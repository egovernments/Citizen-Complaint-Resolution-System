import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";
import {
  buildComboChartAnimations,
  buildComboChartMarkers,
  buildComboChartPlotOptions,
  buildComboChartSeriesData,
  buildComboChartStroke,
  buildComboChartTooltip,
  buildComboChartYAxis,
} from "../config/comboChartPresentation";
import {
  buildLineChartGrid,
  buildLineChartXAxis,
  normalizeLineChartSeries,
  resolveLineChartColors,
  resolveLineChartXAxisLabelHeight,
} from "../config/lineChartPresentation";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import { useChartContainerSize } from "../hooks/useChartContainerSize";

const ComboChart = ({ categories = [], series: seriesProp = [], yAxis }) => {
  const { containerRef, containerSize } = useChartContainerSize();
  const { width: containerWidth, height: containerHeight } = containerSize;

  const normalizedSeries = useMemo(
    () => normalizeLineChartSeries(seriesProp),
    [seriesProp]
  );

  const chartSeries = useMemo(
    () => buildComboChartSeriesData(normalizedSeries, categories.length),
    [categories.length, normalizedSeries]
  );

  const colors = useMemo(
    () => resolveLineChartColors(normalizedSeries),
    [normalizedSeries]
  );

  const xAxisLabelHeight = useMemo(
    () => resolveLineChartXAxisLabelHeight(categories, containerWidth),
    [categories, containerWidth]
  );

  const options = useMemo(
    () => ({
      chart: {
        type: "line",
        stacked: false,
        toolbar: { show: false },
        fontFamily: DASHBOARD_FONT_FAMILY,
        zoom: { enabled: false },
        parentHeightOffset: 0,
        animations: buildComboChartAnimations(),
      },
      plotOptions: buildComboChartPlotOptions(categories.length),
      stroke: buildComboChartStroke(normalizedSeries),
      markers: buildComboChartMarkers(normalizedSeries, colors),
      xaxis: buildLineChartXAxis(categories, containerWidth),
      yaxis: buildComboChartYAxis(normalizedSeries, yAxis),
      colors,
      legend: {
        show: true,
        position: "bottom",
        horizontalAlign: "center",
        fontSize: "11px",
        markers: {
          width: 10,
          height: 10,
          radius: 2,
          strokeWidth: 0,
          offsetX: -2,
        },
        itemMargin: { horizontal: 14, vertical: 4 },
        offsetY: 4,
      },
      grid: buildLineChartGrid({ bottomPadding: xAxisLabelHeight }),
      tooltip: buildComboChartTooltip(categories, normalizedSeries),
      states: {
        hover: { filter: { type: "lighten", value: 0.04 } },
        active: { filter: { type: "none" } },
      },
    }),
    [categories, colors, containerWidth, normalizedSeries, xAxisLabelHeight, yAxis]
  );

  const lineStyles = VISUALIZATION_STYLES[VIZ_TYPE.LINE_CHART];
  const hasChartStructure = categories.length > 0 && normalizedSeries.length > 0;

  if (!hasChartStructure) return null;

  return (
    <div
      ref={containerRef}
      className={`${lineStyles.container} tw-h-full tw-min-h-0 tw-w-full tw-flex-1 tw-overflow-visible`}
    >
      {containerHeight > 0 && containerWidth > 0 ? (
        <Chart
          key={`${containerHeight}-${containerWidth}`}
          options={options}
          series={chartSeries}
          type="line"
          height={containerHeight}
          width="100%"
        />
      ) : null}
    </div>
  );
};

export default ComboChart;
