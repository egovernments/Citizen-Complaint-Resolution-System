import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";
import { resolveDashboardCssColor } from "../config/chartColors";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import { getNumberTileValueClass } from "../config/kpiDisplay";
import { useChartContainerSize } from "../hooks/useChartContainerSize";
import useDashboardT from "../i18n/useDashboardT";
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

// ours (digit-3 P0, 2026-10-14): empty / all-equal series are drawn without ApexCharts (see utils/sparklineShape.js)
import { sparklineShape } from "../utils/sparklineShape";

const KpiSparklineCard = ({
  title,
  value,
  status,
  deltaDisplay,
  deltaClass,
  seriesColor = "var(--chart-1)",
  sparkline = [],
  loading = false,
  onRemove,
}) => {
  const { t } = useDashboardT();
  const isUnavailable = value === "—";
  const displayValue = value ?? (loading ? "…" : "—");
  const valueClass = getNumberTileValueClass(status, { unavailable: isUnavailable });
  const shape = useMemo(() => sparklineShape(sparkline), [JSON.stringify(sparkline ?? [])]); // eslint-disable-line react-hooks/exhaustive-deps
  const chartData = shape.data;
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
          title={t("DASHBOARD_TILE_REMOVE", "Remove from dashboard")}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          className="dashboard-widget-remove-btn"
          aria-label={`${t("DASHBOARD_TILE_REMOVE_ARIA", "Remove")} ${title}`}
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
          <div className={`${sparklineTile.delta} ${deltaClass ?? valueClass}`}>
            {deltaDisplay}
          </div>
        ) : loading ? (
          <div className={`${sparklineTile.delta} ${sparklineTile.deltaMuted}`}>…</div>
        ) : null}
      </div>

      <div ref={containerRef} className={sparklineTile.sparkline}>
        {shape.kind === "none" ? (
          <div className="tw-flex tw-h-full tw-items-end tw-text-xs tw-text-gray-400" data-testid="sparkline-none">
            {loading ? "" : t("DASHBOARD_SPARKLINE_NO_DATA", "No trend data")}
          </div>
        ) : shape.kind === "flat" ? (
          <div className="tw-flex tw-h-full tw-items-center" data-testid="sparkline-flat" aria-hidden="true">
            <div className="tw-w-full" style={{ borderTop: `1px solid ${strokeColor}` }} />
          </div>
        ) : chartHeight > 0 ? (
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
