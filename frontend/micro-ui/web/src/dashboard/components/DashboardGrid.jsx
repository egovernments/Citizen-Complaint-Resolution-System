import React, { useCallback, useMemo, useRef, useState } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  DROPPING_ITEM,
  DROPPING_ITEM_ID,
  KPI_ROW_HEIGHT,
  RANKED_LIST_WIDGET_ID,
  WIDGETS,
  isKpiWidget,
} from "../constants/layoutConfig";
import {
  KPI_METRICS,
  getSubMetricDef,
  subMetricValueKey,
} from "../config/kpiQueries";
import KpiCard from "./KpiCard";
import DepartmentBarChart, { WEEKDAY_CHART_ORDER } from "./DepartmentBarChart";
import RankedList from "./RankedList";

const ResponsiveGridLayout = WidthProvider(Responsive);

const METRIC_LOOKUP = Object.fromEntries(KPI_METRICS.map((m) => [m.id, m]));

const WIDGET_PADDING = "tw-p-3";

const ChartPlaceholder = ({ message }) => (
  <div className={`tw-flex tw-h-full tw-items-center tw-justify-center tw-text-sm tw-text-slate-500 ${WIDGET_PADDING}`}>
    {message}
  </div>
);

const WidgetHeader = ({ metric, subMetric }) => (
  <div className={`dashboard-drag-handle tw-min-w-0 tw-shrink-0 tw-border-b tw-border-slate-100 tw-px-3 tw-py-2`}>
    <p className="tw-truncate tw-text-xs tw-font-semibold tw-text-slate-700">{metric}</p>
    <p className="tw-truncate tw-text-[10px] tw-text-slate-400">{subMetric}</p>
  </div>
);

const GRID_MARGIN = [16, 16];
const DROP_SIZE = { w: DROPPING_ITEM.w, h: DROPPING_ITEM.h };
const RESIZE_HANDLES = ["se"];

const DashboardGrid = ({
  layout,
  onLayoutChange,
  onLayoutStop,
  onRemoveWidget,
  onDropKpi,
  draggingKpiId,
  subMetricValues = {},
  getSubMetricId,
  setSubMetricId,
  chartData = { categories: [], wards: [], dow: [], rankedCategories: [] },
  loading = false,
}) => {
  const isExternalDrag = Boolean(draggingKpiId);
  const activeItemRef = useRef(null);
  const interactionRef = useRef(null);
  const [preventCollision, setPreventCollision] = useState(true);

  const layouts = useMemo(
    () => ({
      lg: layout.map((item) => ({
        ...item,
        resizeHandles: RESIZE_HANDLES,
      })),
    }),
    [layout]
  );

  const renderKpi = (metricId) => {
    const metric = METRIC_LOOKUP[metricId];
    if (!metric) return null;

    const selectedSubMetricId = getSubMetricId(metricId);
    const sub = getSubMetricDef(metric, selectedSubMetricId);
    const value = subMetricValues[subMetricValueKey(metricId, sub.id)];

    return (
      <KpiCard
        metric={metric.metric}
        subMetrics={metric.subMetrics}
        selectedSubMetricId={sub.id}
        onSubMetricChange={(nextId) => setSubMetricId(metricId, nextId)}
        value={value}
        accent={metric.accent}
        loading={loading && value == null}
      />
    );
  };

  const renderWidget = (widgetId) => {
    const meta = WIDGETS[widgetId];
    if (!meta) return null;

    if (meta.type === "kpi") {
      return renderKpi(widgetId);
    }

    if (widgetId === "cl-chart-categories") {
      if (loading && !chartData.categories?.length) return <ChartPlaceholder message="Loading…" />;
      if (!chartData.categories?.length) return <ChartPlaceholder message="No data" />;
      return <DepartmentBarChart data={chartData.categories} />;
    }

    if (widgetId === "cl-chart-wards") {
      if (loading && !chartData.wards?.length) return <ChartPlaceholder message="Loading…" />;
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

    if (widgetId === "cl-list-categories") {
      if (loading && !chartData.rankedCategories?.length) {
        return <ChartPlaceholder message="Loading…" />;
      }
      if (!chartData.rankedCategories?.length) return <ChartPlaceholder message="No data" />;
      return <RankedList items={chartData.rankedCategories} />;
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
      const next = allLayouts.lg || layout;
      const withoutPlaceholder = next.filter((item) => item.i !== DROPPING_ITEM_ID);
      if (withoutPlaceholder.length !== next.length) return;

      const mode = interactionRef.current;
      onLayoutChange(withoutPlaceholder, activeItemRef.current, {
        passThrough: mode === "drag",
        mode,
      });
    },
    [isExternalDrag, layout, onLayoutChange]
  );

  const handleDragStop = useCallback(
    (nextLayout) => {
      if (isExternalDrag) return;
      const withoutPlaceholder = nextLayout.filter((item) => item.i !== DROPPING_ITEM_ID);
      const activeId = activeItemRef.current;
      activeItemRef.current = null;
      interactionRef.current = null;
      setPreventCollision(true);
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

  const handleDragStart = useCallback((_layout, _oldItem, newItem) => {
    activeItemRef.current = newItem.i;
    interactionRef.current = "drag";
    setPreventCollision(true);
  }, []);

  const handleResizeStart = useCallback((_layout, _oldItem, newItem) => {
    activeItemRef.current = newItem.i;
    interactionRef.current = "resize";
    setPreventCollision(false);
  }, []);

  return (
    <div>
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

            if (isKpi) {
              return (
                <div key={item.i} className="dashboard-kpi-widget tw-group tw-relative tw-h-full">
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
              <div key={item.i} className="tw-group tw-relative tw-h-full">
                <button
                  type="button"
                  title="Remove from dashboard"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleRemove(e, item.i)}
                  className="dashboard-kpi-remove tw-absolute tw-right-2 tw-top-2 tw-z-10 tw-flex tw-h-5 tw-w-5 tw-cursor-pointer tw-items-center tw-justify-center tw-rounded tw-bg-slate-200 tw-text-xs tw-font-bold tw-text-slate-600 hover:tw-bg-red-100 hover:tw-text-red-700"
                >
                  ×
                </button>
                <div className="dashboard-widget dashboard-chart-widget tw-flex tw-h-full tw-min-h-0 tw-w-full tw-flex-col">
                  {meta && <WidgetHeader metric={meta.metric} subMetric={meta.subMetric} />}
                  <div
                    className={`tw-flex tw-min-h-0 tw-flex-col tw-justify-start tw-overflow-visible ${WIDGET_PADDING} ${
                      item.i === RANKED_LIST_WIDGET_ID ? "tw-shrink-0" : "tw-flex-1"
                    }`}
                  >
                    {renderWidget(item.i)}
                  </div>
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
