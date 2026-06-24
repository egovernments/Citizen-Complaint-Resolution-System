/**
 * Citizen experience landscape — one KPI card per metric; sub-metrics selectable in-card.
 * @see kpis for configurable dashboard - supervisor metrics.csv
 */

export const CITIZEN_EXPERIENCE_SECTION = "Citizen experience";

/** @type {Array<{id:string, metric:string, accent:string, defaultSubMetricId:string, subMetrics:object[]}>} */
export const CITIZEN_EXPERIENCE_METRICS = [
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
