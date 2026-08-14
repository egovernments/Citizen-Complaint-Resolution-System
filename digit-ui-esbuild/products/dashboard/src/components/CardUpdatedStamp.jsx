import React from "react";
import useDashboardT from "../i18n/useDashboardT";

const CardUpdatedStamp = ({ label }) => {
  const { t } = useDashboardT();
  return (
    <span className="dashboard-card-updated tw-pointer-events-none tw-absolute tw-bottom-1 tw-right-5 tw-z-[2] tw-rounded tw-bg-surface tw-px-1 tw-text-[10px] tw-leading-tight tw-text-muted-foreground">
      {t("DASHBOARD_COMMON_UPDATED", "Updated")} {label}
    </span>
  );
};

export default CardUpdatedStamp;
