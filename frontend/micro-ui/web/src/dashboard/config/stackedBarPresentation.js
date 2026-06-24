/**
 * Shared presentation for stacked bar charts (vertical + horizontal).
 */

import {
  buildHorizontalBarYAxisItem,
  buildWrappedVerticalXAxisLabels,
  resolveVerticalCategorySlotWidth,
  resolveVerticalXAxisLabelHeight,
} from "./chartAxisLabels";
import { resolveDashboardCssColor } from "./chartColors";
import {
  resolveBarCategorySlotWidth,
  resolveBarChartColumnWidth,
} from "./barChartPresentation";

export const STACKED_BAR_LEGEND = {
  position: "top",
  horizontalAlign: "center",
  fontSize: "11px",
  markers: {
    width: 10,
    height: 10,
    radius: 2,
    strokeWidth: 0,
    offsetX: -2,
  },
  itemMargin: { horizontal: 12, vertical: 0 },
  offsetY: 2,
};

export function buildStackedBarLegend({ horizontal = false } = {}) {
  return {
    ...STACKED_BAR_LEGEND,
    horizontalAlign: horizontal ? "center" : STACKED_BAR_LEGEND.horizontalAlign,
    offsetY: horizontal ? 8 : STACKED_BAR_LEGEND.offsetY,
  };
}

/** Left margin inside the y-axis column before label text begins. */
export const HORIZONTAL_BAR_LABEL_LEFT_MARGIN_PX = 8;
/** Space between y-axis label text end and bar start (horizontal bar + stacked). */
export const HORIZONTAL_BAR_LABEL_GAP_PX = 14;

/** Y-axis label column sizing — minWidth grows to fit longest label line. */
export const HORIZONTAL_BAR_LABEL_LAYOUT = {
  min: 40,
  maxCap: 140,
  ratio: 0.28,
  maxLines: 2,
};

export const HORIZONTAL_BAR_GRID_PADDING = {
  left: 8,
  right: 16,
  top: 0,
  bottom: 4,
};

export const HORIZONTAL_STACKED_BAR_HEIGHT = "82%";

export function buildHorizontalCategoryYAxis(categories, containerWidth) {
  return buildHorizontalBarYAxisItem(categories, containerWidth, {
    labelLayout: HORIZONTAL_BAR_LABEL_LAYOUT,
    labelBarGapPx: HORIZONTAL_BAR_LABEL_GAP_PX,
    labelLeftMarginPx: HORIZONTAL_BAR_LABEL_LEFT_MARGIN_PX,
  });
}

export function buildStackedBarGrid({ horizontal = false, bottomPadding } = {}) {
  return {
    show: false,
    padding: {
      ...HORIZONTAL_BAR_GRID_PADDING,
      top: horizontal ? -6 : HORIZONTAL_BAR_GRID_PADDING.top,
      left: horizontal ? HORIZONTAL_BAR_GRID_PADDING.left : 4,
      right: horizontal ? HORIZONTAL_BAR_GRID_PADDING.right : 4,
      bottom: bottomPadding ?? HORIZONTAL_BAR_GRID_PADDING.bottom,
    },
  };
}

