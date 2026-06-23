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
 * Charts and demo visualizations on the default layout — recyclable when removed.
 * Keep in sync with non-KPI entries in DEFAULT_LAYOUT (layoutConfig.js).
 */
export const DEFAULT_VIEW_WIDGET_IDS = new Set([
  "demo-viz-stacked-horizontal",
  "cl-chart-resolution-subtype",
  "cl-map-geography-choropleth",
  "cl-chart-department-flow-ratio",
  "cl-chart-over-time",
  "cl-chart-open-by-channel",
  "cl-table-complaints-at-risk",
]);

/** Additional KPI cards users can add from inventory */
export const INVENTORY_METRIC_IDS = new Set([
  "cl-metric-new-created",
  "cl-metric-created-today",
  "cl-metric-resolution-rate",
  "cl-metric-reopen-rate",
  "cl-metric-csat",
  "cl-metric-first-assignment-rate",
  "cl-metric-sla-compliance-rate",
  "cl-metric-sla-non-compliance-rate",
  "cl-metric-resolved-on-time-rate",
  "cl-metric-oldest-open",
  "cl-metric-avg-resolution-time",
  "cl-metric-total-open",
]);

/** Charts and tables addable from inventory (not on default layout) */
export const INVENTORY_WIDGET_IDS = new Set([
  "cl-table-complaint-type-details",
  "cl-table-complaints-at-risk",
  "ep-table-employee-performance",
  "cl-chart-complaints-by-type",
  "cl-chart-departments",
  "cl-chart-department-resolution-rate",
  "cl-chart-department-flow-ratio",
  "cl-map-geography-choropleth",
  "cl-chart-officer-sla",
  "cl-chart-open-by-type",
  "cl-chart-complaints-by-age",
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
