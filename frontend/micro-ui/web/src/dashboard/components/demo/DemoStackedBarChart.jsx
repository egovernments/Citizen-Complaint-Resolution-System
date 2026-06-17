import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../../config/dashboardConfig";

import { getChartColor } from "../../config/chartColors";

const DemoStackedBarChart = ({ categories = [], series = [] }) => {
  const stackedColors = useMemo(
    () => [getChartColor(3), getChartColor(1), getChartColor(2)],
    []
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
        labels: { style: { fontSize: "10px" } },
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
    [categories, stackedColors]
  );

  return (
    <div className="tw-h-full tw-min-h-0 tw-w-full">
      <Chart options={options} series={series} type="bar" height="100%" width="100%" />
    </div>
  );
};

export default DemoStackedBarChart;
