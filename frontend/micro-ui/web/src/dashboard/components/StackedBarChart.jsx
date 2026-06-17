import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";
import {
  buildStackedBarAnnotations,
  buildStackedBarGrid,
  buildStackedBarPlotOptions,
  buildStackedBarXAxis,
  buildStackedBarYAxis,
  resolveStackedBarColors,
  STACKED_BAR_LEGEND,
} from "../config/stackedBarPresentation";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import { useChartContainerSize } from "../hooks/useChartContainerSize";

const StackedBarChart = ({
  categories = [],
  series = [],
  colors = [],
  horizontal = false,
  referenceLines = [],
}) => {
  const { containerRef, containerSize } = useChartContainerSize();
  const { width: containerWidth, height: containerHeight } = containerSize;

  const resolvedColors = useMemo(
    () => resolveStackedBarColors(colors),
    [colors]
  );

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
      dataLabels: { enabled: false },
      xaxis: buildStackedBarXAxis({ horizontal, categories }),
      yaxis: buildStackedBarYAxis({ horizontal }),
      colors: resolvedColors,
      legend: STACKED_BAR_LEGEND,
      grid: buildStackedBarGrid({ horizontal }),
      annotations: buildStackedBarAnnotations({ horizontal, referenceLines }),
      tooltip: { theme: "light" },
      states: {
        hover: { filter: { type: "darken", value: 0.9 } },
      },
    }),
    [categories, horizontal, referenceLines, resolvedColors]
  );

  const chartClass = VISUALIZATION_STYLES[VIZ_TYPE.STACKED_BAR].container;
  const hasData =
    categories.length > 0 &&
    series.some((entry) => entry.data?.some((value) => Number(value) > 0));

  if (!hasData) return null;

  return (
    <div
      ref={containerRef}
      className={`${chartClass} tw-h-full tw-min-h-0 tw-w-full tw-flex-1 tw-overflow-visible`}
    >
      {containerHeight > 0 && containerWidth > 0 ? (
        <Chart
          key={`${horizontal}-${containerHeight}-${containerWidth}-${categories.join("|")}`}
          options={options}
          series={series}
          type="bar"
          height={containerHeight}
          width="100%"
        />
      ) : null}
    </div>
  );
};

export default StackedBarChart;
