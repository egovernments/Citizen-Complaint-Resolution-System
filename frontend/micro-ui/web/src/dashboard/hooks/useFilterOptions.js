import { useEffect, useState } from "react";
import { runBatchQueries } from "../services/analyticsService";
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
 * ward_name is not a groupable facts column, so both selects group by their
 * code and label via formatDimensionLabel (the shared dimension humanizer).
 *
 * Returns: { options, loading }
 * - options: { geography: [{id,label}], complaintType: [{id,label}] } — each
 *   list prepended with its "all" sentinel; a key is omitted when its query
 *   failed or returned nothing, so DashboardFilters falls back to the
 *   placeholder list for that select. null until loaded / on total failure.
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

function toOptionList(rows, codeKey, sentinelOptions) {
  const options = (rows || [])
    .map((row) => String(row?.[codeKey] ?? "").trim())
    .filter(Boolean) // live data carries blank-code rows — drop them
    .map((code) => ({ id: code, label: formatDimensionLabel(code) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return options.length ? [...sentinelOptions, ...options] : null;
}

export function useFilterOptions() {
  const [state, setState] = useState({ options: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    runBatchQueries(OPTION_QUERIES)
      .then((res) => {
        if (cancelled) return;
        const results = res?.results || {};
        // Per-entry failures come back as { error } (no rows) — treated as empty.
        const complaintType = toOptionList(
          results.complaintTypes?.rows,
          "service_code",
          COMPLAINT_TYPE_OPTIONS
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
