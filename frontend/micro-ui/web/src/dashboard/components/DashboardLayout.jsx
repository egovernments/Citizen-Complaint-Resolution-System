import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getBrandTheme } from "../config/dashboardConfig";
import useBreakpoint from "../hooks/useBreakpoint";
import DashboardHeader from "./DashboardHeader";
import DashboardFilters from "./DashboardFilters";
import Sidebar from "./Sidebar";

const DashboardLayout = ({
  children,
  visibleLayoutIds,
  onAddWidget,
  onResetLayout,
  onDragWidgetStart,
  onDragWidgetEnd,
  searchQuery,
  onSearchQueryChange,
  onExport,
  filters,
  onFilterChange,
  onClearFilters,
  filterOptions,
  filterOptionsLoading,
  kpiCardData,
}) => {
  const breakpoint = useBreakpoint();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const brandStyle = useMemo(() => {
    const theme = getBrandTheme();
    return {
      "--brand-teal": theme.teal,
      "--brand-dark": theme.dark,
      "--brand-slate": theme.slate,
    };
  }, []);

  useEffect(() => {
    if (breakpoint === "lg") {
      setSidebarOpen(false);
    }
  }, [breakpoint]);

  const handleSidebarClose = useCallback(() => setSidebarOpen(false), []);
  const handleSidebarToggle = useCallback(
    () => setSidebarOpen((open) => !open),
    []
  );

  return (
    <div
      className="dashboard-root tw-flex tw-h-[100dvh] tw-min-h-screen tw-overflow-hidden tw-bg-background tw-font-sans tw-text-foreground"
      style={brandStyle}
    >
      {sidebarOpen && breakpoint !== "lg" ? (
        <button
          type="button"
          className="dashboard-sidebar-backdrop"
          aria-label="Close navigation"
          onClick={handleSidebarClose}
        />
      ) : null}
      <Sidebar
        isOpen={breakpoint === "lg" || sidebarOpen}
        onNavigate={handleSidebarClose}
      />
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-overflow-hidden">
        <DashboardHeader
          showMenuButton={breakpoint !== "lg"}
          onMenuToggle={handleSidebarToggle}
          visibleLayoutIds={visibleLayoutIds}
          onAddWidget={onAddWidget}
          onResetLayout={onResetLayout}
          onDragWidgetStart={onDragWidgetStart}
          onDragWidgetEnd={onDragWidgetEnd}
          searchQuery={searchQuery}
          onSearchQueryChange={onSearchQueryChange}
          onExport={onExport}
          filters={filters}
          filterOptions={filterOptions}
          kpiCardData={kpiCardData}
        />
        <main className="dashboard-main tw-min-w-0 tw-flex-1 tw-overflow-x-hidden tw-overflow-y-auto tw-bg-background tw-p-3 sm:tw-p-4 lg:tw-p-6">
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
