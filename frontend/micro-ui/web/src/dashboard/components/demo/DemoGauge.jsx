import React from "react";

const DemoGauge = ({ value = 0, target = 90, label = "SLA compliance" }) => {
  const pct = Math.min(100, Math.max(0, value));
  const onTrack = pct >= target;
  const barColor = onTrack ? "var(--status-resolved)" : "var(--primary)";

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-justify-center tw-gap-4">
      <div className="tw-text-center">
        <div className="tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted-foreground">
          {label}
        </div>
        <div className="tw-mt-2 tw-text-[32px] tw-font-semibold tw-tabular-nums tw-leading-none tw-text-foreground">
          {pct}%
        </div>
        <div className="tw-mt-1 tw-text-[12px] tw-text-muted-foreground">Target: {target}%</div>
      </div>
      <div className="tw-px-2">
        <div className="tw-h-3 tw-w-full tw-overflow-hidden tw-rounded-full tw-bg-muted">
          <div
            className="tw-h-full tw-rounded-full tw-transition-all"
            style={{ width: `${pct}%`, backgroundColor: barColor }}
          />
        </div>
        <div className="tw-mt-2 tw-flex tw-justify-between tw-text-[10px] tw-text-muted-foreground">
          <span>0%</span>
          <span
            className="tw-font-medium"
            style={{ color: onTrack ? "var(--status-resolved)" : undefined }}
          >
            {onTrack ? "On track" : `${target - pct}% below goal`}
          </span>
          <span>100%</span>
        </div>
      </div>
    </div>
  );
};

export default DemoGauge;
