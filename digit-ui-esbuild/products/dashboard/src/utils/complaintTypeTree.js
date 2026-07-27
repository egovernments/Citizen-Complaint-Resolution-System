/**
 * Pure helpers for the tree-traversal complaint-type filter (one-widget
 * subtree navigation replacing the flat leaf <select> in the filter bar).
 *
 * Model: the applied filter node is a single MDMS ComplaintHierarchy node —
 *   root ("all")   → no type narrowing at all,
 *   interior node  → subtree filter, sent as `params.complaintPath` (the
 *                    node's dot-path; the backend turns it into a
 *                    starts_with predicate on `complaint_node_path`),
 *   leaf node      → exact filter, sent as `params.serviceCode` (unchanged
 *                    wire shape — back-compat with every backend, and the
 *                    daily grain has service_code but no path column).
 *
 * ABAC: the MDMS master is the FULL tenant tree, but the filter must only
 * ever offer what the caller's row scope can see. pruneComplaintTree
 * intersects the tree with the ABAC-scoped DISTINCT service_code list the
 * dashboard already fetches (useFilterOptions), dropping every branch with
 * zero scoped leaves — a dept-scoped supervisor never sees (or can select)
 * types outside their scope.
 *
 * Everything here is pure (no fetch, no window, no React) so it is
 * unit-testable with node --test; complaintHierarchyService.js does the MDMS
 * fetch, useFilterOptions.js the intersection inputs, and
 * ComplaintTypeTreeFilter.jsx the rendering.
 */

/** Root sentinel — matches the existing filter-state convention. */
export const ALL = "all";

/** The cleared selection trio ({ code, path, leaf }) stored in filters. */
export function clearedSelection() {
  return { code: ALL, path: null, leaf: false };
}

/**
 * Build the complaint-type tree from RAINMAKER-PGR.ComplaintHierarchy records
 * ({ code, name, path (dot-delimited), parentCode, active, ... }).
 *
 * Returns { byCode: Map<code, node>, roots: node[] } or null when no usable
 * records. Node shape:
 *   { code, label (data-owned name, undefined when name === code),
 *     path (dot-path; record.path else derived parent.path + "." + code),
 *     parentCode (null for roots), children: node[], isLeaf }
 *
 * Known data caveat (validation risk #3i): nodes whose CODES contain "." have
 * NULL complaint_node_path on the analytics MV (#1282 migration), so a
 * subtree filter rooted above them will not match those rows. The tree still
 * renders them; the gap is a data/migration concern, not a FE one.
 */
export function buildComplaintTree(records) {
  const byCode = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const code = String(record?.code ?? "").trim();
    if (!code || record?.active === false) continue;
    const name = String(record?.name ?? "").trim();
    byCode.set(code, {
      code,
      label: name && name !== code ? name : undefined,
      recordPath: String(record?.path ?? "").trim() || null,
      parentCode: String(record?.parentCode ?? "").trim() || null,
      children: [],
      isLeaf: true,
    });
  }
  if (!byCode.size) return null;

  const roots = [];
  for (const node of byCode.values()) {
    const parent =
      node.parentCode && node.parentCode !== node.code
        ? byCode.get(node.parentCode)
        : null;
    if (parent) {
      parent.children.push(node);
      parent.isLeaf = false;
    } else {
      node.parentCode = null;
      roots.push(node);
    }
  }

  // Derive dot-paths root-down (record.path wins when present), cycle-safe:
  // only nodes reachable from a root get visited; orphan cycles are dropped.
  const reachable = new Set();
  const stack = roots.map((r) => [r, null]);
  while (stack.length) {
    const [node, parentPath] = stack.pop();
    if (reachable.has(node.code)) continue;
    reachable.add(node.code);
    node.path =
      node.recordPath || (parentPath ? `${parentPath}.${node.code}` : node.code);
    delete node.recordPath;
    for (const child of node.children) stack.push([child, node.path]);
  }
  for (const code of [...byCode.keys()]) {
    if (!reachable.has(code)) byCode.delete(code);
  }

  return byCode.size ? { byCode, roots } : null;
}

/**
 * ABAC pruning (validation required-change #1): intersect the full MDMS tree
 * with the scoped DISTINCT leaf `service_code` list. A node survives iff its
 * own code is scoped OR at least one descendant survives. Scoped codes with
 * no tree record (stray/QA codes — visible in today's flat select) are
 * attached as root-level leaves so no currently-selectable code is lost.
 *
 * Returns a NEW pruned { byCode, roots } (never mutates the input), or null
 * when there is nothing visible (callers fall back to the flat select /
 * placeholder — same as an empty distinct list today).
 */
