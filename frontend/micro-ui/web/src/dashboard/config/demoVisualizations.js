/**
 * Demo visualization kept for the default-layout team SLA stacked bar.
 * Live widgets replace all other former demo charts.
 */

export const DEMO_VIZ_WIDGETS = [
  {
    id: "demo-viz-stacked-horizontal",
    type: "stacked-bar",
    stackOrientation: "horizontal",
    metric: "Team load by SLA",
    subMetric: "All complaints by SLA state",
    outputFormat: "Horizontal stacked bar: officer × SLA bucket",
  },
];

export const DEMO_VIZ_IDS = new Set(DEMO_VIZ_WIDGETS.map((w) => w.id));

export function isDemoVizWidget(widgetId) {
  return DEMO_VIZ_IDS.has(widgetId);
}

export function isDemoTableWidget() {
  return false;
}

export function hasCustomChrome(widgetId) {
  return false;
}

export const DEMO_VIZ_DATA = {
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
};

export const DEMO_VIZ_LAYOUT_DEFAULTS = {
  "demo-viz-stacked-horizontal": {
    x: 6,
    w: 6,
    h: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 10,
  },
};

export const DEMO_VIZ_DEFAULT_LAYOUT = [];
