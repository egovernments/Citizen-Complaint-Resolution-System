import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../../config/dashboardConfig";

const STACKED_COLORS = ["#dc2626", "#64748b", "#059669"];

const DemoStackedBarChart = ({ categories = [], series = [] }) => {
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
      colors: STACKED_COLORS,
      legend: {
        position: "top",
        horizontalAlign: "right",
        fontSize: "11px",
      },
      grid: { borderColor: "#e8e6e1" },
      tooltip: { theme: "light" },
    }),
    [categories]
  );

  return (
    <div className="tw-h-full tw-min-h-0 tw-w-full">
      <Chart options={options} series={series} type="bar" height="100%" width="100%" />
    </div>
  );
};

export default DemoStackedBarChart;
