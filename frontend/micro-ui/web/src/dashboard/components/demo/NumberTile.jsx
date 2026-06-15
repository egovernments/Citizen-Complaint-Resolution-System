import React from "react";

const NumberTile = ({ value, label, context }) => (
  <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-justify-center">
    <div className="tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted-foreground">
      {label}
    </div>
    <div className="tw-mt-2 tw-text-[36px] tw-font-semibold tw-tabular-nums tw-leading-none tw-text-foreground">
      {value}
    </div>
    {context ? (
      <div className="tw-mt-2 tw-text-[12px] tw-text-muted-foreground">{context}</div>
    ) : null}
  </div>
);

export default NumberTile;
