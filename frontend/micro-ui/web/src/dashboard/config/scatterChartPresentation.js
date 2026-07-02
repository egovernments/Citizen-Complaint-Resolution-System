/**
 * Scatter plot presentation — department breach rate vs caseload.
 */

import { resolveDashboardCssColor } from "./chartColors";
import {
  buildApexChartTooltipOptions,
  buildChartTooltipMarkup,
} from "./chartTooltipPresentation";

export const SCATTER_POINT_SIZE = 8;

export function resolveScatterChartColor(index = 0) {
  return resolveDashboardCssColor(`var(--chart-${(index % 5) + 1})`);
}

export function buildScatterChartSeries(points) {
  return [
    {
      name: "Departments",
      data: (points || []).map((point) => ({
        x: Number(point.x) || 0,
        y: Number(point.y) || 0,
        label: point.label ?? "Unknown",
      })),
    },
  ];
}

export function resolveScatterAxisMax(values, { step = 5, padRatio = 0.12, floor = 10 } = {}) {
  const nums = (values || []).filter((value) => Number.isFinite(value));
  if (!nums.length) return floor;
  const rawMax = Math.max(...nums);
  const padded = rawMax * (1 + padRatio);
  return Math.max(step, Math.ceil(padded / step) * step);
}

export function buildScatterChartTooltip() {
  return buildApexChartTooltipOptions({
    custom({ seriesIndex, dataPointIndex, w }) {
      const point = w?.config?.series?.[seriesIndex]?.data?.[dataPointIndex];
      if (!point) return "";

      const caseload = Math.round(Number(point.x) || 0);
      const breachRate = Number(point.y);
      const breachLabel = Number.isFinite(breachRate)
        ? `${(Math.round(breachRate * 10) / 10).toFixed(1)}%`
        : "—";

      return buildChartTooltipMarkup({
        title: point.label || "Department",
        rows: [
          { label: "Caseload", value: String(caseload) },
          { label: "Breach rate", value: breachLabel },
        ],
      });
    },
  });
}

export function buildScatterChartOptions({
  points = [],
  xAxisLabel = "Caseload (open)",
  yAxisLabel = "Breach rate (%)",
} = {}) {
  const borderColor = resolveDashboardCssColor("var(--border)");
  const mutedColor = resolveDashboardCssColor("var(--muted-foreground)");
  const xMax = resolveScatterAxisMax(points.map((point) => point.x));

  return {
    chart: {
      type: "scatter",
      toolbar: { show: false },
      zoom: { enabled: false },
      parentHeightOffset: 0,
    },
    grid: {
      show: true,
      borderColor,
      strokeDashArray: 4,
      padding: { left: 8, right: 16, top: 8, bottom: 4 },
      xaxis: { lines: { show: true } },
      yaxis: { lines: { show: true } },
    },
    markers: {
      size: SCATTER_POINT_SIZE,
      strokeWidth: 1.5,
      strokeColors: points.map((_, index) => resolveScatterChartColor(index)),
      hover: { sizeOffset: 2 },
    },
    xaxis: {
      min: 0,
      max: xMax,
      tickAmount: 5,
      title: {
        text: xAxisLabel,
        style: { fontSize: "11px", fontWeight: 500, color: mutedColor },
        offsetY: 4,
      },
      labels: {
        style: { fontSize: "10px", colors: mutedColor },
        formatter: (value) => Math.round(Number(value) || 0),
      },
      axisBorder: { show: true, color: borderColor },
      axisTicks: { show: false },
    },
    yaxis: {
      min: 0,
      max: 100,
      tickAmount: 5,
      title: {
        text: yAxisLabel,
        style: { fontSize: "11px", fontWeight: 500, color: mutedColor },
      },
      labels: {
        style: { fontSize: "10px", colors: mutedColor },
        formatter: (value) => `${Math.round(Number(value) || 0)}%`,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    legend: { show: false },
    tooltip: buildScatterChartTooltip(),
    states: {
      hover: { filter: { type: "lighten", value: 0.08 } },
      active: { filter: { type: "none" } },
    },
  };
}
