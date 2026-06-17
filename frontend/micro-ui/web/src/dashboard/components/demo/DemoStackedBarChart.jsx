import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../../config/dashboardConfig";
import { useChartContainerSize } from "../../hooks/useChartContainerSize";
import { getChartColor } from "../../config/chartColors";
import { buildXAxisLabelOptions } from "../../utils/barChartXAxis";

const DemoStackedBarChart = ({ categories = [], series = [] }) => {
  const { containerRef, containerSize } = useChartContainerSize();
  const { width: containerWidth, height: containerHeight } = containerSize;

  const stackedColors = useMemo(
    () => [getChartColor(3), getChartColor(1), getChartColor(2)],
    []
  );

  const xAxisLabels = useMemo(
    () => buildXAxisLabelOptions(categories, containerWidth),
    [categories, containerWidth]
  );

  const options = useMemo(
    () => ({
      chart: {
        type: "bar",
        stacked: true,
        toolbar: { show: false },
        fontFamily: DASHBOARD_FONT_FAMILY,
      },
      plotOptions: {
        bar: {
          borderRadius: 2,
          columnWidth: "55%",
        },
      },
      xaxis: {
        categories,
        labels: xAxisLabels,
      },
      yaxis: {
        labels: { style: { fontSize: "10px" } },
      },
      colors: stackedColors,
      legend: {
        position: "top",
        horizontalAlign: "right",
        fontSize: "11px",
      },
      grid: { borderColor: "var(--border)" },
      tooltip: { theme: "light" },
    }),
    [categories, stackedColors, xAxisLabels]
  );

  return (
    <div ref={containerRef} className="tw-h-full tw-min-h-0 tw-w-full">
      {containerHeight > 0 && containerWidth > 0 ? (
        <Chart
          key={`${containerWidth}-${xAxisLabels.show}-${categories.join("|")}`}
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

export default DemoStackedBarChart;
