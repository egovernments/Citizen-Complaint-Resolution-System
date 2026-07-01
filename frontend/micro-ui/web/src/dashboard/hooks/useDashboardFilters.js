import { useCallback, useEffect, useRef, useState } from "react";
import { applyFilterChange } from "../config/globalFilterGroups";
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
  const skipPersistRef = useRef(true);

  useEffect(() => {
    if (!optionLists) return;
    setFilters((prev) => reconcileFiltersWithOptions(prev, optionLists));
  }, [optionLists]);

  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    try {
      persistDashboardFilters(filters, optionLists);
    } catch {
      /* ignore quota / private-mode storage errors */
    }
  }, [filters, optionLists]);

  const applyFilterOptions = useCallback((filterOptions) => {
    setOptionLists(filterOptions);
  }, []);

  const setFilter = useCallback((groupId, value) => {
    setFilters((prev) => applyFilterChange(prev, groupId, value));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(clearDashboardFilters());
  }, []);

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
