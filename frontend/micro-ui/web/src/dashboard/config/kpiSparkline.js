/**
 * Sparkline KPI cards — API query wiring and viz type for live delta + trend tiles.
 */

import { VIZ_TYPE } from "./visualizationStyles";

export const SPARKLINE_KPI_IDS = new Set([
  "cl-metric-total-registered",
  "cl-metric-total-open",
  "cl-metric-inflow-rate",
]);

/** @type {Record<string, { sparklineQueryKey: string, currentQueryKey: string, priorQueryKey: string, deltaLabel: string, derived?: string }>} */
export const SPARKLINE_KPI_QUERIES = {
  "cl-metric-total-registered": {
    sparklineQueryKey: "cl_reg_sparkline_7d",
    currentQueryKey: "cl_reg_weekly",
    priorQueryKey: "cl_reg_prior_week",
    deltaLabel: "WoW",
  },
  "cl-metric-total-open": {
    sparklineQueryKey: "cl_open_sparkline_7d",
    currentQueryKey: "cl_open_weekly",
    priorQueryKey: "cl_open_prior_week",
    deltaLabel: "WoW",
  },
  "cl-metric-inflow-rate": {
    sparklineQueryKey: "cl_reg_sparkline_7d",
    currentQueryKey: "cl_reg_weekly",
    priorQueryKey: "cl_reg_prior_week",
    deltaLabel: "WoW",
    derived: "dailyAvgWow",
  },
};

export function isSparklineKpi(metricId) {
  return SPARKLINE_KPI_IDS.has(metricId);
}

export function getSparklineKpiQueryConfig(metricId) {
  return SPARKLINE_KPI_QUERIES[metricId] || null;
}

export function getMetricVizType(metric) {
  if (metric?.vizType) return metric.vizType;
  if (isSparklineKpi(metric?.id)) return VIZ_TYPE.NUMBER_TILE_SPARKLINE;
  return VIZ_TYPE.NUMBER_TILE;
}
