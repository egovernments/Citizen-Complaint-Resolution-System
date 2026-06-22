import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";
import {
  resolveVerticalCategorySlotWidth,
  resolveVerticalXAxisLabelHeight,
} from "../config/chartAxisLabels";
import {
  buildApexSeriesHoverTooltip,
} from "../config/chartTooltipPresentation";
import {
  buildStackedBarAnnotations,
  buildStackedBarDataLabels,
  buildStackedBarGrid,
  buildStackedBarPlotOptions,
  buildStackedBarXAxis,
  buildStackedBarYAxis,
  resolveStackedBarColors,
  STACKED_BAR_LEGEND,
} from "../config/stackedBarPresentation";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import { useScrollableChartSize } from "../hooks/useScrollableChartSize";
import ChartScrollViewport from "./ChartScrollViewport";

const StackedBarChart = ({
  categories = [],
  series = [],
  colors = [],
  horizontal = false,
  referenceLines = [],
  scrollKey,
}) => {
  const {
    viewportRef,
    chartSize,
    isScrollable,
    isReady,
    scrollAxis,
  } = useScrollableChartSize({
    scrollKey,
    categoryCount: categories.length,
    scrollAxis: horizontal ? "y" : "xy",
  });

  const containerWidth = chartSize.width;
  const containerHeight = chartSize.height;

  const resolvedColors = useMemo(
    () => resolveStackedBarColors(colors),
    [colors]
  );

  const verticalXAxisLabelHeight = useMemo(() => {
    if (horizontal) return 4;
    const slotWidthPx = resolveVerticalCategorySlotWidth(categories.length, containerWidth);
    return resolveVerticalXAxisLabelHeight(categories, slotWidthPx, {
      minHeightPx: 22,
      maxHeightPx: 72,
    });
  }, [categories, containerWidth, horizontal]);

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
      plotOptions: buildStackedBarPlotOptions({ horizontal }),
      dataLabels: buildStackedBarDataLabels(),
      xaxis: buildStackedBarXAxis({ horizontal, categories, containerWidth }),
      yaxis: horizontal
        ? [buildStackedBarYAxis({ horizontal, categories, containerWidth })]
        : buildStackedBarYAxis({ horizontal, categories, containerWidth }),
      colors: resolvedColors,
      legend: STACKED_BAR_LEGEND,
      grid: buildStackedBarGrid({
        horizontal,
        bottomPadding: verticalXAxisLabelHeight,
      }),
      annotations: buildStackedBarAnnotations({ horizontal, referenceLines }),
      tooltip: buildApexSeriesHoverTooltip({ includeZero: false, followCursor: true }),
      states: {
        hover: { filter: { type: "darken", value: 0.9 } },
      },
    }),
    [
      categories,
      containerWidth,
      horizontal,
      referenceLines,
      resolvedColors,
      verticalXAxisLabelHeight,
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
