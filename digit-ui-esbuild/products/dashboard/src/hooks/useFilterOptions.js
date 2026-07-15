import { useEffect, useMemo, useState } from "react";
import { runBatchQueries } from "../services/analyticsService";
import { fetchComplaintTypeIndex } from "../services/complaintHierarchyService";
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
 * the complaint-type display names and root-category grouping. All labels
 * resolve through dimensionLabel: localized message first, then the master's
 * display name, then the shared humanizer (stray/QA codes, failed hierarchy
 * fetch). Labels re-derive from the cached rows on a language switch.
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

export function useFilterOptions() {
  // Raw fetch payload and derived labels are split so a language switch
  // re-labels from the cached rows without re-querying the backend.
  const [raw, setRaw] = useState({ results: null, hierarchyIndex: null, loading: true });
  const { language } = useDashboardT();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      runBatchQueries(OPTION_QUERIES),
      // Resolves null on any failure (never rejects) — labels then fall back
      // to the humanizer and the list stays flat, exactly the old behavior.
      fetchComplaintTypeIndex(),
    ])
      .then(([res, hierarchyIndex]) => {
        if (cancelled) return;
        setRaw({ results: res?.results || {}, hierarchyIndex, loading: false });
      })
      .catch(() => {
        // Never block the dashboard — the selects keep their placeholder lists.
        if (!cancelled) setRaw({ results: null, hierarchyIndex: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    if (!raw.results) return { options: null, loading: raw.loading };
    // Per-entry failures come back as { error } (no rows) — treated as empty.
    const complaintType = toOptionList(
      raw.results.complaintTypes?.rows,
      "service_code",
      COMPLAINT_TYPE_OPTIONS,
      "complaintType",
      toComplaintTypeDecorator(raw.hierarchyIndex)
    );
    const geography = toOptionList(
      raw.results.wards?.rows,
      "ward_code",
      GEOGRAPHY_OPTIONS,
      "boundary"
    );
    const options = {
      ...(geography && { geography }),
      ...(complaintType && { complaintType }),
    };
    return {
      options: Object.keys(options).length ? options : null,
      loading: raw.loading,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- language re-labels cached rows
  }, [raw, language]);
}
