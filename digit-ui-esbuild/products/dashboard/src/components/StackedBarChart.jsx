import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";
import {
  buildApexSeriesHoverTooltip,
} from "../config/chartTooltipPresentation";
import { BAR_CHART_XAXIS_RESERVED_HEIGHT_PX } from "../config/barChartPresentation";
import {
  buildStackedBarAnnotations,
  buildStackedBarDataLabels,
  buildStackedBarGrid,
  buildStackedBarLegend,
  buildStackedBarPlotOptions,
  buildStackedBarXAxis,
  buildStackedBarYAxis,
  resolveStackedBarColors,
} from "../config/stackedBarPresentation";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import { useScrollableChartSize } from "../hooks/useScrollableChartSize";
import { getNumberFormatStamp } from "../utils/numberFormat";
import ChartScrollViewport from "./ChartScrollViewport";

const StackedBarChart = ({
  categories = [],
  series = [],
  colors = [],
  horizontal = false,
  referenceLines = [],
  scrollKey,
  valueFormat,
}) => {
  // Per-locale numberFormat mask stamp (#1272). The options memo bakes it in
  // (and deps on it) because react-apexcharts compares JSON.stringify(options)
  // — which drops the formatter closures — so a language switch that only
  // changes the mask would otherwise never reach Apex. KpiTile (the parent)
  // subscribes to the locale runtime, so this component re-renders — and
  // re-reads the stamp — after AdminDashboard re-primes the store.
  const numberFormatStamp = getNumberFormatStamp();
  const {
    viewportRef,
    chartSize,
    isScrollable,
    isReady,
    scrollAxis,
  } = useScrollableChartSize({
    scrollKey,
    categoryCount: categories.length,
    scrollAxis: horizontal ? "y" : "x",
  });

  const containerWidth = chartSize.width;
  const containerHeight = chartSize.height;

  const resolvedColors = useMemo(
    () => resolveStackedBarColors(colors),
    [colors]
  );

  const verticalXAxisLabelHeight = horizontal
    ? 4
    : BAR_CHART_XAXIS_RESERVED_HEIGHT_PX;

  const options = useMemo(
    () => ({
      chart: {
        type: "bar",
        stacked: true,
        stackType: "normal",
        toolbar: { show: false },
        fontFamily: DASHBOARD_FONT_FAMILY,
        parentHeightOffset: 0,
      },
      plotOptions: buildStackedBarPlotOptions({
        horizontal,
        valueFormat,
        containerWidth,
        containerHeight,
        categoryCount: categories.length,
      }),
      dataLabels: buildStackedBarDataLabels({ valueFormat, horizontal }),
      xaxis: buildStackedBarXAxis({ horizontal, categories, containerWidth }),
      yaxis: horizontal
        ? [buildStackedBarYAxis({ horizontal, categories, containerWidth, valueFormat })]
        : buildStackedBarYAxis({ horizontal, categories, containerWidth, valueFormat }),
      colors: resolvedColors,
      legend: buildStackedBarLegend({ horizontal }),
      grid: buildStackedBarGrid({
        horizontal,
        bottomPadding: verticalXAxisLabelHeight,
      }),
      annotations: buildStackedBarAnnotations({ horizontal, referenceLines }),
      tooltip: buildApexSeriesHoverTooltip({ includeZero: false, followCursor: true }),
      states: {
        hover: { filter: { type: "darken", value: 0.9 } },
      },
      // Not an Apex option — a stringifiable stamp of the per-locale mask so
      // react-apexcharts' JSON.stringify comparison sees the change and
      // redraws the baked data-label/axis/tooltip formatters.
      _numberFormatStamp: numberFormatStamp,
    }),
    [
      categories,
      containerWidth,
      containerHeight,
      horizontal,
      referenceLines,
      resolvedColors,
      verticalXAxisLabelHeight,
      valueFormat,
      numberFormatStamp,
    ]
  );

  const chartClass = VISUALIZATION_STYLES[VIZ_TYPE.STACKED_BAR].container;
  const horizontalClass = horizontal ? "dashboard-stacked-bar--horizontal" : "";
  const chartClassName = `${chartClass} ${horizontalClass}`.trim();
  const hasData =
    categories.length > 0 &&
    series.some((entry) => entry.data?.some((value) => Number(value) > 0));

  if (!hasData) return null;

  return (
    <ChartScrollViewport
      viewportRef={viewportRef}
      chartSize={chartSize}
      isScrollable={isScrollable}
      chartClassName={chartClassName}
      scrollAxis={scrollAxis}
    >
      {isReady ? (
        <Chart
          key={`${horizontal}-${containerHeight}-${containerWidth}-${categories.join("|")}`}
          options={options}
          series={series}
          type="bar"
          height={containerHeight}
          width={horizontal ? "100%" : containerWidth}
        />
      ) : null}
    </ChartScrollViewport>
  );
};

export default StackedBarChart;
