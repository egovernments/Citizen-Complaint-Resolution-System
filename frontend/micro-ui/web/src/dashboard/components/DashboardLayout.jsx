import React, { useMemo } from "react";
import { getBrandTheme } from "../config/dashboardConfig";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import DashboardFilters from "./DashboardFilters";

const DashboardLayout = ({
  children,
  onResetLayout,
  visibleLayoutIds,
  onAddWidget,
  onDragKpiStart,
  onDragKpiEnd,
  asOf,
  filters,
  onFilterChange,
  onClearFilters,
  filterOptions,
  filterOptionsLoading,
}) => {
  const brandStyle = useMemo(() => {
    const theme = getBrandTheme();
    return {
      "--brand-teal": theme.teal,
      "--brand-dark": theme.dark,
      "--brand-slate": theme.slate,
    };
  }, []);

  return (
    <div
      className="tw-flex tw-h-screen tw-overflow-hidden tw-bg-slate-100"
      style={brandStyle}
    >
      <Sidebar
        visibleLayoutIds={visibleLayoutIds}
        onAddWidget={onAddWidget}
        onDragKpiStart={onDragKpiStart}
        onDragKpiEnd={onDragKpiEnd}
      />
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
        <Navbar onResetLayout={onResetLayout} asOf={asOf} />
        <main className="tw-flex-1 tw-overflow-auto tw-bg-slate-100 tw-p-6">
          <DashboardFilters
            filters={filters}
            onFilterChange={onFilterChange}
            onClearFilters={onClearFilters}
            filterOptions={filterOptions}
            filterOptionsLoading={filterOptionsLoading}
          />
          {children}
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
