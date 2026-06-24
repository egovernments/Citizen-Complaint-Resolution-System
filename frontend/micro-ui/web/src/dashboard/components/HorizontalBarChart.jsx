import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";
import { resolveDashboardCssColor } from "../config/chartColors";
import {
  buildApexChartTooltipOptions,
  buildChartTooltipMarkup,
} from "../config/chartTooltipPresentation";
import {
  buildHorizontalBarGrid,
  buildHorizontalCategoryYAxis,
} from "../config/stackedBarPresentation";
import { useScrollableChartSize } from "../hooks/useScrollableChartSize";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import ChartScrollViewport from "./ChartScrollViewport";

function formatRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function breakEvenSeriesValues(value, breakEven) {
  const v = Math.max(0, Number(value) || 0);
  const threshold = Math.max(0, Number(breakEven) || 0);
  if (v >= threshold) {
    return { below: 0, above: v };
  }
  return { below: v, above: 0 };
}

const HorizontalBarChart = ({ data = [], breakEven = 1, scrollKey }) => {
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

  const {
    viewportRef,
    chartSize,
    isScrollable,
    isReady,
    scrollAxis,
  } = useScrollableChartSize({
    scrollKey,
    categoryCount: categories.length,
    scrollAxis: "y",
  });

  const containerWidth = chartSize.width;
  const containerHeight = chartSize.height;

  const belowBreakEvenColor = resolveDashboardCssColor("var(--status-breach)");
  const atOrAboveBreakEvenColor = resolveDashboardCssColor("var(--status-resolved)");
  const foregroundColor = resolveDashboardCssColor("var(--foreground)");
  const borderColor = resolveDashboardCssColor("var(--border)");
  const mutedColor = resolveDashboardCssColor("var(--muted-foreground)");

  const { belowSeries, aboveSeries } = useMemo(() => {
    const below = [];
    const above = [];
    for (const value of values) {
      const split = breakEvenSeriesValues(value, breakEven);
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
          borderRadius: 4,
          borderRadiusApplication: "end",
          barHeight: "68%",
          dataLabels: {
            total: {
              enabled: true,
              offsetX: 6,
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
      yaxis: [buildHorizontalCategoryYAxis(categories, containerWidth)],
      colors: [belowBreakEvenColor, atOrAboveBreakEvenColor],
      legend: {
        show: true,
        position: "top",
        horizontalAlign: "center",
        fontSize: "11px",
        offsetY: 2,
        customLegendItems: ["Falling behind (<1.0)", "Catching up (≥1.0)"],
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
              text: formatRatio(breakEven),
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
      grid: buildHorizontalBarGrid(),
      tooltip: buildApexChartTooltipOptions({
        shared: false,
        followCursor: true,
        custom: ({ dataPointIndex }) => {
          const row = rows[dataPointIndex];
          if (!row) return "";
          const detail =
            Number.isFinite(row.resolved) &&
            Number.isFinite(row.created) &&
            row.created > 0
              ? `${row.resolved} resolved ÷ ${row.created} created`
              : "";
          const value = `${formatRatio(row.value)}${detail ? ` — ${detail}` : ""}`;
          return buildChartTooltipMarkup({
            title: row.label,
            rows: [{ value }],
          });
        },
      }),
    }),
    [
      axisMax,
      atOrAboveBreakEvenColor,
      belowBreakEvenColor,
      borderColor,
      breakEven,
      categories,
      containerWidth,
      foregroundColor,
      mutedColor,
      rows,
    ]
  );

  const series = useMemo(
    () => [
      { name: "Falling behind (<1.0)", data: belowSeries },
      { name: "Catching up (≥1.0)", data: aboveSeries },
    ],
    [aboveSeries, belowSeries]
  );

  const hasData = rows.length > 0;
  const horizontalStyles = VISUALIZATION_STYLES[VIZ_TYPE.HORIZONTAL_BAR];

  if (!hasData) return null;

  return (
    <ChartScrollViewport
      viewportRef={viewportRef}
      chartSize={chartSize}
      isScrollable={isScrollable}
      chartClassName={horizontalStyles.container}
      scrollAxis={scrollAxis}
    >
      {isReady ? (
        <Chart
          key={`${containerWidth}-${containerHeight}-${breakEven}-${categories.join("|")}`}
          options={options}
          series={series}
          type="bar"
          height={containerHeight}
          width="100%"
        />
      ) : null}
    </ChartScrollViewport>
  );
};

export default HorizontalBarChart;
