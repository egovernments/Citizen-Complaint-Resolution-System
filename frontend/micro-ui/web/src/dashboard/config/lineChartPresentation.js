/**
 * Shared presentation for line charts (viz type: line-chart).
 */

import { resolveDashboardCssColor } from "./chartColors";
import {
  buildWrappedVerticalXAxisLabels,
  resolveVerticalXAxisLabelHeight,
} from "./chartAxisLabels";
import { buildApexSeriesHoverTooltip } from "./chartTooltipPresentation";
import { formatWrappedChartLabel } from "../utils/chartLabelWrap";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "./visualizationStyles";

const LINE_CHART_STYLES = VISUALIZATION_STYLES[VIZ_TYPE.LINE_CHART];

export const LINE_CHART_MAX_SERIES = 4;
export const LINE_CHART_STROKE_WIDTH = 2.5;
export const LINE_CHART_MARKER_SIZE = 3;
export const LINE_CHART_MARKER_STROKE_WIDTH = 1.5;
export const LINE_CHART_ANIMATION_SPEED = 450;
/** Gap between y-axis border and first data point (px in plot space). */
export const LINE_CHART_PLOT_INSET_PX = 18;
export const LINE_CHART_Y_AXIS_LABEL_WIDTH = 48;

export const LINE_CHART_LEGEND = {
  show: true,
  position: "bottom",
  horizontalAlign: "center",
  fontSize: "11px",
  markers: {
    width: 6,
    height: 6,
    radius: 12,
    strokeWidth: 0,
    offsetX: -2,
  },
  itemMargin: { horizontal: 14, vertical: 4 },
  offsetY: 4,
};

export const LINE_CHART_PERIOD_OPTIONS = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

export function normalizeLineChartSeries(series = []) {
  return series.slice(0, LINE_CHART_MAX_SERIES).map((entry, index) => {
    const dashed =
      entry.lineStyle === "dashed" ||
      (entry.dashArray != null && Number(entry.dashArray) > 0);

    return {
      name: String(entry.name ?? `Series ${index + 1}`),
      data: (entry.data ?? []).map((value) => Number(value) || 0),
      color: entry.color,
      dashArray: dashed ? Number(entry.dashArray) || 5 : 0,
    };
  });
}

export function resolveLineChartColors(series) {
  return series.map((entry, index) =>
    resolveDashboardCssColor(entry.color || `var(--chart-${(index % 5) + 1})`)
  );
}

export function buildLineChartStroke(series) {
  return {
    curve: "monotoneCubic",
    width: series.map(() => LINE_CHART_STROKE_WIDTH),
    dashArray: series.map((entry) => entry.dashArray ?? 0),
  };
}

export function buildLineChartMarkers(colors, discrete = []) {
  const surfaceColor =
    resolveDashboardCssColor("var(--surface)") ||
    resolveDashboardCssColor("var(--background)") ||
    "#ffffff";

  return {
    size: LINE_CHART_MARKER_SIZE,
    strokeWidth: LINE_CHART_MARKER_STROKE_WIDTH,
    strokeColors: colors,
    fillColors: colors.map(() => surfaceColor),
    discrete,
    hover: {
      size: LINE_CHART_MARKER_SIZE,
      sizeOffset: 0,
    },
  };
}

export function buildLineChartDiscreteMarkers(dataPointIndex, colors) {
  if (dataPointIndex == null || dataPointIndex < 0) return [];

  return colors.map((color, seriesIndex) => ({
    seriesIndex,
    dataPointIndex,
    fillColor: color,
    strokeColor: color,
    size: LINE_CHART_MARKER_SIZE,
    strokeWidth: LINE_CHART_MARKER_STROKE_WIDTH,
    shape: "circle",
  }));
}

export function getLineChartMarkerSurfaceColor() {
  return (
    resolveDashboardCssColor("var(--surface)") ||
    resolveDashboardCssColor("var(--background)") ||
    "#ffffff"
  );
}

/** Hide marker groups while line paths are animating. */
export function setLineChartMarkersVisible(chartContext, visible) {
  const baseEl = chartContext?.w?.globals?.dom?.baseEl;
  if (!baseEl) return;

  baseEl.querySelectorAll(".apexcharts-series-markers-wrap").forEach((wrap) => {
    if (visible) {
      wrap.classList.remove("apexcharts-element-hidden");
      wrap.classList.add("apexcharts-hidden-element-shown");
      return;
    }

    wrap.classList.add("apexcharts-element-hidden");
    wrap.classList.remove("apexcharts-hidden-element-shown");
  });
}

/** Solid-fill the active x-index markers; keep all others hollow. */
export function applyLineChartMarkerHoverState(
  chartContext,
  dataPointIndex,
  colors,
  surfaceColor
) {
  const baseEl = chartContext?.w?.globals?.dom?.baseEl;
  if (!baseEl) return;

  const markers = baseEl.querySelectorAll(
    ".apexcharts-series-markers .apexcharts-marker"
  );

  markers.forEach((marker) => {
    const rel = Number.parseInt(marker.getAttribute("rel") ?? "", 10);
    const seriesIndex = Number.parseInt(marker.getAttribute("index") ?? "", 10);

    if (
      dataPointIndex >= 0 &&
      rel === dataPointIndex &&
      Number.isFinite(seriesIndex) &&
      colors[seriesIndex]
    ) {
      marker.style.fill = colors[seriesIndex];
      marker.classList.add(LINE_CHART_STYLES.markerActive);
      return;
    }

    marker.style.fill = surfaceColor;
    marker.classList.remove(LINE_CHART_STYLES.markerActive);
  });
}

