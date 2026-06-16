import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../../config/dashboardConfig";

const DemoLineChart = ({ categories = [], series = [] }) => {
  const options = useMemo(
    () => ({
      chart: {
        type: "line",
        toolbar: { show: false },
        fontFamily: DASHBOARD_FONT_FAMILY,
        zoom: { enabled: false },
      },
      stroke: { curve: "smooth", width: 3 },
      xaxis: {
        categories,
        labels: { style: { fontSize: "10px" } },
      },
      yaxis: {
        labels: { style: { fontSize: "10px" } },
      },
      colors: ["var(--chart-1)"],
      grid: { borderColor: "var(--border)" },
      markers: { size: 4 },
      legend: { show: false },
      tooltip: { theme: "light" },
    }),
    [categories]
  );

  return (
    <div className="tw-h-full tw-min-h-0 tw-w-full">
      <Chart options={options} series={series} type="line" height="100%" width="100%" />
    </div>
  );
};

export default DemoLineChart;
