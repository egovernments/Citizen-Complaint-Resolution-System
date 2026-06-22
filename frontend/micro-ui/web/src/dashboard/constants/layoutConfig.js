import { CHART_WIDGETS, KPI_METRICS } from "../config/supervisorMetrics";
import { DEMO_VIZ_LAYOUT_DEFAULTS } from "../config/demoVisualizations";
import { isKpiListMetric } from "../config/kpiDisplay";
import { isSparklineKpi } from "../config/kpiSparkline";

export const GRID_COLS = 12;
export const KPI_ROW_HEIGHT = 52;
export const GRID_MARGIN_Y = 16;

export const RANKED_LIST_WIDGET_ID = "cl-list-categories";

/** Default grid size for data-table cards (header + rows + updated stamp). */
export const TABLE_CARD_GRID = {
  h: 3,
  minH: 3,
  minW: 4,
  maxW: 12,
  maxH: 12,
};

/** Pixel estimates for ranked-list auto height (header + padding + rows). */
const LIST_HEADER_PX = 52;
const LIST_PADDING_PX = 24;
const LIST_ITEM_PX = 38;
const LIST_ITEM_GAP_PX = 4;

/** Pixel estimates for in-card KPI lists (title + value + context + 5 rows). */
const KPI_LIST_HEADER_PX = 88;
const KPI_LIST_PADDING_PX = 20;
const KPI_LIST_ITEM_PX = 28;
const KPI_LIST_ITEM_GAP_PX = 4;
const KPI_LIST_VISIBLE_ROWS = 5;

/** Convert ranked-list content to react-grid-layout row units. */
export function resolveRankedListGridHeight(itemCount, rowHeight = KPI_ROW_HEIGHT, marginY = GRID_MARGIN_Y) {
  const count = Math.max(1, Math.min(5, Number(itemCount) || 1));
  const contentPx =
    LIST_HEADER_PX +
    LIST_PADDING_PX +
    count * LIST_ITEM_PX +
    (count - 1) * LIST_ITEM_GAP_PX;
  const h = Math.ceil((contentPx + marginY) / (rowHeight + marginY));
  const defaults = DEFAULT_CHART_LAYOUT[RANKED_LIST_WIDGET_ID];
  const minH = defaults?.minH ?? 2;
  const maxH = defaults?.maxH ?? 8;
  return Math.min(maxH, Math.max(minH, h));
}

/** Default grid height for KPI cards that embed a ranked list (5 visible rows). */
export function resolveKpiListGridHeight(rowHeight = KPI_ROW_HEIGHT, marginY = GRID_MARGIN_Y) {
  const count = KPI_LIST_VISIBLE_ROWS;
  const contentPx =
    KPI_LIST_HEADER_PX +
    KPI_LIST_PADDING_PX +
    count * KPI_LIST_ITEM_PX +
    (count - 1) * KPI_LIST_ITEM_GAP_PX;
  const h = Math.ceil((contentPx + marginY) / (rowHeight + marginY));
  return Math.max(5, h);
}

const KPI_LIST_GRID_H = resolveKpiListGridHeight();

export const DEFAULT_KPI_LAYOUT_ITEM = {
  w: 2,
  h: 2,
  minW: 2,
  minH: 2,
  maxH: 6,
};

/** Sparkline KPIs — min height matches default tile; vertical resize grows the trend line. */
export const DEFAULT_SPARKLINE_KPI_LAYOUT_ITEM = {
  w: 2,
  h: 2,
  minW: 2,
  minH: 2,
  maxH: 6,
};

export const DEFAULT_KPI_LIST_LAYOUT_ITEM = {
  w: 2,
  h: KPI_LIST_GRID_H,
  minW: 2,
  minH: KPI_LIST_GRID_H,
  maxH: 24,
};

export function getDefaultKpiLayoutItem(metricId) {
  if (isKpiListMetric(metricId)) {
    return DEFAULT_KPI_LIST_LAYOUT_ITEM;
  }
  if (isSparklineKpi(metricId)) {
    return DEFAULT_SPARKLINE_KPI_LAYOUT_ITEM;
  }
  return DEFAULT_KPI_LAYOUT_ITEM;
}

export { isKpiListMetric };

const kpiWidgets = Object.fromEntries(
  KPI_METRICS.map((m) => [m.id, { type: "kpi", metric: m.metric }])
);

const chartWidgets = Object.fromEntries(
  CHART_WIDGETS.map((c) => [
    c.id,
    {
      type: c.type,
      metric: c.metric,
      subMetric: c.subMetric,
      outputFormat: c.outputFormat,
      ...(c.stackOrientation ? { stackOrientation: c.stackOrientation } : {}),
      ...(c.customChrome ? { customChrome: true } : {}),
    },
  ])
);

export const WIDGETS = {
  ...kpiWidgets,
  ...chartWidgets,
};

/** One shared size contract per visualization type (uniform min/max across charts). */
export const UNIFORM_CHART_SIZE_CONSTRAINTS = {
  minW: 4,
  minH: 4,
  maxW: 12,
  maxH: 10,
};

