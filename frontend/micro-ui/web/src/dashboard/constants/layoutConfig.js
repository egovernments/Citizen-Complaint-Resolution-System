import { CHART_WIDGETS, KPI_METRICS } from "../config/kpiQueries";

export const LAYOUT_STORAGE_KEY = "bomet-crs-dashboard-complaint-landscape-v7";

export const GRID_COLS = 12;
export const KPI_ROW_HEIGHT = 52;

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
  maxH: 2,
};

export const DEFAULT_CHART_LAYOUT = {
  "cl-chart-categories": { x: 0, w: 6, h: 3, minW: 4, minH: 2 },
  "cl-list-categories": { x: 6, w: 3, h: 3, minW: 3, minH: 2 },
  "cl-chart-wards": { x: 9, w: 3, h: 3, minW: 3, minH: 2 },
  "cl-chart-dow": { x: 0, w: 12, h: 3, minW: 6, minH: 2 },
};

export const TOP_ROW_CHART_IDS = [
  "cl-chart-categories",
  "cl-list-categories",
  "cl-chart-wards",
];

export const DEFAULT_LAYOUT = [
  { i: "cl-metric-total-registered", x: 0, y: 0, ...DEFAULT_KPI_LAYOUT_ITEM },
  { i: "cl-metric-total-open", x: 2, y: 0, ...DEFAULT_KPI_LAYOUT_ITEM },
  { i: "cl-metric-total-resolved", x: 4, y: 0, ...DEFAULT_KPI_LAYOUT_ITEM },
  { i: "cl-metric-channel-mix", x: 6, y: 0, ...DEFAULT_KPI_LAYOUT_ITEM },
  { i: "cl-metric-new-vs-repeat", x: 8, y: 0, ...DEFAULT_KPI_LAYOUT_ITEM },
  { i: "cl-metric-inflow-rate", x: 10, y: 0, ...DEFAULT_KPI_LAYOUT_ITEM },
  { i: "cl-chart-categories", x: 0, y: 2, ...DEFAULT_CHART_LAYOUT["cl-chart-categories"] },
  { i: "cl-list-categories", x: 6, y: 2, ...DEFAULT_CHART_LAYOUT["cl-list-categories"] },
  { i: "cl-chart-wards", x: 9, y: 2, ...DEFAULT_CHART_LAYOUT["cl-chart-wards"] },
  { i: "cl-chart-dow", x: 0, y: 5, ...DEFAULT_CHART_LAYOUT["cl-chart-dow"] },
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
