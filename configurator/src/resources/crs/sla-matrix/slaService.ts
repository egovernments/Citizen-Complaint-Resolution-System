/**
 * Thin service layer over digitClient for the SLA Matrix and Escalation
 * Settings pages.
 *
 * Centralises the MDMS read/write + audit-log fan-out so the page
 * components (CategorySlaMatrixPage.tsx, EscalationSettingsPage) can
 * stay declarative.
 */
import { digitClient } from '@/providers/bridge';
import type { MdmsRecord } from '@digit-mcp/data-provider';
import type { CategorySlaRecord, StateDefaults } from './types';
import { makeCategoryUid, DEFAULT_STATE_DEFAULTS } from './types';
import type { EscalationPolicy, WorkflowStateMapping } from './escalationTypes';

const CATEGORY_SLA_SCHEMA = 'CRS.CategorySLA';
const STATE_SLA_SCHEMA = 'CRS.StateSLA';
const ESCALATION_POLICY_SCHEMA = 'CRS.EscalationPolicy';
const WORKFLOW_STATE_MAPPING_SCHEMA = 'CRS.WorkflowStateMapping';
const AUDIT_LOG_SCHEMA = 'CRS.SLAAuditLog';
const STATE_SLA_UID = 'default';

/**
 * CRITICAL — the deployment-wide records (CRS.EscalationPolicy,
 * CRS.WorkflowStateMapping) live at the STATE-LEVEL tenant only. The
 * scheduler (EscalationScheduler) and the manual-escalate validator
 * (ServiceRequestValidator) both read them at state level, so a record
 * saved under a city tenant (`ke.bomet`) is a silent split-brain: the UI
 * would show settings the backend never sees. Every load/save below
 * normalises through this helper; pages use it for display ("These
 * settings apply to the whole deployment") and for the verify scan.
 */
export function toStateTenant(tenantId: string): string {
  return tenantId.split('.')[0];
}

/** Who performed a change — threaded into the audit-log entry on saves. */
export interface AuditActor {
  uuid?: string;
  name?: string;
}

export interface MatrixRow extends CategorySlaRecord {
  /** MDMS record id when persisted; absent for unsaved rows. */
  recordId?: string;
  /** uniqueIdentifier composed from path:category:subcategoryL1. */
  uniqueIdentifier: string;
  /** True if the row exists only in memory (pending save). */
  pending?: boolean;
  /** True if any cell or active flag changed since the last load. */
  modified?: boolean;
  /** Original MDMS record (kept so updates round-trip auditDetails). */
  original?: MdmsRecord;
}

export type AuditAction = 'create' | 'update' | 'delete' | 'bulk-import';

export interface AuditEntry {
  timestamp: number;
  userUuid: string;
  userName: string;
  action: AuditAction;
  schemaCode: string;
  recordIdentifier: string;
  beforeJson?: string;
  afterJson?: string;
  reason?: string;
}

/** Hydrate MdmsRecords into MatrixRows. */
export function mdmsToMatrixRows(records: MdmsRecord[]): MatrixRow[] {
  return records.map((rec) => {
    const data = rec.data as unknown as CategorySlaRecord;
    return {
      ...data,
      uniqueIdentifier: rec.uniqueIdentifier,
      recordId: rec.id,
      original: rec,
      pending: false,
      modified: false,
    };
  });
}

/** Read all active CategorySLA rows for the tenant. */
export async function loadCategorySla(tenantId: string): Promise<MatrixRow[]> {
  // 500 is a safe upper bound for the matrix size we expect from typical
  // tenants. If a tenant outgrows this we switch to paginated load — the
  // rest of the page is wired to take a single MatrixRow[] so swapping
  // the data source is local.
  const records = await digitClient.mdmsSearch(tenantId, CATEGORY_SLA_SCHEMA, { limit: 500 });
  // MDMS v2 search returns soft-deleted (isActive=false) rows too; filter
  // them client-side so the empty state actually shows when an operator
  // has deactivated everything.
  const active = records.filter((r) => r.isActive !== false);
  return mdmsToMatrixRows(active);
}

/**
 * Read StateSLA singleton; if absent return the (now empty) in-memory
 * fallback. Callers must check `isStateDefaultsEmpty(defaults)` and render
 * an explicit "not configured" prompt rather than fall back to magic
 * numbers — `DEFAULT_STATE_DEFAULTS` is intentionally all-null so the
 * page never lies about values the tenant has never set.
 */
