// What ComplaintHierarchyCreate saves for each level row (RAINMAKER-PGR.ComplaintHierarchyDefinition levels[]).
// The editor's own values win; only what the operator left empty is filled: order = row position (top -> leaf),
// label = the level code, isFreeText = false, active = true. Rows without a level code are dropped.
export interface EditorLevel {
  levelCode?: string;
  parentLevel?: string | null;
  isLeafServiceCode?: boolean;
  label?: string;
  isFreeText?: boolean;
  active?: boolean;
}

export function levelsForSave(levels: unknown): Record<string, unknown>[] {
  const rows = (Array.isArray(levels) ? (levels as EditorLevel[]) : []).filter((l) => l && l.levelCode);
  return rows.map((l, i) => ({
    levelCode: l.levelCode as string,
    order: i + 1,
    parentLevel: i === 0 ? null : l.parentLevel || null,
    isFreeText: typeof l.isFreeText === 'boolean' ? l.isFreeText : false,
    isLeafServiceCode: !!l.isLeafServiceCode,
    label: typeof l.label === 'string' && l.label.trim() ? l.label.trim() : (l.levelCode as string),
    active: typeof l.active === 'boolean' ? l.active : true,
  }));
}
