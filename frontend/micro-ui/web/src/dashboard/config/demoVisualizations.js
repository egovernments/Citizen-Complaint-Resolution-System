/**
 * Visualization catalog — demo widgets with static sample data.
 * Each entry maps to a widget type in the design system reference.
 */

export const DEMO_VIZ_WIDGETS = [
  {
    id: "demo-viz-number",
    type: "number-tile",
    metric: "Number tile",
    subMetric: "Single big number — open complaints",
    outputFormat: "47 open complaints",
  },
  {
    id: "demo-viz-sparkline",
    type: "number-tile-sparkline",
    metric: "Number tile + delta + sparkline",
    subMetric: "Supervisor glanceable KPI",
    outputFormat: "WoW arrow and trend line",
  },
  {
    id: "demo-viz-bar",
    type: "bar-chart",
    metric: "Bar chart",
    subMetric: "Top complaint categories",
    outputFormat: "Comparing values across categories",
  },
  {
    id: "demo-viz-leaderboard",
    type: "horizontal-bar",
    metric: "Horizontal bar / leaderboard",
    subMetric: "Officer closure ranking",
    outputFormat: "Top officers by closures",
  },
  {
    id: "demo-viz-line",
    type: "line-chart",
    metric: "Line chart",
    subMetric: "Daily complaint inflow",
    outputFormat: "Trend over time",
  },
  {
    id: "demo-viz-pie",
    type: "pie-chart",
    metric: "Complaints by channel",
    outputFormat: "Donut with channel legend",
  },
  {
    id: "demo-viz-sla-toggle",
    type: "sla-toggle",
    metric: "Complaints by SLA",
    subMetric: "Table and bar views",
    outputFormat: "Within, breaching, and breached buckets",
    customChrome: true,
  },
  {
    id: "demo-viz-stacked",
    type: "stacked-bar",
    metric: "Stacked bar",
    subMetric: "Status mix per week",
    outputFormat: "Composition over time",
  },
  {
    id: "demo-viz-map",
    type: "map",
    metric: "Map",
    subMetric: "Complaints by ward / hot zones",
    outputFormat: "Geographic distribution",
  },
  {
    id: "demo-viz-sla-risk",
    type: "sla-risk-table",
    metric: "SLA at risk — next 24 hours",
    subMetric: "Breaching complaints with actions",
    outputFormat: "Interactive status and resolve links",
    customChrome: true,
  },
  {
    id: "demo-viz-histogram",
    type: "histogram",
    metric: "Distribution / histogram",
    subMetric: "Complaint aging buckets",
    outputFormat: "0–3d, 3–7d, 7–14d, 14+d",
  },
  {
    id: "demo-viz-gauge",
    type: "gauge",
    metric: "Gauge / progress bar",
    subMetric: "SLA compliance vs 90% goal",
    outputFormat: "Performance vs target",
  },
];

export const DEMO_VIZ_IDS = new Set(DEMO_VIZ_WIDGETS.map((w) => w.id));

export function isDemoVizWidget(widgetId) {
  return DEMO_VIZ_IDS.has(widgetId);
}

export function isDemoTableWidget(widgetId) {
  return widgetId === "demo-viz-sla-risk";
}

export function hasCustomChrome(widgetId) {
  const widget = DEMO_VIZ_WIDGETS.find((w) => w.id === widgetId);
  return Boolean(widget?.customChrome);
}

export const DEMO_VIZ_DATA = {
  "demo-viz-number": {
    value: "47",
    label: "Open complaints",
    context: "As of today",
  },
  "demo-viz-sparkline": {
    value: "47",
    label: "Open complaints",
    delta: 12.4,
    deltaLabel: "WoW",
    sparkline: [32, 35, 38, 41, 39, 44, 47],
  },
  "demo-viz-bar": [
    { label: "Pothole", count: 42 },
    { label: "Water leak", count: 31 },
    { label: "Street light", count: 24 },
    { label: "Waste", count: 18 },
    { label: "Drainage", count: 14 },
  ],
  "demo-viz-leaderboard": [
    { label: "Officer A. Kimani", count: 38 },
    { label: "Officer B. Wanjiru", count: 31 },
    { label: "Officer C. Ochieng", count: 27 },
    { label: "Officer D. Mutua", count: 22 },
    { label: "Officer E. Njeri", count: 19 },
  ],
  "demo-viz-line": {
    categories: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    series: [{ name: "Filed", data: [12, 15, 11, 18, 14, 8, 6] }],
  },
  "demo-viz-pie": [
    { label: "Mobile App", count: 12, color: "var(--chart-1)" },
    { label: "Web", count: 12, color: "var(--chart-2)" },
    { label: "Call", count: 12, color: "var(--chart-3)" },
    { label: "Counter", count: 12, color: "var(--chart-4)" },
    { label: "WhatsApp", count: 12, color: "var(--chart-5)" },
  ],
  "demo-viz-stacked": {
    categories: ["W1", "W2", "W3", "W4"],
    series: [
      { name: "Open", data: [22, 18, 25, 20] },
      { name: "In progress", data: [14, 16, 12, 15] },
      { name: "Resolved", data: [30, 35, 28, 40] },
    ],
  },
  "demo-viz-map": [
    { lat: -0.7833, lng: 35.3416, count: 12, serviceCode: "Pothole", status: "OPEN" },
    { lat: -0.791, lng: 35.35, count: 8, serviceCode: "Water leak", status: "INPROGRESS" },
    { lat: -0.776, lng: 35.33, count: 5, serviceCode: "Street light", status: "OPEN" },
    { lat: -0.788, lng: 35.36, count: 3, serviceCode: "Waste", status: "OPEN" },
    { lat: -0.779, lng: 35.345, count: 6, serviceCode: "Drainage", status: "ESCALATED" },
  ],
  "demo-viz-histogram": [
    { label: "0–3 days", count: 52 },
    { label: "3–7 days", count: 34 },
    { label: "7–14 days", count: 18 },
    { label: "14+ days", count: 9 },
  ],
  "demo-viz-gauge": {
    value: 84,
    target: 90,
    label: "On-time resolution",
  },
};

