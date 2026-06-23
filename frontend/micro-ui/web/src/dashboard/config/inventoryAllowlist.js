/**
 * Metrics and widgets that may appear in the add-metric inventory.
 * Default-view items return here when removed from the dashboard.
 */

/** Top-row KPI cards shipped in the default layout — always recyclable via inventory. */
export const DEFAULT_VIEW_KPI_IDS = new Set([
  "rs-metric-sla-compliance",
  "rs-metric-breach-count",
  "cl-metric-total-resolved",
  "ce-metric-reopen-rate",
  "ce-metric-csat",
]);

/**
 * Charts, tables, and demo visualizations on the default layout — recyclable when removed.
 * Keep in sync with non-KPI entries in DEFAULT_LAYOUT (layoutConfig.js).
 */
export const DEFAULT_VIEW_WIDGET_IDS = new Set([
  "demo-viz-stacked-horizontal",
  "cl-chart-resolution-subtype",
  "demo-viz-map",
  "demo-viz-leaderboard",
  "demo-viz-line",
  "demo-viz-sla-risk",
]);

/** Additional KPI cards users can add from inventory */
export const INVENTORY_METRIC_IDS = new Set([
  "cl-metric-total-registered",
  "cl-metric-total-open",
  "cl-metric-channel-mix",
  "cl-metric-new-vs-repeat",
  "cl-metric-inflow-rate",
]);

/** Charts and tables addable from inventory (not on default layout) */
export const INVENTORY_WIDGET_IDS = new Set([
  "cl-list-categories",
  "cl-table-resolution",
  "cl-table-locality",
  "cl-table-workflow-stages",
  "cl-chart-categories",
  "cl-chart-wards",
  "cl-chart-dow",
  "cl-chart-status-week",
  "demo-viz-stacked",
  "demo-viz-pie",
  "demo-viz-histogram",
  "demo-viz-gauge",
  "demo-viz-sla-toggle",
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
