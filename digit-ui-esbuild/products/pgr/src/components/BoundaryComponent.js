import { Loader } from "@egovernments/digit-ui-components";
import { selectPlaceholder, translateOr } from "../utils/selectPlaceholder";
import { Field as V2Field, Select as V2Select } from "@egovernments/digit-ui-components-v2";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { sameLevelName } from "../utils/boundaryLevels";
import {
  disambiguateLabels,
  levelsFilledAbove,
  optionsForLevels,
  pathsByCode,
  selectionAfterPick,
} from "../utils/boundaryCascade";
import { trackEvent } from "../utils/analytics";
import { useQuery } from "react-query";
import { getTenantHierarchy } from "../services/tenantHierarchy";

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

  // Callers that know which tenant the record belongs to pass it explicitly.
  // The fallback is only a default, and a poor one for citizens:
  // ULBService.getCurrentTenantId() returns the user's own tenant for EMPLOYEE
  // but STATE_LEVEL_TENANT_ID for everyone else, so a citizen always lands on
  // the state root regardless of the city they are filing in. A state root
  // commonly carries no boundary tree of its own, which renders the cascade
  // empty; worse, where it does, the citizen picks boundaries from one tenant
  // and the complaint is created in another.
  const tenantId = config?.tenantId || Digit.ULBService.getCurrentTenantId();

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

  // Hierarchy type + highest/lowest level come from the tenant's
  // CMS-BOUNDARY.HierarchySchema (the Geography step writes it for a
  // workspace; mdms-v2 resolves a city to its state's row), with the
  // globalConfigs values as the fallback when there is no row. Resolved for
  // the same tenant, and by the same resolver, as the tree itself
  // (useFetchBoundaries), so the levels always belong to the tree shown.
  const { data: hierarchySchema } = useQuery(["PGR_TENANT_HIERARCHY", tenantId], () => getTenantHierarchy(tenantId), {
    enabled: !!tenantId,
    staleTime: Infinity,
  });

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
    hierarchySchema?.hierarchyType || window?.globalConfigs?.getConfig("HIERARCHY_TYPE") || "ADMIN";

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
      hierarchySchema?.highestLevel || window?.globalConfigs?.getConfig?.("PGR_BOUNDARY_HIGHEST_LEVEL");
    const configuredLowest =
      hierarchySchema?.lowestLevel || window?.globalConfigs?.getConfig?.("PGR_BOUNDARY_LOWEST_LEVEL");

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

  // The chosen node at each level, keyed by boundary type.
  const [selectedValues, setSelectedValues] = useState({});
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
    setAutoFilledKeys({});
  }, [tenantId]);

  // A caller that clears the value while this stays mounted (the inbox
  // filter's Clear all resets the form) clears the picks behind it too, so
  // they can't come back on the next pick or keep the lists narrowed.
  const currentValue = formData?.[config?.key];
  const hadValue = useRef(false);
  useEffect(() => {
    const hasValue = currentValue != null && currentValue !== "";
    if (hadValue.current && !hasValue) {
      setSelectedValues({});
      setAutoFilledKeys({});
    }
    hadValue.current = hasValue;
  }, [currentValue]);

  // Every level shows from the start, so a ward can be picked (and searched)
  // before its county; a pick fills the levels above it from the tree
  // (utils/boundaryCascade).
  const tree = useMemo(() => childrenData?.[0]?.boundary || [], [childrenData]);
  const pathByCode = useMemo(() => pathsByCode(tree), [tree]);
  const optionsByLevel = useMemo(
    () => optionsForLevels(effectiveHierarchy, selectedValues, tree),
    [effectiveHierarchy, selectedValues, tree]
  );
  // A node's parent, named as the dropdowns name it, to tell apart two places
  // that share a name at one level.
  const parentLabelOf = useCallback(
    (node) => {
      const path = pathByCode.get(node.code);
      const parent = path && path[path.length - 2];
      if (!parent) return null;
      const translated = t(parent.code);
      return translated && translated !== parent.code ? translated : parent.name || parent.code;
    },
    [pathByCode, t]
  );

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
    // Match the hint at the level the cascade actually files at — the CAPPED
    // hierarchy. Using the raw tree depth here made the map and the cascade
    // disagree whenever PGR_BOUNDARY_LOWEST_LEVEL sits above the deepest seeded
    // level: the map resolved a pin to the deeper level, findWardPath looked for
    // a node of that deeper type, and on a tenant that seeds it only patchily the
    // lookup found nothing and auto-fill silently no-opped.
    let hierarchy = effectiveHierarchy;
    if (hierarchy.length === 0) {
      const order = Digit.SessionStorage.get("boundaryHierarchyOrder");
      hierarchy = Array.isArray(order) ? order.map((item) => item.code) : [];
      const configuredLowest =
        hierarchySchema?.lowestLevel || window?.globalConfigs?.getConfig?.("PGR_BOUNDARY_LOWEST_LEVEL");
      const idx = configuredLowest ? hierarchy.findIndex((k) => sameLevelName(k, configuredLowest)) : -1;
      if (idx >= 0) hierarchy = hierarchy.slice(0, idx + 1);
    }
    if (hierarchy.length === 0) return;
    const targetType = hierarchy[hierarchy.length - 1];
    const path = findWardPath(childrenData[0]?.boundary, wardHintCode, wardHintName, targetType);
    if (!path || path.length === 0) return;

    // Rebuild the selection in one go; each level's options follow from it.
    // Only the levels this form shows, as a manual pick keeps them: a tree
    // root above the configured highest level stays out of the address.
    const shownPath = path.filter((node, i) => i === path.length - 1 || hierarchy.includes(node.boundaryType));
    const newSelectedValues = {};
    const newAutoFilled = {};
    for (const node of shownPath) {
      newSelectedValues[node.boundaryType] = node;
      newAutoFilled[node.boundaryType] = true;
    }
    setSelectedValues(newSelectedValues);
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
    onSelect(
      config.key,
      { ...deepest, isLeaf: isDeepestLevel, levels: levelsOf(shownPath) },
      { shouldValidate: true, shouldDirty: true, shouldTouch: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardHintCode, wardHintName, childrenData]);

  /**
   * A pick at any level. The picked node's own path fills the levels above it;
   * a lower selection is kept only while it still sits under the new pick.
   */
  const handleSelection = (selectedBoundary) => {
    if (!selectedBoundary) return;

    const boundaryType = selectedBoundary.boundaryType;
    const newSelectedValues = selectionAfterPick(selectedBoundary, {
      shownLevels: effectiveHierarchy,
      paths: pathByCode,
    });

    // A level the user touched, or whose value the pick changed, is no longer
    // "auto-filled" by the map, so it flips from read-only back to interactive.
    const newAutoFilled = {};
    for (const type of Object.keys(autoFilledKeys)) {
      const unchanged = newSelectedValues[type] && newSelectedValues[type].code === selectedValues[type]?.code;
      if (type !== boundaryType && unchanged) newAutoFilled[type] = true;
    }

    setSelectedValues(newSelectedValues);
    setAutoFilledKeys(newAutoFilled);

    // The option is chosen inside a menu, which the click tracking can't see.
    trackEvent("pgr.boundary.selected", {
      category: "pgr",
      label: boundaryType,
      value: levelsFilledAbove(selectedBoundary, selectedValues, newSelectedValues, boundaryHierarchy),
    });

    // Send the deepest chosen boundary, tagged with `isLeaf` so validators can
    // trust hierarchy depth instead of the `.children` array (which isn't
    // reliably preserved on the picked node and let County-level selections
    // pass — egovernments/CCRS#478).
    // A selection is a leaf when it's the configured deepest level OR the
    // node has no children (the branch stops early — common on tenants whose
    // boundary tree is shallower than the declared hierarchy). Either way the
    // submit pipeline treats it as the fileable leaf so the citizen isn't
    // blocked waiting on a deeper level that doesn't exist for this branch.
    const chosen = boundaryHierarchy.map((type) => newSelectedValues[type]).filter(Boolean);
    const deepest = chosen[chosen.length - 1];
    const lastLevel = effectiveHierarchy[effectiveHierarchy.length - 1];
    const nodeHasChildren = deepest.children && deepest.children.length > 0;
    // Childless-node-is-leaf only when a lowest level was configured AND capped
    // this tree — otherwise strict deepest-level-only (preserves CCRS#478 on
    // unconfigured deployments; a County missing children stays non-fileable).
    const isDeepestLevel = deepest.boundaryType === lastLevel || (lowestLevelCapped && !nodeHasChildren);
    // onSelect is RHF's setValue (FieldV1 wires component onSelect -> setValue).
    // Pass shouldValidate so the `required` rule re-runs and formState.isValid
    // (which gates the disabled NEXT/SubmitBar) flips true on selection.
    onSelect(
      config.key,
      { ...deepest, isLeaf: isDeepestLevel, levels: levelsOf(chosen) },
      { shouldValidate: true, shouldDirty: true, shouldTouch: true }
    );
  };

  /**
   * Check if a boundary type is allowed to be selected.
   */

  if (isBoundaryLoading) {
    return <Loader />;
  }

  return (
    <div className="pgr-boundary-cascade" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        {effectiveHierarchy.map((key) => {
          // Every level shows from the start (see optionsByLevel). A level
          // too long to list whole (null) waits, disabled, for the level
          // above; one with nothing under the current choice stays hidden.
          const waiting = optionsByLevel[key] === null;
          if (waiting || optionsByLevel[key]?.length > 0) {
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
                data={optionsByLevel[key] || []}
                waitingForParent={waiting}
                parentLabelOf={parentLabelOf}
                // Marked required on a form that needs the address; a filter
                // (the inbox's, `isMandatory: false`) leaves every level optional.
                required={config?.isMandatory !== false}
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
                disabled={waiting || (!!readOnly && !!autoFilledKeys[key] && !!selectedAtLevel)}
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
const BoundaryDropdown = ({ label, data, onChange, selected, fieldKey, disabled, parentLabelOf, waitingForParent, required }) => {
  const { t } = useTranslation();
  const id = `boundary-${(fieldKey || label || "field").toString().toLowerCase().replace(/\s+/g, "-")}`;
  // Defensive dedup by code. The jurisdiction prune (filterTree above)
  // is duplicate-safe by construction, but in the field the dropdown
  // has been observed listing the same ward twice (see
  // egovernments/CCRS#496 screen recording — upstream data shape under
  // overlapping HRMS jurisdictions, exact origin still being chased).
  // Dedup at render keeps the symptom contained regardless of where
  // the duplicate enters `data`.
  // Built once per list, not per render: a level can list hundreds of places.
  const labelled = useMemo(() => {
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
        node,
      });
    }
    return disambiguateLabels(options, parentLabelOf || (() => null));
  }, [data, t, parentLabelOf]);
  return (
    <V2Field label={t(label)} required={required} htmlFor={id}>
      <V2Select
        id={id}
        value={selected?.code}
        onValueChange={(code) => {
          const picked = data.find((n) => n.code === code);
          if (picked) onChange(picked);
        }}
        options={labelled}
        // Filing's boundary levels search at any length, as the complaint type
        // levels do (CCRS#941): a ward is typed, not scanned for, and a short
        // list on one tenant is a long one on the next.
        searchable
        searchPlaceholder={t("CS_COMMON_SEARCH") === "CS_COMMON_SEARCH" ? "Search" : t("CS_COMMON_SEARCH")}
        // A tenant that seeds CS_COMMON_SELECT still gets its own text; otherwise
        // the verb is translated too, not just the field name.
        placeholder={
          waitingForParent
            ? translateOr(t, "CS_COMPLAINT_PICK_PARENT_FIRST", "Select the level above first")
            : t("CS_COMMON_SELECT") === "CS_COMMON_SELECT"
            ? selectPlaceholder(t, t(label))
            : t("CS_COMMON_SELECT")
        }
        disabled={!!disabled}
      />
    </V2Field>
  );
};

/**
 * The chosen node at each level, root to leaf, as `{ code, name, boundaryType }`.
 * Handed up with the selection so a caller can name the whole address (a
 * review screen showing "Ward, Sub County, County") without another lookup;
 * the complaint payload still reads only the leaf's `code`.
 */
function levelsOf(nodes) {
  return (nodes || []).map((node) => ({ code: node.code, name: node.name, boundaryType: node.boundaryType }));
}

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