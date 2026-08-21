import { ALL } from "./complaintTypeTree";

/**
 * Boundary (geography) tree helpers for the drill-down ward filter
 * (CCSD-2171: Província → Distrito → Município instead of a flat ward list).
 *
 * Mirrors utils/complaintTypeTree.js on the boundary hierarchy. The tree
 * shape is identical ({ byCode: Map, roots: node[] }, nodes carrying
 * { code, path, parentCode, children, isLeaf }), so ALL of that module's
 * traversal helpers (nodeOf / childrenOf / ancestorsOf / browseBaseCode /
 * truncateTrail) work on this tree unchanged — only building, pruning and
 * the selection→params mapping are boundary-specific:
 *
 *   - paths are PIPE-joined root-down code chains ("maputo_cidade|katembe|
 *     municipio_maputo_katembe"), matching the analytics MV's boundary_path
 *     column byte-for-byte (ancestralmaterializedpath || '|' || code — the
 *     boundary-service relationships response is the same root-down chain,
 *     verified live on cms-pilot against the facts grain);
 *   - leaf (ward) selections keep today's wire shape (params.ward, exact
 *     ward_code match — works on every backend); interior selections send
 *     params.boundaryPath (subtree filter; backends without the param
 *     silently ignore it, so the dashboard degrades to unfiltered for that
 *     selection rather than erroring — the complaintPath precedent).
 */

/** The cleared geography selection trio ({ code, path, leaf }). */
export function clearedGeographySelection() {
  return { code: ALL, path: null, leaf: false };
}

/**
 * Build the boundary tree from the boundary-relationships response's nested
 * TenantBoundary[].boundary nodes ({ code, boundaryType, children: [...] }).
 * Paths are derived root-down as pipe-joined code chains. Labels are left
 * undefined — boundary display names live in localization (t(code), the
 * same seam the flat ward list uses via dimensionLabel).
 */
export function buildBoundaryTree(rootNodes) {
  const byCode = new Map();
  const roots = [];

  const walk = (raw, parent) => {
    const code = String(raw?.code ?? "").trim();
    if (!code || byCode.has(code)) return null; // dupes: first (shallowest) wins
    const node = {
      code,
      boundaryType: String(raw?.boundaryType ?? "").trim() || undefined,
      label: undefined,
      path: parent ? `${parent.path}|${code}` : code,
      parentCode: parent ? parent.code : null,
      children: [],
      isLeaf: true,
    };
    byCode.set(code, node);
    for (const childRaw of Array.isArray(raw?.children) ? raw.children : []) {
      const child = walk(childRaw, node);
      if (child) {
        node.children.push(child);
        node.isLeaf = false;
      }
    }
    return node;
  };

  for (const raw of Array.isArray(rootNodes) ? rootNodes : []) {
    const root = walk(raw, null);
    if (root) roots.push(root);
  }
  return byCode.size ? { byCode, roots } : null;
}

/**
 * ABAC/data pruning — the complaint-tree rule verbatim: intersect the full
 * boundary tree with the scoped DISTINCT ward_code list (the same analytics
 * distinct the flat select is built from, so the server's row-scope applies).
 * A node survives iff its own code is scoped OR a descendant survives.
 * Scoped ward codes with no boundary record (stray/QA rows — visible in
 * today's flat select) are attached as root-level leaves so no currently
 * selectable ward is lost. Returns a NEW pruned tree or null (callers fall
 * back to the flat select).
 */
