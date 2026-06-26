import React, { useMemo } from "react";
import { getProductLabel, getStateLabel } from "../config/dashboardConfig";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", href: "/digit-ui/employee/dashboard", active: true },
];

const Sidebar = ({ isOpen = true, onNavigate }) => {
  const stateLabel = useMemo(() => getStateLabel(), []);
  const productLabel = useMemo(() => getProductLabel(), []);

  return (
    <aside
      className={`dashboard-sidebar tw-flex tw-h-full tw-w-60 tw-flex-shrink-0 tw-flex-col tw-bg-chrome tw-text-chrome-foreground${
        isOpen ? " dashboard-sidebar--open" : ""
      }`}
      aria-hidden={!isOpen ? true : undefined}
    >
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
            onClick={onNavigate}
            className={`tw-block tw-rounded-md tw-px-3 tw-py-2 tw-text-sm tw-font-medium ${
              item.active
                ? "tw-bg-primary tw-text-primary-foreground"
                : "tw-text-chrome-foreground hover:tw-bg-[color-mix(in_srgb,var(--chrome-foreground)_12%,transparent)]"
            }`}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <div className="tw-flex-1" />
      <div className="tw-border-t tw-border-[color-mix(in_srgb,var(--chrome-foreground)_15%,transparent)] tw-p-4 tw-text-xs tw-text-chrome-muted">
        Supervisor
      </div>
    </aside>
  );
};

export default Sidebar;
