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