export function buildLineChartTooltip(categories = []) {
  return buildApexSeriesHoverTooltip({ categories });
}

export function buildLineChartAnimations() {
  return {
    enabled: true,
    easing: "easeinout",
    speed: LINE_CHART_ANIMATION_SPEED,
    animateGradually: { enabled: false },
    dynamicAnimation: {
      enabled: true,
      speed: LINE_CHART_ANIMATION_SPEED,
    },
  };
}

export function resolveLineChartYAxisBounds(series, yAxisConfig = {}) {
  if (yAxisConfig.max != null) {
    return {
      min: yAxisConfig.min ?? 0,
      max: yAxisConfig.max,
      tickAmount: yAxisConfig.tickAmount ?? 4,
    };
  }

  const values = series
    .flatMap((entry) => entry.data)
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return { min: 0, max: 10, tickAmount: 4 };
  }

  const rawMax = Math.max(...values);
  const step = rawMax <= 30 ? 5 : rawMax <= 100 ? 15 : 50;
  const max = Math.ceil((rawMax * 1.05) / step) * step;

  return { min: 0, max: Math.max(step, max), tickAmount: 4 };
}

export function buildLineChartGrid({ bottomPadding = 0 } = {}) {
  const borderColor = resolveDashboardCssColor("var(--border)");

  return {
    show: true,
    borderColor,
    strokeDashArray: 4,
    padding: { left: 0, right: 12, top: 8, bottom: bottomPadding },
    xaxis: { lines: { show: false } },
    yaxis: { lines: { show: true } },
  };
}

export function resolveLineChartXAxisLabelHeight(categories, containerWidth) {
  const gridWidth = estimateLineChartGridWidth(containerWidth);
  const labelSlotWidth =
    categories.length > 1 ? gridWidth / (categories.length - 1) : gridWidth;
  return resolveVerticalXAxisLabelHeight(categories, labelSlotWidth, {
    minHeightPx: 22,
    maxHeightPx: 56,
  });
}

/** Map category series to numeric x/y pairs; x starts at 0 (inset applied via xaxis.min). */
export function buildLineChartSeriesData(series, categoryCount) {
  return series.map((entry) => ({
    name: entry.name,
    data: entry.data.slice(0, categoryCount).map((y, index) => ({
      x: index,
      y,
    })),
  }));
}

export function estimateLineChartGridWidth(containerWidth) {
  return Math.max(100, (containerWidth || 280) - LINE_CHART_Y_AXIS_LABEL_WIDTH);
}

/** Negative min shifts the first point right, clear of y-axis labels. */
export function resolveLineChartNumericXMin(maxX, gridWidth) {
  if (!maxX || !gridWidth || gridWidth <= LINE_CHART_PLOT_INSET_PX) return 0;
  const min = -(LINE_CHART_PLOT_INSET_PX * maxX) / (gridWidth - LINE_CHART_PLOT_INSET_PX);
  return Math.round(min * 1000) / 1000;
}

export function resolveLineChartNumericXBounds(categoryCount, containerWidth) {
  const max = Math.max(categoryCount - 1, 1);
  const gridWidth = estimateLineChartGridWidth(containerWidth);
  const min = resolveLineChartNumericXMin(max, gridWidth);

  return { min, max, tickAmount: max };
}

export function buildLineChartXAxis(categories, containerWidth) {
  const borderColor = resolveDashboardCssColor("var(--border)");
  const { min, max, tickAmount } = resolveLineChartNumericXBounds(
    categories.length,
    containerWidth
  );
  const gridWidth = estimateLineChartGridWidth(containerWidth);
  const labelSlotWidth =
    categories.length > 1 ? gridWidth / (categories.length - 1) : gridWidth;
  const xAxisLabelHeight = resolveVerticalXAxisLabelHeight(categories, labelSlotWidth, {
    minHeightPx: 22,
    maxHeightPx: 56,
  });

  return {
    type: "numeric",
    min,
    max,
    tickAmount,
    decimalsInFloat: 0,
    floating: false,
    labels: {
      ...buildWrappedVerticalXAxisLabels(labelSlotWidth),
      maxHeight: xAxisLabelHeight,
      formatter: (value) => {
        const index = Math.round(Number(value));
        if (index < 0 || index >= categories.length) return "";
        const label = categories[index] ?? "";
        return formatWrappedChartLabel(label, labelSlotWidth);
      },
    },
    axisBorder: { show: true, color: borderColor, height: 1, offsetX: 0, offsetY: 0 },
    axisTicks: { show: true, height: 4, color: borderColor },
    tooltip: { enabled: false },
    crosshairs: {
      show: true,
      position: "front",
      stroke: {
        color: borderColor,
        width: 1,
        dashArray: 0,
      },
    },
  };
}

export function buildLineChartYAxis({ min, max, tickAmount }) {
  const borderColor = resolveDashboardCssColor("var(--border)");

  return {
    min,
    max,
    tickAmount,
    forceNiceScale: false,
    labels: {
      style: { fontSize: "10px" },
      formatter: (value) => Math.round(Number(value)),
    },
    axisBorder: { show: true, color: borderColor, width: 1, offsetX: 0, offsetY: 0 },
    axisTicks: { show: true, width: 4, color: borderColor },
  };
}
