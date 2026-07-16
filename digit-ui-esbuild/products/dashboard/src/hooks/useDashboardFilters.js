import { useCallback, useEffect, useState } from "react";
import {
  clearDashboardFilters,
  loadDashboardFilters,
  persistDashboardFilters,
  reconcileFiltersWithOptions,
  resolveSubMetricId as resolveSubMetricIdForMetric,
} from "../config/dashboardFilters";

export function useDashboardFilters() {
  const [filters, setFilters] = useState(loadDashboardFilters);
  const [optionLists, setOptionLists] = useState(null);

  useEffect(() => {
    if (!optionLists) return;
    setFilters((prev) => {
      const next = reconcileFiltersWithOptions(prev, optionLists);
      if (next !== prev) {
        persistDashboardFilters(next, optionLists);
      }
      return next;
    });
  }, [optionLists]);

  const applyFilterOptions = useCallback((filterOptions) => {
    setOptionLists(filterOptions);
  }, []);

  const setFilter = useCallback(
    (groupId, value) => {
      setFilters((prev) => {
        const next = { ...prev, [groupId]: value };
        if (groupId === "dateFrom" || groupId === "dateTo") {
          next.dateRangeActive = true;
        }
        persistDashboardFilters(next, optionLists);
        return next;
      });
    },
    [optionLists]
  );

  const clearFilters = useCallback(() => {
    const next = clearDashboardFilters();
    persistDashboardFilters(next, optionLists);
    setFilters(next);
  }, [optionLists]);

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
