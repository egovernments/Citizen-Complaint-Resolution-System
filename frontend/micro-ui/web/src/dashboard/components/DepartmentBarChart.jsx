import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";
import { useChartContainerSize } from "../hooks/useChartContainerSize";
import {
  resolveLabelSlotWidth,
  shouldShowXAxisLabels,
  truncateCategoryLabel,
  Y_AXIS_GUTTER_PX,
} from "../utils/barChartXAxis";

const MAX_BAR_WIDTH_PX = 44;
const SPARSE_CATEGORY_THRESHOLD = 4;
const GROUP_SLOT_WIDTH_PX = 72;
/** Reserved space below the plot for horizontal x-axis labels. */
const XAXIS_LABEL_HEIGHT_PX = 48;
const XAXIS_LABEL_HEIGHT_COMPACT_PX = 26;
const XAXIS_LABEL_HEIGHT_HIDDEN_PX = 4;
const TOOLTIP_OFFSET = 12;
const TOOLTIP_EST_WIDTH = 280;
const TOOLTIP_EST_HEIGHT = 56;

function normalizeChartData(data, categoryOrder) {
  if (!categoryOrder?.length) {
    return (data ?? []).map((d) => ({
      label: String(d.label ?? d.department ?? "Unknown"),
      count: Number(d.count) || 0,
    }));
  }

  const lookup = new Map(
    (data ?? []).map((d) => [String(d.label ?? d.department), Number(d.count) || 0])
  );

  return categoryOrder.map((label) => ({
    label: String(label),
    count: lookup.get(String(label)) ?? 0,
  }));
}

function resolveColumnWidth(slotWidthPx) {
  if (!slotWidthPx) return "65%";
  const pct = Math.round((MAX_BAR_WIDTH_PX / slotWidthPx) * 100);
  return `${Math.min(75, Math.max(pct, 40))}%`;
}

/** Center sparse bar groups by shrinking the plot area with symmetric grid padding. */
function resolveBarGroupLayout(categoryCount, containerWidth, bottomPad) {
  if (!categoryCount || !containerWidth || categoryCount > SPARSE_CATEGORY_THRESHOLD) {
    return {
      gridPadding: { left: 8, right: 4, top: 4, bottom: bottomPad },
      slotWidth: containerWidth / Math.max(categoryCount, 1),
    };
  }

  const groupWidth = categoryCount * GROUP_SLOT_WIDTH_PX;
  const plotArea = Math.max(groupWidth, containerWidth - Y_AXIS_GUTTER_PX);
  const sidePad = Math.max(8, Math.floor((plotArea - groupWidth) / 2));

  return {
    gridPadding: { left: sidePad, right: sidePad, top: 4, bottom: bottomPad },
    slotWidth: GROUP_SLOT_WIDTH_PX,
  };
}

function resolveTooltipPosition(clientX, clientY) {
  const margin = TOOLTIP_OFFSET;
  const maxLeft = window.innerWidth - TOOLTIP_EST_WIDTH - margin;
  const maxTop = window.innerHeight - TOOLTIP_EST_HEIGHT - margin;

  let left = clientX + margin;
  let top = clientY - TOOLTIP_EST_HEIGHT - margin;

  if (left > maxLeft) {
    left = clientX - TOOLTIP_EST_WIDTH - margin;
  }
  if (left < margin) {
    left = margin;
  }
  if (top < margin) {
    top = clientY + margin;
  }
  if (top > maxTop) {
    top = maxTop;
  }

  return { left, top };
}

function ChartTooltipPortal({ tooltip }) {
  if (!tooltip) return null;

  const { left, top } = resolveTooltipPosition(tooltip.x, tooltip.y);

  return createPortal(
    <div
      className="dashboard-chart-tooltip"
      style={{ left: `${left}px`, top: `${top}px` }}
      role="tooltip"
    >
      <p className="dashboard-chart-tooltip-title">{tooltip.label}</p>
      <p className="dashboard-chart-tooltip-value">
        Count: <strong>{tooltip.value}</strong>
      </p>
    </div>,
    document.body
  );
}

