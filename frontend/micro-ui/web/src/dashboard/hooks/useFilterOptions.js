import { useEffect, useState } from "react";
import { runBatchQueries } from "../services/analyticsService";
import { fetchComplaintTypeIndex } from "../services/complaintHierarchyService";
import { formatDimensionLabel } from "../config/labelFormat";
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
 * the complaint-type display names and root-category grouping. Codes missing
 * from the master (stray/QA data) — and everything when the hierarchy fetch
 * fails — fall back to formatDimensionLabel (the shared dimension humanizer)
 * with no group. Ward labels stay humanized codes (localized ward naming is a
 * separate follow-up).
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

function toOptionList(rows, codeKey, sentinelOptions, decorate) {
  const options = (rows || [])
    .map((row) => String(row?.[codeKey] ?? "").trim())
    .filter(Boolean) // live data carries blank-code rows — drop them
    .map((code) => {
      const extra = decorate?.(code);
      return {
        id: code,
        label: extra?.label || formatDimensionLabel(code),
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
      ...(entry.rootCode !== code && entry.rootLabel && { group: entry.rootLabel }),
    };
  };
}

export function useFilterOptions() {
  const [state, setState] = useState({ options: null, loading: true });

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
        const results = res?.results || {};
        // Per-entry failures come back as { error } (no rows) — treated as empty.
        const complaintType = toOptionList(
          results.complaintTypes?.rows,
          "service_code",
          COMPLAINT_TYPE_OPTIONS,
          toComplaintTypeDecorator(hierarchyIndex)
        );
        const geography = toOptionList(
          results.wards?.rows,
          "ward_code",
          GEOGRAPHY_OPTIONS
        );
        const options = {
          ...(geography && { geography }),
          ...(complaintType && { complaintType }),
        };
        setState({
          options: Object.keys(options).length ? options : null,
          loading: false,
        });
      })
      .catch(() => {
        // Never block the dashboard — the selects keep their placeholder lists.
        if (!cancelled) setState({ options: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
