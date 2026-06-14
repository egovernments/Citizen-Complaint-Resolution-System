import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  DROPPING_ITEM,
  DROPPING_ITEM_ID,
  KPI_ROW_HEIGHT,
  WIDGETS,
  isChartWidget,
  isKpiWidget,
} from "../constants/layoutConfig";
import { isTableWidget, TABLE_WIDGET_CONFIG } from "../config/dashboardTables";
import KpiCard from "./KpiCard";
import DashboardTable from "./DashboardTable";
import DepartmentBarChart, { WEEKDAY_CHART_ORDER } from "./DepartmentBarChart";
import ComplaintMap from "./ComplaintMap";
import ResizeGrip from "./ResizeGrip";

const ResponsiveGridLayout = WidthProvider(Responsive);

const ChartPlaceholder = ({ message }) => (
  <div className="tw-flex tw-h-full tw-items-center tw-justify-center tw-p-3 tw-text-sm tw-text-slate-500">
    {message}
  </div>
);

const WidgetHeader = ({ metric, subMetric, compact = false }) => (
  <div
    className={`dashboard-drag-handle tw-min-w-0 tw-shrink-0 tw-border-b tw-border-slate-100 tw-px-3 ${
      compact ? "tw-py-1.5" : "tw-py-2"
    }`}
  >
    <p
      className={`tw-truncate tw-font-semibold tw-text-slate-800 ${
        compact ? "tw-text-[11px] tw-leading-tight" : "tw-text-xs"
      }`}
    >
      {metric}
    </p>
    {subMetric ? (
      <p className="tw-truncate tw-text-[10px] tw-leading-tight tw-text-slate-400">{subMetric}</p>
    ) : null}
  </div>
);

const GRID_MARGIN = [16, 16];
const GRID_COLS = 12;
const DROP_SIZE = { w: DROPPING_ITEM.w, h: DROPPING_ITEM.h };
const RESIZE_HANDLES = ["se"];

function measureGridMetrics(containerWidth) {
  if (!containerWidth) return null;
  const [marginX, marginY] = GRID_MARGIN;
  const colWidth = (containerWidth - marginX * (GRID_COLS + 1)) / GRID_COLS;
  return {
    colWidth,
    rowHeight: KPI_ROW_HEIGHT,
    marginX,
    marginY,
  };
}

function dragItemTransform(itemId, layout, dragStartRef, draggingItemId, gridMetrics) {
  if (!draggingItemId || !gridMetrics || !dragStartRef.current?.positions?.[itemId]) {
    return undefined;
  }

  const start = dragStartRef.current.positions[itemId];
  const target = layout.find((entry) => entry.i === itemId);
  if (!target) return undefined;

  const dx = (target.x - start.x) * (gridMetrics.colWidth + gridMetrics.marginX);
  const dy = (target.y - start.y) * (gridMetrics.rowHeight + gridMetrics.marginY);
  if (dx === 0 && dy === 0) return undefined;

  return {
    transform: `translate(${dx}px, ${dy}px)`,
    transition: "transform 150ms ease-out",
    willChange: "transform",
  };
}

function gridItemClassName(widgetId) {
  if (isKpiWidget(widgetId)) return "dashboard-grid-item-kpi";
  if (isTableWidget(widgetId)) return "dashboard-grid-item-chart-clipped";
  if (WIDGETS[widgetId]?.type === "bar-chart") {
    return "dashboard-grid-item-chart-visible";
  }
  if (isChartWidget(widgetId)) return "dashboard-grid-item-chart-clipped";
  return undefined;
}

