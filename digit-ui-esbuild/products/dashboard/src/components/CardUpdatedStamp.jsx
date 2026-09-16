import React, { useEffect, useState } from "react";
import useDashboardT from "../i18n/useDashboardT";
import { formatUpdatedAgoLabel } from "../utils/formatUpdatedAgo";

const TICK_MS = 60_000;

/**
 * Tile freshness stamp (#2047): "Updated 5 min ago" / "Updated 2 hrs ago"
 * relative to the batch asOf, refreshing once a minute while the page is open.
 */
const CardUpdatedStamp = ({ asOf }) => {
  const { t } = useDashboardT();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const label = formatUpdatedAgoLabel(asOf, t, nowMs);
  if (!label) return null;

  return (
    <span className="dashboard-card-updated tw-pointer-events-none tw-absolute tw-bottom-1 tw-right-5 tw-z-[2] tw-rounded tw-bg-surface tw-px-1 tw-text-[10px] tw-leading-tight tw-text-muted-foreground">
      {t("DASHBOARD_COMMON_UPDATED", "Updated")} {label}
    </span>
  );
};

export default CardUpdatedStamp;
