import React, { useCallback, useEffect, useMemo } from "react";
import "./styles/dashboard.css";
import DashboardLayout from "./components/DashboardLayout";
import DashboardGrid from "./components/DashboardGrid";
import { buildAllKpiCardData } from "./config/kpiQueries";
import { useDashboardLayout } from "./hooks/useDashboardLayout";
import { useDashboardData } from "./hooks/useDashboardData";
import { useDashboardFilters } from "./hooks/useDashboardFilters";

const AdminDashboard = () => {
  const { filters, setFilter, clearFilters, applyFilterOptions, resolveSubMetricId } =
    useDashboardFilters();
  const {
    subMetricValues,
    analyticsResults,
    chartData,
    filterOptions,
    loading,
    error,
    refetch,
  } = useDashboardData(filters);

  const kpiCardData = useMemo(
    () =>
      buildAllKpiCardData(
        analyticsResults,
        subMetricValues,
        resolveSubMetricId,
        loading
      ),
    [analyticsResults, subMetricValues, resolveSubMetricId, loading]
  );

  useEffect(() => {
    applyFilterOptions(filterOptions);
  }, [filterOptions, applyFilterOptions]);
  const {
    layout,
    onDragStop,
    onResizeStop,
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    addWidgetToLayout,
    visibleLayoutIds,
  } = useDashboardLayout();

  const handleDropKpi = useCallback(
    (widgetId, position) => {
      addKpiToLayout(widgetId, position);
    },
    [addKpiToLayout]
  );

  return (
    <DashboardLayout
      visibleLayoutIds={visibleLayoutIds}
      onAddWidget={addWidgetToLayout}
      onResetLayout={resetLayout}
      filters={filters}
      onFilterChange={setFilter}
      onClearFilters={clearFilters}
      filterOptions={filterOptions}
      filterOptionsLoading={loading}
    >
      {error && (
        <div className="tw-mb-4 tw-flex tw-items-center tw-justify-between tw-rounded-md tw-border tw-border-[color-mix(in_srgb,var(--destructive)_30%,transparent)] tw-bg-status-breach-bg tw-px-4 tw-py-3 tw-text-sm tw-text-destructive">
          <span>{error}</span>
          <button
            type="button"
            onClick={refetch}
            className="tw-ml-4 tw-flex-shrink-0 tw-rounded-md tw-border tw-border-[color-mix(in_srgb,var(--destructive)_40%,transparent)] tw-bg-surface tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-destructive hover:tw-bg-status-breach-bg"
          >
            Retry
          </button>
        </div>
      )}
      {layout.length === 0 ? (
        <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-rounded tw-border tw-border-dashed tw-border-border tw-bg-surface tw-py-16 tw-text-center">
          <p className="tw-text-[12px] tw-text-muted-foreground">No widgets on the dashboard.</p>
          <button
            type="button"
            onClick={resetLayout}
            className="dashboard-header-btn"
          >
            Reset layout
          </button>
        </div>
      ) : (
        <DashboardGrid
          layout={layout}
          onDragStop={onDragStop}
          onResizeStop={onResizeStop}
          onRemoveWidget={removeWidgetFromLayout}
          onDropKpi={handleDropKpi}
          draggingKpiId={null}
          kpiCardData={kpiCardData}
          chartData={chartData}
          loading={loading}
        />
      )}
    </DashboardLayout>
  );
};

export default AdminDashboard;