export function pruneComplaintTree(tree, scopedLeafCodes) {
  if (!tree) return null;
  const scoped = new Set(
    (Array.isArray(scopedLeafCodes) ? scopedLeafCodes : [...(scopedLeafCodes || [])])
      .map((c) => String(c ?? "").trim())
      .filter(Boolean)
  );
  if (!scoped.size) return null;

  const byCode = new Map();
  const pruneNode = (node) => {
    const children = node.children.map(pruneNode).filter(Boolean);
    if (!children.length && !scoped.has(node.code)) return null;
    const copy = { ...node, children, isLeaf: !children.length };
    byCode.set(copy.code, copy);
    return copy;
  };
  const roots = tree.roots.map(pruneNode).filter(Boolean);

  // Stray scoped codes (rows exist, master record doesn't) → root-level leaves.
  for (const code of scoped) {
    if (byCode.has(code)) continue;
    const stray = {
      code,
      label: undefined,
      path: code,
      parentCode: null,
      children: [],
      isLeaf: true,
    };
    byCode.set(code, stray);
    roots.push(stray);
  }

  return roots.length ? { byCode, roots } : null;
}

/** Node for a code, or null ("all" is the virtual root — also null). */
export function nodeOf(tree, code) {
  if (!tree || code == null || code === ALL) return null;
  return tree.byCode.get(String(code)) || null;
}

/** Children to offer at a node ("all" → the root categories). */
export function childrenOf(tree, code) {
  if (!tree) return [];
  if (code == null || code === ALL) return tree.roots;
  return nodeOf(tree, code)?.children ?? [];
}

/** Parent code of a node — "all" when the node is a root (or unknown). */
export function parentOf(tree, code) {
  const node = nodeOf(tree, code);
  if (!node || !node.parentCode) return ALL;
  return tree.byCode.has(node.parentCode) ? node.parentCode : ALL;
}

/**
 * Ancestor chain (codes, topmost first, EXCLUDING the node itself and the
 * virtual root). Cycle-guarded like buildComplaintTypeIndex.
 */
export function ancestorsOf(tree, code) {
  const chain = [];
  const seen = new Set([String(code)]);
  let cur = nodeOf(tree, code);
  while (cur && cur.parentCode && !seen.has(cur.parentCode)) {
    seen.add(cur.parentCode);
    cur = tree.byCode.get(cur.parentCode) || null;
    if (cur) chain.unshift(cur.code);
  }
  return chain;
}

/**
 * Where the traversal panel starts browsing for an applied selection:
 *   root / unknown code → the virtual root ("all"),
 *   interior node       → the node itself (its children are on show),
 *   leaf node           → the leaf's PARENT, so the leaf renders selected
 *                         among its siblings and switching leaves stays a
 *                         one-click operation.
 */
export function browseBaseCode(tree, code) {
  const node = nodeOf(tree, code);
  if (!node) return ALL;
  return node.isLeaf ? parentOf(tree, code) : node.code;
}

/**
 * Sentinel marking elided entries in a truncated ancestor trail. A string
 * that can never be an MDMS code (codes are [A-Za-z0-9._/-], see
 * COMPLAINT_PATH_RE) so it cannot collide with a real trail entry.
 */
export const TRAIL_ELLIPSIS = "…<elided>";

/**
 * Middle-truncate a trail for DEEP trees: when there are more than `max`
 * entries, keep the FIRST (the "All types" root) and the LAST `max - 2`
 * (the nearest ancestors + current node), replacing the middle with
 * TRAIL_ELLIPSIS — the endpoints matter for orientation, the middle is
 * recoverable by stepping up. Short trails come back untouched (same array).
 */
export function truncateTrail(entries, max = 4) {
  if (!Array.isArray(entries) || entries.length <= max || max < 3) return entries;
  return [entries[0], TRAIL_ELLIPSIS, ...entries.slice(entries.length - (max - 2))];
}

/**
 * The persisted selection trio for applying a node: leaf pick, "All in <X>"
 * subtree apply and the "All types" reset all funnel through here. (In-panel
 * traversal is browse-only local state; nothing is persisted until one of
 * those explicit applies calls this.)
 */
export function selectionFromCode(tree, code) {
  if (code == null || code === ALL) return clearedSelection();
  const node = nodeOf(tree, code);
  if (!node) return clearedSelection();
  return { code: node.code, path: node.path, leaf: node.isLeaf };
}

