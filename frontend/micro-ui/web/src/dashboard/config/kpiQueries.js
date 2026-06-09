import {
  LANDSCAPE_CHARTS,
  LANDSCAPE_METRICS,
  getSubMetricDef,
  subMetricValueKey,
} from "./complaintLandscape";

export const KPI_METRICS = LANDSCAPE_METRICS;
export const CHART_WIDGETS = LANDSCAPE_CHARTS;

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
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const UNSUPPORTED_VALUE = "—";
export const LOADING_VALUE = "…";

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

export function formatSubMetricValue(subMetric, results) {
  if (!subMetric || subMetric.format === "na" || subMetric.format === "text") {
    return UNSUPPORTED_VALUE;
  }

  if (subMetric.format === "percentDelta" || subMetric.format === "multiplier") {
    return formatPercentDelta();
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

  if (!subMetric.queryKey) return UNSUPPORTED_VALUE;

  const queryResult = results?.[subMetric.queryKey];
  if (!queryResult?.rows?.length) return UNSUPPORTED_VALUE;

  const raw = queryResult.rows[0][subMetric.measureKey];
  if (raw == null) return UNSUPPORTED_VALUE;

  switch (subMetric.format) {
    case "integer":
      return String(Math.round(Number(raw)));
    case "percentInteger": {
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
    default:
      return String(raw);
  }
}

export function buildAllSubMetricValues(results, loading) {
  const values = {};
  for (const metric of LANDSCAPE_METRICS) {
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

export { getSubMetricDef, subMetricValueKey };

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
