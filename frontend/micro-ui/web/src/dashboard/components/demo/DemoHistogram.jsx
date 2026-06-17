import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../../config/dashboardConfig";
import { useChartContainerSize } from "../../hooks/useChartContainerSize";
import { buildXAxisLabelOptions } from "../../utils/barChartXAxis";

const DemoHistogram = ({ data = [] }) => {
  const { containerRef, containerSize } = useChartContainerSize();
  const { width: containerWidth, height: containerHeight } = containerSize;

  const categories = data.map((d) => d.label);
  const values = data.map((d) => d.count);

  const xAxisLabels = useMemo(
    () => buildXAxisLabelOptions(categories, containerWidth),
    [categories, containerWidth]
  );

  const options = useMemo(
    () => ({
      chart: {
        type: "bar",
        toolbar: { show: false },
        fontFamily: DASHBOARD_FONT_FAMILY,
      },
      plotOptions: {
        bar: {
          borderRadius: 4,
          columnWidth: "60%",
        },
      },
      dataLabels: { enabled: false },
      xaxis: {
        categories,
        labels: xAxisLabels,
      },
      yaxis: {
        labels: { style: { fontSize: "10px" } },
      },
      colors: ["var(--chart-2)"],
      grid: { borderColor: "var(--border)", strokeDashArray: 3 },
      tooltip: { theme: "light" },
    }),
    [categories, xAxisLabels]
  );

  const series = useMemo(() => [{ name: "Complaints", data: values }], [values]);

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

export default DemoHistogram;
