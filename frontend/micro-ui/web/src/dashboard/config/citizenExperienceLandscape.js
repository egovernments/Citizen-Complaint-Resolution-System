/**
 * Citizen experience landscape — one KPI card per metric; sub-metrics selectable in-card.
 * @see kpis for configurable dashboard - supervisor metrics.csv
 */

export const CITIZEN_EXPERIENCE_SECTION = "Citizen experience";

/** @type {Array<{id:string, metric:string, accent:string, defaultSubMetricId:string, subMetrics:object[]}>} */
export const CITIZEN_EXPERIENCE_METRICS = [
  {
    id: "ce-metric-csat",
    metric: "CSAT / post-resolution rating",
    accent: "teal",
    vizType: "number-tile-sparkline",
    defaultSubMetricId: "avg_rating_week",
    subMetrics: [
      {
        id: "avg_rating_week",
        label: "Avg. rating (zone, this week)",
        outputFormat: "Decimal (1 place, out of 5)",
        format: "decimalOne",
        measureKey: "avg",
        queryKey: "ce_csat_avg_week",
      },
      {
        id: "response_rate",
        label: "% rated (response rate)",
        outputFormat: "% (round to nearest integer)",
        format: "percentInteger",
        measureKey: "pct",
        queryKey: "ce_response_rate",
      },
      {
        id: "avg_by_category",
        label: "Avg. rating by category",
        outputFormat: "Decimal (1 place) per category",
        format: "na",
        measureKey: null,
        queryKey: null,
      },
    ],
  },
  {
    id: "ce-metric-reopen-rate",
    metric: "Reopen rate at zone level",
    accent: "amber",
    vizType: "number-tile-sparkline",
    defaultSubMetricId: "reopen_7d",
    subMetrics: [
      {
        id: "reopen_7d",
        label: "7-day reopen rate (zone)",
        outputFormat: "% (1 decimal)",
        format: "percentOneDecimal",
        measureKey: "pct",
        queryKey: "ce_reopen_7d",
      },
      {
        id: "reopen_30d",
        label: "30-day reopen rate (zone)",
        outputFormat: "% (1 decimal)",
        format: "percentOneDecimal",
        measureKey: "pct",
        queryKey: "ce_reopen_30d",
      },
    ],
  },
];