export function pruneBoundaryTree(tree, scopedWardCodes) {
  if (!tree) return null;
  const scoped = new Set(
    (Array.isArray(scopedWardCodes)
      ? scopedWardCodes
      : [...(scopedWardCodes || [])]
    )
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

  return roots.length ? { byCode, roots, scopedCodes: scoped } : null;
}

/** Exact ABAC-scoped ward codes represented by one boundary hierarchy node. */
export function wardCodesUnder(tree, code) {
  const node = tree?.byCode?.get(String(code)) || null;
  if (!node) return [];
  const scoped = tree?.scopedCodes instanceof Set ? tree.scopedCodes : null;
  if (!scoped) {
    const out = [];
    const stack = [node];
    while (stack.length) {
      const current = stack.pop();
      if (current.isLeaf) out.push(current.code);
      stack.push(...current.children);
    }
    return out;
  }
  return [...scoped].filter((candidate) => {
    const candidateNode = tree.byCode.get(candidate);
    const candidatePath = String(candidateNode?.path ?? "");
    return (
      candidatePath === node.path || candidatePath.startsWith(`${node.path}|`)
    );
  });
}

/** Persisted multi-select entry: semantic node plus exact scoped ward-code expansion. */
export function geographyMultiSelectionFromCode(tree, code) {
  const selection = geographySelectionFromCode(tree, code);
  return selection.code === ALL
    ? null
    : { ...selection, codes: wardCodesUnder(tree, code) };
}

/** The persisted selection trio for applying a boundary node. */
export function geographySelectionFromCode(tree, code) {
  if (code == null || code === ALL) return clearedGeographySelection();
  const node = tree?.byCode?.get(String(code)) || null;
  if (!node) return clearedGeographySelection();
  return { code: node.code, path: node.path, leaf: node.isLeaf };
}

/**
 * The backend's boundaryPath validation (KpiQueryComposer): the complaint
 * path alphabet plus '|' (the boundary_path segment delimiter), max 512.
 * Sanitize CLIENT-side for the same reason as complaintPath — a per-entry
 * invalid_param 400 would blank every tile over one exotic boundary code.
 */
const BOUNDARY_PATH_RE = /^[A-Za-z0-9._/|-]{1,512}$/;

export function isValidBoundaryPath(path) {
  return typeof path === "string" && BOUNDARY_PATH_RE.test(path);
}

/**
 * Selection → KpiQueryComposer params:
 *   root     → {}                   (filter cleared)
 *   leaf     → { ward }             (exact ward_code match — today's wire
 *               shape unchanged, works on every grain and every backend)
 *   interior → { boundaryPath }     (the node's pipe-path; subtree match on
 *               boundary_path. Backends without the param ignore it — the
 *               dashboard degrades to unfiltered, never an error.)
 * Legacy persisted string-only state (leaf flag undefined) behaves exactly
 * like today: leaf ward.
 */
export function geographyParams(selection) {
  const code = selection?.code;
  if (!code || code === ALL) return {};
  if (selection.leaf === false && selection.path) {
    const path = String(selection.path);
    return isValidBoundaryPath(path) ? { boundaryPath: path } : {};
  }
  return { ward: String(code) };
}

/**
 * Repair a persisted geography selection against the (pruned) tree: exact
 * node wins; a vanished node walks UP its stored pipe-path to the nearest
 * surviving ancestor; nothing valid → cleared. Path-prefix matching (never
 * segment splitting) for the same reason as the complaint tree — codes are
 * matched at pipe boundaries only.
 */
export function repairGeographySelection(tree, selection) {
  const code = String(selection?.code ?? "").trim();
  if (!code || code === ALL) return clearedGeographySelection();
  if (!tree) return clearedGeographySelection();
  if (tree.byCode.has(code)) return geographySelectionFromCode(tree, code);

  const path = String(selection?.path ?? "").trim();
  if (path) {
    let ancestor = null;
    for (const node of tree.byCode.values()) {
      const nodePath = String(node.path ?? "");
      if (!nodePath || (nodePath !== path && !path.startsWith(`${nodePath}|`)))
        continue;
      if (!ancestor || nodePath.length > String(ancestor.path).length)
        ancestor = node;
    }
    if (ancestor) return geographySelectionFromCode(tree, ancestor.code);
  }
  return clearedGeographySelection();
}

/**
 * Normalise a filter-change value into the persisted trio. The tree widget
 * sends the trio; the flat fallback <select> sends a bare ward-code string —
 * exactly today's contract ("all" clears).
 */
export function normalizeGeographyValue(value) {
  if (value && typeof value === "object") {
    const code = String(value.code ?? "").trim() || ALL;
    if (code === ALL) return clearedGeographySelection();
    return {
      code,
      path: value.path != null ? String(value.path) : null,
      leaf: value.leaf !== false,
    };
  }
  const code = String(value ?? "").trim();
  if (!code || code === ALL) return clearedGeographySelection();
  return { code, path: null, leaf: true };
}

/**
 * Humanised fallback for boundary codes with no localization message
 * ("municipio_maputo_katembe" → "Municipio Maputo Katembe"). Display-only;
 * params always carry the raw code/path.
 */
export function humanizeBoundaryCode(code) {
  const raw = String(code ?? "").trim();
  if (!raw) return raw;
  const last = raw.split("|").pop();
  return last
    .replace(/[_\-./]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
