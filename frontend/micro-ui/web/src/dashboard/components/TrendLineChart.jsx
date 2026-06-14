import React from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";

const TrendLineChart = ({ data }) => {
  const options = {
    chart: {
      type: "line",
      toolbar: { show: false },
      fontFamily: DASHBOARD_FONT_FAMILY,
      zoom: { enabled: false },
    },
    stroke: { curve: "smooth", width: 3 },
    xaxis: { categories: data.months },
    yaxis: { title: { text: "Complaints" } },
    colors: ["#0d9488", "#64748b"],
    legend: { position: "top", horizontalAlign: "right" },
    grid: { borderColor: "#e2e8f0" },
    markers: { size: 4 },
    tooltip: { theme: "light" },
  };

  const series = [
    { name: "Filed", data: data.filed },
    { name: "Resolved", data: data.resolved },
  ];

  return (
    <div className="dashboard-widget tw-flex tw-h-full tw-flex-col tw-p-4">
      <div className="tw-min-h-0 tw-flex-1">
        <Chart options={options} series={series} type="line" height="100%" width="100%" />
      </div>
    </div>
  );
};

export default TrendLineChart;
