import React, { useMemo } from "react";
import { getBrandTheme } from "../config/dashboardConfig";
import DashboardHeader from "./DashboardHeader";
import DashboardFilters from "./DashboardFilters";
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
      className="dashboard-root tw-flex tw-h-screen tw-overflow-hidden tw-bg-slate-100 tw-font-sans tw-text-foreground"
      style={brandStyle}
    >
      <Sidebar />
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-overflow-hidden">
        <DashboardHeader
          visibleLayoutIds={visibleLayoutIds}
          onAddWidget={onAddWidget}
          onResetLayout={onResetLayout}
          filters={filters}
          filterOptions={filterOptions}
        />
        <main className="tw-flex-1 tw-overflow-auto tw-bg-slate-100 tw-p-4 lg:tw-p-6">
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
