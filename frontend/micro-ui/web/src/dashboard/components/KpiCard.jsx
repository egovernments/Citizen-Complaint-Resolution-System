import React from "react";
import { getStatusValueClass } from "../config/kpiDisplay";
import ResizeGrip from "./ResizeGrip";

const KpiCard = ({
  title,
  value,
  context,
  status,
  listItems = [],
  hasList = false,
  loading = false,
}) => {
  const isUnavailable = value === "—";
  const displayValue = value ?? (loading ? "…" : "—");
  const valueClass = isUnavailable
    ? "tw-text-slate-400"
    : getStatusValueClass(status);

  return (
    <div className="dashboard-widget dashboard-kpi-card tw-relative tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-overflow-hidden tw-px-3 tw-py-2.5">
      <p
        className="dashboard-kpi-title tw-min-w-0 tw-w-full tw-text-[10px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-500"
        title={title}
      >
        {title}
      </p>

      <p
        className={`tw-mt-1.5 tw-shrink-0 tw-text-xl tw-font-bold tw-leading-none ${valueClass} ${
          loading ? "tw-animate-pulse" : ""
        }`}
      >
        {displayValue}
      </p>

      {context ? (
        <p className="dashboard-kpi-context tw-mt-1 tw-shrink-0 tw-text-[11px] tw-leading-snug tw-text-slate-500">
          {context}
        </p>
      ) : null}

      {hasList ? (
        <div className="dashboard-kpi-list-body tw-mt-2 tw-min-h-0 tw-flex-1 tw-overflow-y-auto">
          {listItems.length > 0 ? (
            <ol className="dashboard-kpi-list tw-m-0 tw-list-none tw-space-y-1 tw-p-0">
              {listItems.map((item) => (
                <li
                  key={`${item.rank}-${item.label}`}
                  className="dashboard-kpi-list-item tw-flex tw-items-center tw-justify-between tw-gap-2 tw-rounded tw-bg-slate-50 tw-px-2 tw-py-1"
                >
                  <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1.5">
                    <span className="tw-flex tw-h-4 tw-w-4 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand-teal tw-text-[9px] tw-font-bold tw-text-white">
                      {item.rank}
                    </span>
                    <span
                      className="tw-min-w-0 tw-truncate tw-text-[11px] tw-text-slate-700"
                      title={item.label}
                    >
                      {item.label}
                    </span>
                  </div>
                  <span className="tw-shrink-0 tw-text-[11px] tw-font-semibold tw-text-slate-800">
                    {item.value}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="tw-text-[11px] tw-text-slate-400">
              {loading ? "Loading…" : "No list data"}
            </p>
          )}
        </div>
      ) : null}

      <ResizeGrip />
    </div>
  );
};

export default KpiCard;
