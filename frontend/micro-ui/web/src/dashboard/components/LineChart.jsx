import React, { useCallback, useMemo, useRef, useState } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";
import {
  applyLineChartMarkerHoverState,
  buildLineChartAnimations,
  buildLineChartGrid,
  buildLineChartMarkers,
  buildLineChartStroke,
  buildLineChartTooltip,
  buildLineChartXAxis,
  buildLineChartYAxis,
  getLineChartMarkerSurfaceColor,
  LINE_CHART_LEGEND,
  LINE_CHART_PERIOD_OPTIONS,
  normalizeLineChartSeries,
  resolveLineChartColors,
  resolveLineChartYAxisBounds,
  setLineChartMarkersVisible,
} from "../config/lineChartPresentation";
import { VISUALIZATION_STYLES, VIZ_TYPE, SHARED_CHROME } from "../config/visualizationStyles";
import { useChartContainerSize } from "../hooks/useChartContainerSize";
import ViewToggle from "./demo/ViewToggle";

function resolveActiveDataset({ categories, series, periods, period }) {
  if (periods?.[period]) {
    return periods[period];
  }
  return { categories: categories ?? [], series: series ?? [] };
}

const LineChart = ({
  categories: categoriesProp,
  series: seriesProp,
  periods,
  defaultPeriod = "daily",
  headerTitle,
  yAxis,
}) => {
  const [period, setPeriod] = useState(defaultPeriod);
  const [isAnimating, setIsAnimating] = useState(true);
  const hoveredIndexRef = useRef(-1);
  const isAnimatingRef = useRef(true);
  const colorsRef = useRef([]);
  const surfaceColorRef = useRef("#ffffff");

  const { containerRef, containerSize } = useChartContainerSize();
  const { width: containerWidth, height: containerHeight } = containerSize;

  const handlePeriodChange = useCallback((nextPeriod) => {
    hoveredIndexRef.current = -1;
    isAnimatingRef.current = true;
    setIsAnimating(true);
    setPeriod(nextPeriod);
  }, []);

  const activeDataset = useMemo(
    () =>
      resolveActiveDataset({
        categories: categoriesProp,
        series: seriesProp,
        periods,
        period,
      }),
    [categoriesProp, period, periods, seriesProp]
  );

  const { categories, series } = activeDataset;
  const activeYAxis = activeDataset.yAxis ?? yAxis;

  const normalizedSeries = useMemo(
    () => normalizeLineChartSeries(series),
    [series]
  );

  const chartSeries = useMemo(
    () =>
      normalizedSeries.map((entry) => ({
        name: entry.name,
        data: entry.data,
      })),
    [normalizedSeries]
  );

  const colors = useMemo(
    () => resolveLineChartColors(normalizedSeries),
    [normalizedSeries]
  );
  colorsRef.current = colors;
  surfaceColorRef.current = getLineChartMarkerSurfaceColor();
  isAnimatingRef.current = isAnimating;

  const yAxisBounds = useMemo(
    () => resolveLineChartYAxisBounds(normalizedSeries, activeYAxis),
    [activeYAxis, normalizedSeries]
  );

  const chartEvents = useMemo(
    () => ({
      animationEnd: (chartContext) => {
        isAnimatingRef.current = false;
        setIsAnimating(false);
        setLineChartMarkersVisible(chartContext, true);
        applyLineChartMarkerHoverState(
          chartContext,
          hoveredIndexRef.current,
          colorsRef.current,
          surfaceColorRef.current
        );
      },
      mouseMove: (_event, chartContext, config) => {
        if (isAnimatingRef.current) return;

        const idx = config?.dataPointIndex ?? -1;
        hoveredIndexRef.current = idx;

        const apply = () =>
          applyLineChartMarkerHoverState(
            chartContext,
            idx,
            colorsRef.current,
            surfaceColorRef.current
          );

        apply();
        window.requestAnimationFrame(() => {
          apply();
          window.requestAnimationFrame(apply);
        });
      },
      mouseLeave: (_event, chartContext) => {
        hoveredIndexRef.current = -1;
        applyLineChartMarkerHoverState(
          chartContext,
          -1,
          colorsRef.current,
          surfaceColorRef.current
        );
      },
      updated: (chartContext) => {
        hoveredIndexRef.current = -1;
        if (isAnimatingRef.current) {
          setLineChartMarkersVisible(chartContext, false);
        }
      },
    }),
    []
  );

  const options = useMemo(
    () => ({
      chart: {
        type: "line",
        toolbar: { show: false },
        fontFamily: DASHBOARD_FONT_FAMILY,
        zoom: { enabled: false },
        parentHeightOffset: 0,
        animations: buildLineChartAnimations(),
        events: chartEvents,
      },
      stroke: buildLineChartStroke(normalizedSeries),
      markers: buildLineChartMarkers(colors),
      xaxis: buildLineChartXAxis(categories),
      yaxis: buildLineChartYAxis(yAxisBounds),
      colors,
      legend: LINE_CHART_LEGEND,
      grid: buildLineChartGrid(),
      tooltip: buildLineChartTooltip(),
      states: {
        hover: { filter: { type: "none" } },
        active: { filter: { type: "none" } },
      },
    }),
    [categories, chartEvents, colors, normalizedSeries, yAxisBounds]
  );

  const markerStyleVars = useMemo(
    () => ({
      "--line-chart-marker-fill": getLineChartMarkerSurfaceColor(),
    }),
    [colors]
  );

  const hasData =
    categories.length > 0 &&
    normalizedSeries.some((entry) => entry.data.some((value) => Number(value) > 0));

  const lineStyles = VISUALIZATION_STYLES[VIZ_TYPE.LINE_CHART];
  const showHeader = Boolean(headerTitle && periods);

  const chart = !hasData ? null : (
    <div
      ref={containerRef}
      className={`${lineStyles.container} tw-h-full tw-min-h-0 tw-w-full tw-flex-1 tw-overflow-visible${
        isAnimating ? ` ${lineStyles.animating}` : ""
      }`}
      style={markerStyleVars}
    >
      {containerHeight > 0 && containerWidth > 0 ? (
        <Chart
          key={`${containerHeight}-${containerWidth}`}
          options={options}
          series={chartSeries}
          type="line"
          height={containerHeight}
          width="100%"
        />
      ) : null}
    </div>
  );

  if (!hasData) return null;

  if (!showHeader) {
    return chart;
  }

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col">
      <header
        className={`${lineStyles.headerBar} ${SHARED_CHROME.dragHandle} tw-flex tw-shrink-0 tw-items-center tw-justify-between tw-gap-3 tw-px-4 tw-pb-0 tw-pt-2.5 tw-pr-8`}
      >
        <h2 className={SHARED_CHROME.dragHandleTitle}>{headerTitle}</h2>
        <ViewToggle
          value={period}
          onChange={handlePeriodChange}
          variant="primary"
          options={LINE_CHART_PERIOD_OPTIONS}
        />
      </header>
      <div className={lineStyles.widgetBody}>{chart}</div>
    </div>
  );
};

export default LineChart;
