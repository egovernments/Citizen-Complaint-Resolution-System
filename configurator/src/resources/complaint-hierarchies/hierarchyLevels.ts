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

// What ComplaintHierarchyEdit saves for a LIVE definition: the structure is the saved one (level codes, parents, leaf
// flag, order: complaints and nodes already point at it), only each level's label / free-text / active come from the
// form, matched by level code. A level the form does not carry keeps its saved values.
export function levelsForEdit(saved: unknown, edited: unknown): Record<string, unknown>[] {
  const was = (Array.isArray(saved) ? (saved as (EditorLevel & Record<string, unknown>)[]) : []).filter((l) => l && l.levelCode);
  const now = new Map((Array.isArray(edited) ? (edited as EditorLevel[]) : []).filter((l) => l && l.levelCode).map((l) => [l.levelCode, l]));
  return was.map((l) => {
    const e = now.get(l.levelCode) ?? {};
    return {
      ...l,
      label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : (typeof l.label === 'string' && l.label) || (l.levelCode as string),
      isFreeText: typeof e.isFreeText === 'boolean' ? e.isFreeText : !!l.isFreeText,
      active: typeof e.active === 'boolean' ? e.active : l.active !== false,
    };
  });
}
