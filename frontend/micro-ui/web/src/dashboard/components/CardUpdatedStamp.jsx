import React from "react";

const CardUpdatedStamp = ({ label }) => (
  <span className="dashboard-card-updated tw-pointer-events-none tw-absolute tw-bottom-1 tw-right-5 tw-z-[2] tw-rounded tw-bg-surface tw-px-1 tw-text-[10px] tw-leading-tight tw-text-muted-foreground">
    Updated {label}
  </span>
);

export default CardUpdatedStamp;