export function buildHorizontalBarGrid({ bottomPadding } = {}) {
  return buildStackedBarGrid({ horizontal: true, bottomPadding });
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

/** Open complaints by subtype — current workflow stage (facts.application_status). */
export const OPEN_COMPLAINT_WORKFLOW_SERIES = [
  {
    key: "PENDINGFORASSIGNMENT",
    label: "Pending assignment",
    color: "var(--chart-1)",
  },
  { key: "PENDINGATLME", label: "Assigned", color: "var(--chart-2)" },
  {
    key: "PENDINGFORREASSIGNMENT",
    label: "Pending reassignment",
    color: "var(--chart-3)",
  },
  {
    key: "PENDINGATSUPERVISOR",
    label: "Pending at supervisor",
    color: "var(--chart-4)",
  },
];

export const OPEN_COMPLAINT_WORKFLOW_STAGE_KEYS = new Set(
  OPEN_COMPLAINT_WORKFLOW_SERIES.map((def) => def.key)
);

/** Resolution dwell by complaint sub-type — workflow stage stack (bottom → top). */
export const RESOLUTION_DWELL_STACKED_SERIES = [
  {
    key: "PENDINGFORASSIGNMENT",
    label: "Pending assignment",
    color: "var(--chart-1)",
  },
  { key: "PENDINGATLME", label: "Assigned", color: "var(--chart-2)" },
  {
    key: "PENDINGFORREASSIGNMENT",
    label: "Pending reassignment",
    color: "var(--chart-3)",
  },
  { key: "RESOLVED", label: "Resolved", color: "var(--status-resolved)" },
];

export function formatStackedBarHours(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (Math.abs(n - Math.round(n)) < 0.05) return `${Math.round(n)}h`;
  return `${n.toFixed(1)}h`;
}

export function buildStackedBarPlotOptions({
  horizontal = false,
  valueFormat,
  containerWidth = 0,
  categoryCount = 0,
} = {}) {
  const totalLabelColor = resolveDashboardCssColor("var(--foreground)");
  const formatTotal =
    valueFormat === "hours"
      ? formatStackedBarHours
      : (value) => {
          const n = Number(value);
          if (!Number.isFinite(n) || n <= 0) return "";
          return String(Math.round(n));
        };

  const slotWidth = horizontal
    ? 0
    : resolveBarCategorySlotWidth(categoryCount, containerWidth);
  const columnWidth = horizontal ? undefined : resolveBarChartColumnWidth(slotWidth);

  return {
    bar: {
      horizontal,
      borderRadius: 4,
      borderRadiusApplication: "end",
      columnWidth,
      barHeight: horizontal ? HORIZONTAL_STACKED_BAR_HEIGHT : undefined,
      dataLabels: {
        total: {
          enabled: true,
          offsetX: horizontal ? 6 : 0,
          offsetY: horizontal ? 0 : -8,
          style: {
            fontSize: "11px",
            fontWeight: 600,
            color: totalLabelColor,
          },
          formatter: formatTotal,
        },
      },
    },
  };
}

export function buildStackedBarDataLabels({ valueFormat } = {}) {
  const formatter =
    valueFormat === "hours"
      ? formatStackedBarHours
      : (value) => {
          const n = Number(value);
          if (!Number.isFinite(n) || n <= 0) return "";
          return String(Math.round(n));
        };

  return {
    enabled: true,
    textAnchor: "middle",
    offsetX: 0,
    offsetY: 0,
    style: {
      fontSize: "11px",
      fontWeight: 600,
      colors: ["#ffffff"],
    },
    background: {
      enabled: false,
    },
    formatter,
  };
}

export function buildStackedBarXAxis({
  horizontal,
  categories,
  containerWidth = 0,
}) {
  if (horizontal) {
    return {
      categories,
      labels: { style: { fontSize: "10px" } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    };
  }

  const slotWidthPx = resolveVerticalCategorySlotWidth(categories.length, containerWidth);
  const labelHeight = resolveVerticalXAxisLabelHeight(categories, slotWidthPx, {
    minHeightPx: 22,
    maxHeightPx: 72,
  });

  return {
    categories,
    labels: {
      ...buildWrappedVerticalXAxisLabels(slotWidthPx),
      maxHeight: labelHeight,
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
  };
}

export function buildStackedBarYAxis({
  horizontal,
  categories = [],
  containerWidth = 0,
  valueFormat,
} = {}) {
  if (horizontal) {
    return buildHorizontalCategoryYAxis(categories, containerWidth);
  }
  return {
    labels: {
      style: { fontSize: "10px" },
      formatter: (val) =>
        valueFormat === "hours" ? formatStackedBarHours(val) : Math.round(val),
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