/**
 * Layout defaults and size constraints per demo widget.
 *
 * Grid math: row height is 52px with a 16px vertical margin, so an item that is
 * `h` rows tall is `68 * h - 16` px. A standard widget (drag-handle header +
 * p-4 body) spends roughly 84px on chrome, so usable content height is about
 * `68 * h - 100` px. The minimums below are chosen so each visualization always
 * has enough room to render without the chart collapsing, axes overlapping, or
 * content overflowing:
 *   - text/number tiles need ~3 rows
 *   - apex/SVG charts need ~4 rows of height to keep a usable plot area
 *   - charts with long axis labels (leaderboard) or inline controls
 *     (sla-toggle header) need at least 4 columns of width
 */
export const DEMO_VIZ_LAYOUT_DEFAULTS = {
  "demo-viz-number": { x: 0, w: 2, h: 3, minW: 2, minH: 3, maxW: 4, maxH: 4 },
  "demo-viz-sparkline": { x: 2, w: 3, h: 4, minW: 3, minH: 4, maxW: 6, maxH: 6 },
  "demo-viz-gauge": { x: 5, w: 3, h: 4, minW: 3, minH: 4, maxW: 6, maxH: 6 },
  "demo-viz-pie": { x: 8, w: 4, h: 5, minW: 3, minH: 4, maxW: 6, maxH: 8 },
  "demo-viz-bar": { x: 4, w: 4, h: 6, minW: 3, minH: 4, maxW: 8, maxH: 10 },
  "demo-viz-leaderboard": { x: 8, w: 4, h: 6, minW: 4, minH: 4, maxW: 8, maxH: 10 },
  "demo-viz-line": { x: 0, w: 4, h: 6, minW: 3, minH: 4, maxW: 8, maxH: 10 },
  "demo-viz-stacked": { x: 0, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "demo-viz-histogram": { x: 6, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "demo-viz-sla-toggle": { x: 0, w: 4, h: 5, minW: 4, minH: 4, maxW: 6, maxH: 8 },
  "demo-viz-sla-risk": { x: 0, w: 12, h: 8, minW: 6, minH: 6, maxW: 12, maxH: 14 },
  "demo-viz-map": { x: 0, w: 7, h: 7, minW: 4, minH: 5, maxW: 12, maxH: 14 },
};

const DEMO_ROWS = [
  ["demo-viz-number", "demo-viz-sparkline", "demo-viz-gauge", "demo-viz-pie"],
  ["demo-viz-sla-toggle", "demo-viz-bar", "demo-viz-leaderboard"],
  ["demo-viz-line"],
  ["demo-viz-stacked", "demo-viz-histogram"],
  ["demo-viz-sla-risk"],
  ["demo-viz-map"],
];

let demoY = 28;
export const DEMO_VIZ_DEFAULT_LAYOUT = DEMO_ROWS.flatMap((row) => {
  const items = row.map((id) => {
    const defaults = DEMO_VIZ_LAYOUT_DEFAULTS[id];
    return {
      w: defaults.w,
      h: defaults.h,
      x: defaults.x,
      y: demoY,
      i: id,
      minW: defaults.minW,
      minH: defaults.minH,
      maxW: defaults.maxW,
      maxH: defaults.maxH,
      moved: false,
      static: false,
      resizeHandles: ["se"],
    };
  });
  const rowHeight = Math.max(...row.map((id) => DEMO_VIZ_LAYOUT_DEFAULTS[id].h));
  demoY += rowHeight;
  return items;
});
