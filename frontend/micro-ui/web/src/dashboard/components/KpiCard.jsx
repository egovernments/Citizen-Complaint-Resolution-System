import React from "react";

const ACCENT_STYLES = {
  teal: "tw-border-l-4 tw-border-bomet-teal",
  green: "tw-border-l-4 tw-border-green-500",
  amber: "tw-border-l-4 tw-border-amber-500",
  red: "tw-border-l-4 tw-border-red-500",
  slate: "tw-border-l-4 tw-border-slate-400",
};

const KpiCard = ({
  metric,
  subMetrics,
  selectedSubMetricId,
  onSubMetricChange,
  value,
  accent = "teal",
  loading = false,
}) => {
  const isUnavailable = value === "—";
  const displayValue = value ?? (loading ? "…" : "—");

  return (
    <div
      className={`dashboard-widget dashboard-kpi-card tw-flex tw-h-full tw-flex-col tw-overflow-hidden tw-px-3 tw-py-2 ${ACCENT_STYLES[accent] || ACCENT_STYLES.teal}`}
    >
      <p className="tw-line-clamp-2 tw-pr-5 tw-text-xs tw-font-semibold tw-leading-tight tw-text-slate-800">
        {metric}
      </p>
      <select
        value={selectedSubMetricId}
        onChange={(e) => onSubMetricChange(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={`View for ${metric}`}
        className="tw-mt-1 tw-max-w-full tw-self-start tw-rounded tw-border tw-border-slate-200 tw-bg-white tw-px-1.5 tw-py-0.5 tw-text-[10px] tw-leading-tight tw-text-slate-700 focus:tw-border-bomet-teal focus:tw-outline-none"
      >
        {subMetrics.map((sub) => (
          <option key={sub.id} value={sub.id}>
            {sub.label}
          </option>
        ))}
      </select>
      <p
        className={`tw-mt-1 tw-shrink-0 tw-text-xl tw-font-bold tw-leading-none ${
          isUnavailable ? "tw-text-slate-400" : "tw-text-slate-800"
        } ${loading ? "tw-animate-pulse" : ""}`}
      >
        {displayValue}
      </p>
    </div>
  );
};

export default KpiCard;
