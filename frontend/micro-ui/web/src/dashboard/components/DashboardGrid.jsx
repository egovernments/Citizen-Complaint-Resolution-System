import React, { useCallback, useMemo } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  DROPPING_ITEM,
  DROPPING_ITEM_ID,
  WIDGETS,
  isKpiWidget,
} from "../constants/layoutConfig";
import { KPI_INVENTORY, departmentComplaints, monthlyTrend } from "../data/dummyData";
import KpiCard from "./KpiCard";
import DepartmentBarChart from "./DepartmentBarChart";
import TrendLineChart from "./TrendLineChart";

const ResponsiveGridLayout = WidthProvider(Responsive);

const KPI_LOOKUP = Object.fromEntries(KPI_INVENTORY.map((k) => [k.id, k]));

const GRID_MARGIN = [16, 16];
const DROP_SIZE = { w: DROPPING_ITEM.w, h: DROPPING_ITEM.h };

const DashboardGrid = ({ layout, onLayoutChange, onRemoveKpi, onDropKpi, draggingKpiId }) => {
  const isExternalDrag = Boolean(draggingKpiId);

  const layouts = useMemo(() => ({ lg: layout }), [layout]);

  const renderWidget = (widgetId) => {
    const meta = WIDGETS[widgetId];
    if (!meta) return null;

    if (meta.type === "kpi") {
      const kpi = KPI_LOOKUP[widgetId];
      return kpi ? <KpiCard label={kpi.label} value={kpi.value} accent={kpi.accent} /> : null;
    }
    if (widgetId === "chart-departments") {
      return <DepartmentBarChart data={departmentComplaints} />;
    }
    if (widgetId === "chart-trend") {
      return <TrendLineChart data={monthlyTrend} />;
    }
    return null;
  };

  const handleRemove = (event, widgetId) => {
    event.preventDefault();
    event.stopPropagation();
    onRemoveKpi(widgetId);
  };

  const handleDrop = useCallback(
    (_layout, item, event) => {
      const widgetId = event.dataTransfer.getData("text/plain");
      if (!widgetId || !isKpiWidget(widgetId) || !item) return;
      if (layout.some((entry) => entry.i === widgetId)) return;
      onDropKpi(widgetId, { x: item.x, y: item.y });
    },
    [layout, onDropKpi]
  );

  const handleDropDragOver = useCallback(() => {
    if (!draggingKpiId || !isKpiWidget(draggingKpiId)) return false;
    if (layout.some((entry) => entry.i === draggingKpiId)) return false;
    return DROP_SIZE;
  }, [draggingKpiId, layout]);

  const handleLayoutChange = useCallback(
    (_, allLayouts) => {
      // Ignore layout sync while an inventory KPI is being dragged — otherwise the
      // controlled layout prop resets RGL's internal drop placeholder and it jumps.
      if (isExternalDrag) return;

      const next = allLayouts.lg || layout;
      const withoutPlaceholder = next.filter((item) => item.i !== DROPPING_ITEM_ID);
      if (withoutPlaceholder.length !== next.length) return;
      onLayoutChange(withoutPlaceholder);
    },
    [isExternalDrag, layout, onLayoutChange]
  );

  return (
    <div>
      <div className={isExternalDrag ? "dashboard-external-drag" : undefined}>
        <ResponsiveGridLayout
          className="layout"
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
          cols={{ lg: 12, md: 12, sm: 6, xs: 4 }}
          rowHeight={60}
          margin={GRID_MARGIN}
          containerPadding={[0, 0]}
          onLayoutChange={handleLayoutChange}
          draggableHandle=".dashboard-drag-handle"
          compactType="vertical"
          isResizable
          isDroppable={isExternalDrag}
          droppingItem={DROPPING_ITEM}
          onDrop={handleDrop}
          onDropDragOver={handleDropDragOver}
        >
          {layout.map((item) => {
            const isKpi = isKpiWidget(item.i);

            if (isKpi) {
              return (
                <div key={item.i} className="dashboard-kpi-widget tw-group tw-flex tw-h-full tw-flex-col">
                  <div className="dashboard-drag-handle dashboard-kpi-drag-handle tw-flex tw-justify-end">
                    <button
                      type="button"
                      title="Remove from dashboard"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => handleRemove(e, item.i)}
                      className="dashboard-kpi-remove tw-flex tw-h-5 tw-w-5 tw-cursor-pointer tw-items-center tw-justify-center tw-rounded tw-bg-slate-200 tw-text-xs tw-font-bold tw-text-slate-600 hover:tw-bg-red-100 hover:tw-text-red-700"
                    >
                      ×
                    </button>
                  </div>
                  <div className="tw-min-h-0 tw-flex-1 tw-overflow-hidden">{renderWidget(item.i)}</div>
                </div>
              );
            }

            return (
              <div key={item.i} className="tw-h-full">
                <div className="dashboard-drag-handle tw-flex tw-items-center tw-justify-between tw-gap-2">
                  <span className="tw-truncate">{WIDGETS[item.i]?.label}</span>
                </div>
                <div className="tw-h-[calc(100%-36px)] tw-overflow-hidden">{renderWidget(item.i)}</div>
              </div>
            );
          })}
        </ResponsiveGridLayout>
      </div>
    </div>
  );
};

export default DashboardGrid;
