import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles/dashboard.css";
import DashboardLayout from "./components/DashboardLayout";
import DashboardGrid from "./components/DashboardGrid";
import { buildAllKpiCardData } from "./config/kpiQueries";
import { isKpiWidget } from "./constants/layoutConfig";
import { useDashboardLayout } from "./hooks/useDashboardLayout";
import { useDashboardData } from "./hooks/useDashboardData";
import { useDashboardFilters } from "./hooks/useDashboardFilters";
import { useCatalogGating } from "./hooks/useCatalogGating";
import { downloadDashboardExport } from "./utils/exportDashboard";
import { countMatchingWidgets } from "./utils/dashboardSearch";

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
        loading,
        filters
      ),
    [analyticsResults, subMetricValues, resolveSubMetricId, loading, filters]
  );

  useEffect(() => {
    applyFilterOptions(filterOptions);
  }, [filterOptions, applyFilterOptions]);
  const {
    layout,
    onDragStop,
    onResizeStop,
    onLayoutChange,
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    addWidgetToLayout,
    visibleLayoutIds,
  } = useDashboardLayout();

  // Backend catalog role-gating. When the catalog returns a non-empty allowed
  // set, hide widgets/metric cards the logged-in user's roles may not see
  // (e.g. officer-PII KPIs for a GRO). When the catalog is unavailable/empty,
  // gating is inactive and the full local config renders (graceful fallback).
  const { gatingActive, allowedWidgetIds, roleLabel } = useCatalogGating();

  // Gate the rendered grid: drop any laid-out widget that isn't in the allowed
  // set. Falls back to the unfiltered layout when gating is inactive.
  const gatedLayout = useMemo(() => {
    if (!gatingActive || !allowedWidgetIds) return layout;
    return layout.filter((item) => allowedWidgetIds.has(item.i));
  }, [layout, gatingActive, allowedWidgetIds]);


  const [searchQuery, setSearchQuery] = useState("");
  const [draggingWidgetId, setDraggingWidgetId] = useState(null);
  const draggingWidgetIdRef = useRef(null);

  const handleDragWidgetStart = useCallback((widgetId) => {
    draggingWidgetIdRef.current = widgetId;
    setDraggingWidgetId(widgetId);
  }, []);

  const searchContext = useMemo(
    () => ({ kpiCardData, chartData }),
    [kpiCardData, chartData]
  );

  const matchingWidgetCount = useMemo(
    () => countMatchingWidgets(gatedLayout, searchQuery, searchContext),
    [gatedLayout, searchQuery, searchContext]
  );

  const handleDropWidget = useCallback(
    (widgetId, position) => {
      if (isKpiWidget(widgetId)) {
        addKpiToLayout(widgetId, position);
        return;
      }
      addWidgetToLayout(widgetId, position);
    },
    [addKpiToLayout, addWidgetToLayout]
  );

  const handleExternalDragEnd = useCallback(() => {
    draggingWidgetIdRef.current = null;
    setDraggingWidgetId(null);
  }, []);

  // Listen unconditionally so dragend is not missed when it fires before React
  // re-renders after dragstart (e.g. drag source removed from the DOM).
  useEffect(() => {
    const onWindowDragEnd = () => {
      if (draggingWidgetIdRef.current) handleExternalDragEnd();
    };
    window.addEventListener("dragend", onWindowDragEnd);
    return () => window.removeEventListener("dragend", onWindowDragEnd);
  }, [handleExternalDragEnd]);

  const handleExport = useCallback(() => {
    downloadDashboardExport({
      layout: gatedLayout,
      kpiCardData,
      chartData,
      filters,
    });
  }, [gatedLayout, kpiCardData, chartData, filters]);

  return (
    <DashboardLayout
      visibleLayoutIds={visibleLayoutIds}
      onAddWidget={addWidgetToLayout}
      onResetLayout={resetLayout}
      onDragWidgetStart={handleDragWidgetStart}
      onDragWidgetEnd={handleExternalDragEnd}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      onExport={handleExport}
      filters={filters}
      onFilterChange={setFilter}
      onClearFilters={clearFilters}
      filterOptions={filterOptions}
      filterOptionsLoading={loading}
      kpiCardData={kpiCardData}
      allowedWidgetIds={gatingActive ? allowedWidgetIds : null}
      scopedRole={gatingActive ? roleLabel : null}
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
      {gatedLayout.length === 0 ? (
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
        <>
          {searchQuery.trim() && matchingWidgetCount === 0 ? (
            <p className="tw-mb-3 tw-text-[12px] tw-text-muted-foreground">
              No widgets match &ldquo;{searchQuery.trim()}&rdquo;.
            </p>
          ) : null}
          <DashboardGrid
            layout={gatedLayout}
            onDragStop={onDragStop}
            onResizeStop={onResizeStop}
            onLayoutChange={onLayoutChange}
            onRemoveWidget={removeWidgetFromLayout}
            onDropWidget={handleDropWidget}
            onExternalDragEnd={handleExternalDragEnd}
            draggingWidgetId={draggingWidgetId}
            draggingWidgetIdRef={draggingWidgetIdRef}
            searchQuery={searchQuery}
            searchContext={searchContext}
            kpiCardData={kpiCardData}
            chartData={chartData}
            loading={loading}
          />
        </>
      )}
    </DashboardLayout>
  );
};

export default AdminDashboard;
