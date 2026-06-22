/**
 * Sparkline KPI cards — API query wiring and viz type for live delta + trend tiles.
 */

import { VIZ_TYPE } from "./visualizationStyles";

export const SPARKLINE_KPI_IDS = new Set([
  "cl-metric-total-registered",
  "cl-metric-total-open",
  "cl-metric-total-resolved",
  "cl-metric-inflow-rate",
  "rs-metric-sla-compliance",
  "rs-metric-breach-count",
  "ce-metric-reopen-rate",
  "ce-metric-csat",
]);

/**
 * @type {Record<string, {
 *   sparklineQueryKey: string,
 *   currentQueryKey: string,
 *   priorQueryKey: string,
 *   deltaLabel: string,
 *   measureKey?: string,
 *   sparklineMeasureKey?: string,
 *   derived?: string,
 * }>}
 */
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
  "cl-metric-total-resolved": {
    sparklineQueryKey: "cl_res_sparkline_7d",
    currentQueryKey: "cl_res_weekly",
    priorQueryKey: "cl_res_prior_week",
    deltaLabel: "WoW",
  },
  "cl-metric-inflow-rate": {
    sparklineQueryKey: "cl_reg_sparkline_7d",
    currentQueryKey: "cl_reg_weekly",
    priorQueryKey: "cl_reg_prior_week",
    deltaLabel: "WoW",
    derived: "dailyAvgWow",
  },
  "rs-metric-sla-compliance": {
    sparklineQueryKey: "rs_sla_compliance_sparkline_7d",
    currentQueryKey: "rs_sla_compliance_week",
    priorQueryKey: "rs_sla_compliance_prior_week",
    deltaLabel: "WoW",
    measureKey: "pct",
    sparklineMeasureKey: "pct",
  },
  "rs-metric-breach-count": {
    sparklineQueryKey: "rs_breach_sparkline_7d",
    currentQueryKey: "rs_breach_total",
    priorQueryKey: "rs_breach_prior_week",
    deltaLabel: "WoW",
  },
  "ce-metric-reopen-rate": {
    sparklineQueryKey: "ce_reopen_sparkline_7d",
    currentQueryKey: "ce_reopen_7d",
    priorQueryKey: "ce_reopen_prior_week",
    deltaLabel: "WoW",
    measureKey: "pct",
    sparklineMeasureKey: "pct",
  },
  "ce-metric-csat": {
    sparklineQueryKey: "ce_csat_sparkline_7d",
    currentQueryKey: "ce_csat_avg_week",
    priorQueryKey: "ce_csat_prior_week",
    deltaLabel: "WoW",
    measureKey: "avg",
    sparklineMeasureKey: "avg",
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
