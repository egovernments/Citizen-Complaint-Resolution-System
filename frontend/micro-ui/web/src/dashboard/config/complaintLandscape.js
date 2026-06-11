/**
 * Complaint landscape — one KPI card per metric; sub-metrics selectable in-card.
 * @see kpis for configurable dashboard - supervisor metrics.csv
 */

export const COMPLAINT_LANDSCAPE_SECTION = "Complaint landscape";

export const VISUALIZATIONS_SECTION = "Charts & tables";

export const INVENTORY_SECTIONS = [
  {
    id: "complaint-landscape",
    label: COMPLAINT_LANDSCAPE_SECTION,
    description: "Volume, trends, and geographic patterns",
    metricIds: null,
    widgetIds: null,
  },
  {
    id: "visualizations",
    label: VISUALIZATIONS_SECTION,
    description: "Trending lists, breakdown tables, and bar charts",
    metricIds: null,
    widgetIds: null,
  },
];

export const TIME_WINDOW_OPTIONS = [
  {
    id: "daily",
    label: "Daily count",
    outputFormat: "Whole number",
    format: "integer",
    measureKey: "total",
  },
  {
    id: "weekly",
    label: "Weekly count",
    outputFormat: "Whole number",
    format: "integer",
    measureKey: "total",
  },
  {
    id: "monthly",
    label: "Monthly count",
    outputFormat: "Whole number",
    format: "integer",
    measureKey: "total",
  },
  {
    id: "wow",
    label: "WoW Δ (weekly)",
    outputFormat: "% with ↑/↓ (1 decimal)",
    format: "percentDelta",
    measureKey: "delta",
  },
  {
    id: "mom",
    label: "MoM Δ (monthly)",
    outputFormat: "% with ↑/↓ (1 decimal)",
    format: "percentDelta",
    measureKey: "delta",
  },
];

function countSubMetrics(prefix) {
  return TIME_WINDOW_OPTIONS.map((sub) => ({
    ...sub,
    queryKey:
      sub.format === "percentDelta"
        ? null
        : `${prefix}_${sub.id === "daily" ? "daily" : sub.id === "weekly" ? "weekly" : "monthly"}`,
  }));
}

/** @type {Array<{id:string, metric:string, accent:string, defaultSubMetricId:string, subMetrics:object[]}>} */
export const LANDSCAPE_METRICS = [
  {
    id: "cl-metric-total-registered",
    metric: "Total complaints registered",
    accent: "teal",
    filterGroup: "timeWindow",
    defaultSubMetricId: "weekly",
    subMetrics: countSubMetrics("cl_reg"),
  },
  {
    id: "cl-metric-total-open",
    metric: "Total complaints open",
    accent: "amber",
    filterGroup: "timeWindow",
    defaultSubMetricId: "weekly",
    subMetrics: countSubMetrics("cl_open"),
  },
  {
    id: "cl-metric-total-resolved",
    metric: "Total complaints resolved",
    accent: "green",
    filterGroup: "timeWindow",
    defaultSubMetricId: "weekly",
    subMetrics: countSubMetrics("cl_res"),
  },
  {
    id: "cl-metric-channel-mix",
    metric: "Channel mix",
    accent: "slate",
    defaultSubMetricId: "online",
    subMetrics: [
      {
        id: "app",
        label: "% via app",
        outputFormat: "% (round to nearest integer; all 4 sum to 100)",
        format: "percentInteger",
        measureKey: "pct",
        queryKey: "cl_channel_app",
      },
      {
        id: "phone",
        label: "% via phone",
        outputFormat: "% (round to nearest integer; all 4 sum to 100)",
        format: "percentInteger",
        measureKey: "pct",
        queryKey: "cl_channel_phone",
      },
      {
        id: "walkin",
        label: "% via walk-in",
        outputFormat: "% (round to nearest integer; all 4 sum to 100)",
        format: "percentInteger",
        measureKey: "pct",
        queryKey: "cl_channel_walkin",
      },
      {
        id: "online",
        label: "% via online portal",
        outputFormat: "% (round to nearest integer; all 4 sum to 100)",
        format: "percentInteger",
        measureKey: "pct",
        queryKey: "cl_channel_online",
      },
    ],
  },
  {
    id: "cl-metric-new-vs-repeat",
    metric: "New vs. repeat complainants",
    accent: "green",
    defaultSubMetricId: "new",
    subMetrics: [
      {
        id: "new",
        label: "Count of new complainants",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: "cl_new_complainants",
      },
      {
        id: "repeat",
        label: "Count of repeat complainants",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: "cl_repeat_complainants",
      },
      {
        id: "repeat_pct",
        label: "% repeat (of total)",
        outputFormat: "% (1 decimal)",
        format: "percentOneDecimal",
        measureKey: "pct",
        queryKey: "cl_repeat_pct",
      },
    ],
  },
  {
    id: "cl-metric-inflow-rate",
    metric: "Inflow rate",
    accent: "teal",
    defaultSubMetricId: "daily_avg",
    subMetrics: [
      {
        id: "daily_avg",
        label: "Complaints per day (current week avg.)",
        outputFormat: "Decimal (1 place)",
        format: "decimalOne",
        measureKey: "total",
        queryKey: "cl_reg_weekly",
        derived: "dailyAvgFromWeekly",
      },
      {
        id: "hourly",
        label: "Complaints per hour (today)",
        outputFormat: "Decimal (1 place)",
        format: "decimalOne",
        measureKey: "total",
        queryKey: "cl_reg_daily",
        derived: "hourlyAvgFromDaily",
      },
      {
        id: "wow_avg",
        label: "Δ vs. prior week daily avg.",
        outputFormat: "% with ↑/↓",
        format: "percentDelta",
        measureKey: "delta",
        queryKey: null,
      },
    ],
  },
  {
    id: "cl-metric-hot-ward",
    metric: "Hot ward / locality alerts",
    accent: "red",
    defaultSubMetricId: "spike_count",
    subMetrics: [
      {
        id: "spike_count",
        label: "Wards with spike this week",
        outputFormat: "Map coloring",
        format: "na",
        measureKey: null,
        queryKey: null,
      },
      {
        id: "magnitude",
        label: "Spike magnitude (top ward)",
        outputFormat: "× multiplier (e.g. 3.2×)",
        format: "multiplier",
        measureKey: null,
        queryKey: null,
      },
      {
        id: "top_ward",
        label: "Top spiking ward name",
        outputFormat: "Text label + count",
        format: "text",
        measureKey: null,
        queryKey: null,
      },
    ],
  },
];

