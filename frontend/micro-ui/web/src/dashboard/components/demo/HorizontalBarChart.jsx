import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../../config/dashboardConfig";
import { resolveDashboardCssColor } from "../../config/chartColors";
import { useChartContainerSize } from "../../hooks/useChartContainerSize";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../../config/visualizationStyles";

function formatRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (n >= 1) return `${Math.round(n * 100) / 100}`;
  return n.toFixed(2);
}

function splitAtBreakEven(value, breakEven) {
  const v = Math.max(0, Number(value) || 0);
  const threshold = Math.max(0, Number(breakEven) || 0);
  return {
    below: Math.min(v, threshold),
    above: Math.max(0, v - threshold),
  };
}

const HorizontalBarChart = ({ data = [], breakEven = 1 }) => {
  const { containerRef, containerSize } = useChartContainerSize();
  const { width: containerWidth, height: containerHeight } = containerSize;

  const rows = useMemo(
    () =>
      (data || []).map((entry) => ({
        label: String(entry.label ?? "Unknown"),
        value: Number(entry.value ?? entry.count) || 0,
        resolved: Number(entry.resolved),
        created: Number(entry.created),
      })),
    [data]
  );

  const categories = useMemo(() => rows.map((d) => d.label), [rows]);
  const values = useMemo(() => rows.map((d) => d.value), [rows]);

  const belowBreakEvenColor = resolveDashboardCssColor("var(--status-overdue)");
  const atOrAboveBreakEvenColor = resolveDashboardCssColor("var(--status-resolved)");
  const foregroundColor = resolveDashboardCssColor("var(--foreground)");
  const borderColor = resolveDashboardCssColor("var(--border)");
  const mutedColor = resolveDashboardCssColor("var(--muted-foreground)");

  const { belowSeries, aboveSeries } = useMemo(() => {
    const below = [];
    const above = [];
    for (const value of values) {
      const split = splitAtBreakEven(value, breakEven);
      below.push(split.below);
      above.push(split.above);
    }
    return { belowSeries: below, aboveSeries: above };
  }, [values, breakEven]);

  const axisMax = useMemo(() => {
    const maxValue = Math.max(...values, breakEven, 0);
    const padded = maxValue * 1.2;
    return Math.max(1.2, Math.ceil(padded * 10) / 10);
  }, [values, breakEven]);

  const options = useMemo(
    () => ({
      chart: {
        type: "bar",
        stacked: true,
        stackType: "normal",
        toolbar: { show: false },
        fontFamily: DASHBOARD_FONT_FAMILY,
        parentHeightOffset: 0,
      },
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 0,
          barHeight: "62%",
          dataLabels: {
            total: {
              enabled: true,
              offsetX: 14,
              offsetY: 4,
              hideOverflowingLabels: false,
              style: {
                fontSize: "11px",
                fontWeight: 600,
                color: foregroundColor,
              },
              formatter: (total) => formatRatio(total),
            },
          },
        },
      },
      dataLabels: { enabled: false },
      xaxis: {
        categories,
        min: 0,
        max: axisMax,
        labels: { style: { fontSize: "10px" } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { fontSize: "10px" },
          maxWidth: 140,
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      colors: [belowBreakEvenColor, atOrAboveBreakEvenColor],
      legend: {
        show: true,
        position: "top",
        horizontalAlign: "left",
        fontSize: "11px",
        customLegendItems: ["Below break-even", "At or above break-even"],
        markers: {
          fillColors: [belowBreakEvenColor, atOrAboveBreakEvenColor],
        },
      },
      annotations: {
        xaxis: [
          {
            x: breakEven,
            borderColor,
            strokeDashArray: 4,
            borderWidth: 1,
            label: {
              show: true,
              text: "break-even",
              borderColor: "transparent",
              style: {
                background: "transparent",
                color: mutedColor,
                fontSize: "10px",
              },
            },
          },
        ],
      },
      grid: {
        borderColor,
        strokeDashArray: 0,
        padding: { left: 4, right: 48, top: 4, bottom: 4 },
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: false } },
      },
      tooltip: {
        theme: "light",
        shared: false,
        custom: ({ dataPointIndex }) => {
          const row = rows[dataPointIndex];
          if (!row) return "";
          const detail =
            Number.isFinite(row.resolved) &&
            Number.isFinite(row.created) &&
            row.created > 0
              ? `${row.resolved} resolved of ${row.created} created`
              : "";
          return `<div class="apexcharts-tooltip-title">${row.label}</div>
            <div class="apexcharts-tooltip-series-group apexcharts-active">
              <span class="apexcharts-tooltip-text">
                <span class="apexcharts-tooltip-y-group">
                  <span class="apexcharts-tooltip-text-y-label"></span>
                  <span class="apexcharts-tooltip-text-y-value">${formatRatio(row.value)}${detail ? ` — ${detail}` : ""}</span>
                </span>
              </span>
            </div>`;
        },
      },
    }),
    [
      axisMax,
      atOrAboveBreakEvenColor,
      belowBreakEvenColor,
      borderColor,
      breakEven,
      categories,
      foregroundColor,
      mutedColor,
      rows,
      values,
    ]
  );

  const series = useMemo(
    () => [
      { name: "Below break-even", data: belowSeries },
      { name: "At or above break-even", data: aboveSeries },
    ],
    [aboveSeries, belowSeries]
  );

  const hasData = rows.length > 0 && values.some((v) => Number(v) > 0);
  const horizontalStyles = VISUALIZATION_STYLES[VIZ_TYPE.HORIZONTAL_BAR];

  if (!hasData) return null;

  return (
    <div
      ref={containerRef}
      className={`${horizontalStyles.container} tw-h-full tw-min-h-0 tw-w-full tw-flex-1`}
    >
      {containerHeight > 0 && containerWidth > 0 ? (
        <Chart
          key={`${containerWidth}-${containerHeight}-${breakEven}-${categories.join("|")}`}
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

export default HorizontalBarChart;
