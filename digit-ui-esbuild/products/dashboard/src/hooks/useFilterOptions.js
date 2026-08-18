import { useEffect, useMemo, useState } from "react";
import { runBatchQueries } from "../services/analyticsService";
import {
  buildComplaintTypeIndex,
  fetchComplaintHierarchyRecords,
} from "../services/complaintHierarchyService";
import { fetchBoundaryTreeRoots } from "../services/boundaryHierarchyService";
import {
  buildComplaintTree,
  pruneComplaintTree,
} from "../utils/complaintTypeTree";
import { buildBoundaryTree, pruneBoundaryTree } from "../utils/boundaryTree";
import { dimensionLabel } from "../i18n/dimensionLabel";
import useDashboardT from "../i18n/useDashboardT";
import {
  COMPLAINT_TYPE_OPTIONS,
  DEPARTMENT_OPTIONS,
  GEOGRAPHY_OPTIONS,
} from "../config/globalFilterGroups";

/**
 * Fetches the global filter dropdown options (wards + complaint types + departments) as
 * server-scoped distincts: one inline batch _query on the facts grain, so the
 * backend's ABAC (PrincipalScopeResolver department/ward scoping) applies —
 * a Water-dept supervisor only ever sees water complaint types.
 *
 * The analytics distinct decides WHICH codes appear; the MDMS complaint
 * hierarchy (RAINMAKER-PGR.ComplaintHierarchy, fetched in parallel) supplies
 * the complaint-type display names and root-category grouping. All labels
 * resolve through dimensionLabel: localized message first, then the master's
 * display name, then the shared humanizer (stray/QA codes, failed hierarchy
 * fetch). Labels re-derive from the cached rows on a language switch.
 *
 * Returns: { options, loading }
 * - options: { geography, complaintType, department } — each is an option list;
 *   each list prepended with its "all" sentinel; a key is omitted when its
 *   query failed or returned nothing, so DashboardFilters falls back to the
 *   placeholder list for that select. null until loaded / on total failure.
 * - `group` (root complaint-category display name) is additive: every consumer
 *   of the flat {id,label} contract (sanitizeFilters / reconcile / header
 *   subtitle) keeps working; DashboardFilters groups at render time.
 */
const OPTION_QUERIES = {
  complaintTypes: {
    grain: "facts",
    window: { name: "all" },
    dimensions: ["service_code"],
    measures: [{ name: "n", agg: "count" }],
    limit: 300,
  },
  wards: {
    grain: "facts",
    window: { name: "all" },
    dimensions: ["ward_code"],
    measures: [{ name: "n", agg: "count" }],
    limit: 300,
  },
  departments: {
    grain: "facts",
    window: { name: "all" },
    dimensions: ["department_code"],
    measures: [{ name: "n", agg: "count" }],
    limit: 300,
  },
};

function toOptionList(rows, codeKey, sentinelOptions, kind, decorate) {
  const options = (rows || [])
    .map((row) => String(row?.[codeKey] ?? "").trim())
    .filter(Boolean) // live data carries blank-code rows — drop them
    .map((code) => {
      const extra = decorate?.(code);
      return {
        id: code,
        label: dimensionLabel(code, kind, extra?.label || undefined),
        ...(extra?.group && { group: extra.group }),
      };
    })
    .sort((a, b) => {
      // Grouped options first (grouped alphabetically), stray/ungrouped codes
      // last — group-contiguous so the render pass can emit <optgroup> runs.
      if (!!a.group !== !!b.group) return a.group ? -1 : 1;
      return (
        (a.group ?? "").localeCompare(b.group ?? "") ||
        a.label.localeCompare(b.label)
      );
    });
  return options.length ? [...sentinelOptions, ...options] : null;
}

/** Adapt the hierarchy index into toOptionList's decorate callback. */
function toComplaintTypeDecorator(hierarchyIndex) {
  if (!hierarchyIndex) return null;
  return (code) => {
    const entry = hierarchyIndex.get(code);
    if (!entry) return null; // stray/QA code — humanized fallback, no group
    return {
      label: entry.label,
      // A code that IS its own root (top-level category) stays ungrouped —
      // a one-item optgroup echoing the option's own label is just noise.
      ...(entry.rootCode !== code &&
        entry.rootLabel && {
          group: dimensionLabel(
            entry.rootCode,
            "complaintType",
            entry.rootLabel
          ),
        }),
    };
  };
}

