/** ours (digit-3 P0, 2026-10-14): the tenants the org chart offers - the working tenant and its subtree, the working
 *  tenant first (the state's chart is offered only to someone working at the state). */
export function orgChartTenants<T extends { code?: string }>(tenants: T[], working: string): T[] {
  const inTree = tenants.filter((t) => t.code && (t.code === working || t.code.startsWith(`${working}.`)));
  const list = inTree.length ? inTree : tenants.filter((t) => t.code);
  return [...list].sort((a, b) => (a.code === working ? -1 : b.code === working ? 1 : String(a.code).localeCompare(String(b.code))));
}
