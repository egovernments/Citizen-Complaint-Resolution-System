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

export type Path = 'IGE' | 'IGSAE';

export const PATHS: Path[] = ['IGE', 'IGSAE'];

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
  new: number;
  triage: number;
  forwarded: number;
  investigation: number;
  awaiting: number;
  resolved: number;
}

/**
 * In-memory fallback values used to render greyed-out "default: Xh"
 * hints in empty matrix cells when the tenant has not yet persisted a
 * CRS.StateSLA singleton. Operators are expected to populate the real
 * defaults via the configurator UI; these numbers are only a
 * placeholder so the page is usable on a brand-new tenant.
 *
 * `new = 0` so the scheduler's `elapsed >= sla` check fires on the
 * first scan after creation if the operator chooses to leave it at 0.
 */
export const DEFAULT_STATE_DEFAULTS: StateDefaults = {
  new: 0,
  triage: 24,
  forwarded: 48,
  investigation: 120,
  awaiting: 120,
  resolved: 360,
};

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