export async function loadStateSla(tenantId: string): Promise<{ defaults: StateDefaults; record?: MdmsRecord }> {
  const records = await digitClient.mdmsSearch(tenantId, STATE_SLA_SCHEMA, { limit: 5 });
  const active = records.filter((r) => r.isActive !== false);
  if (active.length === 0) {
    return { defaults: { ...DEFAULT_STATE_DEFAULTS } };
  }
  const record = active[0];
  const data = record.data as { stateDefaults?: Partial<StateDefaults> };
  return { defaults: { ...DEFAULT_STATE_DEFAULTS, ...(data.stateDefaults ?? {}) }, record };
}

/** Save (create or update) a single CategorySLA row. */
export async function saveCategoryRow(
  tenantId: string,
  row: MatrixRow,
): Promise<MdmsRecord> {
  const uniqueIdentifier = makeCategoryUid(row);
  const data: CategorySlaRecord = {
    path: row.path,
    category: row.category,
    subcategoryL1: row.subcategoryL1,
    slaHoursByState: row.slaHoursByState,
    isActive: row.isActive,
  };
  // slaHoursByLevel must survive this projection — it used to list only
  // the five v1 fields, so every save of a row carrying per-level SLAs
  // silently stripped them from MDMS (live data loss on tenants seeded
  // via _seed/add-sla-by-level.sql). Omit the key when the row has none
  // so unset stays unset rather than becoming an explicit empty value.
  if (row.slaHoursByLevel !== undefined) data.slaHoursByLevel = row.slaHoursByLevel;
  if (row.recordId && row.original) {
    return digitClient.mdmsUpdate(
      { ...row.original, data: data as unknown as Record<string, unknown> },
      row.isActive,
    );
  }
  return digitClient.mdmsCreate(tenantId, CATEGORY_SLA_SCHEMA, uniqueIdentifier, data as unknown as Record<string, unknown>);
}

/** Update the StateSLA singleton (create on first save). */
export async function saveStateSla(
  tenantId: string,
  defaults: StateDefaults,
  existing?: MdmsRecord,
): Promise<MdmsRecord> {
  // singletonKey is a placeholder field required by the schema's x-unique
  // (MDMS v2 trips an internal ClassCastException when x-unique is empty,
  // so we tag the singleton with a fixed key value "default").
  const data = { singletonKey: STATE_SLA_UID, stateDefaults: defaults };
  if (existing) {
    return digitClient.mdmsUpdate({ ...existing, data: data as unknown as Record<string, unknown> }, true);
  }
  return digitClient.mdmsCreate(tenantId, STATE_SLA_SCHEMA, STATE_SLA_UID, data as unknown as Record<string, unknown>);
}

/**
 * Read the CRS.EscalationPolicy record (always from the STATE tenant);
 * `policy` is null when the operator has never saved one — callers render
 * "not set, using the previous setting" helpers instead of fake defaults.
 */
export async function loadEscalationPolicy(
  tenantId: string,
): Promise<{ policy: EscalationPolicy | null; record?: MdmsRecord }> {
  const records = await digitClient.mdmsSearch(toStateTenant(tenantId), ESCALATION_POLICY_SCHEMA, { limit: 5 });
  const active = records.filter((r) => r.isActive !== false);
  if (active.length === 0) {
    return { policy: null };
  }
  const record = active[0];
  return { policy: record.data as unknown as EscalationPolicy, record };
}

/**
 * Save (create on first save) the CRS.EscalationPolicy record at the
 * STATE tenant, then append an audit-log entry (recordIdentifier
 * 'policy') attributed to `actor`. Same create-vs-update shape as
 * saveStateSla, including the x-unique singletonKey placeholder.
 */
export async function saveEscalationPolicy(
  tenantId: string,
  policy: EscalationPolicy,
  existing: MdmsRecord | undefined,
  actor: AuditActor,
): Promise<MdmsRecord> {
  const stateTenant = toStateTenant(tenantId);
  const data = { ...policy, singletonKey: STATE_SLA_UID };
  const saved = existing
    ? await digitClient.mdmsUpdate({ ...existing, data: data as unknown as Record<string, unknown> }, true)
    : await digitClient.mdmsCreate(stateTenant, ESCALATION_POLICY_SCHEMA, STATE_SLA_UID, data as unknown as Record<string, unknown>);
  await writeAuditEntry(stateTenant, {
    timestamp: Date.now(),
    userUuid: actor.uuid ?? 'unknown',
    userName: actor.name ?? 'unknown',
    action: existing ? 'update' : 'create',
    schemaCode: ESCALATION_POLICY_SCHEMA,
    recordIdentifier: 'policy',
    beforeJson: existing ? JSON.stringify(existing.data) : undefined,
    afterJson: JSON.stringify(data),
  });
  return saved;
}

/**
 * Read the CRS.WorkflowStateMapping record (always from the STATE
 * tenant); `mapping` is null when none has been saved — the scheduler
 * then skips every per-state SLA source, so callers surface the setup
 * banner rather than inventing a default.
 */
