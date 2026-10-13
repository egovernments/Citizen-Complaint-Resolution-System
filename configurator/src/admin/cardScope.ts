/**
 * ours (cfgreview F03, #1550): the line under a dashboard number that says what it counts, so it can be read against the
 * list it opens, e.g. "active at ke.bomet \u00b7 16 from ke \u00b7 list: 140 (124 inactive)".
 */
export function cardScope(tenant: string, isMaster: boolean, rows: Record<string, unknown>[], listTotal: number | undefined, inactive: number): string {
  if (!isMaster) return `at ${tenant}`;
  const parts = [`active at ${tenant}`];
  const from = new Map<string, number>();
  for (const r of rows) {
    const t = typeof r._tenantId === 'string' ? r._tenantId : '';
    if (r._isActive === false || !t || t === tenant) continue;
    from.set(t, (from.get(t) ?? 0) + 1);
  }
  for (const [t, n] of [...from].sort()) parts.push(`${n} from ${t}`);
  if (inactive > 0 && listTotal !== undefined) parts.push(`list: ${listTotal} (${inactive} inactive)`);
  return parts.join(' \u00b7 ');
}

/**
 * The county-scoped masters (owner 2026-10-12, option B; ccrs/packages/tenant-tree/county-scoped.json "mdms"): a tenant
 * below the state has its own rows or none.
 */
export const COUNTY_SCOPED_SCHEMAS = [
  'common-masters.Department', 'common-masters.Designation', 'RAINMAKER-PGR.ComplaintHierarchy',
  'RAINMAKER-PGR.ServiceDefs', 'RAINMAKER-PGR.EscalationConfig', 'RAINMAKER-PGR.UIConstants',
];
export const isCountyScopedSchema = (schema: string | undefined): boolean => !!schema && COUNTY_SCOPED_SCHEMAS.includes(schema);

/** A tenant and every tenant below it, from tenant.tenants rows (which all live at the state): active / inactive counts. */
export function tenantSubtree(tenant: string, rows: Record<string, unknown>[]): { active: number; inactive: number } {
  let active = 0;
  let inactive = 0;
  for (const r of rows) {
    const code = String(r.code ?? '');
    if (code !== tenant && !code.startsWith(`${tenant}.`)) continue;
    if (r._isActive === false) inactive += 1; else active += 1;
  }
  return { active, inactive };
}
