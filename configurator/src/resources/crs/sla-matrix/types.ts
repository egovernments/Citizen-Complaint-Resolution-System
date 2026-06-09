/**
 * Shared types for the CRS escalation-SLA matrix page.
 *
 * The matrix maps (path, category, subcategoryL1) tuples to a per-workflow-state
 * SLA value. Cells can be:
 *   - null   → fall back to CRS.StateSLA defaults
 *   - number → SLA in hours
 *   - tuple  → [min, max] range; scheduler uses MAX for breach detection,
 *              UI renders "min-max h"
 *
 * Mirrors the CRS.CategorySLA MDMS schema 1:1.
 */

/**
 * `path` is a tenant-defined routing key — any non-empty string. The schema
 * accepts arbitrary strings; the UI derives the available chip set from
 * whatever values the operator has actually entered in CategorySLA rows.
 */
export type Path = string;

/**
 * Empty by default — operators populate paths as they add rows. The page
 * computes the live distinct set from loaded CategorySLA records and uses
 * that for the path filter chips. Kept exported so legacy imports still
 * resolve.
 */
export const PATHS: Path[] = [];

/**
 * The 6 PGR/CRS workflow states the scheduler tracks. Names match the
 * JSON property names in CRS.CategorySLA.slaHoursByState — keep these
 * in sync if the schema is renamed.
 */
export type StateKey =
  | 'new'
  | 'triage'
  | 'forwarded'
  | 'investigation'
  | 'awaiting'
  | 'resolved';

export const STATE_KEYS: StateKey[] = [
  'new',
  'triage',
  'forwarded',
  'investigation',
  'awaiting',
  'resolved',
];

/** Human label per state used in column headers + audit messages. */
export const STATE_LABELS: Record<StateKey, string> = {
  new: 'NEW',
  triage: 'TRIAGE',
  forwarded: 'FORWARDED',
  investigation: 'INVESTIGATION',
  awaiting: 'AWAITING',
  resolved: 'RESOLVED',
};

export type CellValue = number | [number, number] | null;

export interface SlaHoursByState {
  new?: CellValue;
  triage?: CellValue;
  forwarded?: CellValue;
  investigation?: CellValue;
  awaiting?: CellValue;
  resolved?: CellValue;
}

export interface CategorySlaRecord {
  path: Path;
  category: string;
  subcategoryL1: string;
  slaHoursByState: SlaHoursByState;
  isActive: boolean;
}

export interface StateDefaults {
  new: number | null;
  triage: number | null;
  forwarded: number | null;
  investigation: number | null;
  awaiting: number | null;
  resolved: number | null;
}

/**
 * Empty by default — operators populate via the configurator. Listed here
 * only as a typed shape hint so the page can iterate STATE_KEYS without
 * branching on missing keys. When CRS.StateSLA is empty AND every value
 * here is null, the page renders a "Not configured" prompt instead of
 * fake magic numbers.
 *
 * Historically this carried a Mozambique-specific set of BRD §5.2 values
 * ({new:0, triage:24, forwarded:48, investigation:120, awaiting:120,
 * resolved:360}) — that has been removed so the configurator does not
 * lie about defaults the tenant has never set.
 */
export const DEFAULT_STATE_DEFAULTS: StateDefaults = {
  new: null,
  triage: null,
  forwarded: null,
  investigation: null,
  awaiting: null,
  resolved: null,
};

/** True when no per-state default has been configured (all six null). */
export function isStateDefaultsEmpty(d: StateDefaults): boolean {
  return STATE_KEYS.every((k) => d[k] === null || d[k] === undefined);
}

/** Compose the uniqueIdentifier the MDMS schema expects. */
export function makeCategoryUid(rec: { path: Path; category: string; subcategoryL1: string }): string {
  return `${rec.path}:${rec.category}:${rec.subcategoryL1}`;
}

/** Render a cell value the same way the matrix grid does. */
export function formatCell(v: CellValue): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return `${v[0]}–${v[1]}h`;
  return `${v}h`;
}

/**
 * For scheduler-style breach math, collapse a range to its max bound. This
 * matches what EscalationScheduler.resolveSlaHours does on the backend so
 * the trace-back tool's preview agrees with the scheduler's decision.
 */
export function effectiveHours(v: CellValue): number | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v[1];
  return v;
}
