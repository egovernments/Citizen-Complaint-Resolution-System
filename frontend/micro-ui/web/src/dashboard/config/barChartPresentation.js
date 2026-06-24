/**
 * Shared presentation for vertical bar charts (viz type: bar-chart).
 * Used by all normal bar chart widgets — live data and demo.
 */

import { resolveDashboardCssColor } from "./chartColors";

export const BAR_CHART_SERIES_COLOR = "var(--chart-1)";
export const BAR_CHART_DATA_LABEL_COLOR = "var(--foreground)";

export function getBarChartSeriesColor() {
  return resolveDashboardCssColor(BAR_CHART_SERIES_COLOR);
}

export function getBarChartDataLabelColor() {
  return resolveDashboardCssColor(BAR_CHART_DATA_LABEL_COLOR);
}

/** Space reserved below plot for x-axis category labels (inside the chart). */
export const BAR_CHART_XAXIS_LABEL_HEIGHT_PX = 22;
export const BAR_CHART_XAXIS_LABEL_HEIGHT_COMPACT_PX = 18;
/** Fixed bottom reserve for normal vertical bar charts (2 wrapped label lines). */
export const BAR_CHART_XAXIS_RESERVED_HEIGHT_PX = 28;
/** Room above the plot for value labels on bar tops (pairs with data label offsetY). */
export const BAR_CHART_GRID_TOP_PAD = 8;
export const BAR_CHART_DATA_LABEL_OFFSET_Y = -20;
/** Bar thickness as a fraction of each category slot — same on every vertical bar chart. */
export const BAR_COLUMN_WIDTH_RATIO = 0.88;
export const BAR_COLUMN_MAX_WIDTH_PX = 56;
export const BAR_COLUMN_MIN_WIDTH_PERCENT = 70;
export const BAR_COLUMN_MAX_WIDTH_PERCENT = 92;
export const BAR_CHART_GRID_GUTTER_PX = 4;
/** Minimum y-axis headroom (data units) above the tallest bar for value labels. */
export const BAR_CHART_YAXIS_MIN_HEADROOM = 1;
/** Extra headroom as a fraction of peak value (kept small to avoid a large top gap). */
export const BAR_CHART_YAXIS_HEADROOM_RATIO = 0.02;

export function resolveBarChartYAxisMax(seriesMax, { percent = false } = {}) {
  const peak = Math.max(Number(seriesMax) || 0, 0);
  if (peak === 0) return percent ? 10 : 1;

  const headroom = Math.max(
    BAR_CHART_YAXIS_MIN_HEADROOM,
    Math.ceil(peak * BAR_CHART_YAXIS_HEADROOM_RATIO)
  );

  const axisMax = peak + headroom;
  return percent ? Math.ceil(axisMax * 10) / 10 : axisMax;
}

export function resolveBarChartColumnWidth(slotWidthPx) {
  if (!slotWidthPx || slotWidthPx <= 0) {
    return `${Math.round(BAR_COLUMN_WIDTH_RATIO * 100)}%`;
  }

  const preferredPct = BAR_COLUMN_WIDTH_RATIO * 100;
  const maxPctFromPx = (BAR_COLUMN_MAX_WIDTH_PX / slotWidthPx) * 100;
  const boundedPct = Math.min(
    BAR_COLUMN_MAX_WIDTH_PERCENT,
    Math.max(
      BAR_COLUMN_MIN_WIDTH_PERCENT,
      Math.min(preferredPct, maxPctFromPx)
    )
  );
  return `${Math.round(boundedPct)}%`;
}

export function resolveBarCategorySlotWidth(categoryCount, containerWidth) {
  if (!categoryCount || !containerWidth) return 0;
  return Math.max(0, containerWidth - BAR_CHART_GRID_GUTTER_PX) / categoryCount;
}

/** Bars fill the plot edge-to-edge; no side centering or fixed plot width. */
export function resolveBarGroupLayout(categoryCount, containerWidth, bottomPad) {
  return {
    gridPadding: { left: 2, right: 2, top: 0, bottom: bottomPad },
    slotWidth: resolveBarCategorySlotWidth(categoryCount, containerWidth),
  };
}

export function buildBarChartGrid(padding) {
  return {
    show: false,
    padding: {
      ...padding,
      top: Math.max(padding?.top ?? 0, BAR_CHART_GRID_TOP_PAD),
    },
  };
}

export function buildBarChartYAxis({ tickAmount = 5, seriesMax = 0, percent = false } = {}) {
  return {
    labels: { show: false },
    axisBorder: { show: false },
    axisTicks: { show: false },
    forceNiceScale: false,
    min: 0,
    max: resolveBarChartYAxisMax(seriesMax, { percent }),
    tickAmount,
  };
}

export function formatBarChartPercentOneDecimal(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 10) / 10;
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${formatted}%`;
}

export function buildBarChartDataLabels({ valueFormat } = {}) {
  const color = getBarChartDataLabelColor();
  const formatter =
    valueFormat === "percent"
      ? (val) => formatBarChartPercentOneDecimal(val)
      : (val) => (Number.isFinite(Number(val)) ? String(Math.round(Number(val))) : "");

  return {
    enabled: true,
    // Apex anchors column labels at the bar top; negative offset lifts them above the fill.
    offsetY: BAR_CHART_DATA_LABEL_OFFSET_Y,
    style: {
      fontSize: "11px",
      fontWeight: 600,
      colors: [color],
    },
    formatter,
  };
}

/** Apex bar plotOptions fragment — labels sit on top of each bar, outside the fill. */
export function buildBarChartPlotDataLabels() {
  return {
    position: "top",
    hideOverflowingLabels: false,
  };
}

export function buildBarChartLegend() {
  return { show: false };
}
