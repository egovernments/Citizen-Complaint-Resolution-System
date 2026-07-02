/**
 * Mixed bar + line charts (combo) — bars on left axis, % line on right axis.
 */

import { resolveDashboardCssColor } from "./chartColors";
import {
  LINE_CHART_ANIMATION_SPEED,
  LINE_CHART_MARKER_SIZE,
  LINE_CHART_MARKER_STROKE_WIDTH,
  LINE_CHART_STROKE_WIDTH,
  buildLineChartSeriesData,
  buildLineChartTooltip,
} from "./lineChartPresentation";

export function isComboColumnSeries(entry) {
  return entry?.chartType === "column" || entry?.chartType === "bar";
}

export function buildComboChartSeriesData(series, categoryCount) {
  return series.map((entry) => {
    const points = buildLineChartSeriesData([entry], categoryCount)[0]?.data ?? [];
    return {
      name: entry.name,
      type: isComboColumnSeries(entry) ? "column" : "line",
      data: points,
    };
  });
}

export function buildComboChartStroke(series) {
  return {
    curve: "monotoneCubic",
    width: series.map((entry) =>
      isComboColumnSeries(entry) ? 0 : LINE_CHART_STROKE_WIDTH
    ),
    dashArray: series.map((entry) => entry.dashArray ?? 0),
  };
}

export function buildComboChartMarkers(series, colors) {
  const surfaceColor =
    resolveDashboardCssColor("var(--surface)") ||
    resolveDashboardCssColor("var(--background)") ||
    "#ffffff";

  return {
    size: series.map((entry) =>
      isComboColumnSeries(entry) ? 0 : LINE_CHART_MARKER_SIZE
    ),
    strokeWidth: series.map((entry) =>
      isComboColumnSeries(entry) ? 0 : LINE_CHART_MARKER_STROKE_WIDTH
    ),
    strokeColors: colors,
    fillColors: colors.map(() => surfaceColor),
    hover: {
      size: LINE_CHART_MARKER_SIZE,
      sizeOffset: 0,
    },
  };
}

export function buildComboChartPlotOptions(categoryCount) {
  const groupedWidth =
    categoryCount <= 4 ? "42%" : categoryCount <= 8 ? "62%" : "72%";

  return {
    bar: {
      horizontal: false,
      columnWidth: groupedWidth,
      borderRadius: 4,
      borderRadiusApplication: "end",
    },
  };
}

export function buildComboChartYAxis(series, yAxisConfig = {}) {
  const percentNames = series
    .filter((entry) => entry.yAxisGroup === "percent")
    .map((entry) => entry.name);
  const countSeries = series.filter((entry) => entry.yAxisGroup !== "percent");

  const countValues = countSeries
    .flatMap((entry) => entry.data)
    .filter((value) => Number.isFinite(value));
  const rawMax = countValues.length ? Math.max(...countValues) : 10;
  const step = rawMax <= 30 ? 5 : rawMax <= 100 ? 15 : 50;
  const countMax = Math.ceil((rawMax * 1.08) / step) * step;

  const borderColor = resolveDashboardCssColor("var(--border)");

  if (!percentNames.length) {
    return {
      min: yAxisConfig.min ?? 0,
      max: yAxisConfig.max ?? Math.max(step, countMax),
      tickAmount: yAxisConfig.tickAmount ?? 4,
      forceNiceScale: true,
      labels: { style: { fontSize: "10px" }, formatter: (v) => Math.round(v) },
      axisBorder: { show: true, color: borderColor },
      axisTicks: { show: false },
    };
  }

  return [
    {
      min: 0,
      max: Math.max(step, countMax),
      tickAmount: 4,
      forceNiceScale: true,
      seriesName: countSeries.map((entry) => entry.name),
      labels: { style: { fontSize: "10px" }, formatter: (v) => Math.round(v) },
      axisBorder: { show: true, color: borderColor },
      axisTicks: { show: false },
    },
    {
      opposite: true,
      min: 0,
      max: 100,
      tickAmount: 5,
      forceNiceScale: false,
      seriesName: percentNames,
      labels: {
        show: true,
        style: { fontSize: "10px" },
        formatter: (v) => `${Math.round(v)}%`,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
  ];
}

export function buildComboChartAnimations() {
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

export { buildLineChartTooltip as buildComboChartTooltip };
