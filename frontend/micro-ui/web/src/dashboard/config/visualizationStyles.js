/**
 * Visualization registry — single source of truth for dashboard viz types,
 * CSS class names, and grid chrome helpers.
 *
 * Visual rules live in styles/input.css (compiled to dashboard.css).
 * Components import class names from here; do not duplicate dashboard-* strings.
 */

export const VIZ_TYPE = {
  /** Value + optional delta + context (no sparkline). */
  NUMBER_TILE: "number-tile-delta",
  NUMBER_TILE_DELTA: "number-tile-delta",
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
  /** Scope palette CSS variables onto portaled nodes (e.g. body-mounted tooltips). */
  dashboardRoot: "dashboard-root",
  defaultBody: "tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden tw-p-4",
  chartTooltip: "dashboard-chart-tooltip",
  chartTooltipFixed: "dashboard-chart-tooltip--fixed",
  chartTooltipAnchored: "dashboard-chart-tooltip--anchored",
  chartTooltipTitle: "dashboard-chart-tooltip-title",
  chartTooltipRow: "dashboard-chart-tooltip-row",
  chartScrollViewport: "dashboard-chart-scroll-viewport",
  chartScrollViewportActive: "dashboard-chart-scroll-viewport--active",
  chartScrollViewportVertical: "dashboard-chart-scroll-viewport--vertical",
  chartScrollViewportHorizontal: "dashboard-chart-scroll-viewport--horizontal",
  chartScrollCanvas: "dashboard-chart-scroll-canvas",
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
  tableEqualCols: "dashboard-table--equal-cols",
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
  thresholdCell: "dashboard-table-threshold-cell",
  thresholdWatch: "dashboard-table-threshold-watch",
  thresholdGood: "dashboard-table-threshold-good",
  cellToneBreach: "dashboard-table-cell-tone--breach",
  cellToneWatch: "dashboard-table-cell-tone--watch",
  cellToneGood: "dashboard-table-cell-tone--good",
  slaOverrun: "dashboard-table-sla-overrun",
  statusTag: "dashboard-table-status-tag",
  statusTagBreach: "dashboard-table-status-tag--breach",
  statusTagWatch: "dashboard-table-status-tag--watch",
  statusTagGood: "dashboard-table-status-tag--good",
};

/**
 * CSS class names and layout flags per visualization type.
 */
export const VISUALIZATION_STYLES = {
  [VIZ_TYPE.NUMBER_TILE_DELTA]: {
    card: "dashboard-kpi-card",
    cardMetric: "dashboard-kpi-card--metric",
    cardDelta: "dashboard-kpi-card--delta",
    title: "dashboard-kpi-title",
    value: "dashboard-kpi-value",
    valueRow: "dashboard-kpi-sparkline-value-row",
    delta: "dashboard-kpi-sparkline-delta",
    deltaMuted: "dashboard-kpi-sparkline-delta--muted",
    deltaNeutral: "dashboard-kpi-sparkline-delta--neutral",
    deltaPositive: "dashboard-kpi-sparkline-delta--positive",
    deltaNegative: "dashboard-kpi-sparkline-delta--negative",
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
  },
  [VIZ_TYPE.PIE_CHART]: {
    container: "dashboard-pie-chart",
    body: "dashboard-pie-chart-body",
    header: "dashboard-pie-chart-header",
    slice: "dashboard-pie-slice",
  },
  [VIZ_TYPE.DATA_TABLE]: DATA_TABLE_STYLES,
  [VIZ_TYPE.SLA_RISK_TABLE]: {
    table: "dashboard-sla-risk-table",
    link: "dashboard-sla-link",
    linkButton: "dashboard-sla-link dashboard-sla-link--button",
    breachPill: "dashboard-sla-breach-pill",
    breachPillBreached: "dashboard-sla-breach-pill--breached",
    breachPillNearing: "dashboard-sla-breach-pill--nearing",
    overdue: "dashboard-sla-overdue",
    statusPill: "dashboard-sla-status-pill",
    statusPillAssigned: "dashboard-sla-status-pill--assigned",
    statusPillOpen: "dashboard-sla-status-pill--open",
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
  [VIZ_TYPE.HORIZONTAL_BAR]: { chartOverflowVisible: true },
  [VIZ_TYPE.SLA_TOGGLE]: { chartOverflowVisible: true },
  [VIZ_TYPE.MAP]: { chartOverflowVisible: true },
};

export function getVisualizationStyles(vizType) {
  if (vizType === VIZ_TYPE.NUMBER_TILE) {
    return VISUALIZATION_STYLES[VIZ_TYPE.NUMBER_TILE_DELTA];
  }
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
  const {
    statusPill,
    statusPillAssigned,
    statusPillOpen,
    statusPillReopened,
    statusPillInProgress
  } =
    VISUALIZATION_STYLES[VIZ_TYPE.SLA_RISK_TABLE];
  if (status === "assigned") {
    return `${statusPill} ${statusPillAssigned}`;
  }
  if (status === "open") {
    return `${statusPill} ${statusPillOpen}`;
  }
  if (status === "reopened") {
    return `${statusPill} ${statusPillReopened}`;
  }
  return `${statusPill} ${statusPillInProgress}`;
}

export function getSlaRiskBreachPillClass(level) {
  const { breachPill, breachPillBreached, breachPillNearing } =
    VISUALIZATION_STYLES[VIZ_TYPE.SLA_RISK_TABLE];
  if (level === "nearing") {
    return `${breachPill} ${breachPillNearing}`;
  }
  return `${breachPill} ${breachPillBreached}`;
}

export { DATA_TABLE_STYLES };

export const SLA_RISK_TABLE_STYLES = VISUALIZATION_STYLES[VIZ_TYPE.SLA_RISK_TABLE];
