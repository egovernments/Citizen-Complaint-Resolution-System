import {
  KPI_METRICS,
  CHART_WIDGETS,
  getSubMetricDef,
  subMetricValueKey,
} from "./supervisorMetrics";
import {
  buildKpiContextText,
  getKpiDisplayTitle,
  getSparklineDeltaClass,
  getStatusValueClass,
  isKpiListMetric,
  parseKpiListItems,
  resolveThresholdStatus,
  statusValueToCssColor,
} from "./kpiDisplay";
import {
  getSparklineKpiQueryConfig,
  getMetricVizType,
} from "./kpiSparkline";
import { VIZ_TYPE } from "./visualizationStyles";
import {
  SLA_STACKED_SERIES,
  STATUS_STACKED_SERIES,
} from "./stackedBarPresentation";

export { KPI_METRICS, CHART_WIDGETS, getSubMetricDef, subMetricValueKey };

const channelRatio = (sources) => ({
  name: "pct",
  agg: "ratio",
  numerator: { agg: "count", filter: { source: { in: sources } } },
  denominator: { agg: "count" },
});

const filedWindow = (name) => ({
  grain: "facts",
  window: { name, timeRole: "filed_at" },
  measures: [{ name: "total", agg: "count" }],
});

const resolvedWindow = (name) => ({
  grain: "facts",
  window: { name, timeRole: "resolved_at" },
  filters: { is_resolved: true },
  measures: [{ name: "total", agg: "count" }],
});

const openWindow = (name) => ({
  grain: "facts",
  window: { name, timeRole: "filed_at" },
  filters: { is_open: true },
  measures: [{ name: "total", agg: "count" }],
});

const officerTopCount = (filters, timeWindow) => ({
  grain: "facts",
  ...(timeWindow ? { window: timeWindow } : {}),
  filters,
  dimensions: ["current_assignee_uuid"],
  measures: [{ name: "total", agg: "count" }],
  sort: [{ by: "total", dir: "desc" }],
  limit: 1,
});