const DashboardGrid = ({
  layout,
  onLayoutChange,
  onLayoutStop,
  onDragBegin,
  onRemoveWidget,
  onDropKpi,
  draggingKpiId,
  kpiCardData = {},
  chartData = {},
  loading = false,
}) => {
  const isExternalDrag = Boolean(draggingKpiId);
  const activeItemRef = useRef(null);
  const dragOriginRef = useRef(null);
  const interactionRef = useRef(null);
  const gridWrapRef = useRef(null);
  const dragStartRef = useRef(null);
  const [preventCollision, setPreventCollision] = useState(false);
  const [draggingItemId, setDraggingItemId] = useState(null);
  const [gridMetrics, setGridMetrics] = useState(null);

  useEffect(() => {
    const node = gridWrapRef.current;
    if (!node) return undefined;

    const update = () => {
      setGridMetrics(measureGridMetrics(node.offsetWidth));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const layouts = useMemo(() => {
    const lg = layout.map((item) => ({
      ...item,
      resizeHandles: RESIZE_HANDLES,
      className: gridItemClassName(item.i),
    }));
    return { lg, md: lg, sm: lg, xs: lg };
  }, [layout]);

  const renderKpi = (metricId) => {
    const card = kpiCardData?.[metricId];
    if (!card) return null;

    return (
      <KpiCard
        title={card.title}
        value={card.value}
        context={card.context}
        status={card.status}
        listItems={card.listItems}
        hasList={card.hasList}
        loading={loading && card.value == null}
      />
    );
  };

  const renderBarChart = (widgetId) => {
    if (widgetId === "cl-chart-categories") {
      if (loading && !chartData.categories?.length) {
        return <ChartPlaceholder message="Loading…" />;
      }
      if (!chartData.categories?.length) return <ChartPlaceholder message="No data" />;
      return <DepartmentBarChart data={chartData.categories} />;
    }

    if (widgetId === "cl-chart-wards") {
      if (loading && !chartData.wards?.length) {
        return <ChartPlaceholder message="Loading…" />;
      }
      if (!chartData.wards?.length) return <ChartPlaceholder message="No data" />;
      return <DepartmentBarChart data={chartData.wards} />;
    }

    if (widgetId === "cl-chart-dow") {
      if (loading) return <ChartPlaceholder message="Loading…" />;
      return (
        <DepartmentBarChart
          data={chartData.dow}
          categoryOrder={WEEKDAY_CHART_ORDER}
          compact
        />
      );
    }

    return null;
  };

  const renderTableWidget = (widgetId) => {
    const config = TABLE_WIDGET_CONFIG[widgetId];
    if (!config) return null;

    const rows = chartData[config.dataKey] || [];
    if (loading && !rows.length) return <ChartPlaceholder message="Loading…" />;
    if (!rows.length) return <ChartPlaceholder message="No data" />;

    return <DashboardTable columns={config.columns} rows={rows} />;
  };

  const renderMap = () => {
    const pins = chartData.mapPins || [];
    if (loading && !pins.length) return <ChartPlaceholder message="Loading…" />;
    if (!pins.length) return <ChartPlaceholder message="No mapped complaints" />;
    return <ComplaintMap pins={pins} />;
  };

  const renderWidget = (widgetId) => {
    const meta = WIDGETS[widgetId];
    if (!meta) return null;

    if (meta.type === "kpi") {
      return renderKpi(widgetId);
    }

    if (isTableWidget(widgetId)) {
      return renderTableWidget(widgetId);
    }

    if (meta.type === "bar-chart") {
      return renderBarChart(widgetId);
    }

    if (meta.type === "map") {
      return renderMap(widgetId);
    }

    return null;
  };

  const handleRemove = (event, widgetId) => {
    event.preventDefault();
    event.stopPropagation();
    onRemoveWidget(widgetId);
  };

  const handleDrop = useCallback(
    (gridLayout, item, event) => {
      const widgetId = event.dataTransfer.getData("text/plain");
      if (!widgetId || !isKpiWidget(widgetId)) return;
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
      if (isExternalDrag) return;
      const mode = interactionRef.current;
      // Drag swaps are handled in onDrag — skip here to avoid fighting RGL.
      if (mode === "drag") return;

      const next = allLayouts.lg || layout;
      const withoutPlaceholder = next.filter((item) => item.i !== DROPPING_ITEM_ID);
      if (withoutPlaceholder.length !== next.length) return;

      onLayoutChange(withoutPlaceholder, activeItemRef.current, {
        passThrough: false,
        mode,
      });
    },
    [isExternalDrag, layout, onLayoutChange]
  );

  const handleDrag = useCallback(
    (gridLayout, _oldItem, newItem) => {
      if (isExternalDrag || interactionRef.current !== "drag") return;

      onLayoutChange(gridLayout, newItem.i, {
        passThrough: true,
        pointerPos: { x: newItem.x, y: newItem.y },
      });
    },
    [isExternalDrag, onLayoutChange]
  );

  const handleDragStop = useCallback(
    (nextLayout) => {
      if (isExternalDrag) return;
      const withoutPlaceholder = nextLayout.filter((item) => item.i !== DROPPING_ITEM_ID);
      const activeId = activeItemRef.current;
      activeItemRef.current = null;
      dragOriginRef.current = null;
      interactionRef.current = null;
      setDraggingItemId(null);
      dragStartRef.current = null;
      setPreventCollision(false);
      onLayoutStop(withoutPlaceholder, "drag", activeId);
    },
    [isExternalDrag, onLayoutStop]
  );

  const handleResizeStop = useCallback(
    (nextLayout) => {
      if (isExternalDrag) return;
      const withoutPlaceholder = nextLayout.filter((item) => item.i !== DROPPING_ITEM_ID);
      const activeId = activeItemRef.current;
      activeItemRef.current = null;
      interactionRef.current = null;
      setPreventCollision(true);
      onLayoutStop(withoutPlaceholder, "resize", activeId);
    },
    [isExternalDrag, onLayoutStop]
  );

  const handleDragStart = useCallback(
    (_layout, oldItem, newItem) => {
      activeItemRef.current = newItem.i;
      dragOriginRef.current = { x: oldItem.x, y: oldItem.y };
      interactionRef.current = "drag";
      setDraggingItemId(newItem.i);
      setPreventCollision(false);

      dragStartRef.current = {
        positions: Object.fromEntries(
          layout.map((item) => [item.i, { x: item.x, y: item.y }])
        ),
      };

      onDragBegin?.(dragOriginRef.current, layout);
    },
    [layout, onDragBegin]
  );

  const handleResizeStart = useCallback((_layout, _oldItem, newItem) => {
    activeItemRef.current = newItem.i;
    interactionRef.current = "resize";
    setPreventCollision(false);
  }, []);

  return (
    <div ref={gridWrapRef}>
      <div className={isExternalDrag ? "dashboard-external-drag" : undefined}>
        <ResponsiveGridLayout
          className="layout"
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
          cols={{ lg: 12, md: 12, sm: 6, xs: 4 }}
          rowHeight={KPI_ROW_HEIGHT}
          margin={GRID_MARGIN}
          containerPadding={[0, 0]}
          onLayoutChange={handleLayoutChange}
          onDrag={handleDrag}
          onDragStart={handleDragStart}
          onResizeStart={handleResizeStart}
          onDragStop={handleDragStop}
          onResizeStop={handleResizeStop}
          draggableHandle=".dashboard-drag-handle, .dashboard-kpi-widget"
          compactType={null}
          preventCollision={preventCollision}
          isResizable
          isDroppable={isExternalDrag}
          droppingItem={DROPPING_ITEM}
          onDrop={handleDrop}
          onDropDragOver={handleDropDragOver}
        >
          {layout.map((item) => {
            const isKpi = isKpiWidget(item.i);
            const meta = WIDGETS[item.i];
            const isTable = isTableWidget(item.i);
            const isBarChart = meta?.type === "bar-chart";
            const offsetStyle = dragItemTransform(
              item.i,
              layout,
              dragStartRef,
              draggingItemId,
              gridMetrics
            );

            if (isKpi) {
              return (
                <div
                  key={item.i}
                  className="dashboard-kpi-widget tw-group tw-relative tw-h-full"
                  style={offsetStyle}
                >
                  <button
                    type="button"
                    title="Remove from dashboard"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => handleRemove(e, item.i)}
                    className="dashboard-kpi-remove tw-absolute tw-right-2 tw-top-2 tw-z-10 tw-flex tw-h-5 tw-w-5 tw-cursor-pointer tw-items-center tw-justify-center tw-rounded tw-bg-slate-200 tw-text-xs tw-font-bold tw-text-slate-600 hover:tw-bg-red-100 hover:tw-text-red-700"
                  >
                    ×
                  </button>
                  <div className="tw-h-full tw-overflow-hidden">{renderWidget(item.i)}</div>
                </div>
              );
            }

            return (
              <div
                key={item.i}
                className="tw-group tw-relative tw-h-full"
                style={offsetStyle}
              >
                <button
                  type="button"
                  title="Remove from dashboard"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleRemove(e, item.i)}
                  className="dashboard-kpi-remove tw-absolute tw-right-2 tw-top-2 tw-z-10 tw-flex tw-h-5 tw-w-5 tw-cursor-pointer tw-items-center tw-justify-center tw-rounded tw-bg-slate-200 tw-text-xs tw-font-bold tw-text-slate-600 hover:tw-bg-red-100 hover:tw-text-red-700"
                >
                  ×
                </button>
                <div className="dashboard-widget dashboard-chart-widget tw-relative tw-flex tw-h-full tw-min-h-0 tw-w-full tw-flex-col tw-overflow-hidden">
                  {meta && (
                    <WidgetHeader
                      metric={meta.metric}
                      subMetric={meta.subMetric}
                      compact={isTable}
                    />
                  )}
                  <div
                    className={
                      isTable
                        ? "dashboard-table-body tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden tw-px-2 tw-pb-2 tw-pt-1"
                        : isBarChart
                          ? "tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden tw-p-2"
                          : "tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden tw-p-3"
                    }
                  >
                    {renderWidget(item.i)}
                  </div>
                  <ResizeGrip />
                </div>
              </div>
            );
          })}
        </ResponsiveGridLayout>
      </div>
    </div>
  );
};

export default DashboardGrid;
