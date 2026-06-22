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
  {
    id: "ce-metric-repeat-complainants",
    metric: "Repeat-complainant flags",
    accent: "amber",
    defaultSubMetricId: "repeat_count",
    subMetrics: [
      {
        id: "repeat_count",
        label: "Count of repeat complainants",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: "ce_repeat_complainants",
      },
      {
        id: "top5_complainants",
        label: "Top 5 repeat complainants",
        outputFormat: "Ranked list (complainant ID + count)",
        format: "na",
        measureKey: null,
        queryKey: null,
      },
    ],
  },
  {
    id: "ce-metric-repeat-locations",
    metric: "Repeat-location flags",
    accent: "slate",
    defaultSubMetricId: "repeat_locations",
    subMetrics: [
      {
        id: "repeat_locations",
        label: "Count of repeat locations (>2 in 30d)",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: null,
      },
      {
        id: "top5_locations",
        label: "Top 5 repeat locations",
        outputFormat: "Ranked list (address + count)",
        format: "na",
        measureKey: null,
        queryKey: null,
      },
    ],
  },
  {
    id: "ce-metric-negative-feedback",
    metric: "Negative feedback rate",
    accent: "red",
    defaultSubMetricId: "negative_rate",
    subMetrics: [
      {
        id: "negative_rate",
        label: "Negative feedback rate",
        outputFormat: "% (1 decimal)",
        format: "percentOneDecimal",
        measureKey: "pct",
        queryKey: "ce_negative_rate",
      },
      {
        id: "negative_by_category",
        label: "Negative rate by category",
        outputFormat: "% (1 decimal) per category",
        format: "na",
        measureKey: null,
        queryKey: null,
      },
    ],
  },
  {
    id: "ce-metric-time-to-first-response",
    metric: "Time-to-first-response",
    accent: "teal",
    defaultSubMetricId: "avg_tfr",
    subMetrics: [
      {
        id: "avg_tfr",
        label: "Avg. time to first response (zone)",
        outputFormat: "Decimal in hours (1 place)",
        format: "hoursDecimal",
        measureKey: "avg_ms",
        queryKey: "ce_tfr_avg",
      },
      {
        id: "median_tfr",
        label: "Median time to first response",
        outputFormat: "Decimal in hours (1 place)",
        format: "hoursDecimal",
        measureKey: "median_ms",
        queryKey: "ce_tfr_median",
      },
      {
        id: "within_1hr",
        label: "% acknowledged within 1 hr",
        outputFormat: "% (round to nearest integer)",
        format: "percentInteger",
        measureKey: "pct",
        queryKey: null,
      },
    ],
  },
];
