import React, { useCallback, useEffect, useMemo, useState } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";
import { useChartContainerSize } from "../hooks/useChartContainerSize";
import {
  BAR_CHART_XAXIS_LABEL_HEIGHT_COMPACT_PX,
  BAR_CHART_XAXIS_LABEL_HEIGHT_PX,
  buildBarChartDataLabels,
  buildBarChartGrid,
  buildBarChartLegend,
  buildBarChartPlotDataLabels,
  buildBarChartYAxis,
  getBarChartSeriesColor,
} from "../config/barChartPresentation";
import { SHARED_CHROME, VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import {
  resolveLabelSlotWidth,
  truncateCategoryLabel,
  Y_AXIS_GUTTER_PX,
} from "../utils/barChartXAxis";
import ChartTooltipPortal from "./ChartTooltipPortal";

const MAX_BAR_WIDTH_PX = 44;
const SPARSE_CATEGORY_THRESHOLD = 4;
const GROUP_SLOT_WIDTH_PX = 72;

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

/** Center sparse bar groups on narrow cards; scale slots when the card is wider. */
function resolveBarGroupLayout(categoryCount, containerWidth, bottomPad) {
  if (!categoryCount || !containerWidth) {
    return {
      gridPadding: { left: 2, right: 2, top: 0, bottom: bottomPad },
      slotWidth: 0,
    };
  }

  const evenSlotWidth = containerWidth / categoryCount;

  if (categoryCount > SPARSE_CATEGORY_THRESHOLD || evenSlotWidth > GROUP_SLOT_WIDTH_PX) {
    return {
      gridPadding: { left: 2, right: 2, top: 0, bottom: bottomPad },
      slotWidth: evenSlotWidth,
    };
  }

  const groupWidth = categoryCount * GROUP_SLOT_WIDTH_PX;
  const plotArea = Math.max(groupWidth, containerWidth - Y_AXIS_GUTTER_PX);
  const sidePad = Math.max(4, Math.floor((plotArea - groupWidth) / 2));

  return {
    gridPadding: { left: sidePad, right: sidePad, top: 0, bottom: bottomPad },
    slotWidth: GROUP_SLOT_WIDTH_PX,
  };
}

const DepartmentBarChart = ({ data, categoryOrder, compact = false, colors: colorsProp }) => {
  const { containerRef, containerSize } = useChartContainerSize();
  const [tooltip, setTooltip] = useState(null);
  const distributed = Boolean(colorsProp?.length);

  const chartData = useMemo(
    () => normalizeChartData(data, categoryOrder),
    [data, categoryOrder]
  );

  const categories = useMemo(() => chartData.map((d) => d.label), [chartData]);
  const series = useMemo(
    () => [{ name: "Count", data: chartData.map((d) => d.count) }],
    [chartData]
  );

  const seriesMax = useMemo(
    () => chartData.reduce((max, d) => Math.max(max, d.count), 0),
    [chartData]
  );

  const categoryCount = categories.length;
  const containerWidth = containerSize.width;
  const containerHeight = containerSize.height;

  const labelSlotWidth = useMemo(
    () => resolveLabelSlotWidth(categoryCount, containerWidth),
    [categoryCount, containerWidth]
  );

  // At small heights the fixed x-axis label reserve and tick count would crush
  // the plot area (squished bars). Scale label reserve down; labels always show
  // (truncated when slots are narrow).
  const isShort = containerHeight > 0 && containerHeight < 200;
  const xAxisLabelHeight = isShort
    ? BAR_CHART_XAXIS_LABEL_HEIGHT_COMPACT_PX
    : BAR_CHART_XAXIS_LABEL_HEIGHT_PX;
  const yTickAmount = isShort ? 3 : compact ? 4 : 5;

  const { gridPadding, slotWidth } = useMemo(
    () => resolveBarGroupLayout(categoryCount, containerWidth, xAxisLabelHeight),
    [categoryCount, containerWidth, xAxisLabelHeight]
  );

  const columnWidth = useMemo(
    () => resolveColumnWidth(slotWidth),
    [slotWidth]
  );

  const colors = useMemo(
    () => (distributed ? colorsProp : [getBarChartSeriesColor()]),
    [colorsProp, distributed]
  );

  const handleDataPointEnter = useCallback(
    (event, _chart, { dataPointIndex }) => {
      if (dataPointIndex < 0) return;

      setTooltip({
        label: categories[dataPointIndex] ?? "Unknown",
        value: chartData[dataPointIndex]?.count ?? 0,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [categories, chartData]
  );

  const handleChartMouseMove = useCallback((event) => {
    setTooltip((prev) => {
      if (!prev) return null;
      return { ...prev, x: event.clientX, y: event.clientY };
    });
  }, []);

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
        parentHeightOffset: 0,
        events: {
          dataPointMouseEnter: handleDataPointEnter,
          mouseMove: handleChartMouseMove,
          mouseLeave: handleDataPointLeave,
          dataPointMouseLeave: handleDataPointLeave,
        },
      },
      plotOptions: {
        bar: {
          borderRadius: 4,
          horizontal: false,
          distributed,
          columnWidth,
          dataLabels: buildBarChartPlotDataLabels(),
        },
      },
      dataLabels: buildBarChartDataLabels(),
      legend: buildBarChartLegend(),
      xaxis: {
        categories,
        tickPlacement: "on",
        labels: {
          show: true,
          rotate: 0,
          rotateAlways: false,
          trim: false,
          hideOverlappingLabels: false,
          maxHeight: xAxisLabelHeight,
          offsetY: 0,
          style: { fontSize: "10px" },
          formatter: (value) => truncateCategoryLabel(value, labelSlotWidth),
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: buildBarChartYAxis({ tickAmount: yTickAmount, seriesMax }),
      colors,
      grid: buildBarChartGrid(gridPadding),
      tooltip: { enabled: false },
      states: {
        hover: { filter: { type: "darken", value: 0.85 } },
      },
    }),
    [
      categories,
      columnWidth,
      colors,
      containerHeight,
      gridPadding,
      handleChartMouseMove,
      handleDataPointEnter,
      handleDataPointLeave,
      labelSlotWidth,
      xAxisLabelHeight,
      yTickAmount,
      seriesMax,
    ]
  );

  useEffect(() => () => setTooltip(null), []);

  if (!chartData.length) return null;

  const barChartClass = VISUALIZATION_STYLES[VIZ_TYPE.BAR_CHART].container;

  return (
    <>
      <div
        ref={containerRef}
        className={`${barChartClass} tw-h-full tw-min-h-0 tw-w-full tw-flex-1 tw-overflow-visible`}
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
      <ChartTooltipPortal tooltip={tooltip}>
        <div className={SHARED_CHROME.chartTooltipTitle}>{tooltip?.label}</div>
        <div className={SHARED_CHROME.chartTooltipRow}>Count : {tooltip?.value}</div>
      </ChartTooltipPortal>
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
