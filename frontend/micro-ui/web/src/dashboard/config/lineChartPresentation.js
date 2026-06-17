/**
 * Shared presentation for line charts (viz type: line-chart).
 */

import { resolveDashboardCssColor } from "./chartColors";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "./visualizationStyles";

const LINE_CHART_STYLES = VISUALIZATION_STYLES[VIZ_TYPE.LINE_CHART];

export const LINE_CHART_MAX_SERIES = 4;
export const LINE_CHART_STROKE_WIDTH = 2.5;
export const LINE_CHART_MARKER_SIZE = 3;
export const LINE_CHART_MARKER_STROKE_WIDTH = 1.5;
export const LINE_CHART_ANIMATION_SPEED = 450;

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
    curve: "smooth",
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

export function buildLineChartTooltip() {
  return {
    enabled: true,
    shared: true,
    intersect: false,
    followCursor: false,
    theme: "light",
    marker: { show: false },
    x: { show: false },
    y: {
      formatter: (value) => Math.round(Number(value)),
      title: { formatter: (name) => `${name} : ` },
    },
    custom: ({ series, dataPointIndex, w }) => {
      if (dataPointIndex < 0) return "";

      const label =
        w.globals.categoryLabels[dataPointIndex] ??
        w.globals.labels[dataPointIndex] ??
        "";
      const names = w.config.series.map((entry) => entry.name);
      const palette = w.globals.colors;

      const rows = series
        .map((values, index) => {
          const value = values[dataPointIndex];
          if (value == null || Number.isNaN(Number(value))) return "";
          const name = names[index] ?? `Series ${index + 1}`;
          const color = palette[index] ?? palette[0];
          return `<div class="${LINE_CHART_STYLES.tooltipRow}" style="color:${color}">${name} : ${Math.round(Number(value))}</div>`;
        })
        .join("");

      return `<div class="${LINE_CHART_STYLES.tooltip}">${
        label
          ? `<div class="${LINE_CHART_STYLES.tooltipTitle}">${label}</div>`
          : ""
      }${rows}</div>`;
    },
  };
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

export function buildLineChartGrid() {
  const borderColor = resolveDashboardCssColor("var(--border)");

  return {
    show: true,
    borderColor,
    strokeDashArray: 4,
    padding: { left: 4, right: 16, top: 8, bottom: 0 },
    xaxis: { lines: { show: false } },
    yaxis: { lines: { show: true } },
  };
}

export function buildLineChartXAxis(categories) {
  const borderColor = resolveDashboardCssColor("var(--border)");

  return {
    categories,
    labels: {
      style: { fontSize: "10px" },
      hideOverlappingLabels: true,
    },
    axisBorder: { show: true, color: borderColor, height: 1, offsetX: 0, offsetY: 0 },
    axisTicks: { show: true, height: 4, color: borderColor },
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
