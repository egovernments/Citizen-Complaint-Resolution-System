import React from "react";
import ResizeGrip from "./ResizeGrip";

const ACCENT_STYLES = {
  teal: "tw-border-l-4 tw-border-brand-teal",
  green: "tw-border-l-4 tw-border-green-500",
  amber: "tw-border-l-4 tw-border-amber-500",
  red: "tw-border-l-4 tw-border-red-500",
  slate: "tw-border-l-4 tw-border-slate-400",
};

const KpiCard = ({ metric, value, accent = "teal", loading = false }) => {
  const isUnavailable = value === "—";
  const displayValue = value ?? (loading ? "…" : "—");

  return (
    <div
      className={`dashboard-widget dashboard-kpi-card tw-relative tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-px-3 ${ACCENT_STYLES[accent] || ACCENT_STYLES.teal}`}
    >
      <p
        className="dashboard-kpi-title tw-min-w-0 tw-w-full tw-text-sm tw-font-semibold tw-leading-snug tw-text-slate-800"
        title={metric}
      >
        {metric}
      </p>
      <p
        className={`tw-mt-1 tw-shrink-0 tw-text-xl tw-font-bold tw-leading-none ${
          isUnavailable ? "tw-text-slate-400" : "tw-text-slate-800"
        } ${loading ? "tw-animate-pulse" : ""}`}
      >
        {displayValue}
      </p>
      <ResizeGrip />
    </div>
  );
};

export default KpiCard;
