import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../../config/dashboardConfig";

const HorizontalBarChart = ({ data = [] }) => {
  const categories = data.map((d) => d.label);
  const values = data.map((d) => d.count);

  const options = useMemo(
    () => ({
      chart: {
        type: "bar",
        toolbar: { show: false },
        fontFamily: DASHBOARD_FONT_FAMILY,
      },
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 4,
          barHeight: "65%",
        },
      },
      dataLabels: { enabled: false },
      xaxis: {
        categories,
        labels: { style: { fontSize: "10px" } },
      },
      yaxis: {
        labels: {
          style: { fontSize: "10px" },
          maxWidth: 140,
        },
      },
      colors: ["#0d9488"],
      grid: { borderColor: "#e8e6e1", strokeDashArray: 3 },
      tooltip: { theme: "light" },
    }),
    [categories]
  );

  const series = useMemo(() => [{ name: "Closures", data: values }], [values]);

  return (
    <div className="tw-h-full tw-min-h-0 tw-w-full">
      <Chart options={options} series={series} type="bar" height="100%" width="100%" />
    </div>
  );
};

export default HorizontalBarChart;
