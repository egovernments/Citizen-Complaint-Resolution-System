import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../../config/dashboardConfig";

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
];

const DemoPieChart = ({ data = [] }) => {
  const labels = data.map((d) => d.label);
  const values = data.map((d) => d.count);

  const options = useMemo(
    () => ({
      chart: {
        type: "donut",
        fontFamily: DASHBOARD_FONT_FAMILY,
      },
      labels,
      colors: PIE_COLORS,
      legend: {
        position: "bottom",
        fontSize: "11px",
      },
      dataLabels: {
        enabled: true,
        style: { fontSize: "10px" },
      },
      stroke: { width: 1, colors: ["var(--surface)"] },
      tooltip: { theme: "light" },
    }),
    [labels]
  );

  const series = useMemo(() => values, [values]);

  return (
    <div className="tw-h-full tw-min-h-0 tw-w-full">
      <Chart options={options} series={series} type="donut" height="100%" width="100%" />
    </div>
  );
};

export default DemoPieChart;
