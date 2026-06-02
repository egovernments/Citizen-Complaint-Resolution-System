import React from "react";

const ACCENT_STYLES = {
  teal: "tw-border-l-4 tw-border-bomet-teal",
  green: "tw-border-l-4 tw-border-green-500",
  amber: "tw-border-l-4 tw-border-amber-500",
  red: "tw-border-l-4 tw-border-red-500",
  slate: "tw-border-l-4 tw-border-slate-400",
};

const KpiCard = ({ label, value, accent = "teal" }) => (
  <div className={`dashboard-widget tw-flex tw-flex-col tw-justify-center tw-p-4 ${ACCENT_STYLES[accent] || ACCENT_STYLES.teal}`}>
    <p className="tw-text-sm tw-font-medium tw-text-slate-500">{label}</p>
    <p className="tw-mt-2 tw-text-3xl tw-font-bold tw-text-slate-800">{value}</p>
  </div>
);

export default KpiCard;
