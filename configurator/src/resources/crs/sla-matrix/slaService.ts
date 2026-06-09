/**
 * Thin service layer over digitClient for the SLA Matrix page.
 *
 * Centralises the MDMS read/write + audit-log fan-out so the page
 * component (CategorySlaMatrixPage.tsx) can stay declarative.
 */
import { digitClient } from '@/providers/bridge';
import type { MdmsRecord } from '@digit-mcp/data-provider';
import type { CategorySlaRecord, StateDefaults } from './types';
import { makeCategoryUid, DEFAULT_STATE_DEFAULTS } from './types';

const CATEGORY_SLA_SCHEMA = 'CRS.CategorySLA';
const STATE_SLA_SCHEMA = 'CRS.StateSLA';
const AUDIT_LOG_SCHEMA = 'CRS.SLAAuditLog';
const STATE_SLA_UID = 'default';

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

/** Read StateSLA singleton; if absent return the in-memory fallback. */
export async function loadStateSla(tenantId: string): Promise<{ defaults: StateDefaults; record?: MdmsRecord }> {
  const records = await digitClient.mdmsSearch(tenantId, STATE_SLA_SCHEMA, { limit: 5 });
  const active = records.filter((r) => r.isActive !== false);
  if (active.length === 0) {
    return { defaults: { ...DEFAULT_STATE_DEFAULTS } };
  }
  const record = active[0];
  const data = record.data as { stateDefaults?: StateDefaults };
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

export { CATEGORY_SLA_SCHEMA, STATE_SLA_SCHEMA, AUDIT_LOG_SCHEMA };
