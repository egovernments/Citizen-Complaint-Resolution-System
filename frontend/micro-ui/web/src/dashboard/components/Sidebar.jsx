import React from "react";
import KpiInventory from "./KpiInventory";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", href: "/digit-ui/employee/dashboard", active: true },
  { id: "complaints", label: "Complaints", href: "#", disabled: true },
  { id: "reports", label: "Reports", href: "#", disabled: true },
  { id: "settings", label: "Settings", href: "#", disabled: true },
];

const Sidebar = ({ visibleKpiIds, onAddKpi, onDragKpiStart, onDragKpiEnd }) => (
  <aside className="tw-flex tw-h-full tw-w-60 tw-flex-shrink-0 tw-flex-col tw-bg-bomet-dark tw-text-white">
    <div className="tw-border-b tw-border-teal-800 tw-px-5 tw-py-5">
      <p className="tw-text-xs tw-font-medium tw-uppercase tw-tracking-wider tw-text-teal-200">
        Bomet County
      </p>
      <h1 className="tw-mt-1 tw-text-lg tw-font-bold tw-leading-tight">
        Complaint Resolution
      </h1>
    </div>
    <nav className="tw-space-y-1 tw-p-3">
      {NAV_ITEMS.map((item) =>
        item.disabled ? (
          <span
            key={item.id}
            className="tw-block tw-cursor-not-allowed tw-rounded-md tw-px-3 tw-py-2 tw-text-sm tw-text-teal-300 tw-opacity-50"
            title="Coming soon"
          >
            {item.label}
          </span>
        ) : (
          <a
            key={item.id}
            href={item.href}
            className={`tw-block tw-rounded-md tw-px-3 tw-py-2 tw-text-sm tw-font-medium ${
              item.active
                ? "tw-bg-teal-700 tw-text-white"
                : "tw-text-teal-100 hover:tw-bg-teal-800"
            }`}
          >
            {item.label}
          </a>
        )
      )}
    </nav>
    <KpiInventory
      visibleKpiIds={visibleKpiIds}
      onAddKpi={onAddKpi}
      onDragKpiStart={onDragKpiStart}
      onDragKpiEnd={onDragKpiEnd}
    />
    <div className="tw-border-t tw-border-teal-800 tw-p-4 tw-text-xs tw-text-teal-300">
      Admin view · v1.0
    </div>
  </aside>
);

export default Sidebar;
