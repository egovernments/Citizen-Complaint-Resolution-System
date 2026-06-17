/**
 * Visualization style registry — one definition per dashboard viz type.
 *
 * Visual rules live in styles/input.css (compiled to dashboard.css).
 * Components import class names from here so no widget duplicates or
 * overrides typography, spacing, or layout per card.
 */

import { getStatusValueClass } from "./kpiDisplay";
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

/**
 * CSS class names per visualization type.
 * Only types that have been refactored are populated; others are added
 * as we work through the catalog one by one.
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
  },
  [VIZ_TYPE.NUMBER_TILE_SPARKLINE]: {
    card: "dashboard-kpi-card--sparkline",
    valueRow: "dashboard-kpi-sparkline-value-row",
    delta: "dashboard-kpi-sparkline-delta",
    sparkline: "dashboard-kpi-sparkline-chart",
  },
  [VIZ_TYPE.BAR_CHART]: {
    container: "dashboard-bar-chart",
    body: "dashboard-bar-chart-body",
    header: "dashboard-bar-chart-header",
  },
  [VIZ_TYPE.HORIZONTAL_BAR]: {
    container: "dashboard-horizontal-bar",
    body: "dashboard-horizontal-bar-body",
    header: "dashboard-horizontal-bar-header",
  },
  [VIZ_TYPE.HISTOGRAM]: {
    container: "dashboard-bar-chart",
    body: "dashboard-bar-chart-body",
    header: "dashboard-bar-chart-header",
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
  },
  [VIZ_TYPE.PIE_CHART]: {
    container: "dashboard-pie-chart",
    body: "dashboard-pie-chart-body",
    header: "dashboard-pie-chart-header",
  },
  [VIZ_TYPE.DATA_TABLE]: {
    container: "dashboard-data-table",
    shell: "dashboard-data-table-shell",
    body: "dashboard-data-table-body",
    header: "dashboard-data-table-header",
    headerChrome: "dashboard-data-table-header-bar",
    title: "dashboard-drag-handle-title",
    subtitle: "dashboard-drag-handle-subtitle",
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
  },
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

export function getVisualizationStyles(vizType) {
  return VISUALIZATION_STYLES[vizType] || null;
}

/** Value color for number tiles — threshold-driven, shared by every metric card. */
export function getNumberTileValueClass(status, { unavailable = false } = {}) {
  const styles = VISUALIZATION_STYLES[VIZ_TYPE.NUMBER_TILE];
  if (unavailable) return styles.valueUnavailable;
  return getStatusValueClass(status);
}
