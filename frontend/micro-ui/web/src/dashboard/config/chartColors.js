/** Shared data-viz palette — matches the demo pie / channel donut charts. */
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Apex pie chart uses the first four series colors. */
export const PIE_CHART_COLORS = CHART_COLORS.slice(0, 4);

export function getChartColor(index) {
  return CHART_COLORS[((index % CHART_COLORS.length) + CHART_COLORS.length) % CHART_COLORS.length];
}

/** ApexCharts cannot read CSS variables — resolve against .dashboard-root. */
export function resolveDashboardCssColor(colorValue) {
  if (!colorValue || typeof colorValue !== "string") return colorValue;
  const match = colorValue.match(/^var\((--[^)]+)\)$/);
  if (!match || typeof document === "undefined") return colorValue;

  const root = document.querySelector(".dashboard-root");
  if (!root) return colorValue;

  const resolved = getComputedStyle(root).getPropertyValue(match[1]).trim();
  return resolved || colorValue;
}
