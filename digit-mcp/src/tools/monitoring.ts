import type { ToolMetadata } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { rpkDescribeGroup, persisterLogs, psqlCountAll, psqlCountOne } from '../services/shell.js';
import { digitApi } from '../services/digit-api.js';

// ──────────────────────────────────────────
// Module-level cache for db_counts deltas
// ──────────────────────────────────────────
const previousCounts: Map<string, number> = new Map();

// ──────────────────────────────────────────
// Probe implementations
// ──────────────────────────────────────────

interface KafkaLagResult {
  ok: boolean;
  group?: string;
  state?: string;
  topics: { topic: string; partition: number; currentOffset: number; logEndOffset: number; lag: number }[];
  totalLag: number;
  status: 'OK' | 'WARN' | 'CRITICAL' | 'ERROR';
  error?: string;
}

function probeKafkaLag(): KafkaLagResult {
  const result = rpkDescribeGroup();
  if (!result.ok) {
    return { ok: false, topics: [], totalLag: -1, status: 'ERROR', error: result.error };
  }

  try {
    const parsed = JSON.parse(result.stdout);

    const topics: KafkaLagResult['topics'] = [];
    let totalLag = 0;

    // rpk JSON format: handle both nested and flat partition formats
    const groupTopics = parsed.topics || parsed.partitions || [];
    if (Array.isArray(groupTopics)) {
      for (const entry of groupTopics) {
        // Flat partition array format
        if (entry.topic !== undefined && entry.partition !== undefined) {
          const lag = Number(entry.lag ?? 0);
          topics.push({
            topic: entry.topic,
            partition: Number(entry.partition),
            currentOffset: Number(entry.current_offset ?? entry.committed_offset ?? 0),
            logEndOffset: Number(entry.log_end_offset ?? 0),
            lag,
          });
          totalLag += lag;
        }
        // Nested topic format: { topic: string, partitions: [...] }
        if (entry.partitions && Array.isArray(entry.partitions)) {
          for (const p of entry.partitions) {
            const lag = Number(p.lag ?? 0);
            topics.push({
              topic: entry.topic,
              partition: Number(p.partition),
              currentOffset: Number(p.current_offset ?? p.committed_offset ?? 0),
              logEndOffset: Number(p.log_end_offset ?? 0),
              lag,
            });
            totalLag += lag;
          }
        }
      }
    }

    let status: KafkaLagResult['status'] = 'OK';
    if (totalLag > 100) status = 'CRITICAL';
    else if (totalLag > 0) status = 'WARN';

    return {
      ok: true,
      group: parsed.name || 'egov-persister',
      state: parsed.state,
      topics,
      totalLag,
      status,
    };
  } catch {
    // rpk may return non-JSON (e.g. tabular). Try line-based parsing.
    return parseTabularRpkOutput(result.stdout);
  }
}

function parseTabularRpkOutput(stdout: string): KafkaLagResult {
  const lines = stdout.split('\n').filter(Boolean);
  const topics: KafkaLagResult['topics'] = [];
  let totalLag = 0;

  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] === 'TOPIC' || cols[0] === 'GROUP') continue;
    if (cols.length >= 5) {
      const partition = parseInt(cols[1], 10);
      const currentOffset = parseInt(cols[2], 10);
      const logEndOffset = parseInt(cols[3], 10);
      const lag = parseInt(cols[4], 10);
      if (!isNaN(partition) && !isNaN(lag)) {
        topics.push({ topic: cols[0], partition, currentOffset, logEndOffset, lag });
        totalLag += lag;
      }
    }
  }

  if (topics.length === 0) {
    return { ok: true, topics: [], totalLag: 0, status: 'OK', error: 'No partition data found in rpk output' };
  }

  let status: KafkaLagResult['status'] = 'OK';
  if (totalLag > 100) status = 'CRITICAL';
  else if (totalLag > 0) status = 'WARN';

  return { ok: true, group: 'egov-persister', topics, totalLag, status };
}

// ──────────────────────────────────────────

interface ErrorCategory {
  pattern: RegExp;
  name: string;
}

const ERROR_CATEGORIES: ErrorCategory[] = [
  { pattern: /DataIntegrityViolation/i, name: 'DataIntegrityViolation' },
  { pattern: /CannotCreateTransaction/i, name: 'CannotCreateTransaction' },
  { pattern: /CommitFailed|commit.*fail/i, name: 'CommitFailed' },
  { pattern: /ListenerExecutionFailed/i, name: 'ListenerExecutionFailed' },
  { pattern: /rollback/i, name: 'Rollback' },
  { pattern: /dead[.\s_-]*letter|DLT/i, name: 'DeadLetterTopic' },
  { pattern: /exception/i, name: 'GenericException' },
  { pattern: /error/i, name: 'GenericError' },
];

