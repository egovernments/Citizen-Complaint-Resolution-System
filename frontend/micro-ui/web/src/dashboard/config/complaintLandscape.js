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

/** @type {Array<{id:string, metric:string, accent:string, defaultSubMetricId:string, subMetrics:object[]}>} */
export const LANDSCAPE_METRICS = [
  {
    id: "cl-metric-new-created",
    metric: "New complaints created",
    accent: "teal",
    vizType: "number-tile-sparkline",
    defaultSubMetricId: "count",
    subMetrics: [
      {
        id: "count",
        label: "Complaints filed in selected date range",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: "cl_new_created_count",
      },
    ],
  },
  {
    id: "cl-metric-created-today",
    metric: "Complaints created today",
    accent: "teal",
    vizType: "number-tile-sparkline",
    defaultSubMetricId: "count",
    subMetrics: [
      {
        id: "count",
        label: "New complaints filed today (EAT calendar day)",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: "cl_created_today_count",
      },
    ],
  },
  {
    id: "cl-metric-total-open",
    metric: "Open complaints",
    accent: "amber",
    vizType: "number-tile-sparkline",
    defaultSubMetricId: "count",
    subMetrics: [
      {
        id: "count",
        label: "Complaints not yet in a closing stage",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: "cl_open_complaints_live",
      },
    ],
  },
  {
    id: "cl-metric-total-resolved",
    metric: "Resolved complaints",
    accent: "green",
    vizType: "number-tile-sparkline",
    defaultSubMetricId: "count",
    subMetrics: [
      {
        id: "count",
        label: "Complaints marked resolved during the selected date range",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: "cl_resolved_date_range_count",
      },
    ],
  },
  {
    id: "cl-metric-resolution-rate",
    metric: "Resolution rate",
    accent: "green",
    vizType: "number-tile-sparkline",
    defaultSubMetricId: "rate",
    subMetrics: [
      {
        id: "rate",
        label: "Resolved ÷ complaints created in selected date range",
        outputFormat: "% (1 decimal)",
        format: "percentOneDecimal",
        measureKey: "pct",
        queryKey: "cl_resolution_rate_count",
      },
    ],
  },
  {
    id: "cl-metric-reopen-rate",
    metric: "Reopen rate",
    accent: "amber",
    vizType: "number-tile-delta",
    defaultSubMetricId: "rate",
    subMetrics: [
      {
        id: "rate",
        label: "Reopened ÷ resolved",
        outputFormat: "% (1 decimal)",
        format: "percentOneDecimal",
        measureKey: "pct",
        queryKey: "cl_reopen_rate_count",
      },
    ],
  },
  {
    id: "cl-metric-csat",
    metric: "CSAT",
    accent: "teal",
    vizType: "number-tile-delta",
    defaultSubMetricId: "avg",
    subMetrics: [
      {
        id: "avg",
        label: "Avg. rating on resolved complaints",
        outputFormat: "Decimal (1 place, out of 5)",
        format: "ratingOutOfFive",
        measureKey: "avg",
        queryKey: "cl_csat_avg",
      },
    ],
  },
  {
    id: "cl-metric-first-assignment-rate",
    metric: "First-assignment rate",
    accent: "green",
    vizType: "number-tile-delta",
    defaultSubMetricId: "rate",
    subMetrics: [
      {
        id: "rate",
        label: "Never reassigned ÷ assigned",
        outputFormat: "% (1 decimal)",
        format: "percentOneDecimal",
        measureKey: "pct",
        queryKey: "cl_first_assignment_rate_count",
      },
    ],
  },
  {
    id: "cl-metric-sla-compliance-rate",
    metric: "SLA compliance rate",
    accent: "teal",
    vizType: "number-tile-delta",
    defaultSubMetricId: "rate",
    subMetrics: [
      {
        id: "rate",
        label: "Resolved within SLA ÷ all filed",
        outputFormat: "% (1 decimal)",
        format: "percentOneDecimal",
        measureKey: "pct",
        queryKey: "cl_sla_compliance_rate_count",
      },
    ],
  },
  {
    id: "cl-metric-sla-non-compliance-rate",
    metric: "SLA non-compliance rate",
    accent: "red",
    vizType: "number-tile-delta",
    defaultSubMetricId: "rate",
    subMetrics: [
      {
        id: "rate",
        label: "Breached SLA ÷ all complaints",
        outputFormat: "% (1 decimal)",
        format: "percentOneDecimal",
        measureKey: "pct",
        queryKey: "cl_sla_compliance_rate_count",
        derived: "slaComplianceComplement",
      },
    ],
  },
  {
    id: "cl-metric-resolved-on-time-rate",
    metric: "Resolved on time rate",
    accent: "teal",
    vizType: "number-tile-sparkline",
    defaultSubMetricId: "rate",
    subMetrics: [
      {
        id: "rate",
        label: "Resolved within SLA ÷ resolved",
        outputFormat: "% (1 decimal)",
        format: "percentOneDecimal",
        measureKey: "pct",
        queryKey: "cl_resolved_on_time_rate_count",
      },
    ],
  },
  {
    id: "cl-metric-oldest-open",
    metric: "Oldest complaint",
    accent: "amber",
    vizType: "number-tile-delta",
    defaultSubMetricId: "age_days",
    subMetrics: [
      {
        id: "age_days",
        label: "Earliest open complaint",
        outputFormat: "Whole number (days)",
        format: "integer",
        measureKey: "max_age_ms",
        queryKey: "cl_oldest_open_age",
        derived: "openAgeMsToDays",
      },
    ],
  },
  {
    id: "cl-metric-avg-resolution-time",
    metric: "Average resolution time",
    accent: "green",
    vizType: "number-tile-delta",
    defaultSubMetricId: "avg",
    subMetrics: [
      {
        id: "avg",
        label: "Avg. time to resolve",
        outputFormat: "Duration (hrs or days)",
        format: "hoursDays",
        measureKey: "avg_ms",
        queryKey: "cl_avg_resolution_time",
      },
    ],
  },
];

