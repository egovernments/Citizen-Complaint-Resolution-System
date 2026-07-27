/**
 * Pure helpers for the per-widget "Group by" hierarchy-level control (#1111 PR2).
 *
 * A KPI definition opts into hierarchy grouping by declaring a `hierLevel`
 * params entry ({ name:"hierLevel", allowed:["leaf","1",...], default }) — the
 * backend KpiQueryComposer rewrites the `service_code` dimension to the chosen
 * hierarchy level at query time and aliases the level code back AS
 * `service_code`, so the FE viz contract (dimensionKey, columns, sort) is
 * unchanged. These helpers own the FE side of that contract:
 *
 *   - which ComplaintHierarchyDefinition applies to this deployment,
 *   - which "Group by" options a tile offers,
 *   - which hierLevel value is in effect / must be sent for a tile.
 *
 * Everything here is pure (no fetch, no window) so it is unit-testable with
 * node --test; complaintHierarchyService.js does the MDMS fetch and
 * AdminDashboard.jsx owns the override state.
 */

/** The tile's declared hierLevel params entry, or null when it doesn't opt in. */
export function hierLevelParam(def) {
  const params = Array.isArray(def?.params) ? def.params : [];
  return params.find((p) => p && p.name === "hierLevel") || null;
}

function allowedList(param) {
  return Array.isArray(param?.allowed) && param.allowed.length
    ? param.allowed.map(String)
    : null;
}

function overrideFor(def, overrides) {
  const param = hierLevelParam(def);
  if (!param) return null;
  const kpiId = def?.kpiId ?? def?.id;
  const raw = overrides && kpiId != null ? overrides[kpiId] : null;
  if (raw == null || raw === "") return null;
  const value = String(raw);
  // Drop stale saved values the def no longer allows (seed drift) instead of
  // sending a param the backend's allowed-list validation would reject.
  const allowed = allowedList(param);
  if (allowed && !allowed.includes(value)) return null;
  return value;
}

/**
 * The hierLevel value to SEND for this tile: the user's valid override, else
 * null (the backend applies the def's declared default itself — sending
 * nothing keeps the wire identical to today for untouched tiles).
 */
export function appliedHierLevel(def, overrides) {
  return overrideFor(def, overrides);
}

/**
 * The hierLevel value in EFFECT for this tile (what the select shows and what
 * the table columns must reflect): the valid override, else the def's declared
 * default, else "leaf". Null when the def doesn't declare hierLevel.
 */
export function effectiveHierLevel(def, overrides) {
  const param = hierLevelParam(def);
  if (!param) return null;
  return overrideFor(def, overrides) || (param.default != null ? String(param.default) : "leaf");
}

/**
 * Pick the ComplaintHierarchyDefinition this deployment's dashboard groups by.
 *
 * `pinnedType` (globalConfigs COMPLAINT_HIERARCHY_TYPE) wins when set — ke
 * carries BOTH a "PGR" 2-level and a "PGR_TEST" 4-level definition, and only
 * the deployment knows which one its complaints are actually coded against.
 * Without a pin, prefer the definition whose hierarchyType has the most
 * ComplaintHierarchy rows behind it (the live tree, not a test stub) — the
 * same rows-backed heuristic the PGR complaint pages use — else the first
 * active definition.
 */
export function selectHierarchyDefinition(definitions, rows, pinnedType) {
  const defs = (Array.isArray(definitions) ? definitions : []).filter(
    (d) => d && d.active !== false
  );
  if (!defs.length) return null;
  if (pinnedType) {
    return defs.find((d) => String(d.hierarchyType) === String(pinnedType)) || null;
  }
  const allRows = Array.isArray(rows) ? rows : [];
  const counts = new Map();
  for (const n of allRows) {
    if (!n || n.active === false) continue;
    const type = n.hierarchyType;
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const d of defs) {
    const c = counts.get(d.hierarchyType) || 0;
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return best || defs[0];
}

/** Ordered levels [{ levelCode, label, order, isLeafServiceCode }] of a definition. */
export function orderedLevels(definition) {
  return [...(definition?.levels || [])]
    .filter((l) => l && l.levelCode != null)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((l) => ({
      levelCode: String(l.levelCode),
      label: l.label,
      order: l.order,
      isLeafServiceCode: !!l.isLeafServiceCode,
    }));
}

/**
 * Build the "Group by" select options for one tile:
 *   [{ value:"1", level }, ..., { value:"leaf", leaf:true }]
 *
 * - Only non-leaf levels are offered by level number: the leaf service-code
 *   level (isLeafServiceCode, else the deepest level) IS what "Leaf" means —
 *   listing it again would duplicate the Leaf option (bomet's live 2-level
 *   PGR tree: level 2 == leaf, so the demo contrast is level 1 vs Leaf).
 * - Each level number must pass the def's allowed list (when declared) so the
 *   select never offers a value the backend would reject.
 *
 * Returns null when there is nothing to choose (no param, <2 usable options).
 */
export function buildGroupByOptions(levels, param) {
  if (!param || !Array.isArray(levels) || levels.length < 2) return null;
  const allowed = allowedList(param);
  const leafFlagIdx = levels.findIndex((l) => l.isLeafServiceCode);
  const cut = leafFlagIdx >= 0 ? leafFlagIdx : levels.length - 1;

  const options = [];
  for (let i = 0; i < cut; i++) {
    const value = String(i + 1);
    if (allowed && !allowed.includes(value)) continue;
    options.push({ value, level: levels[i] });
  }
  if (!allowed || allowed.includes("leaf")) {
    options.push({ value: "leaf", leaf: true });
  }
  return options.length >= 2 ? options : null;
}

/**
 * Table-kind column shaping at a non-leaf "Group by" level (R4). Every row is
 * then a hierarchy-level bucket (the backend aliases the level code back AS
 * `service_code`), so the service_group ("Type") column would duplicate
 * (level 1) or cross-cut (deeper levels) the grouped dimension — drop it, and
 * relabel the service_code column to the selected level's display name
 * (labelKey stripped so the computed label wins in TableSortHeader).
 *
 * `groupBy` is { level, label } or null (leaf/no grouping → columns untouched).
 */
export function applyGroupByToColumns(columns, groupBy) {
  if (!groupBy || !Array.isArray(columns)) return columns;
  return columns
    .filter((c) => c.id !== "service_group")
    .map((c) =>
      c.id === "service_code" ? { ...c, label: groupBy.label, labelKey: undefined } : c
    );
}
