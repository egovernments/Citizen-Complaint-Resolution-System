import React from "react";
import useDashboardT from "../i18n/useDashboardT";

/**
 * Deploy dependency: `DASHBOARD_COMMON_UPDATED` must be upserted + cache-busted
 * (en_IN / pt_PT rainmaker-dashboard) before or with this FE — `t()` echoes the
 * raw KEY on a miss, so unseeded tenants would show "DASHBOARD_COMMON_UPDATED …".
 * Packs: local-setup/db/dss-mdms-seed/l10n/{en_IN,pt_PT}.json via export-l10n.mjs.
 */
const CardUpdatedStamp = ({ label }) => {
  const { t } = useDashboardT();
  return (
    <span className="dashboard-card-updated tw-pointer-events-none tw-absolute tw-bottom-1 tw-right-5 tw-z-[2] tw-rounded tw-bg-surface tw-px-1 tw-text-[10px] tw-leading-tight tw-text-muted-foreground">
      {t("DASHBOARD_COMMON_UPDATED", "Updated")} {label}
    </span>
  );
};

export default CardUpdatedStamp;