interface PersisterErrorsResult {
  ok: boolean;
  since: string;
  totalErrorLines: number;
  categories: Record<string, { count: number; samples: string[] }>;
  status: 'OK' | 'WARN' | 'CRITICAL' | 'ERROR';
  error?: string;
}

function probePersisterErrors(since: string): PersisterErrorsResult {
  // persisterLogs validates the since param against /^[0-9]+[smh]$/
  const result = persisterLogs(since);
  if (!result.ok) {
    return { ok: false, since, totalErrorLines: 0, categories: {}, status: 'ERROR', error: result.error };
  }

  const lines = result.stdout.split('\n');
  const errorLines = lines.filter(l => /error|exception|rollback|failed|DLT|dead.letter/i.test(l));

  const categories: Record<string, { count: number; samples: string[] }> = {};

  for (const line of errorLines) {
    let matched = false;
    for (const cat of ERROR_CATEGORIES) {
      if (cat.pattern.test(line)) {
        if (!categories[cat.name]) categories[cat.name] = { count: 0, samples: [] };
        categories[cat.name].count++;
        if (categories[cat.name].samples.length < 3) {
          categories[cat.name].samples.push(line.substring(0, 300));
        }
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (!categories['Other']) categories['Other'] = { count: 0, samples: [] };
      categories['Other'].count++;
      if (categories['Other'].samples.length < 3) {
        categories['Other'].samples.push(line.substring(0, 300));
      }
    }
  }

  let status: PersisterErrorsResult['status'] = 'OK';
  const total = errorLines.length;
  if (categories['DeadLetterTopic']?.count || categories['DataIntegrityViolation']?.count) {
    status = 'CRITICAL';
  } else if (total > 10) {
    status = 'CRITICAL';
  } else if (total > 0) {
    status = 'WARN';
  }

  return { ok: true, since, totalErrorLines: total, categories, status };
}

// ──────────────────────────────────────────

interface DbCountsResult {
  ok: boolean;
  tables: { table: string; count: number; delta: number | null }[];
  status: 'OK' | 'WARN' | 'ERROR';
  error?: string;
}

// Hardcoded table list — never from user input
const MONITORED_TABLES = [
  'eg_pgr_service_v2',
  'eg_pgr_address_v2',
  'eg_wf_processinstance_v2',
  'eg_wf_state_v2',
  'eg_hrms_employee',
] as const;

function probeDbCounts(): DbCountsResult {
  const tables: DbCountsResult['tables'] = [];

  const result = psqlCountAll(MONITORED_TABLES);
  if (!result.ok) {
    return probeDbCountsFallback();
  }

  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [tbl, cntStr] = line.split('|');
    if (!tbl) continue;
    const count = parseInt(cntStr, 10) || 0;
    const prev = previousCounts.get(tbl);
    const delta = prev !== undefined ? count - prev : null;
    previousCounts.set(tbl, count);
    tables.push({ table: tbl, count, delta });
  }

  return { ok: true, tables, status: 'OK' };
}

function probeDbCountsFallback(): DbCountsResult {
  const tables: DbCountsResult['tables'] = [];
  let hasError = false;

  for (const tbl of MONITORED_TABLES) {
    const result = psqlCountOne(tbl);
    if (result.ok) {
      const count = parseInt(result.stdout.trim(), 10) || 0;
      const prev = previousCounts.get(tbl);
      const delta = prev !== undefined ? count - prev : null;
      previousCounts.set(tbl, count);
      tables.push({ table: tbl, count, delta });
    } else {
      hasError = true;
      tables.push({ table: tbl, count: -1, delta: null });
    }
  }

  return { ok: true, tables, status: hasError ? 'WARN' : 'OK' };
}

// ──────────────────────────────────────────
// Allowed "since" values for the persister_errors tool.
// Restricts input to a safe enum instead of freeform string.
// ──────────────────────────────────────────
const ALLOWED_SINCE = ['30s', '1m', '5m', '15m', '30m', '1h', '2h', '6h', '12h', '24h'] as const;
type AllowedSince = typeof ALLOWED_SINCE[number];

// ──────────────────────────────────────────
// Tool registration
// ──────────────────────────────────────────

