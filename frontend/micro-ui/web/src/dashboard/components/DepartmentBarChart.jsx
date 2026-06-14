import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";

const MAX_BAR_WIDTH_PX = 44;
const SPARSE_CATEGORY_THRESHOLD = 4;
const GROUP_SLOT_WIDTH_PX = 72;
const Y_AXIS_GUTTER_PX = 40;
/** Reserved space below the plot for horizontal x-axis labels. */
const XAXIS_LABEL_HEIGHT_PX = 48;
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
function resolveBarGroupLayout(categoryCount, containerWidth) {
  const bottomPad = XAXIS_LABEL_HEIGHT_PX;

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

function truncateCategoryLabel(label, slotWidthPx) {
  const text = String(label ?? "").trim() || "—";
  const maxChars = Math.max(8, Math.floor(slotWidthPx / 5.5));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(maxChars - 1, 3))}…`;
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
  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
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

  const { gridPadding, slotWidth } = useMemo(
    () => resolveBarGroupLayout(categoryCount, containerWidth),
    [categoryCount, containerWidth]
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
          show: true,
          rotate: 0,
          rotateAlways: false,
          trim: false,
          hideOverlappingLabels: false,
          maxHeight: XAXIS_LABEL_HEIGHT_PX,
          offsetY: 2,
          style: { fontSize: "10px" },
          formatter: (value) => truncateCategoryLabel(value, slotWidth),
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
        tickAmount: compact ? 4 : 5,
      },
      colors: ["var(--brand-teal, #0d9488)"],
      grid: {
        borderColor: "#e2e8f0",
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
      compact,
      containerHeight,
      gridPadding,
      handleDataPointEnter,
      handleDataPointLeave,
      slotWidth,
    ]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const updateSize = () => {
      const { width, height } = el.getBoundingClientRect();
      setContainerSize({
        width: Math.floor(width),
        height: Math.floor(height),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
            key={`${containerHeight}-${containerWidth}-${categories.join("|")}`}
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