/** Progress bar (gauge) — fixed height; width only. */
export const GAUGE_SIZE_CONSTRAINTS = {
  minW: 3,
  minH: 2,
  maxW: 6,
  maxH: 2,
};

export const CHART_TYPE_SIZE_CONSTRAINTS = {
  "data-table": {
    minW: TABLE_CARD_GRID.minW,
    minH: TABLE_CARD_GRID.minH,
    maxW: TABLE_CARD_GRID.maxW,
    maxH: TABLE_CARD_GRID.maxH,
  },
  "bar-chart": UNIFORM_CHART_SIZE_CONSTRAINTS,
  "histogram": UNIFORM_CHART_SIZE_CONSTRAINTS,
  "stacked-bar": UNIFORM_CHART_SIZE_CONSTRAINTS,
  "horizontal-bar": UNIFORM_CHART_SIZE_CONSTRAINTS,
  "line-chart": UNIFORM_CHART_SIZE_CONSTRAINTS,
  "pie-chart": UNIFORM_CHART_SIZE_CONSTRAINTS,
  "sla-toggle": UNIFORM_CHART_SIZE_CONSTRAINTS,
  "map": UNIFORM_CHART_SIZE_CONSTRAINTS,
  "sla-risk-table": {
    minW: 6,
    minH: 4,
    maxW: 12,
    maxH: 14,
  },
  "gauge": GAUGE_SIZE_CONSTRAINTS,
};

export function getChartTypeSizeConstraints(type) {
  return CHART_TYPE_SIZE_CONSTRAINTS[type] ?? UNIFORM_CHART_SIZE_CONSTRAINTS;
}

