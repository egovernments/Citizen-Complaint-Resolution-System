import React, { useEffect, useMemo, useRef, useState } from "react";
import Chart from "react-apexcharts";

/** ApexCharts columnWidth — ~80% bar / ~20% gap within each category band. */
const COLUMN_WIDTH = "80%";
const MIN_CHART_HEIGHT = 300;

function normalizeChartData(data, categoryOrder) {
  if (!categoryOrder?.length) {
    return (data ?? []).map((d) => ({
      label: String(d.label ?? d.department ?? "Unknown"),
      count: Number(d.count) || 0,
    }));
  }

  const lookup = new Map(
    (data ?? []).map((d) => [String(d.label ?? d.department), Number(d.count) || 0])
  );

  return categoryOrder.map((label) => ({
    label: String(label),
    count: lookup.get(String(label)) ?? 0,
  }));
}

function resolveLabelRotation(categories, labelRotate) {
  if (typeof labelRotate === "number") return labelRotate;
  if (labelRotate === false) return 0;
  if (labelRotate === true) return -45;
  const hasLongLabel = categories.some((label) => String(label).length > 10);
  if (hasLongLabel || categories.length > 5) return -45;
  return 0;
}

const DepartmentBarChart = ({
  data,
  categoryOrder,
  labelRotate = "auto",
}) => {
  const containerRef = useRef(null);
  const [height, setHeight] = useState(0);

  const chartData = useMemo(
    () => normalizeChartData(data, categoryOrder),
    [data, categoryOrder]
  );

  const categories = useMemo(() => chartData.map((d) => d.label), [chartData]);
  const series = useMemo(
    () => [{ name: "Count", data: chartData.map((d) => d.count) }],
    [chartData]
  );

  const labelRotation = useMemo(
    () => resolveLabelRotation(categories, labelRotate),
    [categories, labelRotate]
  );

  const options = useMemo(
    () => ({
      chart: {
        type: "bar",
        toolbar: { show: false },
        fontFamily: "inherit",
        parentHeightOffset: 0,
        animations: { enabled: true, speed: 300 },
      },
      plotOptions: {
        bar: {
          borderRadius: 4,
          horizontal: false,
          columnWidth: COLUMN_WIDTH,
        },
      },
      dataLabels: { enabled: false },
      xaxis: {
        categories,
        tickPlacement: "on",
        labels: {
          rotate: labelRotation,
          rotateAlways: labelRotation !== 0,
          trim: false,
          hideOverlappingLabels: false,
          maxHeight: labelRotation !== 0 ? 140 : 80,
          style: { fontSize: "11px" },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        title: { text: "Count", style: { fontSize: "11px", fontWeight: 500 } },
        labels: {
          minWidth: 32,
          style: { fontSize: "11px" },
          formatter: (val) => Math.round(val),
        },
        forceNiceScale: true,
        min: 0,
        tickAmount: 4,
      },
      colors: ["var(--brand-teal, #0d9488)"],
      grid: {
        borderColor: "#e2e8f0",
        strokeDashArray: 3,
        padding: {
          left: 8,
          right: 12,
          top: 4,
          bottom: labelRotation !== 0 ? 24 : 8,
        },
      },
      tooltip: { theme: "light" },
    }),
    [categories, labelRotation]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const updateHeight = () => {
      const next = Math.max(MIN_CHART_HEIGHT, Math.floor(el.getBoundingClientRect().height));
      setHeight(next);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!chartData.length) return null;

  return (
    <div className="dashboard-widget tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-p-3">
      <div ref={containerRef} className="tw-min-h-[300px] tw-flex-1">
        {height > 0 ? (
          <Chart
            key={`${height}-${categories.join("|")}`}
            options={options}
            series={series}
            type="bar"
            height={height}
            width="100%"
          />
        ) : null}
      </div>
    </div>
  );
};

export const WEEKDAY_CHART_ORDER = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

export default DepartmentBarChart;