INVENTORY_SECTIONS[0].metricIds = LANDSCAPE_METRICS.map((m) => m.id);

export const LANDSCAPE_CHARTS = [
  {
    id: "cl-chart-complaints-by-type",
    type: "stacked-bar",
    stackOrientation: "horizontal",
    metric: "Complaints by type",
    subMetric: "Complaint types, descending by complaints filed",
    outputFormat: "Count grouped by complaint type, biggest first",
    queryKey: "cl_chart_complaints_by_type",
  },
  {
    id: "cl-chart-departments",
    type: "bar-chart",
    metric: "Complaints by departments",
    subMetric: "Departments, descending by complaints filed",
    outputFormat: "Count grouped by department, biggest first",
    queryKey: "cl_chart_departments_by_type",
  },
  {
    id: "cl-chart-department-resolution-rate",
    type: "bar-chart",
    metric: "Department-wise resolution rate",
    subMetric: "Per department: resolved ÷ filed",
    outputFormat: "% (1 decimal)",
    queryKey: "cl_chart_department_resolution_rate",
    valueFormat: "percent",
  },
  {
    id: "cl-chart-department-flow-ratio",
    type: "horizontal-bar",
    metric: "Flow ratio by department",
    subMetric: "Resolved ÷ created",
    outputFormat:
      "Ratio (2 dp) with break-even at 1.0 — red below, green at or above",
    queryKey: "cl_chart_department_resolution_rate",
  },
  {
    id: "cl-map-geography-choropleth",
    type: "map",
    metric: "Complaint map",
    subMetric: "WoW change or SLA breach by locality",
    outputFormat: "Choropleth — toggle WoW change vs SLA breach",
    queryKey: "cl_map_ward_wow_current",
    customChrome: true,
  },
  {
    id: "cl-chart-over-time",
    type: "line-chart",
    metric: "Complaints over time",
    outputFormat: "Compound line chart with daily / weekly / monthly toggle",
    customChrome: true,
    subMetrics: [
      {
        id: "created",
        label: "Created",
        outputFormat: "Whole number",
        description: "Count by created date, per bucket",
      },
      {
        id: "resolved",
        label: "Resolved",
        outputFormat: "Whole number",
        description: "Count by resolve date, per bucket",
      },
      {
        id: "resolution_rate",
        label: "Resolution rate",
        outputFormat: "% (1 decimal)",
        description: "Per bucket: resolved ÷ created",
      },
      {
        id: "sla_compliance",
        label: "SLA compliance rate",
        outputFormat: "% (1 decimal)",
        description: "Per bucket: on-time-resolved ÷ total filed",
      },
    ],
  },
  {
    id: "cl-chart-open-by-type",
    type: "stacked-bar",
    stackOrientation: "vertical",
    metric: "Open complaints by complaint types",
    subMetric: "Subtypes with the most open complaints",
    outputFormat: "Workflow stage breakdown per subtype",
    queryKey: "cl_chart_open_by_type_stage",
  },
  {
    id: "cl-chart-open-by-channel",
    type: "pie-chart",
    metric: "Complaints by channel",
    subMetric: "Open complaints by web, mobile, IVR, and walk-in",
    outputFormat: "Whole number (+ %)",
    queryKey: "cl_chart_open_by_channel",
  },
  {
    id: "cl-chart-complaints-by-age",
    type: "histogram",
    metric: "Complaints by age",
    subMetric: "Open complaints by days since filed",
    outputFormat: "Count per bucket: 0–3d, 3–7d, 7–14d, 14d+",
    queryKey: "cl_chart_open_by_age",
  },
  {
    id: "cl-chart-resolution-subtype",
    type: "stacked-bar",
    stackOrientation: "vertical",
    metric: "Resolution time by sub-type",
    subMetric: "Top 5 complaint subtypes by average hours to resolve",
    outputFormat: "Stacked bar: stage dwell hours by sub-type",
    queryKey: "ev_chart_resolution_dwell_subtype",
  },
  {
    id: "cl-table-complaint-type-details",
    type: "data-table",
    metric: "Complaint type details",
    subMetric: "One row per subtype",
    outputFormat:
      "Avg resolution, SLA, reopen rate, oldest open, on-time rate, CSAT — rows over SLA flagged",
    queryKey: "cl_table_complaint_type_details",
  },
  {
    id: "cl-table-complaints-at-risk",
    type: "sla-risk-table",
    metric: "Complaints at risk",
    subMetric: "Open complaints nearing or past SLA",
    outputFormat:
      "ID, type, locality, owner, status, SLA tags — sorted by breach duration desc",
    queryKey: "cl_table_complaints_at_risk",
  },
];

INVENTORY_SECTIONS[1].widgetIds = LANDSCAPE_CHARTS.map((c) => c.id);

export function getSubMetricDef(metric, subMetricId) {
  return metric.subMetrics.find((s) => s.id === subMetricId) || metric.subMetrics[0];
}

export function subMetricValueKey(metricId, subMetricId) {
  return `${metricId}:${subMetricId}`;
}