const RAW_DEFAULT_CHART_LAYOUT = {
  "cl-list-categories": { x: 0, w: 6, ...TABLE_CARD_GRID },
  "cl-table-resolution": { x: 6, w: 6, ...TABLE_CARD_GRID },
  "cl-table-locality": { x: 0, w: 6, ...TABLE_CARD_GRID },
  "cl-table-workflow-stages": { x: 6, w: 6, ...TABLE_CARD_GRID },
  "cl-chart-categories": { x: 0, w: 4, h: 6, minW: 3, minH: 6, maxW: 8, maxH: 10 },
  "cl-chart-wards": { x: 4, w: 4, h: 6, minW: 3, minH: 4, maxW: 8, maxH: 10 },
  "cl-chart-dow": { x: 8, w: 4, h: 6, minW: 3, minH: 4, maxW: 8, maxH: 10 },
  "cl-chart-status-week": { x: 0, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "cl-chart-officer-sla": { x: 6, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  ...DEMO_VIZ_LAYOUT_DEFAULTS,
};

export const DEFAULT_CHART_LAYOUT = Object.fromEntries(
  Object.entries(RAW_DEFAULT_CHART_LAYOUT).map(([widgetId, layout]) => {
    const type = WIDGETS[widgetId]?.type;
    if (!type) return [widgetId, layout];
    return [widgetId, { ...layout, ...getChartTypeSizeConstraints(type) }];
  })
);

export const TOP_ROW_CHART_IDS = [
  "cl-list-categories",
  "cl-table-resolution",
  "cl-table-locality",
  "cl-table-workflow-stages",
];

export const DEFAULT_LAYOUT = [
  { i: "cl-metric-total-registered", x: 0, y: 0, w: 2, h: 2, minW: 2, minH: 2, maxH: 6, moved: false, static: false, resizeHandles: ["se"] },
  { i: "cl-metric-total-open", x: 2, y: 0, w: 2, h: 2, minW: 2, minH: 2, maxH: 6, moved: false, static: false, resizeHandles: ["se"] },
  { i: "cl-metric-total-resolved", x: 4, y: 0, w: 2, h: 2, minW: 2, minH: 2, maxH: 6, moved: false, static: false, resizeHandles: ["se"] },
  { i: "cl-metric-channel-mix", x: 6, y: 0, w: 2, h: 2, minW: 2, minH: 2, maxH: 6, moved: false, static: false, resizeHandles: ["se"] },
  { i: "cl-metric-new-vs-repeat", x: 8, y: 0, w: 2, h: 2, minW: 2, minH: 2, maxH: 6, moved: false, static: false, resizeHandles: ["se"] },
  { i: "cl-metric-inflow-rate", x: 10, y: 0, w: 2, h: 2, minW: 2, minH: 2, maxH: 6, moved: false, static: false, resizeHandles: ["se"] },
  { i: "cl-list-categories", x: 0, y: 2, w: 6, h: 3, minW: 4, minH: 3, maxW: 12, maxH: 12, moved: false, static: false, resizeHandles: ["se"] },
  { i: "cl-table-resolution", x: 6, y: 2, w: 6, h: 3, minW: 4, minH: 3, maxW: 12, maxH: 12, moved: false, static: false, resizeHandles: ["se"] },
  { i: "cl-table-locality", x: 0, y: 5, w: 6, h: 3, minW: 4, minH: 3, maxW: 12, maxH: 12, moved: false, static: false, resizeHandles: ["se"] },
  { i: "cl-table-workflow-stages", x: 6, y: 5, w: 6, h: 3, minW: 4, minH: 3, maxW: 12, maxH: 12, moved: false, static: false, resizeHandles: ["se"] },
  { i: "cl-chart-categories", x: 0, y: 8, w: 4, h: 6, minW: 3, minH: 6, maxW: 8, maxH: 10, moved: false, static: false, resizeHandles: ["se"] },
  { i: "cl-chart-wards", x: 4, y: 8, w: 4, h: 6, minW: 3, minH: 4, maxW: 8, maxH: 10, moved: false, static: false, resizeHandles: ["se"] },
  { i: "cl-chart-dow", x: 8, y: 8, w: 4, h: 6, minW: 3, minH: 4, maxW: 8, maxH: 10, moved: false, static: false, resizeHandles: ["se"] },
  { i: "demo-viz-stacked", x: 0, y: 14, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10, moved: false, static: false, resizeHandles: ["se"] },
  { i: "demo-viz-stacked-horizontal", x: 6, y: 14, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10, moved: false, static: false, resizeHandles: ["se"] },
  { i: "demo-viz-pie", x: 0, y: 20, w: 5, h: 5, minW: 3, minH: 4, maxW: 6, maxH: 8, moved: false, static: false, resizeHandles: ["se"] },
  { i: "demo-viz-histogram", x: 5, y: 20, w: 4, h: 5, minW: 4, minH: 4, maxW: 12, maxH: 10, moved: false, static: false, resizeHandles: ["se"] },
  { i: "demo-viz-gauge", x: 0, y: 25, w: 4, h: 2, minW: 3, minH: 2, maxW: 6, maxH: 2, moved: false, static: false, resizeHandles: ["se"] },
  { i: "demo-viz-leaderboard", x: 4, y: 25, w: 7, h: 6, minW: 4, minH: 4, maxW: 8, maxH: 10, moved: false, static: false, resizeHandles: ["se"] },
  { i: "demo-viz-sla-toggle", x: 0, y: 27, w: 4, h: 4, minW: 4, minH: 3, maxW: 6, maxH: 8, moved: false, static: false, resizeHandles: ["se"] },
  { i: "demo-viz-map", x: 0, y: 31, w: 6, h: 6, minW: 4, minH: 5, maxW: 12, maxH: 14, moved: false, static: false, resizeHandles: ["se"] },
  { i: "demo-viz-line", x: 6, y: 31, w: 6, h: 6, minW: 3, minH: 4, maxW: 8, maxH: 10, moved: false, static: false, resizeHandles: ["se"] },
  { i: "demo-viz-sla-risk", x: 0, y: 37, w: 12, h: 5, minW: 6, minH: 4, maxW: 12, maxH: 14, moved: false, static: false, resizeHandles: ["se"] },
].map((item) => {
  const type = WIDGETS[item.i]?.type;
  if (!type || type === "kpi") return item;
  return { ...item, ...getChartTypeSizeConstraints(type) };
});

export const DROPPING_ITEM_ID = "__dropping-kpi__";

export const DROPPING_ITEM = {
  i: DROPPING_ITEM_ID,
  ...DEFAULT_KPI_LAYOUT_ITEM,
};

export function isKpiWidget(widgetId) {
  return WIDGETS[widgetId]?.type === "kpi";
}

export function isChartWidget(widgetId) {
  const type = WIDGETS[widgetId]?.type;
  return type && type !== "kpi";
}

export function getDefaultChartItem(widgetId) {
  const defaults = DEFAULT_CHART_LAYOUT[widgetId];
  if (!defaults) return null;
  return { i: widgetId, ...defaults };
}

/** Charts with a fixed grid height (width still resizes). */
export function isHeightLockedChart(widgetId) {
  return WIDGETS[widgetId]?.type === "gauge";
}

export function getResizeHandles(widgetId) {
  return ["se"];
}

/**
 * Current min/max size constraints for a widget, sourced from config.
 * Applied at render time so resize limits always reflect the latest config —
 * even for widgets persisted with older (looser) constraints — without
 * touching the saved x/y/w/h.
 */
export function getSizeConstraints(widgetId) {
  if (!isKpiWidget(widgetId)) {
    const type = WIDGETS[widgetId]?.type;
    if (type) return { ...getChartTypeSizeConstraints(type) };
  }

  const source = isKpiWidget(widgetId)
    ? getDefaultKpiLayoutItem(widgetId)
    : DEFAULT_CHART_LAYOUT[widgetId];
  if (!source) return {};

  const constraints = {};
  if (source.minW != null) constraints.minW = source.minW;
  if (source.minH != null) constraints.minH = source.minH;
  if (source.maxW != null) constraints.maxW = source.maxW;
  if (source.maxH != null) constraints.maxH = source.maxH;
  return constraints;
}
