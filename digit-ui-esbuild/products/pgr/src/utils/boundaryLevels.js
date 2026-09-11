/**
 * Comparing a configured boundary level name against the tree's own.
 *
 * `PGR_BOUNDARY_LOWEST_LEVEL` is authored by an operator in host_vars, so it
 * carries the tenant's own orthography — Mozambique writes "Municipio" with an
 * accent. The boundary tree stores whatever the loader wrote, which for the
 * same deployment is the unaccented form. A plain (even case-insensitive)
 * comparison therefore misses, and because both sides read correct to a human
 * the miss is invisible: the level simply never applies and the caller falls
 * back, with no error anywhere.
 *
 * So compare on a folded form — strip diacritics, casefold, trim — rather than
 * asking operators to guess which spelling the loader happened to use.
 */

// U+0300-U+036F = combining diacritical marks, what NFD splits accents into.
// Written as escapes: the literal characters are invisible in a diff.
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** "Municipio" with an accent -> "municipio". Leaves ASCII names untouched. */
export const foldLevelName = (name) =>
  String(name ?? "")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .trim()
    .toLowerCase();

/** True when two boundary level names denote the same level. */
export const sameLevelName = (a, b) => {
  const fa = foldLevelName(a);
  return fa.length > 0 && fa === foldLevelName(b);
};

export default sameLevelName;
