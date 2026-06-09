import React from "react";
import Chart from "react-apexcharts";

const DepartmentBarChart = ({ data }) => {
  const categories = data.map((d) => d.label ?? d.department);
  const series = [{ name: "Complaints", data: data.map((d) => d.count) }];

  const options = {
    chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit" },
    plotOptions: {
      bar: { borderRadius: 4, horizontal: false, columnWidth: "55%" },
    },
    dataLabels: { enabled: false },
    xaxis: { categories, labels: { style: { fontSize: "12px" } } },
    yaxis: { title: { text: "Count" } },
    colors: ["#0d9488"],
    grid: { borderColor: "#e2e8f0" },
    tooltip: { theme: "light" },
  };

  return (
    <div className="dashboard-widget tw-flex tw-h-full tw-flex-col tw-p-4">
      <div className="tw-min-h-0 tw-flex-1">
        <Chart options={options} series={series} type="bar" height="100%" width="100%" />
      </div>
    </div>
  );
};

export default DepartmentBarChart;
