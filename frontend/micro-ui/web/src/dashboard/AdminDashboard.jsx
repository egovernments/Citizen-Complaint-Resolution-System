import React, { useCallback, useState } from "react";
import "./styles/dashboard.css";
import DashboardLayout from "./components/DashboardLayout";
import DashboardGrid from "./components/DashboardGrid";
import { useDashboardLayout } from "./hooks/useDashboardLayout";

const AdminDashboard = () => {
  const [draggingKpiId, setDraggingKpiId] = useState(null);
  const {
    layout,
    onLayoutChange,
    resetLayout,
    removeKpiFromLayout,
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
    (widgetId, position) => {
      addKpiToLayout(widgetId, position);
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
    >
      <DashboardGrid
        layout={layout}
        onLayoutChange={onLayoutChange}
        onRemoveKpi={removeKpiFromLayout}
        onDropKpi={handleDropKpi}
        draggingKpiId={draggingKpiId}
      />
    </DashboardLayout>
  );
};

export default AdminDashboard;
