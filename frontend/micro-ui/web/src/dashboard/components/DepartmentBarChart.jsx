import React, { useCallback, useEffect, useMemo, useState } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";
import { useChartContainerSize } from "../hooks/useChartContainerSize";
import { useScrollableChartSize } from "../hooks/useScrollableChartSize";
import {
  buildBarChartDataLabels,
  buildBarChartGrid,
  buildBarChartLegend,
  buildBarChartPlotDataLabels,
  buildBarChartYAxis,
  formatBarChartPercentOneDecimal,
  getBarChartSeriesColor,
  BAR_CHART_XAXIS_RESERVED_HEIGHT_PX,
  resolveBarChartColumnWidth,
  resolveBarGroupLayout,
} from "../config/barChartPresentation";
import { SHARED_CHROME, VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import {
  buildWrappedVerticalXAxisLabels,
} from "../config/chartAxisLabels";
import { resolveLabelSlotWidth } from "../utils/barChartXAxis";
import ChartTooltipPortal from "./ChartTooltipPortal";
import ChartScrollViewport from "./ChartScrollViewport";

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

const DepartmentBarChart = ({
  data,
  categoryOrder,
  colors: colorsProp,
  scrollKey,
  histogram = false,
  valueFormat = "count",
}) => {
  const isPercent = valueFormat === "percent";
  const {
    containerRef: histogramContainerRef,
    containerSize: histogramContainerSize,
  } = useChartContainerSize();
  const effectiveScrollKey = histogram ? undefined : scrollKey;
  const [tooltip, setTooltip] = useState(null);
  const distributed = Boolean(colorsProp?.length);

  const chartData = useMemo(
    () => normalizeChartData(data, categoryOrder),
    [data, categoryOrder]
  );

  const { viewportRef, chartSize, isScrollable, isReady, scrollAxis } = useScrollableChartSize({
    scrollKey: effectiveScrollKey,
    categoryCount: histogram ? 0 : chartData.length,
    scrollAxis: histogram ? "xy" : "x",
  });

  const categories = useMemo(() => chartData.map((d) => d.label), [chartData]);
  const series = useMemo(
    () => [{ name: isPercent ? "Resolution rate" : "Count", data: chartData.map((d) => d.count) }],
    [chartData, isPercent]
  );

  const seriesMax = useMemo(
    () => chartData.reduce((max, d) => Math.max(max, d.count), 0),
    [chartData]
  );

  const categoryCount = categories.length;
  const containerWidth = histogram ? histogramContainerSize.width : chartSize.width;
  const containerHeight = histogram ? histogramContainerSize.height : chartSize.height;

  const labelSlotWidth = useMemo(
    () => resolveLabelSlotWidth(categoryCount, containerWidth),
    [categoryCount, containerWidth]
  );

  const isShort = containerHeight > 0 && containerHeight < 200;

  const xAxisLabelHeight = histogram
    ? isShort
      ? 26
      : 30
    : BAR_CHART_XAXIS_RESERVED_HEIGHT_PX;

  const yTickAmount = isShort ? 4 : 5;

  const { gridPadding, slotWidth } = useMemo(
    () => resolveBarGroupLayout(categoryCount, containerWidth, xAxisLabelHeight),
    [categoryCount, containerWidth, xAxisLabelHeight]
  );

  const columnWidth = useMemo(() => {
    if (histogram) return "74%";
    return resolveBarChartColumnWidth(slotWidth);
  }, [histogram, slotWidth]);

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
      dataLabels: buildBarChartDataLabels({ valueFormat }),
      legend: buildBarChartLegend(),
      xaxis: {
        categories,
        tickPlacement: histogram ? "between" : "on",
        labels: {
          ...buildWrappedVerticalXAxisLabels(labelSlotWidth, {
            maxLines: histogram ? 1 : 2,
          }),
          maxHeight: xAxisLabelHeight,
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: buildBarChartYAxis({
        tickAmount: yTickAmount,
        seriesMax,
        percent: isPercent,
      }),
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
      yTickAmount,
      seriesMax,
      histogram,
      isPercent,
    ]
  );

  useEffect(() => () => setTooltip(null), []);

  if (!chartData.length) return null;

  const barChartClass = VISUALIZATION_STYLES[VIZ_TYPE.BAR_CHART].container;

  return (
    <>
      {histogram ? (
        <div
          ref={histogramContainerRef}
          className={`${barChartClass} tw-h-full tw-min-h-0 tw-w-full tw-flex-1`}
        >
          {containerHeight > 0 && containerWidth > 0 ? (
            <Chart
              key={`hist-${containerHeight}-${containerWidth}-${categories.join("|")}`}
              options={options}
              series={series}
              type="bar"
              height={containerHeight}
              width="100%"
            />
          ) : null}
        </div>
      ) : (
        <ChartScrollViewport
          viewportRef={viewportRef}
          chartSize={chartSize}
          isScrollable={isScrollable}
          scrollAxis={scrollAxis}
          chartClassName={barChartClass}
        >
          {isReady ? (
            <Chart
              key={`${containerHeight}-${containerWidth}-${categories.join("|")}`}
              options={options}
              series={series}
              type="bar"
              height={containerHeight}
              width={containerWidth}
            />
          ) : null}
        </ChartScrollViewport>
      )}
      <ChartTooltipPortal tooltip={tooltip}>
        <div className={SHARED_CHROME.chartTooltipTitle}>{tooltip?.label}</div>
        <div className={SHARED_CHROME.chartTooltipRow}>
          {isPercent ? "Resolution rate" : "Count"} :{" "}
          {isPercent
            ? formatBarChartPercentOneDecimal(tooltip?.value)
            : tooltip?.value}
        </div>
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
