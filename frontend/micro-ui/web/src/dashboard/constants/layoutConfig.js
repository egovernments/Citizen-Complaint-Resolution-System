import { CHART_WIDGETS, KPI_METRICS } from "../config/supervisorMetrics";

export const GRID_COLS = 12;
export const KPI_ROW_HEIGHT = 52;
export const GRID_MARGIN_Y = 16;

export const RANKED_LIST_WIDGET_ID = "cl-list-categories";

/** Pixel estimates for ranked-list auto height (header + padding + rows). */
const LIST_HEADER_PX = 52;
const LIST_PADDING_PX = 24;
const LIST_ITEM_PX = 38;
const LIST_ITEM_GAP_PX = 4;

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
    },
  ])
);

export const WIDGETS = {
  ...kpiWidgets,
  ...chartWidgets,
};

export const DEFAULT_KPI_LAYOUT_ITEM = {
  w: 2,
  h: 2,
  minW: 2,
  minH: 2,
  maxH: 6,
};

export const DEFAULT_CHART_LAYOUT = {
  "cl-list-categories": { x: 0, w: 6, h: 3, minW: 4, minH: 3, maxW: 12, maxH: 6 },
  "cl-table-resolution": { x: 6, w: 6, h: 3, minW: 4, minH: 3, maxW: 12, maxH: 6 },
  "cl-table-locality": { x: 0, w: 6, h: 3, minW: 4, minH: 3, maxW: 12, maxH: 6 },
  "cl-table-workflow-stages": { x: 6, w: 6, h: 3, minW: 4, minH: 3, maxW: 12, maxH: 6 },
  "cl-chart-categories": { x: 0, w: 4, h: 6, minW: 3, minH: 4, maxW: 8, maxH: 10 },
  "cl-chart-wards": { x: 4, w: 4, h: 6, minW: 3, minH: 4, maxW: 8, maxH: 10 },
  "cl-chart-dow": { x: 8, w: 4, h: 6, minW: 3, minH: 4, maxW: 8, maxH: 10 },
};

export const TOP_ROW_CHART_IDS = [
  "cl-list-categories",
  "cl-table-resolution",
  "cl-table-locality",
  "cl-table-workflow-stages",
];

export const DEFAULT_LAYOUT = [
  {
    w: 2,
    h: 2,
    x: 0,
    y: 0,
    i: "cl-metric-total-registered",
    minW: 2,
    minH: 2,
    maxH: 6,
    moved: false,
    static: false,
    resizeHandles: ["se"],
  },
  {
    w: 2,
    h: 2,
    x: 2,
    y: 0,
    i: "cl-metric-total-open",
    minW: 2,
    minH: 2,
    maxH: 6,
    moved: false,
    static: false,
    resizeHandles: ["se"],
  },
  {
    w: 2,
    h: 2,
    x: 4,
    y: 0,
    i: "cl-metric-total-resolved",
    minW: 2,
    minH: 2,
    maxH: 6,
    moved: false,
    static: false,
    resizeHandles: ["se"],
  },
  {
    w: 2,
    h: 2,
    x: 6,
    y: 0,
    i: "cl-metric-channel-mix",
    minW: 2,
    minH: 2,
    maxH: 6,
    moved: false,
    static: false,
    resizeHandles: ["se"],
  },
  {
    w: 2,
    h: 2,
    x: 8,
    y: 0,
    i: "cl-metric-new-vs-repeat",
    minW: 2,
    minH: 2,
    maxH: 6,
    moved: false,
    static: false,
    resizeHandles: ["se"],
  },
  {
    w: 2,
    h: 2,
    x: 10,
    y: 0,
    i: "cl-metric-inflow-rate",
    minW: 2,
    minH: 2,
    maxH: 6,
    moved: false,
    static: false,
    resizeHandles: ["se"],
  },
  {
    w: 6,
    h: 3,
    x: 0,
    y: 2,
    i: "cl-list-categories",
    minW: 4,
    minH: 3,
    maxH: 6,
    moved: false,
    static: false,
    resizeHandles: ["se"],
  },
  {
    w: 6,
    h: 3,
    x: 6,
    y: 2,
    i: "cl-table-resolution",
    minW: 4,
    minH: 3,
    maxH: 6,
    moved: false,
    static: false,
    resizeHandles: ["se"],
  },
  {
    w: 6,
    h: 3,
    x: 0,
    y: 5,
    i: "cl-table-locality",
    minW: 4,
    minH: 3,
    maxH: 6,
    moved: false,
    static: false,
    resizeHandles: ["se"],
  },
  {
    w: 6,
    h: 3,
    x: 6,
    y: 5,
    i: "cl-table-workflow-stages",
    minW: 4,
    minH: 3,
    maxH: 6,
    moved: false,
    static: false,
    resizeHandles: ["se"],
  },
  {
    w: 4,
    h: 6,
    x: 0,
    y: 8,
    i: "cl-chart-categories",
    minW: 3,
    minH: 4,
    maxH: 10,
    moved: false,
    static: false,
    resizeHandles: ["se"],
  },
  {
    w: 4,
    h: 6,
    x: 4,
    y: 8,
    i: "cl-chart-wards",
    minW: 3,
    minH: 4,
    maxH: 10,
    moved: false,
    static: false,
    resizeHandles: ["se"],
  },
  {
    w: 4,
    h: 6,
    x: 8,
    y: 8,
    i: "cl-chart-dow",
    minW: 3,
    minH: 4,
    maxH: 10,
    moved: false,
    static: false,
    resizeHandles: ["se"],
  },
];

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
