// Display label for a ComplaintHierarchy level: the localized
// `<HIERARCHYTYPE>_<LEVELCODE>` key wins, then the definition's `label`, then a
// prettified levelCode. A `label` equal to the raw levelCode (definitions saved
// with raw codes) is treated as unset so AUTHORITY_TYPE renders "Authority Type".

export const prettifyCode = (code) =>
  String(code || "")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export function levelLabel(t, def, lvl) {
  const tr = typeof t === "function" ? t : (k) => k;
  const key = (String(def && def.hierarchyType) + "_" + String(lvl.levelCode)).toUpperCase();
  const v = tr(key);
  if (v && v !== key) return v;
  if (lvl.label && lvl.label !== lvl.levelCode) return lvl.label;
  return prettifyCode(lvl.levelCode);
}
