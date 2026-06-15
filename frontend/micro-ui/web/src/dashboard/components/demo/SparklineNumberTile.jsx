import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../../config/dashboardConfig";

const SparklineNumberTile = ({ value, label, delta, deltaLabel = "WoW", sparkline = [] }) => {
  const up = delta >= 0;
  const deltaClass = up ? "tw-text-status-resolved" : "tw-text-status-breach";

  const chartOptions = useMemo(
    () => ({
      chart: {
        type: "area",
        sparkline: { enabled: true },
        fontFamily: DASHBOARD_FONT_FAMILY,
        animations: { enabled: false },
      },
      stroke: { curve: "smooth", width: 2 },
      fill: {
        type: "gradient",
        gradient: {
          shadeIntensity: 0.3,
          opacityFrom: 0.35,
          opacityTo: 0.05,
        },
      },
      colors: ["#0d9488"],
      tooltip: { enabled: false },
    }),
    []
  );

  const series = useMemo(() => [{ data: sparkline }], [sparkline]);

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col">
      <div className="tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted-foreground">
        {label}
      </div>
      <div className="tw-mt-2 tw-flex tw-items-end tw-justify-between tw-gap-3">
        <div className="tw-text-[36px] tw-font-semibold tw-tabular-nums tw-leading-none tw-text-foreground">
          {value}
        </div>
        <div className={`tw-pb-1 tw-text-[12px] tw-font-semibold tw-tabular-nums ${deltaClass}`}>
          {up ? "↑" : "↓"} {Math.abs(delta).toFixed(1)}% {deltaLabel}
        </div>
      </div>
      <div className="tw-mt-2 tw-min-h-0 tw-flex-1">
        <Chart options={chartOptions} series={series} type="area" height="100%" width="100%" />
      </div>
    </div>
  );
};

export default SparklineNumberTile;
