import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../../config/dashboardConfig";

const PIE_COLORS = ["#0d9488", "#64748b", "#059669", "#dc2626"];

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
      stroke: { width: 1, colors: ["#fff"] },
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