const DepartmentBarChart = ({ data, categoryOrder, compact = false }) => {
  const { containerRef, containerSize } = useChartContainerSize();
  const [tooltip, setTooltip] = useState(null);

  const chartData = useMemo(
    () => normalizeChartData(data, categoryOrder),
    [data, categoryOrder]
  );

  const categories = useMemo(() => chartData.map((d) => d.label), [chartData]);
  const series = useMemo(
    () => [{ name: "Count", data: chartData.map((d) => d.count) }],
    [chartData]
  );

  const categoryCount = categories.length;
  const containerWidth = containerSize.width;
  const containerHeight = containerSize.height;

  const labelSlotWidth = useMemo(
    () => resolveLabelSlotWidth(categoryCount, containerWidth),
    [categoryCount, containerWidth]
  );

  const showXAxisLabels = useMemo(
    () => shouldShowXAxisLabels(categories, labelSlotWidth),
    [categories, labelSlotWidth]
  );

  // At small heights the fixed x-axis label reserve and tick count would crush
  // the plot area (squished bars, overlapping y-axis labels). Scale them down so
  // a short chart still renders cleanly — or drop labels entirely when they won't fit.
  const isShort = containerHeight > 0 && containerHeight < 200;
  const xAxisLabelHeight = showXAxisLabels
    ? isShort
      ? XAXIS_LABEL_HEIGHT_COMPACT_PX
      : XAXIS_LABEL_HEIGHT_PX
    : XAXIS_LABEL_HEIGHT_HIDDEN_PX;
  const yTickAmount = isShort ? 3 : compact ? 4 : 5;

  const { gridPadding, slotWidth } = useMemo(
    () => resolveBarGroupLayout(categoryCount, containerWidth, xAxisLabelHeight),
    [categoryCount, containerWidth, xAxisLabelHeight]
  );

  const columnWidth = useMemo(
    () => resolveColumnWidth(slotWidth),
    [slotWidth]
  );

  const handleDataPointEnter = useCallback(
    (event, _chart, { dataPointIndex }) => {
      setTooltip({
        label: categories[dataPointIndex] ?? "Unknown",
        value: chartData[dataPointIndex]?.count ?? 0,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [categories, chartData]
  );

  const handleDataPointLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const options = useMemo(
    () => ({
      chart: {
        type: "bar",
        toolbar: { show: false },
        fontFamily: DASHBOARD_FONT_FAMILY,
        animations: { enabled: true, speed: 300 },
        height: containerHeight,
        events: {
          dataPointMouseEnter: handleDataPointEnter,
          dataPointMouseLeave: handleDataPointLeave,
        },
      },
      plotOptions: {
        bar: {
          borderRadius: 4,
          horizontal: false,
          distributed: false,
          columnWidth,
        },
      },
      dataLabels: { enabled: false },
      xaxis: {
        categories,
        tickPlacement: "on",
        labels: {
          show: showXAxisLabels,
          rotate: 0,
          rotateAlways: false,
          trim: false,
          hideOverlappingLabels: true,
          maxHeight: xAxisLabelHeight,
          offsetY: 2,
          style: { fontSize: "10px" },
          formatter: (value) => truncateCategoryLabel(value, labelSlotWidth),
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          minWidth: 28,
          style: { fontSize: "10px" },
          formatter: (val) => Math.round(val),
        },
        forceNiceScale: true,
        min: 0,
        tickAmount: yTickAmount,
      },
      colors: ["var(--chart-1)"],
      grid: {
        borderColor: "var(--border)",
        strokeDashArray: 3,
        padding: gridPadding,
      },
      tooltip: { enabled: false },
      states: {
        hover: { filter: { type: "darken", value: 0.85 } },
      },
    }),
    [
      categories,
      columnWidth,
      containerHeight,
      gridPadding,
      handleDataPointEnter,
      handleDataPointLeave,
      showXAxisLabels,
      labelSlotWidth,
      xAxisLabelHeight,
      yTickAmount,
    ]
  );

  useEffect(() => () => setTooltip(null), []);

  if (!chartData.length) return null;

  return (
    <>
      <div
        ref={containerRef}
        className="department-bar-chart tw-h-full tw-min-h-0 tw-w-full tw-flex-1 tw-overflow-visible"
      >
        {containerHeight > 0 && containerWidth > 0 ? (
          <Chart
            key={`${containerHeight}-${containerWidth}-${showXAxisLabels}-${categories.join("|")}`}
            options={options}
            series={series}
            type="bar"
            height={containerHeight}
            width="100%"
          />
        ) : null}
      </div>
      <ChartTooltipPortal tooltip={tooltip} />
    </>
  );
};

export const WEEKDAY_CHART_ORDER = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

export default DepartmentBarChart;
