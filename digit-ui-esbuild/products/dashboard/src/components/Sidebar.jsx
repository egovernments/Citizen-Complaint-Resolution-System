import React, { useMemo } from "react";
import { getProductLabel, getStateLabel } from "../config/dashboardConfig";
import useDashboardT from "../i18n/useDashboardT";

// Labels are functions of t so they resolve at render time (never frozen at import).
const NAV_ITEMS = [
  {
    id: "dashboard",
    label: (t) => t("DASHBOARD_SIDEBAR_DASHBOARD", "Dashboard"),
    href: "/digit-ui/employee/dashboard",
    active: true,
  },
];

/** Signed-in employee's username + significant (non-EMPLOYEE) role, for the footer. */
function getSignedInLabel() {
  try {
    const raw = window.localStorage?.getItem("Employee.user-info");
    if (!raw) return null;
    const u = JSON.parse(raw);
    const info = u?.roles ? u : u?.userInfo || u;
    const roles = info?.roles || [];
    const role =
      roles.find((r) => r.code && r.code !== "EMPLOYEE")?.code ||
      roles[0]?.code ||
      info?.type;
    const name = info?.userName || info?.name;
    if (name && role) return `${name} · ${role}`;
    return role || name || null;
  } catch {
    return null;
  }
}

const Sidebar = ({ onSignOut }) => {
  const { t } = useDashboardT();
  const stateLabel = useMemo(() => getStateLabel(), []);
  const productLabel = useMemo(() => getProductLabel(), []);
  const signedInLabel = useMemo(() => getSignedInLabel(), []);

  return (
    <aside className="tw-flex tw-h-full tw-w-60 tw-flex-shrink-0 tw-flex-col tw-bg-chrome tw-text-chrome-foreground">
      <div className="tw-border-b tw-border-[color-mix(in_srgb,var(--chrome-foreground)_15%,transparent)] tw-px-5 tw-py-5">
        <p className="tw-text-xs tw-font-medium tw-uppercase tw-tracking-wider tw-text-chrome-muted">
          {stateLabel}
        </p>
        <h1 className="tw-mt-1 tw-text-lg tw-font-bold tw-leading-tight">
          {productLabel}
        </h1>
      </div>
      <nav className="tw-space-y-1 tw-p-3">
        {NAV_ITEMS.map((item) => (
          <a
            key={item.id}
            href={item.href}
            className={`tw-block tw-rounded-md tw-px-3 tw-py-2 tw-text-sm tw-font-medium ${
              item.active
                ? "tw-bg-primary tw-text-primary-foreground"
                : "tw-text-chrome-foreground hover:tw-bg-[color-mix(in_srgb,var(--chrome-foreground)_12%,transparent)]"
            }`}
          >
            {item.label(t)}
          </a>
        ))}
      </nav>
      <div className="tw-flex-1" />
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-border-t tw-border-[color-mix(in_srgb,var(--chrome-foreground)_15%,transparent)] tw-p-4 tw-text-xs tw-text-chrome-muted">
        <span className="tw-min-w-0 tw-truncate" title={signedInLabel || undefined}>
          {signedInLabel || t("DASHBOARD_SIDEBAR_NOT_SIGNED_IN", "Not signed in")}
        </span>
        {onSignOut ? (
          <button
            type="button"
            onClick={onSignOut}
            title={t("DASHBOARD_SIDEBAR_SIGN_OUT", "Sign out")}
            className="tw-flex-shrink-0 tw-rounded-md tw-px-2.5 tw-py-1 tw-text-[11px] tw-font-medium tw-text-chrome-foreground hover:tw-bg-[color-mix(in_srgb,var(--chrome-foreground)_22%,transparent)]"
            style={{
              // Explicit subtle fill: without it the browser's default light
              // buttonface shows through, making the light label unreadable on the
              // dark sidebar.
              backgroundColor:
                "color-mix(in srgb, var(--chrome-foreground) 12%, transparent)",
              border:
                "1px solid color-mix(in srgb, var(--chrome-foreground) 35%, transparent)",
            }}
          >
            {t("DASHBOARD_SIDEBAR_SIGN_OUT", "Sign out")}
          </button>
        ) : null}
      </div>
    </aside>
  );
};

export default Sidebar;
