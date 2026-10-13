/** ours (cfgreview F19, #1565): boundary rows (code, parentCode) as a tree, depth first, children by name. */
export interface TreeRow { code: string; name: string; depth: number; parentCode?: string; boundaryType?: string; tenantId?: string; id: unknown }

type Row = Record<string, unknown>;

export function boundaryTree(rows: Row[], nameOf: (code: string) => string | undefined): TreeRow[] {
  const byCode = new Map<string, Row>();
  for (const r of rows) if (typeof r.code === 'string') byCode.set(r.code, r);
  const kids = new Map<string, Row[]>();
  const roots: Row[] = [];
  for (const r of byCode.values()) {
    const p = typeof r.parentCode === 'string' ? r.parentCode : undefined;
    if (p && byCode.has(p) && p !== r.code) (kids.get(p) ?? kids.set(p, []).get(p)!).push(r);
    else roots.push(r);
  }
  const label = (r: Row) => nameOf(String(r.code)) || String(r.code);
  const byName = (a: Row, b: Row) => label(a).localeCompare(label(b));
  const out: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (r: Row, depth: number) => {
    const code = String(r.code);
    if (seen.has(code)) return;
    seen.add(code);
    out.push({ code, name: label(r), depth, parentCode: r.parentCode as string | undefined, boundaryType: r.boundaryType as string | undefined, tenantId: r.tenantId as string | undefined, id: r.id ?? code });
    for (const c of (kids.get(code) ?? []).sort(byName)) walk(c, depth + 1);
  };
  for (const r of roots.sort(byName)) walk(r, 0);
  return out;
}
