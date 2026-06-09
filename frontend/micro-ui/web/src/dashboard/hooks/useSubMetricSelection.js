import { useCallback, useState } from "react";
import { KPI_METRICS } from "../config/kpiQueries";

const STORAGE_KEY = "bomet-dashboard-submetric-selection-v1";

function loadSelection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function useSubMetricSelection() {
  const [selection, setSelection] = useState(loadSelection);

  const getSubMetricId = useCallback(
    (metricId) => {
      const metric = KPI_METRICS.find((m) => m.id === metricId);
      if (!metric) return null;
      return selection[metricId] || metric.defaultSubMetricId;
    },
    [selection]
  );

  const setSubMetricId = useCallback((metricId, subMetricId) => {
    setSelection((prev) => {
      const next = { ...prev, [metricId]: subMetricId };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { getSubMetricId, setSubMetricId };
}