/**
 * The backend's complaintPath validation (#1282 @ 33f738c88): charset
 * [A-Za-z0-9._/-], max 256 chars. Sanitize CLIENT-side — the server rejects
 * violations with a per-entry 400/invalid_param, which would blank every tile
 * over one exotic MDMS code.
 */
const COMPLAINT_PATH_RE = /^[A-Za-z0-9._/-]{1,256}$/;

export function isValidComplaintPath(path) {
  return typeof path === "string" && COMPLAINT_PATH_RE.test(path);
}

/**
 * Selection → KpiQueryComposer params (merged into every tile's globalParams):
 *   root     → {}                      (filter cleared — neither param)
 *   leaf     → { serviceCode }         (exact match, works on ALL grains —
 *                required-change #4; complaintPath is interior-only)
 *   interior → { complaintPath }       (the node's dot-path; #1282 matches the
 *                node itself + dot-descendants on complaint_node_path.
 *                Pre-#1282 backends silently ignore unknown params, so this
 *                degrades to "no type narrowing", never an error)
 * An interior path that fails the backend's charset/length validation is NOT
 * sent (tiles stay unfiltered rather than erroring) — exotic codes outside
 * [A-Za-z0-9._/-] can't be subtree-filtered at all (their MV paths are NULL
 * anyway, see buildComplaintTree's caveat).
 * Legacy persisted string-only state (leaf flag undefined) behaves exactly
 * like today: leaf serviceCode.
 */
export function complaintTypeParams(selection) {
  const code = selection?.code;
  if (!code || code === ALL) return {};
  if (selection.leaf === false && selection.path) {
    const path = String(selection.path);
    return isValidComplaintPath(path) ? { complaintPath: path } : {};
  }
  return { serviceCode: String(code) };
}

/**
 * Repair a persisted selection against the (pruned) tree: exact node wins;
 * a vanished node walks UP its stored dot-path to the nearest surviving
 * ancestor (the exhumed demo's sanitize-and-repair idea); nothing valid →
 * cleared. Also normalises path/leaf drift (e.g. a node that used to be a
 * leaf and now has children keeps working as a subtree filter).
 *
 * The ancestor walk matches surviving node PATHS as dot-boundary prefixes of
 * the stored path — never by splitting the stored path into segments, because
 * codes may themselves contain "." (e.g. "complaints.categories.sanitation")
 * and would be shredded into non-codes, mis-clearing a repairable selection.
 * The deepest (longest-path) surviving prefix wins.
 */
export function repairSelection(tree, selection) {
  const code = String(selection?.code ?? "").trim();
  if (!code || code === ALL) return clearedSelection();
  if (!tree) return clearedSelection();
  if (tree.byCode.has(code)) return selectionFromCode(tree, code);

  const path = String(selection?.path ?? "").trim();
  if (path) {
    let ancestor = null;
    for (const node of tree.byCode.values()) {
      const nodePath = String(node.path ?? "");
      if (!nodePath || (nodePath !== path && !path.startsWith(`${nodePath}.`))) continue;
      if (!ancestor || nodePath.length > String(ancestor.path).length) ancestor = node;
    }
    if (ancestor) return selectionFromCode(tree, ancestor.code);
  }
  return clearedSelection();
}

/**
 * Normalise a filter-change value into the persisted trio. The tree widget
 * sends the trio itself; the flat fallback <select> (tree unavailable) sends
 * a bare leaf-code string — exactly today's contract.
 */
export function normalizeComplaintTypeValue(value) {
  if (value && typeof value === "object") {
    const code = String(value.code ?? "").trim() || ALL;
    if (code === ALL) return clearedSelection();
    return {
      code,
      path: value.path != null ? String(value.path) : null,
      leaf: value.leaf !== false,
    };
  }
  const code = String(value ?? "").trim();
  if (!code || code === ALL) return clearedSelection();
  return { code, path: null, leaf: true };
}

/**
 * Humanised fallback for nodes with no data-owned name and no localization
 * message (validation risk #3ii: interior category records often have
 * name === code, e.g. "complaints.categories.sanitation" / "MedicalServices").
 * Last dot-segment, un-snake/un-camel, title-cased — NEVER a raw dotted code
 * in the breadcrumb. Display-only: params always carry the raw code/path.
 */
export function humanizeTypeCode(code) {
  const raw = String(code ?? "").trim();
  if (!raw) return "";
  const segment = raw.split(".").filter(Boolean).pop() || raw;
  const spaced = segment
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return spaced
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}
