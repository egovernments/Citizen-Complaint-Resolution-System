/**
 * Visualization registry — single source of truth for dashboard viz types,
 * CSS class names, and grid chrome helpers.
 *
 * Visual rules live in styles/input.css (compiled to dashboard.css).
 * Components import class names from here; do not duplicate dashboard-* strings.
 */

export const VIZ_TYPE = {
  NUMBER_TILE: "number-tile",
  NUMBER_TILE_SPARKLINE: "number-tile-sparkline",
  BAR_CHART: "bar-chart",
  HORIZONTAL_BAR: "horizontal-bar",
  LINE_CHART: "line-chart",
  PIE_CHART: "pie-chart",
  DATA_TABLE: "data-table",
  SLA_TOGGLE: "sla-toggle",
  STACKED_BAR: "stacked-bar",
  MAP: "map",
  SLA_RISK_TABLE: "sla-risk-table",
  HISTOGRAM: "histogram",
  GAUGE: "gauge",
};

/** Shared chrome reused across viz types. */
export const SHARED_CHROME = {
  dragHandle: "dashboard-drag-handle",
  dragHandleTitle: "dashboard-drag-handle-title",
  dragHandleSubtitle: "dashboard-drag-handle-subtitle",
  widgetSurface: "dashboard-widget-surface",
  widgetRemoveBtn: "dashboard-widget-remove-btn",
  defaultBody: "tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden tw-p-4",
  chartTooltip: "dashboard-chart-tooltip",
  chartTooltipTitle: "dashboard-chart-tooltip-title",
  chartTooltipValue: "dashboard-chart-tooltip-value",
};

const BAR_CHART_STYLES = {
  container: "dashboard-bar-chart",
  body: "dashboard-bar-chart-body",
  header: "dashboard-bar-chart-header",
};

const DATA_TABLE_STYLES = {
  container: "dashboard-data-table",
  shell: "dashboard-data-table-shell",
  body: "dashboard-data-table-body",
  header: "dashboard-data-table-header",
  headerChrome: "dashboard-data-table-header-bar",
  title: SHARED_CHROME.dragHandleTitle,
  subtitle: SHARED_CHROME.dragHandleSubtitle,
  scroll: "dashboard-table-scroll",
  table: "dashboard-table",
  th: "dashboard-table-th",
  thRight: "dashboard-table-th-right",
  td: "dashboard-table-td",
  tdRight: "dashboard-table-td-right",
  colFixed: "dashboard-table-col-fixed",
  rowHighlight: "dashboard-table-row-highlight",
  primary: "dashboard-table-primary",
  label: "dashboard-table-label",
  badge: "dashboard-table-badge",
  muted: "dashboard-table-muted",
  empty: "dashboard-table-empty",
  trendUp: "dashboard-table-trend-up",
  trendDown: "dashboard-table-trend-down",
  legendSwatch: "dashboard-data-table-legend-swatch",
  legendLabel: "dashboard-data-table-legend-label",
  valueEmphasis: "dashboard-data-table-value-emphasis",
};

/**
 * CSS class names and layout flags per visualization type.
 */
