/**
 * Resolution & SLA landscape — one KPI card per metric; sub-metrics selectable in-card.
 * @see kpis for configurable dashboard - supervisor metrics.csv
 */

export const RESOLUTION_SLA_SECTION = "Resolution & SLA";

/** @type {Array<{id:string, metric:string, accent:string, defaultSubMetricId:string, subMetrics:object[]}>} */
export const RESOLUTION_SLA_METRICS = [
  {
    id: "rs-metric-sla-compliance",
    metric: "Zone SLA compliance %",
    accent: "teal",
    defaultSubMetricId: "compliance_week",
    subMetrics: [
      {
        id: "compliance_week",
        label: "Compliance % this week",
        outputFormat: "Map coloring",
        format: "percentNoDecimal",
        measureKey: "pct",
        queryKey: "rs_sla_compliance_week",
      },
      {
        id: "wow_delta",
        label: "Δ vs. prior week",
        outputFormat: "% point change with ↑/↓",
        format: "percentPointDelta",
        measureKey: "delta",
        queryKey: null,
      },
      {
        id: "by_category",
        label: "Compliance % by category",
        outputFormat: "% per category row",
        format: "na",
        measureKey: null,
        queryKey: null,
      },
    ],
  },
  {
    id: "rs-metric-breach-count",
    metric: "Active SLA breach count",
    accent: "red",
    defaultSubMetricId: "total",
    subMetrics: [
      {
        id: "total",
        label: "Total breach count",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: "rs_breach_total",
      },
      {
        id: "trend_7d",
        label: "7-day trend",
        outputFormat: "Sparkline (7 points)",
        format: "na",
        measureKey: null,
        queryKey: null,
      },
      {
        id: "by_category",
        label: "Breach count by category",
        outputFormat: "Whole number per category",
        format: "na",
        measureKey: null,
        queryKey: null,
      },
    ],
  },
  {
    id: "rs-metric-zone-ttr",
    metric: "Avg + median time-to-resolve",
    accent: "teal",
    defaultSubMetricId: "avg_ttr",
    subMetrics: [
      {
        id: "avg_ttr",
        label: "Avg. TTR (zone, this week)",
        outputFormat: "Decimal in hours/days",
        format: "hoursDays",
        measureKey: "avg_ms",
        queryKey: "rs_zone_ttr_avg",
      },
      {
        id: "median_ttr",
        label: "Median TTR (zone, this week)",
        outputFormat: "Decimal in hours/days",
        format: "hoursDays",
        measureKey: "median_ms",
        queryKey: "rs_zone_ttr_median",
      },
      {
        id: "median_delta",
        label: "Δ vs. 4-week rolling median",
        outputFormat: "% change with ↑/↓",
        format: "percentDelta",
        measureKey: "delta",
        queryKey: null,
      },
    ],
  },
  {
    id: "rs-metric-closure-rate",
    metric: "Closure rate",
    accent: "green",
    defaultSubMetricId: "closure_rate",
    subMetrics: [
      {
        id: "closure_rate",
        label: "Closure rate",
        outputFormat: "% (round to nearest integer)",
        format: "percentInteger",
        measureKey: "pct",
        queryKey: "rs_closure_rate",
      },
      {
        id: "open_rate",
        label: "Open rate (complement)",
        outputFormat: "% (round to nearest integer; both sum to 100)",
        format: "percentInteger",
        measureKey: "pct",
        queryKey: "rs_closure_rate",
        derived: "openRateComplement",
      },
    ],
  },
  {
    id: "rs-metric-resolution-by-category",
    metric: "Resolution rate by category",
    accent: "slate",
    defaultSubMetricId: "closure_per_category",
    subMetrics: [
      {
        id: "closure_per_category",
        label: "Closure rate per category",
        outputFormat: "% per category row (1 decimal)",
        format: "na",
        measureKey: null,
        queryKey: null,
      },
      {
        id: "avg_ttr_per_category",
        label: "Avg. TTR per category",
        outputFormat: "Decimal in hours/days per category",
        format: "na",
        measureKey: null,
        queryKey: null,
      },
    ],
  },
  {
    id: "rs-metric-inflow-outflow",
    metric: "Inflow vs. outflow (net backlog change)",
    accent: "amber",
    defaultSubMetricId: "daily_inflow",
    subMetrics: [
      {
        id: "daily_inflow",
        label: "Daily inflow (new complaints)",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: "rs_inflow_daily",
      },
      {
        id: "daily_outflow",
        label: "Daily outflow (closures)",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: "rs_outflow_daily",
      },
      {
        id: "net_daily",
        label: "Net backlog Δ (daily)",
        outputFormat: "Whole number with +/− sign",
        format: "signedInteger",
        measureKey: "net",
        derived: "netBacklogDaily",
      },
      {
        id: "net_14d",
        label: "14-day cumulative net Δ",
        outputFormat: "Whole number with +/− sign",
        format: "signedInteger",
        measureKey: "net",
        queryKey: null,
      },
    ],
  },
];
