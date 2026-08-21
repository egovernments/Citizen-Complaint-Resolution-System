/** Pure state helpers shared by the dashboard's flat and hierarchical multi-selects. */

export const MAX_FILTER_SELECTIONS = 300;

export function normalizeStringList(raw, max = MAX_FILTER_SELECTIONS) {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((value) => String(value ?? "").trim())
        .filter((value) => value && value !== "all")
    ),
  ].slice(0, max);
}

export function normalizeHierarchySelection(raw) {
  if (!raw || typeof raw !== "object") return null;
  const code = String(raw.code ?? "").trim();
  if (!code || code === "all") return null;
  return {
    code,
    path: raw.path != null ? String(raw.path) : null,
    leaf: raw.leaf !== false,
    codes: normalizeStringList(raw.codes ?? (raw.leaf !== false ? [code] : [])),
  };
}

export function normalizeHierarchySelections(raw) {
  const source = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const seen = new Set();
  const selections = [];
  for (const entry of source) {
    const selection = normalizeHierarchySelection(entry);
    if (!selection || seen.has(selection.code)) continue;
    seen.add(selection.code);
    selections.push(selection);
    if (selections.length >= MAX_FILTER_SELECTIONS) break;
  }
  return selections;
}

export function selectedCodes(selections) {
  const codes = [];
  const seen = new Set();
  for (const selection of normalizeHierarchySelections(selections)) {
    const exact = selection.codes.length
      ? selection.codes
      : selection.leaf
      ? [selection.code]
      : [];
    for (const code of exact) {
      if (seen.has(code)) continue;
      seen.add(code);
      codes.push(code);
    }
  }
  return codes;
}

function isSubset(left, right) {
  if (!left.length || !right.length) return false;
  const superset = new Set(right);
  return left.every((code) => superset.has(code));
}

/**
 * Toggle one hierarchy selection while canonicalizing overlap: a selected parent absorbs its
 * descendants, and selecting a parent replaces already-selected descendants.
 */
export function toggleHierarchySelection(current, candidate) {
  const selections = normalizeHierarchySelections(current);
  const next = normalizeHierarchySelection(candidate);
  if (!next) return selections;
  if (selections.some((entry) => entry.code === next.code)) {
    return selections.filter((entry) => entry.code !== next.code);
  }
  if (selections.some((entry) => isSubset(next.codes, entry.codes)))
    return selections;
  return [
    ...selections.filter((entry) => !isSubset(entry.codes, next.codes)),
    next,
  ];
}

export function removeHierarchySelection(current, code) {
  return normalizeHierarchySelections(current).filter(
    (entry) => entry.code !== code
  );
}

export function selectionCountLabel(count, singular, plural = singular) {
  return `${count} ${count === 1 ? singular : plural}`;
}
