import {
  KPI_METRICS,
  CHART_WIDGETS,
  getSubMetricDef,
  subMetricValueKey,
} from "./supervisorMetrics";

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
  cl_open_daily: {
    grain: "facts",
    filters: { is_open: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_open_weekly: openWindow("wtd"),
  cl_open_monthly: openWindow("mtd"),
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
  // Employee performance
  ep_open_by_officer: officerTopCount({ is_open: true }),
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

export function parseBarChart(result, labelKey) {
  if (!result?.rows?.length) return [];
  return result.rows.map((row) => ({
    label: String(row[labelKey] ?? "Unknown"),
    count: Number(row.total) || 0,
  }));
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
  return result.rows.slice(0, limit).map((row, index) => ({
    rank: index + 1,
    label: String(row[labelKey] ?? "Unknown"),
    value: Number(row.total) || 0,
  }));
}
