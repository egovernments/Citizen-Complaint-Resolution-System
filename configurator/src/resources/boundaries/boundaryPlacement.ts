// A boundary's place in its hierarchy, read from the flattened boundary tree (dataProvider boundaryGetList rows:
// code, boundaryType, hierarchyType, parentCode). The entity record Edit loads carries none of these.
export interface BoundaryRow { id?: unknown; code?: unknown; name?: unknown; boundaryType?: unknown; hierarchyType?: unknown; parentCode?: unknown }
export interface Placement { code: string; boundaryType: string; hierarchyType: string; parent: string | null; parentType: string | null }

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function placementOf(rows: BoundaryRow[], id: unknown): Placement | null {
  const self = rows.find((r) => s(r.id) === s(id) || s(r.code) === s(id));
  if (!self) return null;
  const parent = s(self.parentCode) || null;
  const parentRow = parent ? rows.find((r) => s(r.code) === parent) : undefined;
  return {
    code: s(self.code),
    boundaryType: s(self.boundaryType),
    hierarchyType: s(self.hierarchyType),
    parent,
    parentType: parentRow ? s(parentRow.boundaryType) : null,
  };
}

/** The boundaries this one may move under: the parent's level, same hierarchy, not itself. */
export function parentChoices(rows: BoundaryRow[], p: Placement): { value: string; label: string }[] {
  return rows
    .filter((r) => s(r.boundaryType) === p.parentType && s(r.hierarchyType) === p.hierarchyType && s(r.code) !== p.code)
    .map((r) => ({ value: s(r.code), label: s(r.name) && s(r.name) !== s(r.code) ? `${s(r.name)} (${s(r.code)})` : s(r.code) }));
}
