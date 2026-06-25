// Resolve a leaf complaint `serviceCode` into its full hierarchy path so the
// complaint-details pages can show every level (e.g. Main Category › Sector ›
// Sub-Type) instead of the flat Type/Sub-Type pair.
//
// Returns an ordered array `[{ levelCode, label, value }]` from the top level
// down to the leaf sub-type, or `null` when the tenant has no usable hierarchy
// (the caller then falls back to the legacy flat rows).
//
// Source of truth: the single RAINMAKER-PGR.ComplaintHierarchy adjacency list
// (interior nodes + leaf complaint types). The leaf is the row whose
// `code === serviceCode`; every row (leaf or interior) chains to its parent via
// `parentCode` through one byCode map. Level labels prefer the localized
// `<HIERARCHYTYPE>_<LEVELCODE>` key, then the definition's `label`, then a
// prettified levelCode.

import { complaintLabel } from "./complaintLabel";

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

function resolveComplaintPath({ serviceCode, def, nodes, t } = {}) {
  if (!serviceCode || !def || !Array.isArray(def.levels) || def.levels.length === 0) return null;
  const tr = typeof t === "function" ? t : (k) => k;
  const levels = [...def.levels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // `nodes` is the full ComplaintHierarchy adjacency list (interior + leaf). The
  // complaint's serviceCode is the code of the deepest node the user actually
  // selected — usually a leaf, but it may be an INTERIOR node when that branch
  // had no deeper level (e.g. 3 levels declared but this SECTOR has no SUB_TYPE).
  const byCode = new Map((nodes || []).map((n) => [n.code, n]));
  const self = byCode.get(serviceCode) || null;
  if (!self) return null; // not in the tree (flat tenant) -> caller keeps legacy rows

  // Walk from the selected node INCLUSIVE up to the root via parentCode, so the
  // chain holds the chosen node at its own level plus every ancestor.
  const byLevel = new Map();
  {
    let cur = self;
    const guard = new Set();
    while (cur && !guard.has(cur.code)) {
      guard.add(cur.code);
      byLevel.set(cur.levelCode, cur);
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

  // Emit one row per level from the top down to the selected node. Levels DEEPER
  // than the selected node (never reached on this branch) are omitted entirely,
  // so a SECTOR-coded complaint shows "Category › Sector" — not a blank/duplicated
  // sub-type slot.
  const rows = [];
  for (const lvl of levels) {
    const node = byLevel.get(lvl.levelCode);
    if (!node) continue;
    // Label = key-based (COMPLAINT_HIERARCHY.<code>) like every other service,
    // falling back to the node's own name when the key isn't seeded.
    const value = complaintLabel(tr, node.code, node.name);
    rows.push({ levelCode: lvl.levelCode, label: labelFor(lvl), value });
  }

  // A lone leaf with no resolved ancestors means the tenant isn't really using
  // the hierarchy — fall back to the legacy flat rows.
  if (rows.length === 0) return null;
  if (rows.length === 1) {
    const only = levels.find((l) => l.levelCode === rows[0].levelCode);
    if (only && only.isLeafServiceCode) return null;
  }
  return rows;
}