export async function loadWorkflowStateMapping(
  tenantId: string,
): Promise<{ mapping: WorkflowStateMapping | null; record?: MdmsRecord }> {
  const records = await digitClient.mdmsSearch(toStateTenant(tenantId), WORKFLOW_STATE_MAPPING_SCHEMA, { limit: 5 });
  const active = records.filter((r) => r.isActive !== false);
  if (active.length === 0) {
    return { mapping: null };
  }
  const record = active[0];
  const data = record.data as unknown as Partial<WorkflowStateMapping>;
  return { mapping: { singletonKey: 'default', mappings: data.mappings ?? {} }, record };
}

/**
 * Save (create on first save) the CRS.WorkflowStateMapping record at the
 * STATE tenant, then append an audit-log entry (recordIdentifier
 * 'state-mapping') attributed to `actor`.
 */
export async function saveWorkflowStateMapping(
  tenantId: string,
  mapping: WorkflowStateMapping,
  existing: MdmsRecord | undefined,
  actor: AuditActor,
): Promise<MdmsRecord> {
  const stateTenant = toStateTenant(tenantId);
  const data = { singletonKey: STATE_SLA_UID, mappings: mapping.mappings };
  const saved = existing
    ? await digitClient.mdmsUpdate({ ...existing, data: data as unknown as Record<string, unknown> }, true)
    : await digitClient.mdmsCreate(stateTenant, WORKFLOW_STATE_MAPPING_SCHEMA, STATE_SLA_UID, data as unknown as Record<string, unknown>);
  await writeAuditEntry(stateTenant, {
    timestamp: Date.now(),
    userUuid: actor.uuid ?? 'unknown',
    userName: actor.name ?? 'unknown',
    action: existing ? 'update' : 'create',
    schemaCode: WORKFLOW_STATE_MAPPING_SCHEMA,
    recordIdentifier: 'state-mapping',
    beforeJson: existing ? JSON.stringify(existing.data) : undefined,
    afterJson: JSON.stringify(data),
  });
  return saved;
}

/** Delay before the read-after-write verification re-fetch (~1.5s). */
export const READ_AFTER_WRITE_DELAY_MS = 1500;

/**
 * Read-after-write verification. MDMS creates/updates are acknowledged
 * synchronously but persisted asynchronously (Kafka → egov-persister →
 * Postgres); a dead persister acks the write and then silently drops it.
 * Waits ~1.5s, re-fetches via `reload`, and reports whether `matches`
 * sees the write — callers show "Saved, verified" on true and a "saved
 * but not yet visible" warning on false. A failed re-fetch counts as
 * not-verified rather than throwing (the save itself already landed).
 */
export async function verifyAfterWrite<T>(
  reload: () => Promise<T>,
  matches: (current: T) => boolean,
  delayMs: number = READ_AFTER_WRITE_DELAY_MS,
): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  try {
    return matches(await reload());
  } catch {
    return false;
  }
}

/**
 * Append an audit-log entry. Always called AFTER a successful MDMS data
 * write (never before — if the audit write itself fails we surface the
 * error but the MDMS write has already landed, so this is a strictly
 * best-effort safety net).
 */
export async function writeAuditEntry(tenantId: string, entry: AuditEntry): Promise<void> {
  const uid = `${entry.timestamp}:${entry.userUuid}:${entry.recordIdentifier}`;
  try {
    await digitClient.mdmsCreate(
      tenantId,
      AUDIT_LOG_SCHEMA,
      uid,
      entry as unknown as Record<string, unknown>,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[SLA matrix] failed to write audit entry', uid, err);
  }
}

/** Read the most recent N audit entries (for the drawer). */
export async function loadAuditEntries(tenantId: string, limit = 50): Promise<AuditEntry[]> {
  const records = await digitClient.mdmsSearch(tenantId, AUDIT_LOG_SCHEMA, { limit });
  const entries: AuditEntry[] = records.map((rec) => rec.data as unknown as AuditEntry);
  entries.sort((a, b) => b.timestamp - a.timestamp);
  return entries.slice(0, limit);
}

/** Delete a CategorySLA row by soft-deactivating it. MDMS v2 has no hard delete. */
export async function deactivateCategoryRow(row: MatrixRow): Promise<MdmsRecord | null> {
  if (!row.recordId || !row.original) return null;
  return digitClient.mdmsUpdate(row.original, false);
}

export {
  CATEGORY_SLA_SCHEMA,
  STATE_SLA_SCHEMA,
  ESCALATION_POLICY_SCHEMA,
  WORKFLOW_STATE_MAPPING_SCHEMA,
  AUDIT_LOG_SCHEMA,
};