export const VISUALIZATION_STYLES = {
  [VIZ_TYPE.NUMBER_TILE]: {
    card: "dashboard-kpi-card",
    cardMetric: "dashboard-kpi-card--metric",
    title: "dashboard-kpi-title",
    value: "dashboard-kpi-value",
    context: "dashboard-kpi-context",
    valueLoading: "tw-animate-pulse",
    valueUnavailable: "tw-text-muted-foreground",
    listBody: "dashboard-kpi-list-body",
    list: "dashboard-kpi-list",
    listItem: "dashboard-kpi-list-item",
  },
  [VIZ_TYPE.NUMBER_TILE_SPARKLINE]: {
    card: "dashboard-kpi-card--sparkline",
    valueRow: "dashboard-kpi-sparkline-value-row",
    delta: "dashboard-kpi-sparkline-delta",
    deltaMuted: "dashboard-kpi-sparkline-delta--muted",
    deltaNeutral: "dashboard-kpi-sparkline-delta--neutral",
    deltaPositive: "dashboard-kpi-sparkline-delta--positive",
    deltaNegative: "dashboard-kpi-sparkline-delta--negative",
    sparkline: "dashboard-kpi-sparkline-chart",
  },
  [VIZ_TYPE.BAR_CHART]: BAR_CHART_STYLES,
  [VIZ_TYPE.HISTOGRAM]: BAR_CHART_STYLES,
  [VIZ_TYPE.HORIZONTAL_BAR]: {
    container: "dashboard-horizontal-bar",
    body: "dashboard-horizontal-bar-body",
    header: "dashboard-horizontal-bar-header",
  },
  [VIZ_TYPE.STACKED_BAR]: {
    container: "dashboard-stacked-bar",
    body: "dashboard-stacked-bar-body",
    header: "dashboard-stacked-bar-header",
  },
  [VIZ_TYPE.LINE_CHART]: {
    container: "dashboard-line-chart",
    body: "dashboard-line-chart-body",
    header: "dashboard-line-chart-header",
    headerBar: "dashboard-line-chart-header-bar",
    widgetBody: "dashboard-line-chart-widget-body",
    animating: "dashboard-line-chart-animating",
    markerActive: "dashboard-line-chart-marker-active",
    tooltip: "dashboard-line-chart-tooltip",
    tooltipTitle: "dashboard-line-chart-tooltip-title",
    tooltipRow: "dashboard-line-chart-tooltip-row",
  },
  [VIZ_TYPE.PIE_CHART]: {
    container: "dashboard-pie-chart",
    body: "dashboard-pie-chart-body",
    header: "dashboard-pie-chart-header",
    slice: "dashboard-pie-slice",
    tooltip: "dashboard-pie-tooltip",
  },
  [VIZ_TYPE.DATA_TABLE]: DATA_TABLE_STYLES,
  [VIZ_TYPE.SLA_RISK_TABLE]: {
    link: "dashboard-sla-link",
    linkButton: "dashboard-sla-link dashboard-sla-link--button",
    breachPill: "dashboard-sla-breach-pill",
    overdue: "dashboard-sla-overdue",
    statusPill: "dashboard-sla-status-pill",
    statusPillReopened: "dashboard-sla-status-pill--reopened",
    statusPillInProgress: "dashboard-sla-status-pill--in-progress",
    ownerName: "dashboard-data-table-owner-name",
    slaCell: "dashboard-data-table-sla-cell",
  },
  [VIZ_TYPE.SLA_TOGGLE]: {
    bodyBar: "dashboard-sla-toggle-body",
  },
  [VIZ_TYPE.MAP]: {
    container: "dashboard-map",
    body: "dashboard-map-body",
    header: "dashboard-map-header",
  },
  [VIZ_TYPE.GAUGE]: {
    body: "dashboard-gauge-body",
    header: "dashboard-gauge-header",
    value: "dashboard-gauge-value",
    status: "dashboard-gauge-status",
    track: "dashboard-gauge-track",
    fill: "dashboard-gauge-fill",
    targetLine: "dashboard-gauge-target-line",
    targetMarker: "dashboard-gauge-target-marker",
    targetTooltip: "dashboard-gauge-target-tooltip",
  },
};

/** Grid layout behavior flags keyed by viz type. */
export const VIZ_GRID_BEHAVIOR = {
  [VIZ_TYPE.BAR_CHART]: { chartOverflowVisible: true },
  [VIZ_TYPE.HORIZONTAL_BAR]: { chartOverflowVisible: true },
  [VIZ_TYPE.LINE_CHART]: { chartOverflowVisible: true },
  [VIZ_TYPE.PIE_CHART]: { chartOverflowVisible: true },
  [VIZ_TYPE.STACKED_BAR]: { chartOverflowVisible: true },
  [VIZ_TYPE.HISTOGRAM]: { chartOverflowVisible: true },
  [VIZ_TYPE.SLA_TOGGLE]: { chartOverflowVisible: true },
};

export function getVisualizationStyles(vizType) {
  return VISUALIZATION_STYLES[vizType] || null;
}

export function buildWidgetHeaderClassName(vizType) {
  const styles = getVisualizationStyles(vizType);
  if (!styles?.header) return SHARED_CHROME.dragHandle;
  return `${SHARED_CHROME.dragHandle} ${styles.header}`;
}

export function getWidgetBodyClassName(vizType, { isTable = false } = {}) {
  if (isTable) return DATA_TABLE_STYLES.body;
  const styles = getVisualizationStyles(vizType);
  return styles?.body ?? SHARED_CHROME.defaultBody;
}

export function getWidgetScrollClassName() {
  return DATA_TABLE_STYLES.scroll;
}

export function isChartOverflowVisibleType(vizType) {
  return VIZ_GRID_BEHAVIOR[vizType]?.chartOverflowVisible === true;
}

export function hasTypedGridChrome(vizType) {
  const styles = getVisualizationStyles(vizType);
  return Boolean(styles?.header || styles?.body);
}

export function getDataTableThClass(align = "left") {
  const { th, thRight } = DATA_TABLE_STYLES;
  return align === "right" ? `${th} ${thRight}` : th;
}

export function getDataTableTdClass(align = "left") {
  const { td, tdRight } = DATA_TABLE_STYLES;
  return align === "right" ? `${td} ${tdRight}` : td;
}

export function getSlaRiskStatusPillClass(status) {
  const { statusPill, statusPillReopened, statusPillInProgress } =
    VISUALIZATION_STYLES[VIZ_TYPE.SLA_RISK_TABLE];
  if (status === "reopened") {
    return `${statusPill} ${statusPillReopened}`;
  }
  return `${statusPill} ${statusPillInProgress}`;
}

export { DATA_TABLE_STYLES };

export const SLA_RISK_TABLE_STYLES = VISUALIZATION_STYLES[VIZ_TYPE.SLA_RISK_TABLE];
