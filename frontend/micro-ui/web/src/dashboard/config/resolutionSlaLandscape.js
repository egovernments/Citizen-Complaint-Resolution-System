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
    vizType: "number-tile-sparkline",
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
    vizType: "number-tile-sparkline",
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
];
