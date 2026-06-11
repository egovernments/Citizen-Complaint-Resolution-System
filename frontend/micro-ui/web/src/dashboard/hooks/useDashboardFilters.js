import { useCallback, useState } from "react";
import {
  loadDashboardFilters,
  persistDashboardFilters,
  resolveSubMetricId as resolveSubMetricIdForMetric,
} from "../config/dashboardFilters";

export function useDashboardFilters() {
  const [filters, setFilters] = useState(loadDashboardFilters);

  const setFilter = useCallback((groupId, value) => {
    setFilters((prev) => {
      const next = { ...prev, [groupId]: value };
      persistDashboardFilters(next);
      return next;
    });
  }, []);

  const resolveSubMetricId = useCallback(
    (metric) => resolveSubMetricIdForMetric(metric, filters),
    [filters]
  );

  return {
    filters,
    setFilter,
    resolveSubMetricId,
  };
}
