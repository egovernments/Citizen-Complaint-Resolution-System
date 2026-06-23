import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";
import { resolveDashboardCssColor } from "../config/chartColors";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import { getNumberTileValueClass } from "../config/kpiDisplay";
import { useChartContainerSize } from "../hooks/useChartContainerSize";
import ResizeGrip from "./ResizeGrip";

const SPARKLINE_MIN_HEIGHT = 10;

const sparklineTile = VISUALIZATION_STYLES[VIZ_TYPE.NUMBER_TILE_SPARKLINE];
const numberTile = VISUALIZATION_STYLES[VIZ_TYPE.NUMBER_TILE_DELTA];

const RemoveIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="tw-h-3.5 tw-w-3.5"
    aria-hidden="true"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

function normalizeSparklineData(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return [0, 0, 0, 0, 0, 0, 0];
  }
  if (points.length === 1) {
    return [points[0], points[0]];
  }
  return points;
}

const KpiSparklineCard = ({
  title,
  value,
  status,
  deltaDisplay,
  seriesColor = "var(--chart-1)",
  sparkline = [],
  loading = false,
  onRemove,
}) => {
  const isUnavailable = value === "—";
  const displayValue = value ?? (loading ? "…" : "—");
  const valueClass = getNumberTileValueClass(status, { unavailable: isUnavailable });
  const chartData = normalizeSparklineData(sparkline);
  const { containerRef, containerSize } = useChartContainerSize();
  const chartHeight = Math.max(SPARKLINE_MIN_HEIGHT, containerSize.height || SPARKLINE_MIN_HEIGHT);
  const strokeColor = useMemo(
    () => resolveDashboardCssColor(seriesColor),
    [seriesColor]
  );

  const chartOptions = useMemo(
    () => ({
      chart: {
        type: "line",
        sparkline: { enabled: true },
        fontFamily: DASHBOARD_FONT_FAMILY,
        animations: { enabled: false },
        parentHeightOffset: 0,
      },
      stroke: { curve: "smooth", width: 1 },
      fill: { opacity: 0 },
      colors: [strokeColor],
      tooltip: { enabled: false },
    }),
    [strokeColor]
  );

  const series = useMemo(() => [{ data: chartData }], [chartData]);

  return (
    <div className={`${numberTile.card} ${sparklineTile.card} tw-group`}>
      {onRemove ? (
        <button
          type="button"
          title="Remove from dashboard"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          className="dashboard-widget-remove-btn"
          aria-label={`Remove ${title}`}
        >
          <RemoveIcon />
        </button>
      ) : null}

      <div className={numberTile.title} title={title}>
        {title}
      </div>

      <div className={sparklineTile.valueRow}>
        <div
          className={`${numberTile.value} ${valueClass} ${
            loading ? numberTile.valueLoading : ""
          }`}
        >
          {displayValue}
        </div>
        {deltaDisplay ? (
          <div className={`${sparklineTile.delta} ${valueClass}`}>{deltaDisplay}</div>
        ) : loading ? (
          <div className={`${sparklineTile.delta} ${sparklineTile.deltaMuted}`}>…</div>
        ) : null}
      </div>

      <div ref={containerRef} className={sparklineTile.sparkline}>
        {chartHeight > 0 ? (
          <Chart
            key={chartHeight}
            options={chartOptions}
            series={series}
            type="line"
            height={chartHeight}
            width="100%"
          />
        ) : null}
      </div>

      <ResizeGrip />
    </div>
  );
};

export default KpiSparklineCard;
