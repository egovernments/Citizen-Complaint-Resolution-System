import React, { useMemo } from "react";
import { getBrandTheme } from "../config/dashboardConfig";
import DashboardHeader from "./DashboardHeader";
import Sidebar from "./Sidebar";

const DashboardLayout = ({
  children,
  visibleLayoutIds,
  onAddWidget,
  onResetLayout,
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
      <Sidebar />
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-overflow-hidden">
        <DashboardHeader
          visibleLayoutIds={visibleLayoutIds}
          onAddWidget={onAddWidget}
          onResetLayout={onResetLayout}
          filters={filters}
          onFilterChange={onFilterChange}
          onClearFilters={onClearFilters}
          filterOptions={filterOptions}
          filterOptionsLoading={filterOptionsLoading}
        />
        <main className="tw-flex-1 tw-overflow-auto tw-bg-slate-100 tw-px-5 tw-pb-5 tw-pt-4">
          {children}
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
