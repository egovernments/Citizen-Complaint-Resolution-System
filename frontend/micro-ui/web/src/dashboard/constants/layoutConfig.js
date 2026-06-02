import { KPI_INVENTORY } from "../data/dummyData";

export const LAYOUT_STORAGE_KEY = "bomet-crs-dashboard-layout-admin";

const kpiWidgets = Object.fromEntries(
  KPI_INVENTORY.map((k) => [k.id, { type: "kpi", label: k.label }])
);

export const WIDGETS = {
  ...kpiWidgets,
  "chart-departments": { type: "bar-chart", label: "Department-wise Complaints" },
  "chart-trend": { type: "line-chart", label: "Complaints Filed vs Resolved" },
};

export const DEFAULT_KPI_IDS = [
  "kpi-total",
  "kpi-resolved",
  "kpi-pending",
  "kpi-escalated",
  "kpi-avg-time",
];

export const DEFAULT_LAYOUT = [
  { i: "kpi-total", x: 0, y: 0, w: 2, h: 2, minW: 2, minH: 2 },
  { i: "kpi-resolved", x: 2, y: 0, w: 2, h: 2, minW: 2, minH: 2 },
  { i: "kpi-pending", x: 4, y: 0, w: 2, h: 2, minW: 2, minH: 2 },
  { i: "kpi-escalated", x: 6, y: 0, w: 2, h: 2, minW: 2, minH: 2 },
  { i: "kpi-avg-time", x: 8, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
  { i: "chart-departments", x: 0, y: 2, w: 6, h: 5, minW: 4, minH: 4 },
  { i: "chart-trend", x: 0, y: 7, w: 12, h: 5, minW: 6, minH: 4 },
];

export const DEFAULT_KPI_LAYOUT_ITEM = {
  w: 2,
  h: 2,
  minW: 2,
  minH: 2,
};

export const DROPPING_ITEM_ID = "__dropping-kpi__";

export const DROPPING_ITEM = {
  i: DROPPING_ITEM_ID,
  ...DEFAULT_KPI_LAYOUT_ITEM,
};

export function isKpiWidget(widgetId) {
  return WIDGETS[widgetId]?.type === "kpi";
}
