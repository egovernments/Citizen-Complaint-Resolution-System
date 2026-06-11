/**
 * Comparative & reporting landscape — one KPI card per metric; sub-metrics selectable in-card.
 * @see kpis for configurable dashboard - supervisor metrics.csv
 */

export const COMPARATIVE_REPORTING_SECTION = "Comparative & reporting";

/** @type {Array<{id:string, metric:string, accent:string, defaultSubMetricId:string, subMetrics:object[]}>} */
export const COMPARATIVE_REPORTING_METRICS = [
  {
    id: "cr-metric-yoy-trend",
    metric: "Year-on-year trend",
    accent: "slate",
    defaultSubMetricId: "yoy_sla",
    subMetrics: [
      {
        id: "yoy_sla",
        label: "YoY Δ on SLA compliance %",
        outputFormat: "% point change with ↑/↓",
        format: "percentPointDelta",
        measureKey: "delta",
        queryKey: null,
      },
      {
        id: "yoy_complaints",
        label: "YoY Δ on total complaints",
        outputFormat: "% change with ↑/↓",
        format: "percentDelta",
        measureKey: "delta",
        queryKey: null,
      },
    ],
  },
  {
    id: "cr-metric-vs-target",
    metric: "Performance vs. target / benchmark",
    accent: "teal",
    defaultSubMetricId: "sla_vs_target",
    subMetrics: [
      {
        id: "sla_vs_target",
        label: "SLA compliance % vs. target",
        outputFormat: "Actual %, Target %, Gap as % points",
        format: "text",
        measureKey: null,
        queryKey: null,
      },
      {
        id: "ttr_vs_target",
        label: "Avg. TTR vs. target",
        outputFormat: "Actual hours/days, Target hours/days, Gap",
        format: "text",
        measureKey: null,
        queryKey: null,
      },
    ],
  },
  {
    id: "cr-metric-weekly-digest",
    metric: "Weekly digest summary for Commissioner",
    accent: "amber",
    defaultSubMetricId: "complaints_week",
    subMetrics: [
      {
        id: "complaints_week",
        label: "Total complaints this week",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: "cl_reg_weekly",
      },
      {
        id: "sla_week",
        label: "SLA compliance % this week",
        outputFormat: "% (1 decimal)",
        format: "percentOneDecimal",
        measureKey: "pct",
        queryKey: "rs_sla_compliance_week",
      },
      {
        id: "zone_rank",
        label: "Zone rank this week",
        outputFormat: "\"N of M\" format",
        format: "text",
        measureKey: null,
        queryKey: null,
      },
      {
        id: "open_breach",
        label: "Open breach count (end of week)",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: "rs_breach_total",
      },
      {
        id: "top_categories",
        label: "Top 3 categories this week",
        outputFormat: "Ranked text list",
        format: "na",
        measureKey: null,
        queryKey: null,
      },
    ],
  },
];
