/**
 * Sparkline KPI cards — API query wiring and viz type for live delta + trend tiles.
 */

import { VIZ_TYPE } from "./visualizationStyles";

export const SPARKLINE_KPI_IDS = new Set([
  "cl-metric-new-created",
  "cl-metric-created-today",
  "cl-metric-total-open",
  "cl-metric-total-resolved",
  "cl-metric-resolution-rate",
  "cl-metric-resolved-on-time-rate",
  "rs-metric-sla-compliance",
  "rs-metric-breach-count",
  "ce-metric-reopen-rate",
]);

/**
 * @type {Record<string, {
 *   sparklineQueryKey: string,
 *   currentQueryKey: string,
 *   priorQueryKey: string,
 *   deltaLabel: string,
 *   measureKey?: string,
 *   sparklineMeasureKey?: string,
 *   sparklineMode?: "dateRange" | "recentDays",
 *   sparklineDateField?: string,
 *   recentDays?: number,
 *   deltaMode?: "percentPoint" | "duration" | "rating",
 *   currentCreatedCountKey?: string,
 *   currentResolvedCountKey?: string,
 *   priorCreatedCountKey?: string,
 *   priorResolvedCountKey?: string,
 *   derived?: string,
 * }>}
 */
export const SPARKLINE_KPI_QUERIES = {
  "cl-metric-new-created": {
    sparklineQueryKey: "cl_new_created_sparkline",
    currentQueryKey: "cl_new_created_count",
    priorQueryKey: "cl_new_created_prior",
    deltaLabel: "vs prior period",
    sparklineMode: "dateRange",
  },
  "cl-metric-created-today": {
    sparklineQueryKey: "cl_created_today_sparkline",
    currentQueryKey: "cl_created_today_count",
    priorQueryKey: "cl_created_yesterday_count",
    deltaLabel: "vs yesterday",
    sparklineMode: "recentDays",
    recentDays: 7,
  },
  "cl-metric-total-open": {
    sparklineQueryKey: "cl_open_complaints_sparkline",
    currentQueryKey: "cl_open_complaints_live",
    priorQueryKey: "cl_open_complaints_prior",
    filedSparklineQueryKey: "cl_new_created_sparkline",
    filedCountQueryKey: "cl_new_created_count",
    resolvedSparklineQueryKey: "cl_resolved_date_range_sparkline",
    resolvedCountQueryKey: "cl_resolved_date_range_count",
    deltaLabel: "vs prior period",
    sparklineMode: "dateRange",
    sparklineDateField: "snapshot_date",
    derived: "openBacklogFromFlows",
  },
  "cl-metric-total-resolved": {
    sparklineQueryKey: "cl_resolved_date_range_sparkline",
    currentQueryKey: "cl_resolved_date_range_count",
    priorQueryKey: "cl_resolved_date_range_prior",
    deltaLabel: "vs prior period",
    sparklineMode: "dateRange",
    sparklineDateField: "occurred_date",
  },
  "cl-metric-resolution-rate": {
    sparklineQueryKey: "cl_resolution_rate_sparkline",
    currentQueryKey: "cl_resolution_rate_count",
    priorQueryKey: "cl_resolution_rate_prior",
    currentCreatedCountKey: "cl_new_created_count",
    currentResolvedCountKey: "cl_resolution_cohort_resolved_count",
    priorCreatedCountKey: "cl_new_created_prior",
    priorResolvedCountKey: "cl_resolution_cohort_resolved_prior",
    deltaLabel: "vs prior period",
    deltaMode: "percentPoint",
    sparklineMode: "dateRange",
    measureKey: "pct",
    sparklineMeasureKey: "pct",
  },
  "cl-metric-resolved-on-time-rate": {
    sparklineQueryKey: "cl_resolved_on_time_rate_sparkline",
    currentQueryKey: "cl_resolved_on_time_rate_count",
    priorQueryKey: "cl_resolved_on_time_rate_prior",
    currentCreatedCountKey: "cl_resolved_date_range_count",
    currentResolvedCountKey: "cl_resolved_on_time_compliant_count",
    priorCreatedCountKey: "cl_resolved_date_range_prior",
    priorResolvedCountKey: "cl_resolved_on_time_compliant_prior",
    deltaLabel: "vs prior period",
    deltaMode: "percentPoint",
    sparklineMode: "dateRange",
    measureKey: "pct",
    sparklineMeasureKey: "pct",
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
  "cl-metric-oldest-open": {
    currentQueryKey: "cl_oldest_open_age",
    deltaLabel: "vs period start",
    derived: "oldestOpenAge",
    measureKey: "max_age_ms",
  },
  "cl-metric-avg-resolution-time": {
    currentQueryKey: "cl_avg_resolution_time",
    priorQueryKey: "cl_avg_resolution_time_prior",
    deltaLabel: "vs prior period",
    deltaMode: "duration",
    measureKey: "avg_ms",
  },
  "cl-metric-reopen-rate": {
    currentQueryKey: "cl_reopen_rate_count",
    priorQueryKey: "cl_reopen_rate_prior",
    currentCreatedCountKey: "cl_resolved_date_range_count",
    currentResolvedCountKey: "cl_reopen_rate_reopened_count",
    priorCreatedCountKey: "cl_resolved_date_range_prior",
    priorResolvedCountKey: "cl_reopen_rate_reopened_prior",
    deltaLabel: "vs prior period",
    deltaMode: "percentPoint",
    measureKey: "pct",
  },
  "cl-metric-csat": {
    currentQueryKey: "cl_csat_avg",
    priorQueryKey: "cl_csat_avg_prior",
    deltaLabel: "vs prior period",
    deltaMode: "rating",
    measureKey: "avg",
  },
  "cl-metric-first-assignment-rate": {
    currentQueryKey: "cl_first_assignment_rate_count",
    priorQueryKey: "cl_first_assignment_rate_prior",
    currentCreatedCountKey: "cl_first_assignment_assigned_count",
    currentResolvedCountKey: "cl_first_assignment_first_only_count",
    priorCreatedCountKey: "cl_first_assignment_assigned_prior",
    priorResolvedCountKey: "cl_first_assignment_first_only_prior",
    deltaLabel: "vs prior period",
    deltaMode: "percentPoint",
    measureKey: "pct",
  },
  "cl-metric-sla-compliance-rate": {
    currentQueryKey: "cl_sla_compliance_rate_count",
    priorQueryKey: "cl_sla_compliance_rate_prior",
    currentCreatedCountKey: "cl_new_created_count",
    currentResolvedCountKey: "cl_sla_compliant_resolved_count",
    priorCreatedCountKey: "cl_new_created_prior",
    priorResolvedCountKey: "cl_sla_compliant_resolved_prior",
    deltaLabel: "vs prior period",
    deltaMode: "percentPoint",
    measureKey: "pct",
  },
  "cl-metric-sla-non-compliance-rate": {
    currentQueryKey: "cl_sla_compliance_rate_count",
    priorQueryKey: "cl_sla_compliance_rate_prior",
    currentCreatedCountKey: "cl_new_created_count",
    currentResolvedCountKey: "cl_sla_compliant_resolved_count",
    priorCreatedCountKey: "cl_new_created_prior",
    priorResolvedCountKey: "cl_sla_compliant_resolved_prior",
    deltaLabel: "vs prior period",
    deltaMode: "percentPoint",
    measureKey: "pct",
    derived: "slaComplianceComplement",
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
  return VIZ_TYPE.NUMBER_TILE_DELTA;
}
