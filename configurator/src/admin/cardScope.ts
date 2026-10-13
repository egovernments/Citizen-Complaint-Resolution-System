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
