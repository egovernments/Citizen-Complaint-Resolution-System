/**
 * The boundary cascade's rules (County -> Sub County -> Ward on Bomet), kept
 * apart from the component so they can be tested on their own.
 *
 * Every level is shown from the start, so a ward can be searched for and
 * picked before its county. What keeps that safe is that a pick fills the
 * levels above it from the tree itself: a chosen ward's county and sub-county
 * are always its own, the guarantee the old one-level-at-a-time gate gave
 * (egovernments/CCRS#477).
 *
 * Nodes are boundary-service nodes: { code, name, boundaryType, children }.
 */

/** Each node's path from the root, keyed by code (the first occurrence wins). */
export const pathsByCode = (tree) => {
  const paths = new Map();
  const walk = (nodes, trail) => {
    for (const node of nodes || []) {
      const path = [...trail, node];
      if (!paths.has(node.code)) paths.set(node.code, path);
      walk(node.children, path);
    }
  };
  walk(tree, []);
  return paths;
};

/**
 * A level listing more than this with nothing chosen above it waits for the
 * level above instead. A menu of thousands (Maputo's quarteirões) is unusable
 * and mostly repeated names; a city's wards stay listed from the start.
 */
export const MAX_UNANCHORED_OPTIONS = 200;

/**
 * What each shown level lists: the nodes of its type under the nearest chosen
 * level above it, or every node of its type when nothing above is chosen.
 * `null` means the level is too long to list whole and waits for the level
 * above.
 */
export const optionsForLevels = (levels, selected, tree, { maxUnanchored = MAX_UNANCHORED_OPTIONS } = {}) => {
  const byLevel = {};
  levels.forEach((type, idx) => {
    let anchor = null;
    for (let up = idx - 1; up >= 0 && !anchor; up--) anchor = selected[levels[up]] || null;
    const found = [];
    const collect = (nodes) => {
      for (const node of nodes || []) {
        if (node.boundaryType === type) found.push(node);
        else collect(node.children);
      }
    };
    collect(anchor ? anchor.children : tree);
    byLevel[type] = !anchor && idx > 0 && found.length > maxUnanchored ? null : found;
  });
  return byLevel;
};

/**
 * The selection after picking `picked`: its own path within the shown levels,
 * and nothing below it. Changing a level, or picking its current value again,
 * clears the levels under it, so a filter can widen back to a county. A tree
 * root above the configured highest level stays out of the address.
 *
 * @param shownLevels  the levels the form shows (the hierarchy, possibly capped)
 */
export const selectionAfterPick = (picked, { shownLevels, paths }) => {
  const next = {};
  for (const node of paths.get(picked.code) || [picked]) {
    if (node === picked || shownLevels.includes(node.boundaryType)) next[node.boundaryType] = node;
  }
  return next;
};

/**
 * How many levels above `picked` the pick filled in or changed: 0 when the
 * cascade was walked top-down, more when a ward was picked first. Reported
 * with the pick so the telemetry shows how people use the open cascade.
 */
export const levelsFilledAbove = (picked, before, after, hierarchy) =>
  hierarchy
    .slice(0, Math.max(hierarchy.indexOf(picked.boundaryType), 0))
    .filter((type) => after[type] && after[type].code !== before[type]?.code).length;

/**
 * Labels for one level's options. With every ward listed before a sub-county
 * is picked, two can share a name; those carry their parent's
 * ("Township (Bomet East)").
 */
export const disambiguateLabels = (options, parentLabelOf) => {
  const counts = {};
  for (const option of options) counts[option.label] = (counts[option.label] || 0) + 1;
  return options.map((option) => {
    const parent = counts[option.label] > 1 ? parentLabelOf(option.node) : null;
    return { value: option.value, label: parent ? `${option.label} (${parent})` : option.label };
  });
};
