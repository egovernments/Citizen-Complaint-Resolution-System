import React, { useMemo } from "react";
import { getBrandTheme } from "../config/dashboardConfig";
import DashboardHeader from "./DashboardHeader";
import DashboardFilters from "./DashboardFilters";
import Sidebar from "./Sidebar";
import DashboardFooter from "./DashboardFooter";

const DashboardLayout = ({
  children,
  visibleLayoutIds,
  catalogItems,
  onAddWidget,
  onResetLayout,
  onDragWidgetStart,
  onDragWidgetEnd,
  onExport,
  filters,
  onFilterChange,
  onClearFilters,
  timeZone,
  filterOptions,
  filterOptionsLoading,
  kpiCardData,
  allowedWidgetIds,
  scopedRole,
  username,
  officerAccess,
  visibleKpiCount,
  scope,
  onSignOut,
  embedded = false,
  readOnly = false,
  publicMode = false,
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
      // Embedded = mounted inside the DigitUI employee chrome: keep
      // .dashboard-root (all CSS variables + chart color resolution hang off
      // it) and add the .dashboard-embedded modifier, whose CSS overrides
      // (appended in styles/input.css + dashboard.css) neutralize the
      // full-viewport shell so the page scrolls naturally in the host.
      className={`dashboard-root${embedded ? " dashboard-embedded" : ""}${publicMode ? " dashboard-public" : ""} tw-flex tw-h-screen tw-overflow-hidden tw-bg-background tw-font-sans tw-text-foreground`}
      style={brandStyle}
    >
      {/* The employee nav sidebar stays off the public page; its filter bar,
          Add KPI / Reset and language switcher render through the header and
          main column like every other mode (#1797). */}
      {!embedded && !publicMode && <Sidebar onSignOut={onSignOut} />}
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-overflow-hidden">
        <DashboardHeader
          visibleLayoutIds={visibleLayoutIds}
          catalogItems={catalogItems}
          onAddWidget={onAddWidget}
          onResetLayout={onResetLayout}
          onDragWidgetStart={onDragWidgetStart}
          onDragWidgetEnd={onDragWidgetEnd}
          onExport={onExport}
          filters={filters}
          filterOptions={filterOptions}
          kpiCardData={kpiCardData}
          allowedWidgetIds={allowedWidgetIds}
          scopedRole={scopedRole}
          officerAccess={officerAccess}
          visibleKpiCount={visibleKpiCount}
          scope={scope}
          readOnly={readOnly}
          publicMode={publicMode}
          showLanguageMenu={!embedded}
        />
        <main
          className={
            embedded
              ? "dashboard-main tw-flex-1 tw-min-w-0 tw-max-w-full tw-overflow-x-clip tw-overflow-y-auto tw-bg-background"
              : "dashboard-main tw-flex-1 tw-overflow-auto tw-bg-background tw-p-4 lg:tw-p-6"
          }
        >
          {!readOnly && (
            <DashboardFilters
              filters={filters}
              onFilterChange={onFilterChange}
              onClearFilters={onClearFilters}
              timeZone={timeZone}
              filterOptions={filterOptions}
              filterOptionsLoading={filterOptionsLoading}
            />
          )}
          {children}
        </main>
        {/* Sibling of <main>, not a child: the shell is tw-h-screen with an
            overflow-hidden column, so the footer must sit outside the scroll
            container to stay pinned at the bottom. In embedded mode the
            employee shell renders its own attribution above us, so skip ours
            rather than stacking two. */}
        {!embedded && <DashboardFooter />}
      </div>
    </div>
  );
};

export default DashboardLayout;