export function useFilterOptions({ enabled = true } = {}) {
  // Raw fetch payload and derived labels are split so a language switch
  // re-labels from the cached rows without re-querying the backend.
  const [raw, setRaw] = useState({
    results: null,
    hierarchyRecords: null,
    boundaryRoots: null,
    loading: true,
  });
  const { language, i18nTick } = useDashboardT();

  useEffect(() => {
    if (!enabled) {
      setRaw({
        results: null,
        hierarchyRecords: null,
        boundaryRoots: null,
        loading: false,
      });
      return undefined;
    }
    let cancelled = false;
    Promise.all([
      runBatchQueries(OPTION_QUERIES),
      // Both hierarchy fetches resolve null on any failure (never reject) —
      // labels then fall back to the humanizer and the affected filter stays
      // flat, exactly the old behavior.
      fetchComplaintHierarchyRecords(),
      fetchBoundaryTreeRoots(),
    ])
      .then(([res, hierarchyRecords, boundaryRoots]) => {
        if (cancelled) return;
        setRaw({
          results: res?.results || {},
          hierarchyRecords,
          boundaryRoots,
          loading: false,
        });
      })
      .catch(() => {
        // Never block the dashboard — the selects keep their placeholder lists.
        if (!cancelled)
          setRaw({
            results: null,
            hierarchyRecords: null,
            boundaryRoots: null,
            loading: false,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return useMemo(() => {
    if (!raw.results) return { options: null, loading: raw.loading };
    const hierarchyIndex = raw.hierarchyRecords
      ? buildComplaintTypeIndex(raw.hierarchyRecords)
      : null;
    // Per-entry failures come back as { error } (no rows) — treated as empty.
    const complaintType = toOptionList(
      raw.results.complaintTypes?.rows,
      "service_code",
      COMPLAINT_TYPE_OPTIONS,
      "complaintType",
      toComplaintTypeDecorator(hierarchyIndex?.size ? hierarchyIndex : null)
    );
    const geography = toOptionList(
      raw.results.wards?.rows,
      "ward_code",
      GEOGRAPHY_OPTIONS,
      "boundary"
    );
    const department = toOptionList(
      raw.results.departments?.rows,
      "department_code",
      DEPARTMENT_OPTIONS,
      "department"
    );
    // Tree-traversal complaint-type filter: the MDMS tree intersected with the
    // ABAC-scoped DISTINCT service_code list above (pruneComplaintTree). Both
    // inputs must exist — no scoped distincts (query failed / zero rows) or no
    // master → null, and the widget degrades to the flat leaf select.
    const scopedLeafCodes = (raw.results.complaintTypes?.rows || [])
      .map((row) => String(row?.service_code ?? "").trim())
      .filter(Boolean);
    const complaintTypeTree = pruneComplaintTree(
      buildComplaintTree(raw.hierarchyRecords),
      scopedLeafCodes
    );
    // Geography drill-down (CCSD-2171): the boundary-relationships tree
    // intersected with the same ABAC-scoped DISTINCT ward_code list the flat
    // select is built from. Either input missing → null, and the filter
    // degrades to the flat ward select — the complaint-type pattern verbatim.
    const scopedWardCodes = (raw.results.wards?.rows || [])
      .map((row) => String(row?.ward_code ?? "").trim())
      .filter(Boolean);
    const geographyTree = pruneBoundaryTree(
      buildBoundaryTree(raw.boundaryRoots),
      scopedWardCodes
    );
    const options = {
      ...(geography && { geography }),
      ...(complaintType && { complaintType }),
      ...(department && { department }),
      ...(complaintTypeTree && { complaintTypeTree }),
      ...(geographyTree && { geographyTree }),
    };
    return {
      options: Object.keys(options).length ? options : null,
      loading: raw.loading,
    };
    // `languageChanged` can fire before the new message bundle is installed.
    // i18nTick also advances on the later store `added` event, so cached rows
    // are re-labelled once the selected locale is actually available (#1108).
  }, [raw, language, i18nTick]);
}
