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
import { resolveBarChartColumnWidth } from "../config/barChartPresentation";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import useDashboardT from "../i18n/useDashboardT";
import ChartScrollViewport from "./ChartScrollViewport";
import { formatNumber, getNumberFormatStamp } from "../utils/numberFormat";

// Numeric part goes through the tenant mask (formatNumber, null when
// unconfigured -> pre-#1213 expression).
function formatRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return formatNumber(0, { decimals: 2 }) ?? "0.00";
  return formatNumber(n, { decimals: 2 }) ?? n.toFixed(2);
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
  const { t, language } = useDashboardT();
  // Per-locale numberFormat mask stamp (#1272): baked into the options memo
  // because react-apexcharts compares JSON.stringify(options), which drops
  // the total-label/tooltip formatter closures — `language` alone can miss a
  // mask change whose translated strings happen to coincide.
  const numberFormatStamp = getNumberFormatStamp();
  const rows = useMemo(
    () =>
      (data || []).map((entry) => ({
        label: String(entry.label ?? t("DASHBOARD_COMMON_UNKNOWN", "Unknown")),
        value: Number(entry.value ?? entry.count) || 0,
        resolved: Number(entry.resolved),
        created: Number(entry.created),
      })),
    [data, t, language]
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
          // Cap bar thickness at the same max px as vertical bars so a 1-category
          // chart doesn't render one giant bar — consistent regardless of the data.
          barHeight: resolveBarChartColumnWidth(
            containerHeight / Math.max(1, categories.length)
          ),
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
        customLegendItems: [
          t("DASHBOARD_TILE_LEGEND_FALLING_BEHIND", "Falling behind (<1.0)"),
          t("DASHBOARD_TILE_LEGEND_CATCHING_UP", "Catching up (≥1.0)"),
        ],
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
              ? `${formatNumber(row.resolved, { decimals: 0 }) ?? row.resolved} ${t("DASHBOARD_COMMON_RESOLVED", "resolved")} ÷ ${formatNumber(row.created, { decimals: 0 }) ?? row.created} ${t("DASHBOARD_COMMON_CREATED", "created")}`
              : "";
          const value = `${formatRatio(row.value)}${detail ? ` — ${detail}` : ""}`;
          return buildChartTooltipMarkup({
            title: row.label,
            rows: [{ value }],
          });
        },
      }),
      // Not an Apex option — stringifiable stamp of the per-locale mask so
      // the JSON.stringify options comparison sees mask-only changes.
      _numberFormatStamp: numberFormatStamp,
    }),
    [
      axisMax,
      atOrAboveBreakEvenColor,
      belowBreakEvenColor,
      borderColor,
      breakEven,
      categories,
      containerWidth,
      containerHeight,
      foregroundColor,
      mutedColor,
      rows,
      t,
      language,
      numberFormatStamp,
    ]
  );

  const series = useMemo(
    () => [
      { name: t("DASHBOARD_TILE_LEGEND_FALLING_BEHIND", "Falling behind (<1.0)"), data: belowSeries },
      { name: t("DASHBOARD_TILE_LEGEND_CATCHING_UP", "Catching up (≥1.0)"), data: aboveSeries },
    ],
    [aboveSeries, belowSeries, t, language]
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
