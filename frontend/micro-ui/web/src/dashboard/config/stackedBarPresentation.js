/**
 * Shared presentation for stacked bar charts (vertical + horizontal).
 */

import {
  buildHorizontalBarYAxisItem,
  buildWrappedVerticalXAxisLabels,
} from "./chartAxisLabels";
import { resolveDashboardCssColor } from "./chartColors";
import {
  BAR_CHART_XAXIS_RESERVED_HEIGHT_PX,
  buildBarChartGrid,
  resolveBarCategorySlotWidth,
  resolveBarChartColumnWidth,
} from "./barChartPresentation";
import { CHART_AXIS_WRAPPED_LABEL_MAX_LINES } from "../utils/chartLabelWrap";

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
    offsetY: horizontal ? 8 : 6,
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
  maxLines: CHART_AXIS_WRAPPED_LABEL_MAX_LINES,
};

export const HORIZONTAL_BAR_GRID_PADDING = {
  left: 8,
  right: 16,
  top: 0,
  bottom: 4,
};

/** Thinner bars leave more vertical room between category rows. */
export const HORIZONTAL_STACKED_BAR_HEIGHT = "62%";

export function buildHorizontalCategoryYAxis(categories, containerWidth) {
  return buildHorizontalBarYAxisItem(categories, containerWidth, {
    labelLayout: HORIZONTAL_BAR_LABEL_LAYOUT,
    labelBarGapPx: HORIZONTAL_BAR_LABEL_GAP_PX,
    labelLeftMarginPx: HORIZONTAL_BAR_LABEL_LEFT_MARGIN_PX,
  });
}

