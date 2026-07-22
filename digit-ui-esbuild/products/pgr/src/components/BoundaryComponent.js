import { Loader } from "@egovernments/digit-ui-components";
import { Field as V2Field, Select as V2Select } from "@egovernments/digit-ui-components-v2";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

// Humanize a boundary-type code for use as a graceful fallback when its
// localization key isn't seeded: "SUB_COUNTY" -> "Sub County", "bairro" ->
// "Bairro". Accent-preserving so "Município" survives intact.
const humanizeBoundaryType = (raw) =>
  String(raw || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());

const BoundaryComponent = ({ t, config, onSelect, userType, formData, readOnly }) => {

  const tenantId = Digit.ULBService.getCurrentTenantId();

  // Employee jurisdiction gate (egovernments/CCRS#496).
  //
  // A CSR scoped to e.g. NAIROBI_CITY_HARAMBEE could file complaints at
  // any of the 9 Nairobi wards today — the cascade always rendered the
  // full boundary tree without consulting the operator's HRMS
  // jurisdictions. Backend doesn't independently enforce CSR creation
  // jurisdiction, so the UI is the primary defense.
  //
  // For employees we look up the HRMS record and collect each
  // `jurisdictions[].boundary` as an "allowed root". The boundary tree
  // is then pruned to subtrees that either match an allowed root or
  // contain one. City-level jurisdictions (NAIROBI_CITY) match the
  // tree root, so the full city stays visible — no functional change
  // for the 89% of employees with city-wide scope. Ward / sub-county
  // scoped employees get a meaningfully narrower picker.
  //
  // Citizens have no HRMS record / jurisdictions, so the filter is
  // dormant on the citizen path.
  const user = Digit.UserService.getUser();
  const isEmployee = user?.info?.type === "EMPLOYEE";
  const employeeCode = user?.info?.userName;

  const { data: hrmsData } = Digit.Hooks.useEmployeeSearch(
    tenantId,
    { codes: employeeCode },
    { enabled: isEmployee && !!employeeCode, staleTime: 10 * 60 * 1000 }
  );

  const allowedRoots = useMemo(() => {
    if (!isEmployee) return null;
    const juris = hrmsData?.Employees?.[0]?.jurisdictions || [];
    // Defensive: one observed seed record has `boundary: "ke.nairobi"`
    // (the tenant code, not a real boundary code). Drop entries that
    // can't appear in the boundary tree so they don't accidentally
    // null-filter the cascade.
    const roots = juris
      .map((j) => j?.boundary)
      .filter((b) => typeof b === "string" && b.length > 0 && b !== tenantId && !b.includes("."));
    return roots.length > 0 ? new Set(roots) : null;
  }, [isEmployee, hrmsData, tenantId]);

  const { data: rawChildrenData, isLoading: isBoundaryLoading } = Digit.Hooks.pgr.useFetchBoundaries(tenantId);

  // Hierarchy type + highest/lowest level are configured per-state on
  // CMS-BOUNDARY.HierarchySchema (written by the onboarding tooling — see
  // utilities/crs_dataloader/unified_loader_v1.py's update_hierarchy_schema)
  // and take priority over the ansible-templated globalConfigs values, which
  // are a deploy-time fallback for tenants where this MDMS master hasn't
  // been seeded yet. Mirrors the established pattern already used on the
  // citizen/employee create-complaint pages in frontend/micro-ui.
  const stateId = Digit.ULBService.getStateId();
  const { data: hierarchySchema } = Digit.Hooks.useCustomMDMS(
    stateId,
    "CMS-BOUNDARY",
    [{ name: "HierarchySchema" }],
    {
      select: (data) => {
        const rows = data?.["CMS-BOUNDARY"]?.HierarchySchema;
        return Array.isArray(rows) ? rows.find((row) => row.moduleName === "CMS") : null;
      },
      retry: false,
      enabled: !!stateId,
    }
  );

  const childrenData = useMemo(() => {
    if (!rawChildrenData || !allowedRoots) return rawChildrenData;
    const filterTree = (nodes) =>
      (nodes || [])
        .map((node) => {
          if (allowedRoots.has(node.code)) {
            // Allowed at this level — preserve the entire subtree so the
            // operator can pick any ward under their sub-county or any
            // descendant under their city.
            return node;
          }
          const filteredChildren = node.children ? filterTree(node.children) : [];
          if (filteredChildren.length === 0) return null;
          // Otherwise the node only stays because a descendant is
          // allowed — keep the path open down to the allowed leaf.
          return { ...node, children: filteredChildren };
        })
        .filter(Boolean);
    const filtered = rawChildrenData.map((entry) => ({
      ...entry,
      boundary: filterTree(entry.boundary || []),
    }));
    // If the jurisdiction filter prunes the entire tree (HRMS boundary codes
    // don't exactly match boundary-service node codes — common with seeding
    // drift), fall back to the full unfiltered tree so the dropdown renders.
    // Silently returning empty would black out the picker with no error shown.
    const hasAny = filtered.some((e) => (e.boundary || []).length > 0);
    return hasAny ? filtered : rawChildrenData;
  }, [rawChildrenData, allowedRoots]);

  // boundaryHierarchyOrder is populated by usePGRInitialization at
  // module mount and changes when the operator switches city. Reading
  // it once at render meant a city switch left the cascade pointing at
  // the previous tenant's hierarchy — a 2-level tenant after coming
  // from a 3-level tenant would still try to render a Sub-County
  // dropdown that the new tenant doesn't have.
  const boundaryHierarchy = useMemo(() => {
    const order = Digit.SessionStorage.get("boundaryHierarchyOrder");
    return Array.isArray(order) ? order.map((item) => item.code) : [];
  }, [tenantId]);
  const hierarchyType =
    hierarchySchema?.hierarchy || window?.globalConfigs?.getConfig("HIERARCHY_TYPE") || "ADMIN";

  // Respect the tenant's configured highest AND lowest boundary levels.
  // PGR_BOUNDARY_LOWEST_LEVEL caps the bottom: a tenant whose boundary tree
  // is shallower than the declared hierarchy (Maputo: many bairros have no
  // Quarteirão) otherwise leaves the deepest declared level with no options
  // — the required leaf dropdown never renders and the citizen can't
  // submit. PGR_BOUNDARY_HIGHEST_LEVEL caps the top: previously this config
  // was written to globalConfigs by ansible but never actually read here,
  // so the cascade always started at whatever level the boundary-service
  // happened to return as root, regardless of the configured highest level
  // (egovernments/CCRS#721).
  //
  // CMS-BOUNDARY.HierarchySchema (fetched above) is the primary source for
  // both levels — it's the master an operator actually edits post-deploy —
  // with the ansible-templated globalConfigs value used only as a fallback
  // for tenants where that MDMS record hasn't been seeded yet.
  //
  // Neither source is trusted blindly: `findIndex` below returns -1 for a
  // configured level that doesn't exist in this tenant's hierarchy at all
  // (typo'd MDMS value, or a level declared for another tenant), in which
  // case the corresponding cap is silently skipped rather than collapsing
  // the whole cascade. Separately, a level that's only MISSING on some
  // branches (e.g. a handful of bairros with no Quarteirão child) is not
  // a findIndex concern at all — `lowestLevelCapped` only records whether
  // the cap was configured and matched in the hierarchy's type list; the
  // childless-node-is-leaf fallback below (keyed off it) is what actually
  // tolerates a specific branch running out of children before reaching
  // the configured lowest level.
  // `lowestLevelCapped` records whether PGR_BOUNDARY_LOWEST_LEVEL was BOTH
  // configured AND matched in this tree (the cap actually applied). The
  // childless-node-is-leaf fallback keys off it: only a deployment that
  // declared a lowest level treats a childless mid-tree node as fileable.
  // Unconfigured deployments keep strict deepest-level-only leaf semantics so a
  // County seeded without children can't become fileable (egovernments/CCRS#478).
  const { effectiveHierarchy, lowestLevelCapped } = useMemo(() => {
    const configuredHighest =
      hierarchySchema?.highestHierarchy || window?.globalConfigs?.getConfig?.("PGR_BOUNDARY_HIGHEST_LEVEL");
    const configuredLowest =
      hierarchySchema?.lowestHierarchy || window?.globalConfigs?.getConfig?.("PGR_BOUNDARY_LOWEST_LEVEL");

    const highestIdx = configuredHighest
      ? boundaryHierarchy.findIndex((k) => String(k).toLowerCase() === String(configuredHighest).toLowerCase())
      : -1;
    const startIdx = highestIdx >= 0 ? highestIdx : 0;

    if (!configuredLowest) {
      return { effectiveHierarchy: boundaryHierarchy.slice(startIdx), lowestLevelCapped: false };
    }
    const lowestIdx = boundaryHierarchy.findIndex(
      (k) => String(k).toLowerCase() === String(configuredLowest).toLowerCase()
    );
    return lowestIdx >= startIdx
      ? { effectiveHierarchy: boundaryHierarchy.slice(startIdx, lowestIdx + 1), lowestLevelCapped: true }
      : { effectiveHierarchy: boundaryHierarchy.slice(startIdx), lowestLevelCapped: false };
  }, [boundaryHierarchy, hierarchySchema]);

  // State to manage selected values and dropdown options
  const [selectedValues, setSelectedValues] = useState({});
  const [value, setValue] = useState({});
  // Track which levels were filled by the map auto-fill (vs manually
  // selected by the user). Only auto-filled levels should render as
  // disabled when readOnly is true — once the user changes a level
  // manually, that level (and any children that get reset) flips to
  // interactive so they can keep editing.
  const [autoFilledKeys, setAutoFilledKeys] = useState({});

  // Reset selection state on tenant change so the previous tenant's
  // selected County / Ward doesn't leak through to the new tenant's
  // boundary tree (different UUIDs, different shape).
  useEffect(() => {
    setSelectedValues({});
    setValue({});
    setAutoFilledKeys({});
  }, [tenantId]);

  // Effect to initialize dropdowns when data loads
useEffect(() => {
  if (childrenData && childrenData.length > 0) {
    const boundaryMap = {};
    let currentLevel = childrenData[0]?.boundary;

    while (currentLevel && currentLevel.length > 0) {
      const currentType = currentLevel[0].boundaryType;
      boundaryMap[currentType] = currentLevel;

      // Proceed to children of the first element for next level
      const hasChildren = currentLevel[0]?.children;
      currentLevel = hasChildren && hasChildren.length > 0 ? currentLevel[0].children : null;
    }

    setValue(boundaryMap);
  }
}, [childrenData]);

  // CCRS#491: auto-fill the cascade when the citizen drops a pin on the
  // map. `GeoLocations.fetchAddress` runs `resolveWard` (turf
  // point-in-polygon against the bundled Nairobi-wards GeoJSON) and
  // writes the matching ward into `formData.GeoLocationsPoint.ward`.
  // We watch that field and set the County / Sub-County / Ward
  // dropdowns to the matching tree path, then call onSelect with the
  // deepest node so `formData.SelectedBoundary` is the ward — which is
  // what the submit pipeline reads (utils/index.js).
  //
  // Lenient match: the GeoJSON ships ward codes like `KILIMANI` while
  // the live boundary tree uses `NAIROBI_CITY_KILIMANI`. We accept
  // either, plus a name-based fallback (`Kangemi` ≈ `KANGEMI`). If no
  // match (pin outside any seeded ward, or GeoJSON / boundary-tree
  // drift) we silently leave the cascade alone — the user can still
  // pick manually.
  const wardHintCode = formData?.GeoLocationsPoint?.ward?.code;
  const wardHintName = formData?.GeoLocationsPoint?.ward?.name;
  useEffect(() => {
    if (!wardHintCode && !wardHintName) return;
    if (!childrenData || childrenData.length === 0) return;
    // boundaryHierarchyOrder may not be seeded yet (usePGRInitialization
    // still in flight / city just switched). Without it the deepest-level
    // targetType is undefined and findWardPath would match the hint at
    // ANY level. The `boundaryHierarchy` memo is keyed only on tenantId,
    // so if this component mounted before init seeded SessionStorage the
    // memo caches [] for the tenant's lifetime — re-read the session
    // value directly as a fallback so auto-fill recovers once init
    // lands. Skip only when BOTH are empty; the effect re-runs when
    // childrenData settles.
    let hierarchy = boundaryHierarchy;
    if (hierarchy.length === 0) {
      const order = Digit.SessionStorage.get("boundaryHierarchyOrder");
      hierarchy = Array.isArray(order) ? order.map((item) => item.code) : [];
    }
    if (hierarchy.length === 0) return;
    const targetType = hierarchy[hierarchy.length - 1];
    const path = findWardPath(childrenData[0]?.boundary, wardHintCode, wardHintName, targetType);
    if (!path || path.length === 0) return;

    // Rebuild the cascade state in one go: every level's selection +
    // every level's option list (so child dropdowns are populated
    // correctly without the user having to click through).
    const newSelectedValues = {};
    const newValue = {};
    const newAutoFilled = {};
    let levelOptions = childrenData[0]?.boundary || [];
    for (const node of path) {
      newSelectedValues[node.boundaryType] = node;
      newValue[node.boundaryType] = levelOptions;
      newAutoFilled[node.boundaryType] = true;
      levelOptions = node.children || [];
    }
    setSelectedValues(newSelectedValues);
    setValue((prev) => ({ ...prev, ...newValue }));
    setAutoFilledKeys(newAutoFilled);

    // The deepest hit (typically Ward) is what SelectedBoundary should
    // hold — that's the leaf the routing payload uses. Tag with
    // `isLeaf` so validators don't have to trust `.children` being
    // preserved on the picked node (closes egovernments/CCRS#478 —
    // locality validation was firing only when children happened to
    // be attached, so County-level selections silently passed).
    const deepest = path[path.length - 1];
    // Use the *effective* (capped) hierarchy's deepest level, not the raw
    // `hierarchy` — otherwise a map-pin that auto-fills only to the configured
    // lowest level (e.g. Bairro, when the tree has no Quarteirão below it) is
    // tagged isLeaf:false and the citizen can never advance past Location.
    // Mirrors handleSelection's leaf logic so both paths agree.
    const lastLevel = effectiveHierarchy[effectiveHierarchy.length - 1];
    // Childless-node-is-leaf only when a lowest level was configured AND capped
    // this tree — otherwise strict deepest-level-only (preserves CCRS#478).
    const isDeepestLevel =
      deepest?.boundaryType === lastLevel ||
      (lowestLevelCapped && !(deepest?.children && deepest.children.length > 0));
    onSelect(config.key, { ...deepest, isLeaf: isDeepestLevel }, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardHintCode, wardHintName, childrenData]);

  /**
   * Handle dropdown selection.
   * - Stores the selected boundary.
   * - Clears all children dropdowns.
   * - Loads children of the selected boundary.
   */
  const handleSelection = (selectedBoundary) => {
    if (!selectedBoundary) return;

    const boundaryType = selectedBoundary.boundaryType;

    // Reset all child selections
    const index = boundaryHierarchy.indexOf(boundaryType);
    const newSelectedValues = { ...selectedValues };
    const newValue = { ...value };
    // User just touched this level → it's no longer "auto-filled".
    // Same for any child levels we're about to clear; they'll be
    // re-picked manually. The change flips this level + descendants
    // from disabled-readonly back to interactive.
    const newAutoFilled = { ...autoFilledKeys };
    delete newAutoFilled[boundaryType];

    for (let i = index + 1; i < boundaryHierarchy.length; i++) {
      delete newSelectedValues[boundaryHierarchy[i]]; // Clear selected children
      delete newValue[boundaryHierarchy[i]]; // Clear child dropdowns
      delete newAutoFilled[boundaryHierarchy[i]];
    }

    // Update selected values
    newSelectedValues[boundaryType] = selectedBoundary;
    setSelectedValues(newSelectedValues);
    setValue(newValue);
    setAutoFilledKeys(newAutoFilled);
    // always sending the last selected boundary code, tagged with
    // `isLeaf` so validators can trust hierarchy depth instead of the
    // `.children` array (which isn't reliably preserved on the picked
    // node and let County-level selections pass — egovernments/CCRS#478).
    // A selection is a leaf when it's the configured deepest level OR the
    // node has no children (the branch stops early — common on tenants whose
    // boundary tree is shallower than the declared hierarchy). Either way the
    // submit pipeline treats it as the fileable leaf so the citizen isn't
    // blocked waiting on a deeper level that doesn't exist for this branch.
    const lastLevel = effectiveHierarchy[effectiveHierarchy.length - 1];
    const nodeHasChildren = selectedBoundary.children && selectedBoundary.children.length > 0;
    // Childless-node-is-leaf only when a lowest level was configured AND capped
    // this tree — otherwise strict deepest-level-only (preserves CCRS#478 on
    // unconfigured deployments; a County missing children stays non-fileable).
    const isDeepestLevel = boundaryType === lastLevel || (lowestLevelCapped && !nodeHasChildren);
    // onSelect is RHF's setValue (FieldV1 wires component onSelect -> setValue).
    // Pass shouldValidate so the `required` rule re-runs and formState.isValid
    // (which gates the disabled NEXT/SubmitBar) flips true on selection.
    onSelect(config.key, { ...selectedBoundary, isLeaf: isDeepestLevel }, { shouldValidate: true, shouldDirty: true, shouldTouch: true });

    // Load child boundaries
    if (selectedBoundary.children && selectedBoundary.children.length > 0) {
      newValue[selectedBoundary.children[0].boundaryType] = selectedBoundary.children;
      setValue(newValue);
    }
  };

  /**
   * Check if a boundary type is allowed to be selected.
   */

  if (isBoundaryLoading) {
    return <Loader />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        {effectiveHierarchy.map((key, idx) => {
          // Gate child dropdowns by parent selection so the user can't
          // pick a Ward without first picking County → Sub-County. The
          // init effect above pre-populates `value` for every level
          // (it walks the first chain top-down so the data is hot when
          // the user reaches it), so without this gate all three
          // dropdowns would be active simultaneously and the citizen
          // could select a Ward of a different sub-county than the one
          // they actually meant — closes egovernments/CCRS#477.
          if (idx > 0) {
            const parentKey = effectiveHierarchy[idx - 1];
            if (!selectedValues[parentKey]) return null;
          }
          if (value[key]?.length > 0) {
            const selectedAtLevel =
              formData?.locality || formData?.SelectedBoundary ? selectedValues[key] : null;
            // Localized level header, with a humanized fallback when the
            // `${HIERARCHY_TYPE}_${TYPE}` key isn't seeded — react-i18next
            // otherwise echoes the raw key (e.g. "ADMIN_MUNICÍPIO") into the
            // UI. Mirrors the wizard's tOr() graceful-degradation.
            const levelKey = `${hierarchyType}_${key?.toUpperCase()}`;
            const translatedLevel = t(levelKey);
            const levelLabel =
              translatedLevel && translatedLevel !== levelKey
                ? translatedLevel
                : humanizeBoundaryType(key);
            return (
              <BoundaryDropdown
                key={key}
                fieldKey={key}
                label={levelLabel}
                data={value[key]}
                onChange={(selectedValue) => handleSelection(selectedValue)}
                selected={selectedAtLevel}
                // Read-only when (a) the caller asked for it, AND
                // (b) this level was filled by the map auto-fill —
                // NOT just by any value present. If the user
                // manually picks something at this level (e.g.
                // because the auto-fill missed it), the flag is
                // cleared in handleSelection so the field flips back
                // to interactive — they can keep refining without
                // getting locked out by their own click.
                disabled={!!readOnly && !!autoFilledKeys[key] && !!selectedAtLevel}
              />
            );
          }
          return null;
        })}
    </div>
  );
};

/**
 * BoundaryDropdown — uses the v2 Select so the boundary cascade matches
 * the rest of the modernized form chrome (theme placeholder color,
 * yellow-tint hover, no list-bullet padding). The boundary objects
 * carry through onChange unchanged so the parent's cascade logic /
 * SelectedBoundary payload stays byte-identical to the legacy.
 */
const BoundaryDropdown = ({ label, data, onChange, selected, fieldKey, disabled }) => {
  const { t } = useTranslation();
  const id = `boundary-${(fieldKey || label || "field").toString().toLowerCase().replace(/\s+/g, "-")}`;
  // Defensive dedup by code. The jurisdiction prune (filterTree above)
  // is duplicate-safe by construction, but in the field the dropdown
  // has been observed listing the same ward twice (see
  // egovernments/CCRS#496 screen recording — upstream data shape under
  // overlapping HRMS jurisdictions, exact origin still being chased).
  // Dedup at render keeps the symptom contained regardless of where
  // the duplicate enters `data`.
  const options = [];
  const seen = new Set();
  for (const node of data || []) {
    if (seen.has(node.code)) continue;
    seen.add(node.code);
    // Localization-first: t(code) is the convention (configurator Phase 2
    // writes the human name as the message for the code key). Fall back
    // to a raw `name` only when no translation exists.
    const translated = t(node.code);
    options.push({
      value: node.code,
      label: translated && translated !== node.code ? translated : node.name || node.code,
    });
  }
  return (
    <V2Field label={t(label)} required htmlFor={id}>
      <V2Select
        id={id}
        value={selected?.code}
        onValueChange={(code) => {
          const picked = data.find((n) => n.code === code);
          if (picked) onChange(picked);
        }}
        options={options}
        placeholder={t("CS_COMMON_SELECT") === "CS_COMMON_SELECT" ? `Select ${t(label)}` : t("CS_COMMON_SELECT")}
        disabled={!!disabled}
      />
    </V2Field>
  );
};

/**
 * Walk the boundary tree and return the path (root → … → ward) whose
 * leaf matches the GeoJSON-resolved hint. Returns null if nothing
 * matches.
 *
 * Match strategy (in priority order, all case-insensitive):
 *   1. Exact code match.
 *   2. Suffix code match — boundary tree codes are typically prefixed
 *      with the tenant (`NAIROBI_CITY_KANGEMI`) while the GeoJSON
 *      ships bare codes (`KANGEMI`). Accepting `code.endsWith('_' +
 *      hint)` covers the common case.
 *   3. Name match against the hint name normalized to UPPER_SNAKE.
 *      Handles future GeoJSON versions that ship display names but no
 *      code field.
 *
 * Only matches nodes whose boundary type matches the deepest level 
 * (targetType). Sub-county / county hints aren't useful here because 
 * the GeoJSON gives us the leaf ward; the parents are derived by 
 * walking up the path.
 */
function findWardPath(roots, hintCode, hintName, targetType) {
  const normCode = String(hintCode || '').toUpperCase();
  const normName = String(hintName || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!normCode && !normName) return null;
  const isMatch = (node) => {
    if (targetType && node.boundaryType !== targetType) return false;
    const code = String(node.code || '').toUpperCase();
    const nodeName = String(node.name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (normCode && (code === normCode || code.endsWith('_' + normCode))) return true;
    if (normName && (code === normName || code.endsWith('_' + normName))) return true;
    if (normName && (nodeName === normName || nodeName.endsWith('_' + normName))) return true;
    return false;
  };
  const walk = (node, trail) => {
    const next = [...trail, node];
    if (isMatch(node)) return next;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = walk(child, next);
        if (found) return found;
      }
    }
    return null;
  };
  for (const root of roots || []) {
    const found = walk(root, []);
    if (found) return found;
  }
  return null;
}

export default BoundaryComponent;