/**
 * Metrics and widgets that may appear in the add-metric inventory.
 * Default-view items return here when removed from the dashboard.
 */

/** Supervisor KPI cards from the approved spec (complaint landscape). */
export const APPROVED_KPI_IDS = new Set([
  "cl-metric-new-created",
  "cl-metric-total-open",
  "cl-metric-total-resolved",
  "cl-metric-created-today",
  "cl-metric-resolution-rate",
  "cl-metric-oldest-open",
  "cl-metric-avg-resolution-time",
  "cl-metric-reopen-rate",
  "cl-metric-csat",
  "cl-metric-first-assignment-rate",
  "cl-metric-sla-compliance-rate",
  "cl-metric-sla-non-compliance-rate",
  "cl-metric-resolved-on-time-rate",
]);

/** Top-row KPI cards shipped in the default layout — always recyclable via inventory. */
export const DEFAULT_VIEW_KPI_IDS = new Set([
  "cl-metric-resolution-rate",
  "rs-metric-breach-count",
  "cl-metric-total-resolved",
  "cl-metric-reopen-rate",
  "cl-metric-csat",
]);

/**
 * Charts and demo visualizations on the default layout — recyclable when removed.
 * Keep in sync with non-KPI entries in DEFAULT_LAYOUT (layoutConfig.js).
 */
export const DEFAULT_VIEW_WIDGET_IDS = new Set([
  "cl-chart-officer-sla",
  "cl-chart-resolution-subtype",
  "cl-map-geography-choropleth",
  "cl-chart-department-flow-ratio",
  "cl-chart-over-time",
  "cl-table-complaints-at-risk",
]);

/** Additional KPI cards users can add from inventory */
export const INVENTORY_METRIC_IDS = new Set(
  [...APPROVED_KPI_IDS].filter((id) => !DEFAULT_VIEW_KPI_IDS.has(id))
);

/** Charts and tables from the approved supervisor spec (addable from inventory). */
export const APPROVED_WIDGET_IDS = new Set([
  "cl-chart-over-time",
  "cl-chart-complaints-by-type",
  "cl-chart-departments",
  "cl-chart-officer-sla",
  "cl-chart-resolution-subtype",
  "cl-map-geography-choropleth",
  "cl-chart-department-resolution-rate",
  "cl-chart-open-by-channel",
  "cl-table-complaint-type-details",
  "cl-chart-complaints-by-age",
  "ep-table-employee-performance",
  "cl-table-complaints-at-risk",
  "cl-chart-department-flow-ratio",
]);

/** Charts and tables addable from inventory when not on the default layout. */
export const INVENTORY_WIDGET_IDS = new Set(
  [...APPROVED_WIDGET_IDS].filter((id) => !DEFAULT_VIEW_WIDGET_IDS.has(id))
);

export function isInventoryMetric(metricId) {
  return (
    APPROVED_KPI_IDS.has(metricId) || DEFAULT_VIEW_KPI_IDS.has(metricId)
  );
}

export function isInventoryWidget(widgetId) {
  return (
    APPROVED_WIDGET_IDS.has(widgetId) || DEFAULT_VIEW_WIDGET_IDS.has(widgetId)
  );
}

export function filterInventoryMetricIds(ids = []) {
  return ids.filter((id) => isInventoryMetric(id));
}

export function filterInventoryWidgetIds(ids = []) {
  return ids.filter((id) => isInventoryWidget(id));
}
