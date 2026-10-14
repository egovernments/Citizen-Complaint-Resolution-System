/**
 * ours (#1550, option B, owner 2026-10-12): COUNTY-SCOPED masters. A tenant below the state never inherits these from
 * the state itself, only from its own subtree; shared masters keep inheriting. The state's own county (stateCounty:
 * the county whose config lives AT the state, today Bomet at ke) and its subtree are the exception and keep the
 * state's rows. Mirrors ccrs-compat's rule (src/compat/core/countyScoped.js, county-scoped.json), so a backend that
 * still answers nearest-ancestor rows shows the same as one that applies it.
 */
import type { MdmsRecord } from '../client/types.js';

export const COUNTY_SCOPED_SCHEMAS: readonly string[] = [
  'common-masters.Department',
  'common-masters.Designation',
  'RAINMAKER-PGR.ComplaintHierarchy',
  'RAINMAKER-PGR.ServiceDefs',
  'RAINMAKER-PGR.EscalationConfig',
  'RAINMAKER-PGR.UIConstants',
];

/** state -> the county whose county-scoped config lives at the state (county-scoped.json stateCounty). */
let stateCounties: Record<string, string> = { ke: 'ke.bomet' };

/** Set the stateCounty map (e.g. {} on a stack where every county holds its own config). */
export function setStateCounties(map: Record<string, string>): void {
  stateCounties = { ...map };
}

const within = (t: string, node: string) => t === node || t.startsWith(`${node}.`);

/** True when `tenant` must not read the state's rows of `schema`: a county-scoped master, below the state, outside stateCounty. */
export function skipsState(tenant: string, schema: string): boolean {
  if (!COUNTY_SCOPED_SCHEMAS.includes(schema) || !tenant.includes('.')) return false;
  const county = stateCounties[tenant.split('.')[0]];
  return !(county && within(tenant, county));
}

/** The rows `tenant` may show: the state's rows of a county-scoped master are dropped below the state (option B). */
export function withoutStateRows(tenant: string, schema: string, rows: MdmsRecord[]): MdmsRecord[] {
  if (!skipsState(tenant, schema)) return rows;
  const state = tenant.split('.')[0];
  return rows.filter((r) => r.tenantId !== state);
}