export const BATCH_QUERIES = {
  cl_reg_daily: filedWindow("last_1d"),
  cl_reg_weekly: filedWindow("wtd"),
  cl_reg_monthly: filedWindow("mtd"),
  cl_reg_sparkline_7d: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "filed_at" },
    dimensions: ["created_date"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 7,
  },
  cl_reg_prior_week: {
    grain: "facts",
    measures: [{ name: "total", agg: "count" }],
  },
  cl_open_daily: {
    grain: "facts",
    filters: { is_open: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_open_weekly: openWindow("wtd"),
  cl_open_monthly: openWindow("mtd"),
  cl_open_sparkline_7d: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "filed_at" },
    filters: { is_open: true },
    dimensions: ["created_date"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 7,
  },
  cl_open_prior_week: {
    grain: "facts",
    filters: { is_open: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_res_daily: resolvedWindow("last_1d"),
  cl_res_weekly: resolvedWindow("wtd"),
  cl_res_monthly: resolvedWindow("mtd"),
  cl_channel_app: { grain: "facts", measures: [channelRatio(["app", "mobile"])] },
  cl_channel_phone: { grain: "facts", measures: [channelRatio(["phone"])] },
  cl_channel_walkin: {
    grain: "facts",
    measures: [channelRatio(["walk_in", "walk-in", "walkin"])],
  },
  cl_channel_online: {
    grain: "facts",
    measures: [channelRatio(["web", "online", "citizen"])],
  },
  cl_new_complainants: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    measures: [
      {
        name: "total",
        agg: "count",
        filter: { is_first_time_complainant: true },
      },
    ],
  },
  cl_repeat_complainants: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    measures: [
      {
        name: "total",
        agg: "count",
        filter: { is_first_time_complainant: false },
      },
    ],
  },
  cl_repeat_pct: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: {
          agg: "count",
          filter: { is_first_time_complainant: false },
        },
        denominator: { agg: "count" },
      },
    ],
  },
  cl_chart_categories: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["service_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 5,
  },
  cl_chart_wards: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["ward_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 10,
  },
  cl_chart_dow: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["created_dow"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "created_dow", dir: "asc" }],
  },
  cl_chart_officer_sla: {
    grain: "facts",
    filters: { is_open: true },
    dimensions: ["current_assignee_uuid", "sla_status_bucket"],
    measures: [{ name: "total", agg: "count" }],
    limit: 120,
  },
  cl_chart_status_week: {
    grain: "facts",
    window: { name: "last_28d", timeRole: "filed_at" },
    dimensions: ["created_week_start", "application_status"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "created_week_start", dir: "asc" }],
    limit: 200,
  },
  cl_chart_categories_pw: {
    grain: "facts",
    dimensions: ["service_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 200,
  },
  cl_trending_wow: {
    grain: "facts",
    window: { name: "last_28d", timeRole: "filed_at" },
    dimensions: ["service_code", "created_week_start"],
    measures: [{ name: "total", agg: "count" }],
    limit: 500,
  },
  cl_ward_open: {
    grain: "facts",
    dimensions: ["ward_code"],
    filters: { is_open: true },
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 15,
  },
  cl_ward_ontime: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    dimensions: ["ward_code"],
    filters: { is_resolved: true },
    measures: [
      {
        name: "ontime_pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_breached: false } },
        denominator: { agg: "count" },
      },
    ],
    sort: [{ by: "ontime_pct", dir: "desc" }],
    limit: 15,
  },
  rs_table_resolution_by_category: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["service_code"],
    measures: [
      {
        name: "closure_pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_resolved: true } },
        denominator: { agg: "count" },
      },
      {
        name: "ontime_pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_resolved: true, sla_breached: false } },
        denominator: { agg: "count", filter: { is_resolved: true } },
      },
      {
        name: "avg_ttr_ms",
        agg: "avg",
        column: "resolution_ms",
        filter: { is_resolved: true },
      },
    ],
    sort: [{ by: "closure_pct", dir: "desc" }],
    limit: 15,
  },
  ev_table_stage_dwell: {
    grain: "events",
    dimensions: ["status"],
    filters: { is_current_state: false },
    measures: [
      { name: "avg_dwell", agg: "avg", column: "dwell_ms" },
      { name: "median_dwell", agg: "percentile", column: "dwell_ms", p: 50 },
      { name: "samples", agg: "count" },
    ],
    sort: [{ by: "avg_dwell", dir: "desc" }],
    limit: 8,
  },
  // Employee performance
  ep_open_by_officer: officerTopCount({ is_open: true }),
  ep_open_list: {
    grain: "facts",
    filters: { is_open: true },
    dimensions: ["current_assignee_uuid"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 5,
  },
  ep_ttr_avg: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [{ name: "avg_ms", agg: "avg", column: "resolution_ms" }],
  },
  ep_ttr_median: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [{ name: "median_ms", agg: "percentile", column: "resolution_ms", p: 50 }],
  },
  ep_closed_by_officer: officerTopCount(
    { is_resolved: true },
    { name: "wtd", timeRole: "resolved_at" }
  ),
  ep_closed_list: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    dimensions: ["current_assignee_uuid"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 5,
  },
  ep_leaderboard_closed: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    dimensions: ["current_assignee_uuid"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 5,
  },
  ep_reopen_7d: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  ep_reopen_30d: {
    grain: "facts",
    window: { name: "last_30d", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  // Resolution & SLA
  rs_sla_compliance_week: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_breached: false } },
        denominator: { agg: "count" },
      },
    ],
  },
  rs_breach_total: {
    grain: "facts",
    filters: { is_open: true, sla_breached: true },
    measures: [{ name: "total", agg: "count" }],
  },
  rs_zone_ttr_avg: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [{ name: "avg_ms", agg: "avg", column: "resolution_ms" }],
  },
  rs_zone_ttr_median: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [{ name: "median_ms", agg: "percentile", column: "resolution_ms", p: 50 }],
  },
  rs_closure_rate: {
    grain: "facts",
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_resolved: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  rs_inflow_daily: filedWindow("last_1d"),
  rs_outflow_daily: resolvedWindow("last_1d"),
  // Escalations & risk
  er_aging_safe: {
    grain: "facts",
    filters: { is_open: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_status_bucket: "within" } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_aging_approaching: {
    grain: "facts",
    filters: { is_open: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_status_bucket: "approaching" } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_aging_breached: {
    grain: "facts",
    filters: { is_open: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_breached: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_aging_critical: {
    grain: "facts",
    filters: { is_open: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { aging_bucket: ">7d" } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_overnight_escalations: {
    grain: "events",
    window: { name: "last_1d", timeRole: "event_at" },
    filters: { is_escalation: true },
    measures: [{ name: "total", agg: "count" }],
  },
  er_overnight_auto_pct: {
    grain: "events",
    window: { name: "last_1d", timeRole: "event_at" },
    filters: { is_escalation: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { escalation_source: "auto" } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_overnight_manual_pct: {
    grain: "events",
    window: { name: "last_1d", timeRole: "event_at" },
    filters: { is_escalation: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { escalation_source: "manual" } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_critical_breach: {
    grain: "facts",
    filters: { is_open: true, aging_bucket: ">7d" },
    measures: [{ name: "total", agg: "count" }],
  },
  er_critical_by_officer: officerTopCount({ is_open: true, aging_bucket: ">7d" }),
  er_escalation_auto_pct: {
    grain: "events",
    window: { name: "wtd", timeRole: "event_at" },
    filters: { is_escalation: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { escalation_source: "auto" } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_escalation_manual_pct: {
    grain: "events",
    window: { name: "wtd", timeRole: "event_at" },
    filters: { is_escalation: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { escalation_source: "manual" } },
        denominator: { agg: "count" },
      },
    ],
  },
  // Citizen experience
  ce_csat_avg_week: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true, has_rating: true },
    measures: [{ name: "avg", agg: "avg", column: "rating" }],
  },
  ce_response_rate: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { has_rating: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  ce_reopen_7d: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  ce_reopen_30d: {
    grain: "facts",
    window: { name: "last_30d", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  ce_repeat_complainants: {
    grain: "facts",
    window: { name: "last_30d", timeRole: "filed_at" },
    filters: { is_first_time_complainant: false },
    measures: [{ name: "total", agg: "count_distinct", column: "account_id" }],
  },
  ce_top_complainants: {
    grain: "facts",
    window: { name: "last_30d", timeRole: "filed_at" },
    dimensions: ["account_id"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 5,
  },
  ce_negative_rate: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true, has_rating: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_negative_rating: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  ce_tfr_avg: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    measures: [{ name: "avg_ms", agg: "avg", column: "time_to_assign_ms" }],
  },
  ce_tfr_median: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    measures: [{ name: "median_ms", agg: "percentile", column: "time_to_assign_ms", p: 50 }],
  },
};

/** Unfiltered ward/service lists for global filter dropdowns (no self-dimension filter). */
export const FILTER_DIMENSION_QUERIES = {
  cl_filter_wards: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["ward_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "ward_code", dir: "asc" }],
    limit: 200,
  },
  cl_filter_categories: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["service_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "service_code", dir: "asc" }],
    limit: 200,
  },
};

function isoDateToStartMs(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function isoDateToEndExclusiveMs(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d + 1);
}

function mergeQueryFilters(existingFilters, globalFilters) {
  const merged = { ...(existingFilters || {}) };
  for (const [key, value] of Object.entries(globalFilters)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      merged[key] = { ...(merged[key] || {}), ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function dateFilterColumnForQuery(query) {
  // The events grain has no created_at/resolved_at; complaint_created_at filters events
  // by the same complaint population as the facts widgets.
  if (query.grain === "events") {
    return "complaint_created_at";
  }
  if (query.window?.timeRole === "resolved_at") {
    return "resolved_at";
  }
  return "created_at";
}

export function buildGlobalApiFilters(dashboardFilters) {
  const apiFilters = {};

  if (dashboardFilters?.geography && dashboardFilters.geography !== "all") {
    apiFilters.ward_code = dashboardFilters.geography;
  }
  if (dashboardFilters?.complaintType && dashboardFilters.complaintType !== "all") {
    apiFilters.service_code = dashboardFilters.complaintType;
  }

  if (
    dashboardFilters?.dateRangeActive &&
    dashboardFilters?.dateFrom &&
    dashboardFilters?.dateTo
  ) {
    apiFilters.__dateRange = {
      fromMs: isoDateToStartMs(dashboardFilters.dateFrom),
      toMs: isoDateToEndExclusiveMs(dashboardFilters.dateTo),
    };
  }

  return apiFilters;
}

function applyDashboardFiltersToQuery(query, apiFilters) {
  if (!apiFilters || Object.keys(apiFilters).length === 0) {
    return query;
  }

  const { __dateRange, ...dimensionFilters } = apiFilters;
  const next = { ...query };
  const filtersToApply = { ...dimensionFilters };

  if (__dateRange) {
    const dateColumn = dateFilterColumnForQuery(query);
    filtersToApply[dateColumn] = { gte: __dateRange.fromMs, lt: __dateRange.toMs };
    delete next.window;
  }

  if (Object.keys(filtersToApply).length === 0) {
    return query;
  }

  next.filters = mergeQueryFilters(query.filters, filtersToApply);
  return next;
}

function priorWeekCreatedAtFilter() {
  const now = new Date();
  const day = now.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  const thisMonday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysFromMonday
  );
  thisMonday.setHours(0, 0, 0, 0);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  return { gte: lastMonday.getTime(), lt: thisMonday.getTime() };
}

function isAnalyticsResult(result) {
  return Boolean(result?.rows) && !result?.error;
}

function normalizeWeekKey(value) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value).slice(0, 10);
}

function buildPriorVolumeByKey(priorResult, wowFallbackResult, labelKey = "service_code") {
  if (isAnalyticsResult(priorResult) && priorResult.rows.length > 0) {
    return Object.fromEntries(
      priorResult.rows.map((row) => [
        String(row[labelKey]),
        Number(row.total) || 0,
      ])
    );
  }

  if (!isAnalyticsResult(wowFallbackResult)) return {};

  const byWeek = new Map();
  for (const row of wowFallbackResult.rows) {
    const week = normalizeWeekKey(row.created_week_start);
    const key = String(row[labelKey]);
    if (!week || !key) continue;
    if (!byWeek.has(week)) byWeek.set(week, {});
    const bucket = byWeek.get(week);
    bucket[key] = (bucket[key] ?? 0) + (Number(row.total) || 0);
  }

  const weeks = [...byWeek.keys()].sort();
  if (weeks.length < 2) return {};
  return byWeek.get(weeks[weeks.length - 2]) || {};
}

function normalizeStageDwellQuery(query, apiFilters) {
  const baseFilters = mergeQueryFilters(query.filters, { is_current_state: false });
  const { __dateRange, ...dimensionFilters } = apiFilters || {};

  if (__dateRange) {
    const withoutComplaintCreated = { ...baseFilters };
    delete withoutComplaintCreated.complaint_created_at;
    const { window, filters, ...rest } = query;
    return {
      ...rest,
      filters: mergeQueryFilters(withoutComplaintCreated, {
        ...dimensionFilters,
        entered_at: { gte: __dateRange.fromMs, lt: __dateRange.toMs },
      }),
    };
  }

  const { window, filters, ...rest } = query;
  return {
    ...rest,
    filters: baseFilters,
  };
}

export function buildBatchQueries(dashboardFilters) {
  const apiFilters = buildGlobalApiFilters(dashboardFilters);
  const dimensionOnlyFilters = apiFilters.__dateRange
    ? { __dateRange: apiFilters.__dateRange }
    : {};
  const queries = {};

  for (const [key, query] of Object.entries(FILTER_DIMENSION_QUERIES)) {
    queries[key] = applyDashboardFiltersToQuery(query, dimensionOnlyFilters);
  }
  for (const [key, query] of Object.entries(BATCH_QUERIES)) {
    queries[key] = applyDashboardFiltersToQuery(query, apiFilters);
  }

  if (queries.cl_chart_categories_pw) {
    queries.cl_chart_categories_pw = {
      ...queries.cl_chart_categories_pw,
      filters: mergeQueryFilters(queries.cl_chart_categories_pw.filters, {
        created_at: priorWeekCreatedAtFilter(),
      }),
    };
  }

  if (!apiFilters.__dateRange) {
    const priorWeekFilter = { created_at: priorWeekCreatedAtFilter() };
    for (const key of ["cl_reg_prior_week", "cl_open_prior_week"]) {
      if (queries[key]) {
        queries[key] = {
          ...queries[key],
          filters: mergeQueryFilters(apiFilters, priorWeekFilter),
        };
      }
    }
  }

  if (queries.ev_table_stage_dwell) {
    queries.ev_table_stage_dwell = normalizeStageDwellQuery(
      queries.ev_table_stage_dwell,
      apiFilters
    );
  }

  return queries;
}

export function formatDimensionLabel(code) {
  const humanized = String(code).replace(/([a-z])([A-Z])/g, "$1 $2");
  const wardMatch = humanized.match(/ward[_\s-]?(\d+)/i);
  if (wardMatch) return `Ward ${wardMatch[1]}`;

  const dot = humanized.lastIndexOf(".");
  if (dot >= 0) {
    return humanized
      .slice(dot + 1)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const parts = humanized.split("_").filter(Boolean);
  if (parts.length > 2) {
    return parts
      .slice(-2)
      .join(" ")
      .replace(/_/g, " ");
  }

  return humanized.replace(/_/g, " ");
}

function parseDimensionOptions(result, key) {
  if (!result?.rows?.length) return [];
  return result.rows
    .filter((row) => row[key] != null && row[key] !== "")
    .map((row) => ({
      id: String(row[key]),
      label: formatDimensionLabel(String(row[key])),
    }));
}

export function parseFilterOptions(results) {
  return {
    geography: [
      { id: "all", label: "All wards" },
      ...parseDimensionOptions(results?.cl_filter_wards, "ward_code"),
    ],
    complaintType: [
      { id: "all", label: "All types" },
      ...parseDimensionOptions(results?.cl_filter_categories, "service_code"),
    ],
  };
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const UNSUPPORTED_VALUE = "—";
export const LOADING_VALUE = "…";

const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;

function daysElapsedThisWeek() {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

function hoursElapsedToday() {
  return Math.max(new Date().getHours(), 1);
}

function formatPercentDelta() {
  return UNSUPPORTED_VALUE;
}

function formatOpenRateComplement(results) {
  const raw = results?.rs_closure_rate?.rows?.[0]?.pct;
  if (raw == null) return UNSUPPORTED_VALUE;
  const pct = Number(raw) <= 1 ? Number(raw) * 100 : Number(raw);
  if (!Number.isFinite(pct)) return UNSUPPORTED_VALUE;
  return `${Math.round(100 - pct)}%`;
}

function formatNetBacklogDaily(results) {
  const inflow = results?.rs_inflow_daily?.rows?.[0]?.total;
  const outflow = results?.rs_outflow_daily?.rows?.[0]?.total;
  if (inflow == null || outflow == null) return UNSUPPORTED_VALUE;
  const net = Math.round(Number(inflow) - Number(outflow));
  if (!Number.isFinite(net)) return UNSUPPORTED_VALUE;
  return net > 0 ? `+${net}` : String(net);
}

function formatSignedInteger(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return UNSUPPORTED_VALUE;
  return n > 0 ? `+${n}` : String(n);
}

function formatMsAsDays(ms) {
  const days = Number(ms) / MS_PER_DAY;
  return Number.isFinite(days) ? days.toFixed(1) : UNSUPPORTED_VALUE;
}

function formatMsAsHours(ms) {
  const hours = Number(ms) / MS_PER_HOUR;
  return Number.isFinite(hours) ? hours.toFixed(1) : UNSUPPORTED_VALUE;
}

function formatLeaderboardRank(subMetric, results) {
  if (!subMetric.queryKey) return UNSUPPORTED_VALUE;
  const rows = results?.[subMetric.queryKey]?.rows;
  if (!rows?.length) return UNSUPPORTED_VALUE;
  return "1";
}

export function formatSubMetricValue(subMetric, results) {
  if (!subMetric || subMetric.format === "na" || subMetric.format === "text") {
    return UNSUPPORTED_VALUE;
  }

  if (subMetric.format === "percentDelta" || subMetric.format === "percentPointDelta" || subMetric.format === "multiplier") {
    return formatPercentDelta();
  }

  if (subMetric.format === "ordinal") {
    return formatLeaderboardRank(subMetric, results);
  }

  if (subMetric.derived === "dailyAvgFromWeekly") {
    const raw = results?.cl_reg_weekly?.rows?.[0]?.total;
    if (raw == null) return UNSUPPORTED_VALUE;
    const avg = Number(raw) / daysElapsedThisWeek();
    return Number.isFinite(avg) ? avg.toFixed(1) : UNSUPPORTED_VALUE;
  }

  if (subMetric.derived === "hourlyAvgFromDaily") {
    const raw = results?.cl_reg_daily?.rows?.[0]?.total;
    if (raw == null) return UNSUPPORTED_VALUE;
    const avg = Number(raw) / hoursElapsedToday();
    return Number.isFinite(avg) ? avg.toFixed(1) : UNSUPPORTED_VALUE;
  }

  if (subMetric.derived === "openRateComplement") {
    return formatOpenRateComplement(results);
  }

  if (subMetric.derived === "netBacklogDaily") {
    return formatNetBacklogDaily(results);
  }

  if (!subMetric.queryKey) return UNSUPPORTED_VALUE;

  const queryResult = results?.[subMetric.queryKey];
  if (!queryResult?.rows?.length) return UNSUPPORTED_VALUE;

  const raw = queryResult.rows[0][subMetric.measureKey];
  if (raw == null) return UNSUPPORTED_VALUE;

  switch (subMetric.format) {
    case "integer":
      return String(Math.round(Number(raw)));
    case "percentInteger":
    case "percentNoDecimal": {
      const pct = Number(raw) <= 1 ? Number(raw) * 100 : Number(raw);
      return Number.isFinite(pct) ? `${Math.round(pct)}%` : UNSUPPORTED_VALUE;
    }
    case "percentOneDecimal": {
      const pct = Number(raw) <= 1 ? Number(raw) * 100 : Number(raw);
      return Number.isFinite(pct) ? `${pct.toFixed(1)}%` : UNSUPPORTED_VALUE;
    }
    case "decimalOne": {
      const n = Number(raw);
      return Number.isFinite(n) ? n.toFixed(1) : UNSUPPORTED_VALUE;
    }
    case "decimalTwo": {
      const n = Number(raw);
      return Number.isFinite(n) ? n.toFixed(2) : UNSUPPORTED_VALUE;
    }
    case "hoursDays":
      return formatMsAsDays(raw);
    case "hoursDecimal":
      return formatMsAsHours(raw);
    case "signedInteger":
      return formatSignedInteger(raw);
    default:
      return String(raw);
  }
}

export function buildAllSubMetricValues(results, loading) {
  const values = {};
  for (const metric of KPI_METRICS) {
    for (const sub of metric.subMetrics) {
      const key = subMetricValueKey(metric.id, sub.id);
      if (loading) {
        values[key] = LOADING_VALUE;
      } else {
        values[key] = formatSubMetricValue(sub, results);
      }
    }
  }
  return values;
}

export function getDisplayValue(metric, subMetricId, allValues, loading) {
  const sub = getSubMetricDef(metric, subMetricId);
  const key = subMetricValueKey(metric.id, sub.id);
  if (loading) return LOADING_VALUE;
  return allValues[key] ?? UNSUPPORTED_VALUE;
}

function readMetricCount(results, queryKey, measureKey = "total") {
  const raw = results?.[queryKey]?.rows?.[0]?.[measureKey];
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseSparkline7d(result) {
  const rows = result?.rows;
  if (!rows?.length) return [];

  return [...rows]
    .sort((a, b) => String(a.created_date ?? "").localeCompare(String(b.created_date ?? "")))
    .map((row) => Math.round(Number(row.total) || 0));
}

function formatSparklineDeltaDisplay(deltaPercent) {
  if (deltaPercent == null || !Number.isFinite(deltaPercent)) return null;
  const arrow = deltaPercent >= 0 ? "▲" : "▼";
  const abs = Math.abs(deltaPercent);
  const rounded = Math.round(abs * 10) / 10;
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${arrow} ${formatted}%`;
}

function buildSparklineKpiExtras(metricId, results, loading) {
  const config = getSparklineKpiQueryConfig(metricId);
  const empty = {
    delta: null,
    deltaLabel: config?.deltaLabel || "WoW",
    deltaDisplay: null,
    sparkline: [],
  };

  if (!config || loading) return empty;

  let current;
  let prior;

  if (config.derived === "dailyAvgWow") {
    const curTotal = readMetricCount(results, config.currentQueryKey);
    const priorTotal = readMetricCount(results, config.priorQueryKey);
    current = curTotal == null ? null : curTotal / daysElapsedThisWeek();
    prior = priorTotal == null ? null : priorTotal / 7;
  } else {
    current = readMetricCount(results, config.currentQueryKey);
    prior = readMetricCount(results, config.priorQueryKey);
  }

  const delta = computeWowPercent(current, prior);

  return {
    delta,
    deltaLabel: config.deltaLabel,
    deltaDisplay: formatSparklineDeltaDisplay(delta),
    sparkline: parseSparkline7d(results?.[config.sparklineQueryKey]),
  };
}

export function buildKpiCardData(metric, subMetricId, results, subMetricValues, loading) {
  const sub = getSubMetricDef(metric, subMetricId);
  const value = loading
    ? LOADING_VALUE
    : subMetricValues[subMetricValueKey(metric.id, sub.id)] ?? UNSUPPORTED_VALUE;

  const hasList = isKpiListMetric(metric.id);
  const listItems = hasList && !loading ? parseKpiListItems(results, metric.id, 5) : [];
  const vizType = getMetricVizType(metric);
  const isSparkline = vizType === VIZ_TYPE.NUMBER_TILE_SPARKLINE;

  const base = {
    title: getKpiDisplayTitle(metric),
    value,
    context: isSparkline ? null : buildKpiContextText(metric.id, results, sub.label),
    status: resolveThresholdStatus(metric.id, value),
    listItems,
    hasList,
    vizType,
  };

  if (!isSparkline) return base;

  const sparklineExtras = buildSparklineKpiExtras(metric.id, results, loading);
  return {
    ...base,
    ...sparklineExtras,
    deltaClass: getSparklineDeltaClass(sparklineExtras.delta, metric.id),
    seriesColor: statusValueToCssColor(
      getStatusValueClass(resolveThresholdStatus(metric.id, value))
    ),
  };
}

export function buildAllKpiCardData(results, subMetricValues, resolveSubMetricId, loading) {
  const data = {};
  for (const metric of KPI_METRICS) {
    const subMetricId = resolveSubMetricId(metric);
    data[metric.id] = buildKpiCardData(
      metric,
      subMetricId,
      results,
      subMetricValues,
      loading
    );
  }
  return data;
}

function sortRowsByTotalDesc(rows, labelKey) {
  return [...rows].sort((a, b) => {
    const countDiff = (Number(b.total) || 0) - (Number(a.total) || 0);
    if (countDiff !== 0) return countDiff;
    return String(a[labelKey] ?? "").localeCompare(String(b[labelKey] ?? ""));
  });
}

export function parseBarChart(result, labelKey) {
  if (!result?.rows?.length) return [];
  return sortRowsByTotalDesc(result.rows, labelKey).map((row) => ({
    label: String(row[labelKey] ?? "Unknown"),
    count: Number(row.total) || 0,
  }));
}

function formatOfficerStackedLabel(uuid) {
  const id = String(uuid ?? "Unknown");
  if (!id || id === "null" || id === "undefined") return "Unassigned";
  if (id.length <= 8) return id;
  return `Officer …${id.slice(-6)}`;
}

function formatWeekStackedLabel(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value ?? "Unknown");
  return `Wk ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function parsePivotStackedChart(
  result,
  { categoryKey, segmentKey, segmentDefs, categoryLabel, maxCategories = 6, segmentFilter }
) {
  if (!result?.rows?.length) {
    return { categories: [], series: [], colors: segmentDefs.map((def) => def.color) };
  }

  const categoryMap = new Map();

  for (const row of result.rows) {
    const segment = String(row[segmentKey] ?? "");
    if (segmentFilter && !segmentFilter(segment)) continue;

    const category = String(row[categoryKey] ?? "Unknown");
    if (!categoryMap.has(category)) categoryMap.set(category, {});
    const bucket = categoryMap.get(category);
    bucket[segment] = (bucket[segment] ?? 0) + (Number(row.total) || 0);
  }

  const ranked = [...categoryMap.entries()]
    .map(([key, segments]) => ({
      key,
      total: Object.values(segments).reduce((sum, value) => sum + value, 0),
      segments,
    }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, maxCategories);

  return {
    categories: ranked.map((entry) => categoryLabel(entry.key)),
    series: segmentDefs.map((def) => ({
      name: def.label,
      data: ranked.map((entry) => entry.segments[def.key] ?? 0),
    })),
    colors: segmentDefs.map((def) => def.color),
  };
}

export function parseOfficerSlaStackedChart(result, { maxCategories = 6 } = {}) {
  return parsePivotStackedChart(result, {
    categoryKey: "current_assignee_uuid",
    segmentKey: "sla_status_bucket",
    segmentDefs: SLA_STACKED_SERIES,
    categoryLabel: formatOfficerStackedLabel,
    maxCategories,
    segmentFilter: (segment) =>
      Boolean(segment) && segment !== "null" && segment !== "undefined",
  });
}

export function parseStatusWeekStackedChart(result, { maxWeeks = 4 } = {}) {
  if (!result?.rows?.length) {
    return { categories: [], series: [], colors: STATUS_STACKED_SERIES.map((def) => def.color) };
  }

  const weekMap = new Map();
  for (const row of result.rows) {
    const week = String(row.created_week_start ?? "");
    const status = String(row.application_status ?? "Unknown").toUpperCase();
    if (!week) continue;
    if (!weekMap.has(week)) weekMap.set(week, {});
    const bucket = weekMap.get(week);
    bucket[status] = (bucket[status] ?? 0) + (Number(row.total) || 0);
  }

  const weeks = [...weekMap.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .slice(-maxWeeks);

  return {
    categories: weeks.map(([week]) => formatWeekStackedLabel(week)),
    series: STATUS_STACKED_SERIES.map((def) => ({
      name: def.label,
      data: weeks.map(([, segments]) => segments[def.key] ?? 0),
    })),
    colors: STATUS_STACKED_SERIES.map((def) => def.color),
  };
}

export function parseDowChart(result) {
  if (!result?.rows?.length) return [];
  return result.rows.map((row) => {
    const dow = Number(row.created_dow);
    return {
      label: DOW_LABELS[dow] ?? String(row.created_dow),
      count: Number(row.total) || 0,
    };
  });
}

export function parseRankedList(result, labelKey, limit = 5) {
  if (!result?.rows?.length) return [];
  return sortRowsByTotalDesc(result.rows, labelKey)
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      label: String(row[labelKey] ?? "Unknown"),
      value: Number(row.total) || 0,
    }));
}

function formatStatusLabel(status) {
  return String(status)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function computeWowPercent(current, prior) {
  if (prior == null || !Number.isFinite(prior)) return null;
  if (prior === 0) return current > 0 ? 100 : 0;
  return ((current - prior) / prior) * 100;
}

export function parseTrendingComplaintsTable(
  currentResult,
  priorResult,
  labelKey = "service_code",
  limit = 5,
  { enableWow = true, wowFallbackResult = null } = {}
) {
  if (!currentResult?.rows?.length) return [];

  const priorByKey = enableWow
    ? buildPriorVolumeByKey(priorResult, wowFallbackResult, labelKey)
    : null;

  return sortRowsByTotalDesc(currentResult.rows, labelKey)
    .slice(0, limit)
    .map((row, index) => {
      const key = String(row[labelKey] ?? "Unknown");
      const volume = Number(row.total) || 0;
      const label = formatDimensionLabel(key);
      const priorVolume = priorByKey?.[key] ?? 0;
      return {
        id: `trend-${index + 1}-${key}`,
        rank: index + 1,
        label,
        volume,
        wow: enableWow ? computeWowPercent(volume, priorVolume) : null,
      };
    });
}

export function parseResolutionByTypeTable(result, limit = 5) {
  if (!result?.rows?.length) return [];
  return result.rows.slice(0, limit).map((row, index) => {
    const key = String(row.service_code ?? "Unknown");
    return {
      id: `resolution-${index}-${key}`,
      label: formatDimensionLabel(key),
      closurePct: Number(row.closure_pct),
      ontimePct: Number(row.ontime_pct),
      avgTtrMs: Number(row.avg_ttr_ms),
    };
  });
}

export function parseLocalityTable(loggedResult, openResult, ontimeResult, limit = 5) {
  if (!loggedResult?.rows?.length) return [];

  const openByWard = Object.fromEntries(
    (openResult?.rows || []).map((row) => [
      String(row.ward_code),
      Number(row.total) || 0,
    ])
  );
  const ontimeByWard = Object.fromEntries(
    (ontimeResult?.rows || []).map((row) => [
      String(row.ward_code),
      Number(row.ontime_pct),
    ])
  );

  return sortRowsByTotalDesc(loggedResult.rows, "ward_code")
    .slice(0, limit)
    .map((row, index) => {
      const ward = String(row.ward_code ?? "Unknown");
      return {
        id: `ward-${index}-${ward}`,
        label: formatDimensionLabel(ward),
        logged: Number(row.total) || 0,
        open: openByWard[ward] ?? 0,
        ontimePct: ontimeByWard[ward],
      };
    });
}

function formatWorkflowStageLabel(status) {
  const key = String(status ?? "").toUpperCase();
  const labels = {
    PENDINGFORASSIGNMENT: "Pending Assignment",
    PENDINGATLME: "Assigned",
    PENDINGFORREASSIGNMENT: "Pending Reassignment",
    RESOLVED: "Resolved (end-to-end)",
    REJECTED: "Rejected",
    CLOSEDAFTERRESOLUTION: "Closed after resolution",
    CLOSEDAFTERREJECTION: "Closed after rejection",
  };
  if (labels[key]) return labels[key];
  return formatStatusLabel(status);
}

export function parseWorkflowStageTable(result, limit = 5) {
  if (result?.error || !result?.rows?.length) return [];

  return result.rows.slice(0, limit).map((row, index) => {
    const label = formatWorkflowStageLabel(row.status);
    return {
      id: `stage-${index}-${label}`,
      label,
      avgDwellMs: Number(row.avg_dwell),
      medianDwellMs: Number(row.median_dwell),
      samples: Number(row.samples) || 0,
    };
  });
}

export function parseDowTable(result) {
  if (!result?.rows?.length) return [];
  return result.rows.map((row, index) => {
    const dow = Number(row.created_dow);
    const label = DOW_LABELS[dow] ?? String(row.created_dow);
    return {
      id: `dow-${index}-${dow}`,
      label,
      count: Number(row.total) || 0,
    };
  });
}
