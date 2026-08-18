import { useCallback, useEffect, useState } from "react";
import {
  clearDashboardFilters,
  loadDashboardFilters,
  persistDashboardFilters,
  reconcileFiltersWithOptions,
  resolveSubMetricId as resolveSubMetricIdForMetric,
} from "../config/dashboardFilters";
import {
  normalizeHierarchySelections,
  normalizeStringList,
} from "../utils/multiSelectFilters";
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
        if (groupId === "geographies" || groupId === "complaintTypes") {
          next = { ...prev, [groupId]: normalizeHierarchySelections(value) };
        } else if (groupId === "departments") {
          next = { ...prev, departments: normalizeStringList(value) };
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
