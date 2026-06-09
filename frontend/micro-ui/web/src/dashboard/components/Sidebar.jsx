import React, { useMemo } from "react";
import { getProductLabel, getStateLabel } from "../config/dashboardConfig";
import KpiInventory from "./KpiInventory";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", href: "/digit-ui/employee/dashboard", active: true },
];

const Sidebar = ({
  visibleKpiIds,
  onAddKpi,
  onDragKpiStart,
  onDragKpiEnd,
  subMetricValues,
  getSubMetricId,
}) => {
  const stateLabel = useMemo(() => getStateLabel(), []);
  const productLabel = useMemo(() => getProductLabel(), []);

  return (
    <aside className="tw-flex tw-h-full tw-w-60 tw-flex-shrink-0 tw-flex-col tw-bg-brand-dark tw-text-white">
      <div className="tw-border-b tw-border-teal-800 tw-px-5 tw-py-5">
        <p className="tw-text-xs tw-font-medium tw-uppercase tw-tracking-wider tw-text-teal-200">
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
              item.active ? "tw-bg-teal-700 tw-text-white" : "tw-text-teal-100 hover:tw-bg-teal-800"
            }`}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <KpiInventory
        visibleKpiIds={visibleKpiIds}
        onAddKpi={onAddKpi}
        onDragKpiStart={onDragKpiStart}
        onDragKpiEnd={onDragKpiEnd}
        subMetricValues={subMetricValues}
        getSubMetricId={getSubMetricId}
      />
      <div className="tw-border-t tw-border-teal-800 tw-p-4 tw-text-xs tw-text-teal-300">
        Supervisor
      </div>
    </aside>
  );
};

export default Sidebar;
