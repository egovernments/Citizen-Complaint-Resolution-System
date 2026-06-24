import React, { useMemo } from "react";
import { getSystemTitle } from "../config/dashboardConfig";

function getUserInfo() {
  try {
    const fromSession = window.Digit?.SessionStorage?.get("User")?.info;
    if (fromSession?.name) return fromSession;

    const raw = localStorage.getItem("Employee.user-info");
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed?.name ? parsed : parsed?.userInfo || parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function formatAsOf(asOf) {
  if (asOf == null) return null;
  const date = new Date(Number(asOf));
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString();
}

const Navbar = ({ onResetLayout, asOf }) => {
  const user = useMemo(() => getUserInfo(), []);
  const systemTitle = useMemo(() => getSystemTitle(), []);

  const displayName = user?.name || "Admin User";
  const displayRole =
    user?.roles?.[0]?.name || user?.type || "Administrator";
  const asOfLabel = formatAsOf(asOf);

  return (
    <header className="tw-flex tw-h-16 tw-flex-shrink-0 tw-items-center tw-justify-between tw-border-b tw-border-border tw-bg-surface tw-px-6 tw-shadow-sm">
      <div>
        <h2 className="tw-text-lg tw-font-semibold tw-text-foreground">
          {systemTitle}
        </h2>
        <p className="tw-text-xs tw-text-muted-foreground">
          {asOfLabel ? `Data as of ${asOfLabel}` : "Supervisor dashboard"}
        </p>
      </div>
      <div className="tw-flex tw-items-center tw-gap-4">
        <button
          type="button"
          onClick={onResetLayout}
          className="tw-rounded-md tw-border tw-border-border tw-bg-surface tw-px-3 tw-py-1.5 tw-text-xs tw-font-medium tw-text-muted-foreground hover:tw-bg-muted"
        >
          Reset layout
        </button>
        <div className="tw-text-right">
          <p className="tw-text-sm tw-font-medium tw-text-foreground">{displayName}</p>
          <p className="tw-text-xs tw-text-muted-foreground">{displayRole}</p>
        </div>
        <div className="tw-flex tw-h-10 tw-w-10 tw-items-center tw-justify-center tw-rounded-full tw-bg-primary tw-text-sm tw-font-bold tw-text-primary-foreground">
          {displayName.charAt(0).toUpperCase()}
        </div>
      </div>
    </header>
  );
};

export default Navbar;
