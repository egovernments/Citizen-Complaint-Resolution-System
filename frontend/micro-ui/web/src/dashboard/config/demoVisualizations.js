/**
 * Visualization catalog — demo widgets with static sample data.
 * Each entry maps to a widget type in the design system reference.
 */

export const DEMO_VIZ_WIDGETS = [
  {
    id: "demo-viz-stacked",
    type: "stacked-bar",
    stackOrientation: "vertical",
    metric: "Status mix per week",
    subMetric: "Complaint composition by week",
    outputFormat: "Stacked bar: status mix over time",
  },
  {
    id: "demo-viz-stacked-horizontal",
    type: "stacked-bar",
    stackOrientation: "horizontal",
    metric: "Team load by SLA",
    subMetric: "All complaints by SLA state",
    outputFormat: "Horizontal stacked bar: officer × SLA bucket",
  },
  {
    id: "demo-viz-leaderboard",
    type: "horizontal-bar",
    metric: "Flow ratio by department",
    subMetric: "resolved \u00f7 created",
    outputFormat: "Horizontal bar: ratio with break-even marker",
  },
  {
    id: "demo-viz-line",
    type: "line-chart",
    metric: "Complaints logged over time",
    outputFormat: "Logged vs resolved with daily / weekly / monthly toggle",
    customChrome: true,
  },
  {
    id: "demo-viz-pie",
    type: "pie-chart",
    metric: "Complaints by channel",
    outputFormat: "Donut with in-slice counts and outer labels",
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
    metric: "On-time resolution",
    outputFormat: "Performance vs 90% goal",
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
  "demo-viz-stacked": {
    categories: ["W1", "W2", "W3", "W4"],
    series: [
      { name: "Resolved", data: [30, 35, 28, 40] },
      { name: "Open", data: [22, 18, 25, 20] },
      { name: "In progress", data: [14, 16, 12, 15] },
      { name: "Escalated", data: [8, 6, 10, 7] },
    ],
    colors: [
      "var(--status-resolved)",
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
    ],
  },
  "demo-viz-stacked-horizontal": {
    categories: [
      "Baljeet Kaur",
      "Ramesh Kumar",
      "Pritam Singh",
      "Mohan Lal",
      "Surinder Pal",
      "Gurmeet Singh",
    ],
    series: [
      { name: "Resolved", data: [3, 2, 2, 1, 3, 1] },
      { name: "On track", data: [4, 3, 3, 3, 4, 2] },
      { name: "Nearing breach", data: [2, 2, 2, 1, 2, 2] },
      { name: "Breached", data: [2, 1, 1, 1, 2, 1] },
    ],
    colors: [
      "var(--status-resolved)",
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--status-breach)",
    ],
    horizontal: true,
    referenceLines: [{ value: 8.3 }],
  },
  "demo-viz-leaderboard": {
    breakEven: 1,
    data: [
      { label: "Public Works", value: 0.14, resolved: 1, created: 7 },
      { label: "Sanitation", value: 0.21, resolved: 2, created: 10 },
      { label: "Electrical", value: 0.29, resolved: 2, created: 7 },
      { label: "Sewerage", value: 0.29, resolved: 2, created: 7 },
      { label: "Water Supply", value: 1.08, resolved: 14, created: 13 },
      { label: "Town Planning", value: 1.17, resolved: 7, created: 6 },
      { label: "Veterinary", value: 1.0, resolved: 3, created: 3 },
    ],
  },
  "demo-viz-line": {
    title: "Complaints logged over time",
    defaultPeriod: "daily",
    periods: {
      daily: {
        categories: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        yAxis: { min: 0, max: 60, tickAmount: 4 },
        series: [
          {
            name: "Logged",
            data: [38, 45, 38, 48, 59, 44, 21],
            color: "var(--chart-1)",
          },
          {
            name: "Resolved",
            data: [31, 38, 34, 40, 49, 46, 24],
            color: "var(--chart-2)",
          },
        ],
      },
      weekly: {
        categories: ["W1", "W2", "W3", "W4"],
        series: [
          {
            name: "Logged",
            data: [248, 272, 255, 231],
            color: "var(--chart-1)",
          },
          {
            name: "Resolved",
            data: [228, 258, 249, 238],
            color: "var(--chart-2)",
          },
        ],
      },
      monthly: {
        categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
        series: [
          {
            name: "Logged",
            data: [980, 1045, 1012, 1095, 1128, 1064],
            color: "var(--chart-1)",
          },
          {
            name: "Resolved",
            data: [945, 1010, 998, 1068, 1102, 1040],
            color: "var(--chart-2)",
          },
        ],
      },
    },
  },
  "demo-viz-pie": [
    { label: "Mobile App", count: 12, color: "var(--chart-1)" },
    { label: "Web", count: 12, color: "var(--chart-2)" },
    { label: "Call", count: 12, color: "var(--chart-3)" },
    { label: "Counter", count: 12, color: "var(--chart-4)" },
    { label: "WhatsApp", count: 12, color: "var(--chart-5)" },
  ],
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
 *   - sparkline KPI tiles need ~4 rows (live KPI cards with vizType number-tile-sparkline)
 *   - apex/SVG charts need ~4 rows of height to keep a usable plot area
 *   - charts with long axis labels (leaderboard) or inline controls
 *     (sla-toggle header) need at least 4 columns of width
 */
export const DEMO_VIZ_LAYOUT_DEFAULTS = {
  "demo-viz-gauge": { x: 0, w: 3, h: 2, minW: 3, minH: 2, maxW: 6, maxH: 2 },
  "demo-viz-pie": { x: 8, w: 4, h: 5, minW: 3, minH: 4, maxW: 6, maxH: 8 },
  "demo-viz-stacked": { x: 0, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "demo-viz-stacked-horizontal": { x: 6, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "demo-viz-leaderboard": { x: 8, w: 4, h: 6, minW: 4, minH: 4, maxW: 8, maxH: 10 },
  "demo-viz-line": { x: 0, w: 4, h: 6, minW: 3, minH: 4, maxW: 8, maxH: 10 },
  "demo-viz-histogram": { x: 6, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "demo-viz-sla-toggle": { x: 0, w: 4, h: 4, minW: 4, minH: 3, maxW: 6, maxH: 8 },
  "demo-viz-sla-risk": { x: 0, w: 12, h: 5, minW: 6, minH: 4, maxW: 12, maxH: 14 },
  "demo-viz-map": { x: 0, w: 7, h: 7, minW: 4, minH: 5, maxW: 12, maxH: 14 },
};

const DEMO_ROWS = [
  ["demo-viz-gauge", "demo-viz-pie"],
  ["demo-viz-sla-toggle", "demo-viz-leaderboard"],
  ["demo-viz-line"],
  ["demo-viz-stacked", "demo-viz-stacked-horizontal"],
  ["demo-viz-histogram"],
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