export function registerMonitoringTools(registry: ToolRegistry): void {

  // ── kafka_lag ──
  registry.register({
    name: 'kafka_lag',
    group: 'monitoring',
    category: 'monitoring',
    risk: 'read',
    description:
      'Check Kafka consumer group lag for egov-persister via Redpanda rpk. ' +
      'Returns per-topic/partition lag, current offset, log end offset, and overall status. ' +
      'Status: OK (lag=0), WARN (1-100), CRITICAL (>100). ' +
      'Requires the digit-redpanda Docker container to be running.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const result = probeKafkaLag();
      return JSON.stringify({
        success: result.ok,
        probe: 'kafka_lag',
        ...result,
      }, null, 2);
    },
  } satisfies ToolMetadata);

  // ── persister_errors ──
  registry.register({
    name: 'persister_errors',
    group: 'monitoring',
    category: 'monitoring',
    risk: 'read',
    description:
      'Scan egov-persister container logs for errors. ' +
      'Categorizes errors: DataIntegrityViolation, CannotCreateTransaction, CommitFailed, ' +
      'ListenerExecutionFailed, Rollback, DeadLetterTopic, GenericException, GenericError. ' +
      'Returns counts per category with sample error lines. ' +
      'Requires the egov-persister Docker container to be running.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        since: {
          type: 'string',
          enum: ALLOWED_SINCE as unknown as string[],
          description: 'Time window for log scan. Default: "5m".',
        },
      },
    },
    handler: async (args) => {
      const since = (args.since as AllowedSince) || '5m';
      const result = probePersisterErrors(since);
      return JSON.stringify({
        success: result.ok,
        probe: 'persister_errors',
        ...result,
      }, null, 2);
    },
  } satisfies ToolMetadata);

  // ── db_counts ──
  registry.register({
    name: 'db_counts',
    group: 'monitoring',
    category: 'monitoring',
    risk: 'read',
    description:
      'Get row counts for key DIGIT database tables via direct psql query. ' +
      'Tables: eg_pgr_service_v2, eg_pgr_address_v2, eg_wf_processinstance_v2, eg_wf_state_v2, eg_hrms_employee. ' +
      'Returns current count and delta from previous call (null on first call). ' +
      'Connects to PostgreSQL at localhost:15432 (user: egov, db: egov).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const result = probeDbCounts();
      return JSON.stringify({
        success: result.ok,
        probe: 'db_counts',
        ...result,
      }, null, 2);
    },
  } satisfies ToolMetadata);

  // ── persister_monitor (composite) ──
  registry.register({
    name: 'persister_monitor',
    group: 'monitoring',
    category: 'monitoring',
    risk: 'read',
    description:
      'Comprehensive persister health monitor. Runs all monitoring probes and cross-references results. ' +
      'Probes: (1) Kafka consumer lag, (2) Persister error log scan, ' +
      '(3) DB row counts, (4) Kafka-vs-DB delta comparison, (5) PGR-Workflow transaction parity. ' +
      'Returns composite JSON with per-probe results and aggregated alerts. ' +
      'Accepts tenant_id for API-based probes, since for log window, skip_probes to skip specific probes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID for API-based probes (PGR search, workflow search). Defaults to environment state tenant.',
        },
        since: {
          type: 'string',
          enum: ALLOWED_SINCE as unknown as string[],
          description: 'Time window for persister error log scan. Default: "5m".',
        },
        skip_probes: {
          type: 'array',
          items: { type: 'string', enum: ['kafka_lag', 'persister_errors', 'db_counts', 'parity'] },
          description: 'Probe names to skip (e.g. ["parity"] to skip the API-based parity check).',
        },
      },
    },
    handler: async (args) => {
      const tenantId = (args.tenant_id as string) || digitApi.getEnvironmentInfo().stateTenantId;
      const since = (args.since as AllowedSince) || '5m';
      const skipProbes = new Set((args.skip_probes as string[]) || []);
      const alerts: { level: 'WARN' | 'CRITICAL'; probe: string; message: string }[] = [];

      // ── Probe 1: Kafka lag ──
      let kafkaLag: KafkaLagResult | null = null;
      if (!skipProbes.has('kafka_lag')) {
        kafkaLag = probeKafkaLag();
        if (kafkaLag.status === 'CRITICAL') {
          alerts.push({ level: 'CRITICAL', probe: 'kafka_lag', message: `Total lag: ${kafkaLag.totalLag} messages` });
        } else if (kafkaLag.status === 'WARN') {
          alerts.push({ level: 'WARN', probe: 'kafka_lag', message: `Total lag: ${kafkaLag.totalLag} messages` });
        } else if (kafkaLag.status === 'ERROR') {
          alerts.push({ level: 'CRITICAL', probe: 'kafka_lag', message: `Probe failed: ${kafkaLag.error}` });
        }
      }

      // ── Probe 2: Persister errors ──
      let persisterErrors: PersisterErrorsResult | null = null;
      if (!skipProbes.has('persister_errors')) {
        persisterErrors = probePersisterErrors(since);
        if (persisterErrors.status === 'CRITICAL') {
          alerts.push({ level: 'CRITICAL', probe: 'persister_errors', message: `${persisterErrors.totalErrorLines} error lines in last ${since}` });
        } else if (persisterErrors.status === 'WARN') {
          alerts.push({ level: 'WARN', probe: 'persister_errors', message: `${persisterErrors.totalErrorLines} error lines in last ${since}` });
        }
      }

      // ── Probe 3: DB counts ──
      let dbCounts: DbCountsResult | null = null;
      if (!skipProbes.has('db_counts')) {
        dbCounts = probeDbCounts();
        if (dbCounts.status === 'WARN') {
          alerts.push({ level: 'WARN', probe: 'db_counts', message: 'Some tables could not be queried' });
        }
      }

      // ── Probe 4: Kafka-vs-DB delta ──
      let kafkaVsDb: { status: string; detail?: string } | null = null;
      if (kafkaLag && dbCounts && kafkaLag.ok && dbCounts.ok) {
        const pgrTable = dbCounts.tables.find(t => t.table === 'eg_pgr_service_v2');
        if (kafkaLag.totalLag > 0 && pgrTable && pgrTable.delta !== null && pgrTable.delta === 0) {
          const detail = 'Kafka has lag but PGR table count unchanged — persister may be stuck';
          kafkaVsDb = { status: 'WARN', detail };
          alerts.push({ level: 'WARN', probe: 'kafka_vs_db', message: detail });
        } else if (kafkaLag.totalLag === 0 && pgrTable) {
          kafkaVsDb = { status: 'OK', detail: 'Kafka fully consumed, DB counts consistent' };
        } else {
          kafkaVsDb = { status: 'OK', detail: 'No anomaly detected' };
        }
      }

      // ── Probe 5: Transaction parity (PGR IDs vs Workflow businessIds) ──
      let parity: { status: string; pgrCount?: number; workflowCount?: number; missingInWorkflow?: string[]; detail?: string; error?: string } | null = null;
      if (!skipProbes.has('parity')) {
        try {
          if (!digitApi.isAuthenticated()) {
            const username = process.env.CRS_USERNAME;
            const password = process.env.CRS_PASSWORD;
            const loginTenant = process.env.CRS_TENANT_ID || tenantId;
            if (username && password) {
              await digitApi.login(username, password, loginTenant);
            }
          }

          if (digitApi.isAuthenticated()) {
            const pgrResults = await digitApi.pgrSearch(tenantId, { limit: 100, offset: 0 });
            const pgrIds: string[] = pgrResults
              .map(sw => ((sw.service as Record<string, unknown>)?.serviceRequestId as string))
              .filter(Boolean);

            if (pgrIds.length > 0) {
              const wfResults = await digitApi.workflowProcessSearch(tenantId, pgrIds, { limit: 200, offset: 0 });
              const wfBusinessIds = new Set(wfResults.map(p => p.businessId as string));
              const missingInWorkflow = pgrIds.filter(id => !wfBusinessIds.has(id));

              const detail = missingInWorkflow.length > 0
                ? `${missingInWorkflow.length} PGR complaints have no matching workflow process instance`
                : 'All PGR complaints have matching workflow entries';

              parity = {
                status: missingInWorkflow.length > 0 ? 'WARN' : 'OK',
                pgrCount: pgrIds.length,
                workflowCount: wfBusinessIds.size,
                missingInWorkflow: missingInWorkflow.length > 0 ? missingInWorkflow : undefined,
                detail,
              };

              if (missingInWorkflow.length > 0) {
                alerts.push({ level: 'WARN', probe: 'parity', message: detail });
              }
            } else {
              parity = { status: 'OK', pgrCount: 0, workflowCount: 0, detail: 'No PGR complaints found' };
            }
          } else {
            parity = { status: 'SKIPPED', error: 'Not authenticated — parity check requires API access' };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parity = { status: 'ERROR', error: msg };
          alerts.push({ level: 'WARN', probe: 'parity', message: `Parity check failed: ${msg}` });
        }
      }

      // ── Aggregate status ──
      const hasCritical = alerts.some(a => a.level === 'CRITICAL');
      const hasWarn = alerts.some(a => a.level === 'WARN');
      const overallStatus = hasCritical ? 'CRITICAL' : hasWarn ? 'WARN' : 'OK';

      return JSON.stringify({
        success: true,
        probe: 'persister_monitor',
        tenantId,
        timestamp: new Date().toISOString(),
        overallStatus,
        probes: {
          kafka_lag: kafkaLag ? { status: kafkaLag.status, totalLag: kafkaLag.totalLag, topics: kafkaLag.topics } : 'skipped',
          persister_errors: persisterErrors ? { status: persisterErrors.status, totalErrorLines: persisterErrors.totalErrorLines, categories: persisterErrors.categories } : 'skipped',
          db_counts: dbCounts ? { status: dbCounts.status, tables: dbCounts.tables } : 'skipped',
          kafka_vs_db: kafkaVsDb || 'skipped',
          parity: parity || 'skipped',
        },
        alerts,
        alertCount: alerts.length,
      }, null, 2);
    },
  } satisfies ToolMetadata);
}
