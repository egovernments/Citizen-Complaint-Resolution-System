/**
 * Metrics and widgets that may appear in the add-metric inventory.
 * Default-view items return here when removed from the dashboard.
 */

/** Top-row KPI cards shipped in the default layout — always recyclable via inventory. */
export const DEFAULT_VIEW_KPI_IDS = new Set([
  "cl-metric-total-registered",
  "cl-metric-total-open",
  "cl-metric-total-resolved",
  "cl-metric-channel-mix",
  "cl-metric-new-vs-repeat",
  "cl-metric-inflow-rate",
]);

/**
 * Charts, tables, and demo visualizations on the default layout — recyclable when removed.
 * Keep in sync with non-KPI entries in DEFAULT_LAYOUT (layoutConfig.js).
 */
export const DEFAULT_VIEW_WIDGET_IDS = new Set([
  "cl-list-categories",
  "cl-table-resolution",
  "cl-table-locality",
  "cl-table-workflow-stages",
  "cl-chart-categories",
  "cl-chart-wards",
  "cl-chart-dow",
  "demo-viz-stacked",
  "demo-viz-stacked-horizontal",
  "demo-viz-pie",
  "demo-viz-histogram",
  "demo-viz-gauge",
  "cl-chart-resolution-subtype",
  "demo-viz-leaderboard",
  "demo-viz-sla-toggle",
  "demo-viz-map",
  "demo-viz-line",
  "demo-viz-sla-risk",
]);

/** Additional KPI cards users can add from inventory */
export const INVENTORY_METRIC_IDS = new Set([
  "rs-metric-sla-compliance", // On-time resolution rate
  "rs-metric-breach-count", // Breached SLA (open)
  "cl-metric-total-resolved", // Resolved (also default)
  "ce-metric-reopen-rate", // Reopen rate
  "ce-metric-csat", // Citizen satisfaction
]);

/** Charts and tables addable from inventory (not on default layout) */
export const INVENTORY_WIDGET_IDS = new Set([
  "cl-chart-resolution-subtype", // Resolution time by sub-type (stacked bar)
  "cl-chart-status-week", // Status mix per week
  "cl-table-resolution", // Resolution rate by subtype (table)
  "demo-viz-leaderboard", // Flow ratio by department
  "demo-viz-line", // Complaints logged over time
  "demo-viz-sla-risk", // Complaints at risk
]);

export function isInventoryMetric(metricId) {
  return (
    DEFAULT_VIEW_KPI_IDS.has(metricId) || INVENTORY_METRIC_IDS.has(metricId)
  );
}

export function isInventoryWidget(widgetId) {
  return (
    DEFAULT_VIEW_WIDGET_IDS.has(widgetId) || INVENTORY_WIDGET_IDS.has(widgetId)
  );
}

export function filterInventoryMetricIds(ids = []) {
  return ids.filter((id) => isInventoryMetric(id));
}

export function filterInventoryWidgetIds(ids = []) {
  return ids.filter((id) => isInventoryWidget(id));
}
