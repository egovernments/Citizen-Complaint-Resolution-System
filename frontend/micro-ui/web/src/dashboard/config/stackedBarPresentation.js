/**
 * Shared presentation for stacked bar charts (vertical + horizontal).
 */

import { resolveDashboardCssColor } from "./chartColors";

export const STACKED_BAR_LEGEND = {
  position: "top",
  horizontalAlign: "left",
  fontSize: "11px",
  markers: {
    width: 10,
    height: 10,
    radius: 2,
    strokeWidth: 0,
    offsetX: -2,
  },
  itemMargin: { horizontal: 12, vertical: 0 },
  offsetY: 0,
};

export function buildStackedBarGrid({ horizontal = false } = {}) {
  return {
    show: false,
    padding: {
      left: 4,
      right: horizontal ? 28 : 4,
      top: 4,
      bottom: 4,
    },
  };
}

export function resolveStackedBarColors(colorTokens) {
  return colorTokens.map((token) => resolveDashboardCssColor(token));
}

/** SLA bucket series — matches horizontal stacked bar reference palette. */
export const SLA_STACKED_SERIES = [
  { key: "within", label: "On track", color: "var(--chart-1)" },
  { key: "approaching", label: "Nearing breach", color: "var(--chart-2)" },
  { key: "breached", label: "Breached", color: "var(--status-breach)" },
];

/** Status mix per week — top workflow states. */
export const STATUS_STACKED_SERIES = [
  { key: "RESOLVED", label: "Resolved", color: "var(--status-resolved)" },
  { key: "OPEN", label: "Open", color: "var(--chart-1)" },
  { key: "INPROGRESS", label: "In progress", color: "var(--chart-2)" },
  { key: "ESCALATED", label: "Escalated", color: "var(--chart-3)" },
];

export function buildStackedBarPlotOptions({ horizontal = false } = {}) {
  return {
    bar: {
      horizontal,
      borderRadius: 4,
      borderRadiusApplication: "end",
      columnWidth: horizontal ? undefined : "55%",
      barHeight: horizontal ? "68%" : undefined,
      dataLabels: {
        total: {
          enabled: horizontal,
          offsetX: 6,
          style: {
            fontSize: "11px",
            fontWeight: 600,
          },
        },
      },
    },
  };
}

export function buildStackedBarXAxis({ horizontal, categories }) {
  if (horizontal) {
    return {
      categories,
      labels: {
        style: { fontSize: "10px" },
        maxWidth: 140,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    };
  }
  return {
    categories,
    labels: {
      style: { fontSize: "10px" },
      rotate: 0,
      hideOverlappingLabels: true,
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
  };
}

export function buildStackedBarYAxis({ horizontal }) {
  if (horizontal) {
    return {
      labels: {
        style: { fontSize: "10px" },
        formatter: (val) => Math.round(val),
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
      min: 0,
      forceNiceScale: true,
    };
  }
  return {
    labels: {
      style: { fontSize: "10px" },
      formatter: (val) => Math.round(val),
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
    min: 0,
    forceNiceScale: true,
  };
}

/** Dotted reference lines — vertical on horizontal bars, horizontal on vertical bars. */
export function buildStackedBarAnnotations({ horizontal, referenceLines = [] } = {}) {
  if (!referenceLines.length) return {};

  const borderColor = resolveDashboardCssColor("var(--border)");

  const lineStyle = (line) => ({
    strokeDashArray: 4,
    borderColor: line.color ? resolveDashboardCssColor(line.color) : borderColor,
    borderWidth: 1,
    opacity: 0.85,
    label: {
      show: false,
    },
  });

  if (horizontal) {
    return {
      xaxis: referenceLines.map((line) => ({
        x: line.value,
        ...lineStyle(line),
      })),
    };
  }

  return {
    yaxis: referenceLines.map((line) => ({
      y: line.value,
      ...lineStyle(line),
    })),
  };
}
