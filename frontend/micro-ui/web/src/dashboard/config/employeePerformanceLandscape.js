/**
 * Employee performance landscape — one KPI card per metric; sub-metrics selectable in-card.
 * @see kpis for configurable dashboard - supervisor metrics.csv
 */

export const EMPLOYEE_PERFORMANCE_SECTION = "Employee performance";

/** @type {Array<{id:string, metric:string, accent:string, defaultSubMetricId:string, subMetrics:object[]}>} */
export const EMPLOYEE_PERFORMANCE_METRICS = [
  {
    id: "ep-metric-open-load",
    metric: "Open load per officer",
    accent: "amber",
    defaultSubMetricId: "open_count",
    subMetrics: [
      {
        id: "open_count",
        label: "Open count per officer",
        outputFormat: "Whole number per officer row",
        format: "integer",
        measureKey: "total",
        queryKey: "ep_open_by_officer",
      },
    ],
  },
  {
    id: "ep-metric-ttr",
    metric: "Avg + median Time-To-Resolution (TTR) per officer",
    accent: "teal",
    defaultSubMetricId: "avg_ttr",
    subMetrics: [
      {
        id: "avg_ttr",
        label: "Avg. TTR per officer",
        outputFormat: "Decimal in hours/days",
        format: "hoursDays",
        measureKey: "avg_ms",
        queryKey: "ep_ttr_avg",
      },
      {
        id: "median_ttr",
        label: "Median TTR per officer",
        outputFormat: "Decimal in hours/days",
        format: "hoursDays",
        measureKey: "median_ms",
        queryKey: "ep_ttr_median",
      },
    ],
  },
  {
    id: "ep-metric-closed-week",
    metric: "Complaints closed this week per officer",
    accent: "green",
    defaultSubMetricId: "closed_count",
    subMetrics: [
      {
        id: "closed_count",
        label: "Closed count per officer",
        outputFormat: "Whole number per officer row",
        format: "integer",
        measureKey: "total",
        queryKey: "ep_closed_by_officer",
      },
    ],
  },
  {
    id: "ep-metric-leaderboard",
    metric: "Officer leaderboard / ranking",
    accent: "slate",
    defaultSubMetricId: "rank_closed",
    subMetrics: [
      {
        id: "rank_closed",
        label: "Rank by complaints closed",
        outputFormat: "Ordinal rank (1, 2, 3…)",
        format: "ordinal",
        measureKey: "rank",
        queryKey: "ep_leaderboard_closed",
      },
      {
        id: "rank_sla",
        label: "Rank by SLA compliance %",
        outputFormat: "Ordinal rank",
        format: "ordinal",
        measureKey: "rank",
        queryKey: null,
      },
    ],
  },
  {
    id: "ep-metric-reopen-rate",
    metric: "Reopen rate per officer",
    accent: "red",
    defaultSubMetricId: "reopen_7d",
    subMetrics: [
      {
        id: "reopen_7d",
        label: "7-day reopen rate per officer",
        outputFormat: "% (no decimal)",
        format: "percentNoDecimal",
        measureKey: "pct",
        queryKey: "ep_reopen_7d",
      },
      {
        id: "reopen_30d",
        label: "30-day reopen rate per officer",
        outputFormat: "% (no decimal)",
        format: "percentNoDecimal",
        measureKey: "pct",
        queryKey: "ep_reopen_30d",
      },
    ],
  },
  {
    id: "ep-metric-pending-ack",
    metric: "Pending acknowledgements",
    accent: "amber",
    defaultSubMetricId: "zone_unacked",
    subMetrics: [
      {
        id: "zone_unacked",
        label: "Count of unacknowledged complaints (zone)",
        outputFormat: "Whole number",
        format: "integer",
        measureKey: "total",
        queryKey: null,
      },
      {
        id: "officer_unacked",
        label: "Unacknowledged count per officer",
        outputFormat: "Whole number per officer row",
        format: "integer",
        measureKey: "total",
        queryKey: null,
      },
      {
        id: "avg_time_unacked",
        label: "Avg. time since assignment (unacknowledged)",
        outputFormat: "Decimal in hours",
        format: "hoursDecimal",
        measureKey: "avg_ms",
        queryKey: null,
      },
    ],
  },
];
