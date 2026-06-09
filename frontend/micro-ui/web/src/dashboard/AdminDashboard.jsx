import React, { useCallback, useState } from "react";
import "./styles/dashboard.css";
import DashboardLayout from "./components/DashboardLayout";
import DashboardGrid from "./components/DashboardGrid";
import { useDashboardLayout } from "./hooks/useDashboardLayout";
import { useDashboardData } from "./hooks/useDashboardData";
import { useSubMetricSelection } from "./hooks/useSubMetricSelection";

const AdminDashboard = () => {
  const [draggingKpiId, setDraggingKpiId] = useState(null);
  const { subMetricValues, chartData, loading, error, asOf, refetch } = useDashboardData();
  const { getSubMetricId, setSubMetricId } = useSubMetricSelection();
  const {
    layout,
    onLayoutChange,
    onLayoutStop,
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    visibleKpiIds,
  } = useDashboardLayout();

  const handleDragKpiStart = useCallback((kpiId) => {
    setDraggingKpiId(kpiId);
  }, []);

  const handleDragKpiEnd = useCallback(() => {
    setDraggingKpiId(null);
  }, []);

  const handleDropKpi = useCallback(
    (widgetId) => {
      addKpiToLayout(widgetId);
      setDraggingKpiId(null);
    },
    [addKpiToLayout]
  );

  return (
    <DashboardLayout
      onResetLayout={resetLayout}
      visibleKpiIds={visibleKpiIds}
      onAddKpi={addKpiToLayout}
      onDragKpiStart={handleDragKpiStart}
      onDragKpiEnd={handleDragKpiEnd}
      subMetricValues={subMetricValues}
      getSubMetricId={getSubMetricId}
      asOf={asOf}
      error={error}
      onRetry={refetch}
    >
      {error && (
        <div className="tw-mb-4 tw-flex tw-items-center tw-justify-between tw-rounded-md tw-border tw-border-red-200 tw-bg-red-50 tw-px-4 tw-py-3 tw-text-sm tw-text-red-800">
          <span>{error}</span>
          <button
            type="button"
            onClick={refetch}
            className="tw-ml-4 tw-flex-shrink-0 tw-rounded-md tw-border tw-border-red-300 tw-bg-white tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-red-700 hover:tw-bg-red-100"
          >
            Retry
          </button>
        </div>
      )}
      <DashboardGrid
        layout={layout}
        onLayoutChange={onLayoutChange}
        onLayoutStop={onLayoutStop}
        onRemoveWidget={removeWidgetFromLayout}
        onDropKpi={handleDropKpi}
        draggingKpiId={draggingKpiId}
        subMetricValues={subMetricValues}
        getSubMetricId={getSubMetricId}
        setSubMetricId={setSubMetricId}
        chartData={chartData}
        loading={loading}
      />
    </DashboardLayout>
  );
};

export default AdminDashboard;
