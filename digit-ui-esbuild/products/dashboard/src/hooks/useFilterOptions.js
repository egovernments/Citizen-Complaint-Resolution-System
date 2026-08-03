import { useEffect, useMemo, useState } from "react";
import { runBatchQueries } from "../services/analyticsService";
import { fetchBoundariesByCodes } from "../services/boundaryService";
import {
  buildComplaintTypeIndex,
  fetchComplaintHierarchyRecords,
} from "../services/complaintHierarchyService";
import {
  buildComplaintTree,
  pruneComplaintTree,
} from "../utils/complaintTypeTree";
import { dimensionLabel } from "../i18n/dimensionLabel";
import useDashboardT from "../i18n/useDashboardT";
import {
  COMPLAINT_TYPE_OPTIONS,
  GEOGRAPHY_OPTIONS,
} from "../config/globalFilterGroups";

/**
 * Fetches the global filter dropdown options (wards + complaint types) as
 * server-scoped distincts: one inline batch _query on the facts grain, so the
 * backend's ABAC (PrincipalScopeResolver department/ward scoping) applies —
 * a Water-dept supervisor only ever sees water complaint types.
 *
 * The analytics distinct decides WHICH codes appear; the MDMS complaint
 * hierarchy (RAINMAKER-PGR.ComplaintHierarchy, fetched in parallel) supplies
 * the complaint-type display names and root-category grouping. Ward labels
 * also pull boundary-service localname when present; on Bomet that field is
 * null, so dimensionLabel falls through to en_IN rainmaker-boundary-* place
 * names (and a pt_PT seed when operators have upserted one) (#1108). All
 * labels resolve through dimensionLabel: localized message first, then the
 * master's display name, then the raw code.
 *
 * Returns: { options, loading }
 * - options: { geography: [{id,label}], complaintType: [{id,label,group?}] } —
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
          group: dimensionLabel(entry.rootCode, "complaintType", entry.rootLabel),
        }),
    };
  };
}

/** Map boundary-service entities → code → data-owned display name. */
function toBoundaryDecorator(boundaries) {
  if (!boundaries?.length) return null;
  const names = new Map();
  for (const boundary of boundaries) {
    const code = String(boundary?.code ?? "").trim();
    const name = boundary?.localname || boundary?.name || boundary?.label;
    if (code && name) names.set(code, String(name));
  }
  if (!names.size) return null;
  return (code) => {
    const name = names.get(code);
    return name ? { label: name } : null;
  };
}

export function useFilterOptions() {
  // Raw fetch payload and derived labels are split so a language switch
  // re-labels from the cached rows without re-querying the backend.
  const [raw, setRaw] = useState({
    results: null,
    hierarchyRecords: null,
    boundaries: null,
    loading: true,
  });
  const { language, i18nTick } = useDashboardT();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      runBatchQueries(OPTION_QUERIES),
      // Resolves null on any failure (never rejects) — labels then fall back
      // to the humanizer and the list stays flat, exactly the old behavior.
      fetchComplaintHierarchyRecords(),
    ])
      .then(async ([res, hierarchyRecords]) => {
        if (cancelled) return;
        const results = res?.results || {};
        const wardCodes = (results.wards?.rows || [])
          .map((row) => String(row?.ward_code ?? "").trim())
          .filter(Boolean);
        // Parity with the map: localname is the data-owned fallback when
        // rainmaker-boundary-* has no message for the active locale (#1108).
        let boundaries = [];
        try {
          boundaries = wardCodes.length
            ? await fetchBoundariesByCodes(wardCodes)
            : [];
        } catch {
          boundaries = [];
        }
        if (cancelled) return;
        setRaw({ results, hierarchyRecords, boundaries, loading: false });
      })
      .catch(() => {
        // Never block the dashboard — the selects keep their placeholder lists.
        if (!cancelled) {
          setRaw({
            results: null,
            hierarchyRecords: null,
            boundaries: null,
            loading: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      "boundary",
      toBoundaryDecorator(raw.boundaries)
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
    const options = {
      ...(geography && { geography }),
      ...(complaintType && { complaintType }),
      ...(complaintTypeTree && { complaintTypeTree }),
    };
    return {
      options: Object.keys(options).length ? options : null,
      loading: raw.loading,
    };
    // language + i18nTick: re-label when locale switches OR when the en_IN
    // boundary side-cache (ensureMessages) arrives after first paint (#1108).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- i18nTick covers late bundles
  }, [raw, language, i18nTick]);
}
