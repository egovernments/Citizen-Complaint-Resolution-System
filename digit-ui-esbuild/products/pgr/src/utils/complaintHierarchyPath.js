// Resolve a leaf complaint `serviceCode` into its full hierarchy path so the
// complaint-details pages can show every level (e.g. Main Category › Sector ›
// Sub-Type) instead of the flat Type/Sub-Type pair.
//
// Returns an ordered array `[{ levelCode, label, value }]` from the top level
// down to the leaf sub-type, or `null` when the tenant has no usable hierarchy
// (the caller then falls back to the legacy flat rows).
//
// Linking mirrors the citizen/employee pickers exactly: a leaf ServiceDef links
// to its parent node via `parentCode ?? sector ?? menuPath`, and nodes chain up
// via `parentCode`. Level labels prefer the localized `<HIERARCHYTYPE>_<LEVELCODE>`
// key, then the definition's `label`, then a prettified levelCode.

const prettify = (code) =>
  String(code || "")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export function buildComplaintPath(args = {}) {
  // Hard guarantee: any failure (missing hierarchy, unexpected data shape, etc.)
  // returns null so the caller falls back to the legacy flat Type/Sub-Type rows.
  try {
    return resolveComplaintPath(args);
  } catch (e) {
    return null;
  }
}

function resolveComplaintPath({ serviceCode, def, nodes, serviceDefs, t } = {}) {
  if (!serviceCode || !def || !Array.isArray(def.levels) || def.levels.length === 0) return null;
  const tr = typeof t === "function" ? t : (k) => k;
  const levels = [...def.levels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const leaf = (serviceDefs || []).find((s) => s.serviceCode === serviceCode) || null;

  // Walk the node chain from the leaf's immediate parent up to the root.
  const byCode = new Map((nodes || []).map((n) => [n.code, n]));
  const chain = [];
  if (leaf) {
    const link = leaf.parentCode ?? leaf.sector ?? leaf.menuPath;
    let cur = link ? byCode.get(link) : null;
    const guard = new Set();
    while (cur && !guard.has(cur.code)) {
      guard.add(cur.code);
      chain.push(cur);
      cur = cur.parentCode ? byCode.get(cur.parentCode) : null;
    }
  }

  const labelFor = (lvl) => {
    const key = (String(def.hierarchyType) + "_" + String(lvl.levelCode)).toUpperCase();
    const v = tr(key);
    if (v && v !== key) return v;
    if (lvl.label && lvl.label !== lvl.levelCode) return lvl.label;
    return prettify(lvl.levelCode);
  };

  const rows = levels.map((lvl) => {
    if (lvl.isLeafServiceCode) {
      const key = `SERVICEDEFS.${String(serviceCode).toUpperCase()}`;
      const v = tr(key);
      return { levelCode: lvl.levelCode, label: labelFor(lvl), value: v && v !== key ? v : leaf?.name || serviceCode };
    }
    const node = chain.find((n) => n.levelCode === lvl.levelCode);
    return { levelCode: lvl.levelCode, label: labelFor(lvl), value: node ? node.name || node.code : null };
  });

  // If no non-leaf level resolved to a node, the leaf isn't actually in the tree
  // (flat tenant) — signal "no hierarchy" so the caller keeps the legacy rows.
  const resolvedAnyNode = rows.some((r, i) => !levels[i].isLeafServiceCode && r.value);
  if (!resolvedAnyNode) return null;
  return rows;
}
