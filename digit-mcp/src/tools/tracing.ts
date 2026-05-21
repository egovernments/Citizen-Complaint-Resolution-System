import type { ToolMetadata } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import {
  tempoReady,
  collectorHealthy,
  grafanaHealthy,
  getInspectedTraceCount,
  searchTraces,
  getTrace,
} from '../services/tempo.js';

export function registerTracingTools(registry: ToolRegistry): void {
  // ── tracing_health ──
  registry.register({
    name: 'tracing_health',
    group: 'tracing',
    category: 'tracing',
    risk: 'read',
    description:
      'Check the health of the distributed tracing infrastructure: Grafana Tempo (trace storage), ' +
      'OpenTelemetry Collector, and Grafana (UI). Also reports the number of traces Tempo has indexed. ' +
      'Use this first to verify tracing is working before searching or debugging traces.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const [tempo, collector, grafana, inspectedTraces] = await Promise.all([
        tempoReady(),
        collectorHealthy(),
        grafanaHealthy(),
        getInspectedTraceCount(),
      ]);

      const allHealthy = tempo && collector && grafana;

      return JSON.stringify(
        {
          success: true,
          status: allHealthy ? 'healthy' : 'degraded',
          components: {
            tempo: { healthy: tempo, url: process.env.TEMPO_URL || 'http://localhost:13200' },
            collector: { healthy: collector, url: process.env.OTEL_COLLECTOR_URL || 'http://localhost:13133' },
            grafana: { healthy: grafana, url: process.env.GRAFANA_URL || 'http://localhost:13000' },
          },
          inspectedTraces,
          hint: allHealthy
            ? 'All tracing components are running. Use trace_search to find traces or trace_debug for quick failure analysis.'
            : 'Some components are down. Check that Tempo, OTEL Collector, and Grafana containers are running.',
        },
        null,
        2,
      );
    },
  } satisfies ToolMetadata);

  // ── trace_search ──
  registry.register({
    name: 'trace_search',
    group: 'tracing',
    category: 'tracing',
    risk: 'read',
    description:
      'Search for distributed traces by service name, operation, and duration. ' +
      'Queries Grafana Tempo trace storage. Returns matching traces with root service, ' +
      'operation name, duration, and start time. Use this to find traces for a specific ' +
      'service or to locate slow requests.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        service_name: {
          type: 'string',
          description:
            'Filter by service name (e.g. "pgr-services", "egov-workflow-v2", "egov-persister"). ' +
            'Maps to the service.name resource attribute in OpenTelemetry.',
        },
        operation: {
          type: 'string',
          description:
            'Filter by span/operation name (e.g. "POST", "GET", "/_create", "select"). ' +
            'Maps to the span name in traces.',
        },
        min_duration_ms: {
          type: 'number',
          description: 'Minimum trace duration in milliseconds (e.g. 500 for slow traces).',
        },
        max_duration_ms: {
          type: 'number',
          description: 'Maximum trace duration in milliseconds.',
        },
        seconds_ago: {
          type: 'number',
          description: 'How far back to search in seconds (default: 300 = 5 minutes).',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of traces to return (default: 20, max: 100).',
        },
      },
    },
    handler: async (args) => {
      const serviceName = args.service_name as string | undefined;
      const operation = args.operation as string | undefined;
      const minDurationMs = args.min_duration_ms as number | undefined;
      const maxDurationMs = args.max_duration_ms as number | undefined;
      const secondsAgo = args.seconds_ago as number | undefined;
      const rawLimit = args.limit as number | undefined;
      const limit = rawLimit ? Math.min(rawLimit, 100) : 20;

      try {
        const traces = await searchTraces({
          serviceName,
          operation,
          minDurationMs,
          maxDurationMs,
          secondsAgo,
          limit,
        });

        return JSON.stringify(
          {
            success: true,
            count: traces.length,
            filters: {
              ...(serviceName && { service_name: serviceName }),
              ...(operation && { operation }),
              ...(minDurationMs && { min_duration_ms: minDurationMs }),
              ...(maxDurationMs && { max_duration_ms: maxDurationMs }),
              seconds_ago: secondsAgo ?? 300,
              limit,
            },
            traces: traces.map((t) => ({
              traceId: t.traceID,
              rootService: t.rootServiceName,
              rootOperation: t.rootTraceName,
              durationMs: t.durationMs,
              startTime: t.startTimeUnixNano
                ? new Date(Number(t.startTimeUnixNano) / 1_000_000).toISOString()
                : null,
            })),
            hint:
              traces.length > 0
                ? `Use trace_get with a traceId to see full span breakdown, or trace_debug for quick error analysis.`
                : 'No traces found. Try expanding the time window (seconds_ago) or broadening filters.',
          },
          null,
          2,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify(
          {
            success: false,
            error: msg,
            hint: 'Is Tempo running? Use tracing_health to check.',
          },
          null,
          2,
        );
      }
    },
  } satisfies ToolMetadata);

  // ── trace_get ──
  registry.register({
    name: 'trace_get',
    group: 'tracing',
    category: 'tracing',
    risk: 'read',
    description:
      'Get the full trace by ID with a structured span breakdown. Returns all spans grouped by service, ' +
      'with duration, status, and key attributes (http.method, http.status_code, db.statement, etc.). ' +
      'Highlights error spans and provides a Grafana link for visual exploration.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        trace_id: {
          type: 'string',
          description: 'The trace ID to retrieve (hex string, will be padded to 32 chars if shorter).',
        },
      },
      required: ['trace_id'],
    },
    handler: async (args) => {
      const traceId = args.trace_id as string;

      if (!traceId || typeof traceId !== 'string') {
        return JSON.stringify({ success: false, error: 'trace_id is required' }, null, 2);
      }

      try {
        const detail = await getTrace(traceId);

        // Build a concise summary per service
        const serviceSummary: Record<string, { spanCount: number; errorCount: number; operations: string[] }> = {};
        for (const [svc, spans] of Object.entries(detail.services)) {
          const ops = [...new Set(spans.map((s) => s.name))];
          serviceSummary[svc] = {
            spanCount: spans.length,
            errorCount: spans.filter((s) => s.status === 'ERROR').length,
            operations: ops.slice(0, 10),
          };
        }

        return JSON.stringify(
          {
            success: true,
            traceId: detail.traceId,
            durationMs: detail.durationMs,
            spanCount: detail.spanCount,
            serviceCount: Object.keys(detail.services).length,
            serviceSummary,
            errors: detail.errors.map((e) => ({
              service: e.serviceName,
              span: e.name,
              durationMs: e.durationMs,
              attributes: e.attributes,
            })),
            grafanaUrl: detail.grafanaUrl,
            hint:
              detail.errors.length > 0
                ? `Found ${detail.errors.length} error span(s). Check the errors array for details.`
                : 'No error spans found in this trace.',
          },
          null,
          2,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify(
          {
            success: false,
            error: msg,
            hint: 'Check the trace ID is correct. Use trace_search to find valid trace IDs.',
          },
          null,
          2,
        );
      }
    },
  } satisfies ToolMetadata);

  // ── trace_debug ──
  registry.register({
    name: 'trace_debug',
    group: 'tracing',
    category: 'tracing',
    risk: 'read',
    description:
      'One-call debugger: find the most recent trace for a service (optionally filtered by operation), ' +
      'then return the full error analysis and call chain. Use this immediately after an API call fails ' +
      'to understand what went wrong across all services involved in the request. ' +
      'Composite tool: internally calls trace_search + trace_get.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        service_name: {
          type: 'string',
          description:
            'The service to debug (e.g. "pgr-services", "egov-workflow-v2"). Required.',
        },
        operation: {
          type: 'string',
          description:
            'Optional operation/endpoint pattern to narrow the search (e.g. "_create", "POST").',
        },
        seconds_ago: {
          type: 'number',
          description: 'How far back to look in seconds (default: 60).',
        },
      },
      required: ['service_name'],
    },
    handler: async (args) => {
      const serviceName = args.service_name as string;
      const operation = args.operation as string | undefined;
      const secondsAgo = (args.seconds_ago as number) || 60;

      if (!serviceName || typeof serviceName !== 'string') {
        return JSON.stringify({ success: false, error: 'service_name is required' }, null, 2);
      }

      try {
        // Step 1: Find the most recent trace
        const traces = await searchTraces({
          serviceName,
          operation,
          secondsAgo,
          limit: 1,
        });

        if (traces.length === 0) {
          return JSON.stringify(
            {
              success: true,
              found: false,
              message: `No traces found for service "${serviceName}"${operation ? ` with operation "${operation}"` : ''} in the last ${secondsAgo}s.`,
              hint: 'Try increasing seconds_ago or check that the service is instrumented with OpenTelemetry.',
            },
            null,
            2,
          );
        }

        const match = traces[0];

        // Step 2: Get full trace details
        const detail = await getTrace(match.traceID);

        // Build span summary: ordered list of service calls
        const spanSummary = Object.entries(detail.services).map(([svc, spans]) => ({
          service: svc,
          spanCount: spans.length,
          errorCount: spans.filter((s) => s.status === 'ERROR').length,
          operations: [...new Set(spans.map((s) => s.name))].slice(0, 5),
          totalDurationMs: Math.round(spans.reduce((sum, s) => sum + s.durationMs, 0) * 100) / 100,
        }));

        return JSON.stringify(
          {
            success: true,
            found: true,
            traceId: detail.traceId,
            rootService: match.rootServiceName,
            rootOperation: match.rootTraceName,
            durationMs: detail.durationMs,
            servicesInvolved: Object.keys(detail.services),
            errors: detail.errors.map((e) => ({
              service: e.serviceName,
              span: e.name,
              durationMs: e.durationMs,
              attributes: e.attributes,
            })),
            spanSummary,
            grafanaUrl: detail.grafanaUrl,
            hint:
              detail.errors.length > 0
                ? `Found ${detail.errors.length} error(s). The errors array shows which service and span failed.`
                : 'No errors found in this trace. The request completed successfully.',
          },
          null,
          2,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify(
          {
            success: false,
            error: msg,
            hint: 'Is Tempo running? Use tracing_health to check.',
          },
          null,
          2,
        );
      }
    },
  } satisfies ToolMetadata);

  // ── trace_slow ──
  registry.register({
    name: 'trace_slow',
    group: 'tracing',
    category: 'tracing',
    risk: 'read',
    description:
      'Find slow traces above a duration threshold. Returns traces sorted by duration, ' +
      'showing the root service, operation, and duration for each. ' +
      'Useful for identifying performance bottlenecks across the DIGIT platform.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        min_duration_ms: {
          type: 'number',
          description: 'Minimum duration in milliseconds to consider "slow" (default: 500).',
        },
        seconds_ago: {
          type: 'number',
          description: 'How far back to search in seconds (default: 300 = 5 minutes).',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of traces to return (default: 10, max: 50).',
        },
      },
    },
    handler: async (args) => {
      const minDurationMs = (args.min_duration_ms as number) || 500;
      const secondsAgo = (args.seconds_ago as number) || 300;
      const rawLimit = (args.limit as number) || 10;
      const limit = Math.min(rawLimit, 50);

      try {
        const traces = await searchTraces({
          minDurationMs,
          secondsAgo,
          limit,
        });

        // Sort by duration descending
        const sorted = traces.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));

        return JSON.stringify(
          {
            success: true,
            count: sorted.length,
            threshold_ms: minDurationMs,
            seconds_ago: secondsAgo,
            traces: sorted.map((t) => ({
              traceId: t.traceID,
              service: t.rootServiceName,
              operation: t.rootTraceName,
              durationMs: t.durationMs,
              startTime: t.startTimeUnixNano
                ? new Date(Number(t.startTimeUnixNano) / 1_000_000).toISOString()
                : null,
            })),
            hint:
              sorted.length > 0
                ? `Found ${sorted.length} trace(s) slower than ${minDurationMs}ms. Use trace_get with a traceId to see the full span breakdown.`
                : `No traces found above ${minDurationMs}ms. Try lowering the threshold or expanding the time window.`,
          },
          null,
          2,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify(
          {
            success: false,
            error: msg,
            hint: 'Is Tempo running? Use tracing_health to check.',
          },
          null,
          2,
        );
      }
    },
  } satisfies ToolMetadata);
}
