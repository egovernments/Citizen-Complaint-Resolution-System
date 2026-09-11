import { useCallback, useEffect, useState } from "react";
import {
  clearDashboardFilters,
  loadDashboardFilters,
  persistDashboardFilters,
  reconcileFiltersWithOptions,
  resolveSubMetricId as resolveSubMetricIdForMetric,
} from "../config/dashboardFilters";
import { normalizeComplaintTypeValue } from "../utils/complaintTypeTree";
import { buildDefaultFilters } from "../config/globalFilterGroups";

/** `timeZone` is the already-resolved dashboard config zone (see AdminDashboard). */
export function useDashboardFilters({ persistent = true, timeZone } = {}) {
  const [filters, setFilters] = useState(() =>
    persistent ? loadDashboardFilters(timeZone) : buildDefaultFilters(timeZone)
  );
  const [optionLists, setOptionLists] = useState(null);

  useEffect(() => {
    if (!optionLists) return;
    setFilters((prev) => {
      const next = reconcileFiltersWithOptions(prev, optionLists, timeZone);
      if (next !== prev) {
        if (persistent) persistDashboardFilters(next, optionLists, timeZone);
      }
      return next;
    });
  }, [optionLists, persistent, timeZone]);

  const applyFilterOptions = useCallback((filterOptions) => {
    setOptionLists(filterOptions);
  }, []);

  const setFilter = useCallback(
    (groupId, value) => {
      setFilters((prev) => {
        let next;
        if (groupId === "complaintType") {
          // Tree-traversal type filter: the widget sends the { code, path,
          // leaf } node selection (APPLY-ON-SELECT); the flat fallback select
          // still sends a bare leaf-code string. Persist the trio atomically
          // so leaf → serviceCode / interior → complaintPath resolves without
          // waiting for the MDMS tree.
          const selection = normalizeComplaintTypeValue(value);
          next = {
            ...prev,
            complaintType: selection.code,
            complaintTypePath: selection.path,
            complaintTypeLeaf: selection.leaf,
          };
        } else {
          next = { ...prev, [groupId]: value };
        }
        if (groupId === "dateFrom" || groupId === "dateTo") {
          next.dateRangeActive = true;
        }
        if (persistent) persistDashboardFilters(next, optionLists, timeZone);
        return next;
      });
    },
    [optionLists, persistent, timeZone]
  );

  const clearFilters = useCallback(() => {
    const next = clearDashboardFilters(timeZone);
    if (persistent) persistDashboardFilters(next, optionLists, timeZone);
    setFilters(next);
  }, [optionLists, persistent, timeZone]);

  const resolveSubMetricId = useCallback(
    (metric) => resolveSubMetricIdForMetric(metric, filters),
    [filters]
  );

  return {
    filters,
    setFilter,
    clearFilters,
    applyFilterOptions,
    resolveSubMetricId,
  };
}