INVENTORY_SECTIONS[0].metricIds = LANDSCAPE_METRICS.map((m) => m.id);

export const LANDSCAPE_CHARTS = [
  {
    id: "cl-chart-categories",
    type: "bar-chart",
    metric: "Top trending categories",
    subMetric: "Volume per category",
    outputFormat: "Whole number",
    queryKey: "cl_chart_categories",
  },
  {
    id: "cl-chart-wards",
    type: "bar-chart",
    metric: "Category breakdown by ward / locality",
    subMetric: "Complaint count per ward",
    outputFormat: "Colored map",
    queryKey: "cl_chart_wards",
  },
  {
    id: "cl-chart-dow",
    type: "bar-chart",
    metric: "Time-of-day and day-of-week patterns",
    subMetric: "Complaint count by day of week",
    outputFormat: "Bar chart: count per weekday",
    queryKey: "cl_chart_dow",
  },
  {
    id: "cl-list-categories",
    type: "data-table",
    metric: "Trending complaints (top 5)",
    subMetric: null,
    outputFormat: "Ranked table with WoW",
    queryKey: "cl_chart_categories",
  },
  {
    id: "cl-table-resolution",
    type: "data-table",
    metric: "Resolution rate by complaint type",
    subMetric: null,
    outputFormat: "% per category row",
    queryKey: "rs_table_resolution_by_category",
  },
  {
    id: "cl-table-locality",
    type: "data-table",
    metric: "By locality",
    subMetric: null,
    outputFormat: "Ward table",
    queryKey: "cl_chart_wards",
  },
  {
    id: "cl-table-workflow-stages",
    type: "data-table",
    metric: "Average time per workflow stage",
    subMetric: null,
    outputFormat: "Stage dwell table",
    queryKey: "ev_table_stage_dwell",
  },
];

INVENTORY_SECTIONS[1].widgetIds = LANDSCAPE_CHARTS.map((c) => c.id);

export function getSubMetricDef(metric, subMetricId) {
  return metric.subMetrics.find((s) => s.id === subMetricId) || metric.subMetrics[0];
}

export function subMetricValueKey(metricId, subMetricId) {
  return `${metricId}:${subMetricId}`;
}