export function buildStackedBarGrid({ horizontal = false, bottomPadding } = {}) {
  if (!horizontal) {
    return buildBarChartGrid({
      left: 2,
      right: 2,
      top: 0,
      bottom: bottomPadding ?? BAR_CHART_XAXIS_RESERVED_HEIGHT_PX,
    });
  }

  return {
    show: false,
    padding: {
      ...HORIZONTAL_BAR_GRID_PADDING,
      top: -6,
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

const STACKED_BAR_LABEL_CHAR_WIDTH_PX = 7;
const STACKED_BAR_LABEL_HEIGHT_PX = 14;
const STACKED_BAR_LABEL_PADDING_PX = 4;
/** Extra vertical room — Apex centers with +height/2, which clips the bottom of glyphs. */
const STACKED_BAR_LABEL_VERTICAL_INSET_PX = 8;
const STACKED_BAR_SEGMENT_LABEL_OFFSET_Y = 7;

function formatStackedBarSegmentValue(value, valueFormat) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return valueFormat === "hours" ? formatStackedBarHours(n) : String(Math.round(n));
}

function readStackTotal(opts) {
  const idx = opts.dataPointIndex;
  const series = opts.w?.config?.series ?? [];
  return series.reduce((sum, entry) => sum + (Number(entry.data?.[idx]) || 0), 0);
}

function labelBoxForText(text) {
  return {
    width: text.length * STACKED_BAR_LABEL_CHAR_WIDTH_PX + STACKED_BAR_LABEL_PADDING_PX,
    height: STACKED_BAR_LABEL_HEIGHT_PX + STACKED_BAR_LABEL_PADDING_PX,
  };
}

/** Hide segment labels that cannot fit — show full value or nothing. */
export function shouldShowStackedSegmentLabel(value, opts, { horizontal, valueFormat } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return false;

  const text = formatStackedBarSegmentValue(n, valueFormat);
  if (!text) return false;

  const stackTotal = readStackTotal(opts);
  if (stackTotal <= 0) return false;

  const { width: labelW, height: labelH } = labelBoxForText(text);
  const globals = opts.w?.globals ?? {};
  const idx = opts.dataPointIndex;

  if (horizontal) {
    const niceMax = Number(globals.xAxisScale?.niceMax);
    const gridWidth = Number(globals.gridWidth) || 0;
    const barH = Number(globals.barHeight?.[idx]) || 0;
    if (niceMax > 0 && gridWidth > 0 && barH > 0) {
      const segmentW = (n / niceMax) * gridWidth;
      return segmentW >= labelW && barH >= labelH;
    }
    return n / stackTotal >= 0.14;
  }

  const barH = Number(globals.barHeight?.[idx]) || 0;
  if (barH > 0) {
    const segmentH = (n / stackTotal) * barH;
    const categories = Math.max(1, globals.labels?.length ?? 1);
    const barW =
      Number(globals.barWidth?.[idx]) ||
      (Number(globals.gridWidth) || 0) / categories;
    const minSegmentH = labelH + STACKED_BAR_LABEL_VERTICAL_INSET_PX * 2;
    return segmentH >= minSegmentH && barW >= labelW;
  }

  return n / stackTotal >= 0.11;
}

function shouldShowStackedTotalLabel(total, opts, { horizontal, valueFormat } = {}) {
  const n = Number(total);
  if (!Number.isFinite(n) || n <= 0) return false;

  const text = formatStackedBarSegmentValue(n, valueFormat);
  if (!text) return false;

  const { width: labelW, height: labelH } = labelBoxForText(text);
  const globals = opts.w?.globals ?? {};
  const idx = opts.dataPointIndex;

  if (horizontal) {
    const niceMax = Number(globals.xAxisScale?.niceMax);
    const gridWidth = Number(globals.gridWidth) || 0;
    const barH = Number(globals.barHeight?.[idx]) || 0;
    if (niceMax > 0 && gridWidth > 0 && barH > 0) {
      const barW = (n / niceMax) * gridWidth;
      const roomAfterBar = Math.max(0, gridWidth - barW - 6);
      return roomAfterBar >= labelW && barH >= labelH;
    }
    return true;
  }

  const niceMax = Number(globals.yAxisScale?.[0]?.niceMax ?? globals.maxY);
  const gridHeight = Number(globals.gridHeight) || 0;
  const barH = Number(globals.barHeight?.[idx]) || 0;
  if (niceMax > 0 && gridHeight > 0 && barH > 0) {
    const headroom = gridHeight - (n / niceMax) * gridHeight;
    return headroom >= labelH + 8;
  }

  return true;
}

export function buildStackedBarPlotOptions({
  horizontal = false,
  valueFormat,
  containerWidth = 0,
  categoryCount = 0,
} = {}) {
  const totalLabelColor = resolveDashboardCssColor("var(--foreground)");
  const formatTotal = (value, opts) => {
    if (
      opts &&
      !shouldShowStackedTotalLabel(value, opts, { horizontal, valueFormat })
    ) {
      return "";
    }
    return formatStackedBarSegmentValue(value, valueFormat);
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
        hideOverflowingLabels: true,
        position: "center",
        orientation: "horizontal",
        total: {
          enabled: true,
          hideOverflowingLabels: true,
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

export function buildStackedBarDataLabels({ valueFormat, horizontal = false } = {}) {
  return {
    enabled: true,
    hideOverflowingLabels: true,
    textAnchor: "middle",
    offsetX: 0,
    offsetY: horizontal ? 0 : STACKED_BAR_SEGMENT_LABEL_OFFSET_Y,
    style: {
      fontSize: "11px",
      fontWeight: 600,
      colors: ["#ffffff"],
    },
    background: {
      enabled: false,
    },
    formatter(value, opts) {
      if (!shouldShowStackedSegmentLabel(value, opts, { horizontal, valueFormat })) {
        return "";
      }
      return formatStackedBarSegmentValue(value, valueFormat);
    },
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

  const slotWidthPx = resolveBarCategorySlotWidth(categories.length, containerWidth);
  const labelHeight = BAR_CHART_XAXIS_RESERVED_HEIGHT_PX;

  return {
    categories,
    labels: {
      ...buildWrappedVerticalXAxisLabels(slotWidthPx, { maxLines: 2 }),
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
