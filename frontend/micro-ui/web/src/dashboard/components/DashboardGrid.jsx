import React, { useCallback, useMemo } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  DROPPING_ITEM,
  DROPPING_ITEM_ID,
  KPI_ROW_HEIGHT,
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

const ChartPlaceholder = ({ message }) => (
  <div className="dashboard-widget tw-flex tw-h-full tw-items-center tw-justify-center tw-p-4 tw-text-sm tw-text-slate-500">
    {message}
  </div>
);

const WidgetHeader = ({ metric, subMetric }) => (
  <div className="dashboard-drag-handle tw-border-b tw-border-slate-100 tw-px-4 tw-py-2">
    <p className="tw-text-xs tw-font-semibold tw-text-slate-700">{metric}</p>
    <p className="tw-truncate tw-text-[10px] tw-text-slate-400">{subMetric}</p>
  </div>
);

const GRID_MARGIN = [16, 16];
const DROP_SIZE = { w: DROPPING_ITEM.w, h: DROPPING_ITEM.h };
const FULL_RESIZE_HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const KPI_RESIZE_HANDLES = [];

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

  const layouts = useMemo(
    () => ({
      lg: layout.map((item) => ({
        ...item,
        resizeHandles: isKpiWidget(item.i) ? KPI_RESIZE_HANDLES : FULL_RESIZE_HANDLES,
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
      return <DepartmentBarChart data={chartData.categories} labelRotate />;
    }

    if (widgetId === "cl-chart-wards") {
      if (loading && !chartData.wards?.length) return <ChartPlaceholder message="Loading…" />;
      if (!chartData.wards?.length) return <ChartPlaceholder message="No data" />;
      return <DepartmentBarChart data={chartData.wards} labelRotate />;
    }

    if (widgetId === "cl-chart-dow") {
      if (loading) return <ChartPlaceholder message="Loading…" />;
      return (
        <DepartmentBarChart
          data={chartData.dow}
          categoryOrder={WEEKDAY_CHART_ORDER}
          labelRotate={false}
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
    (_layout, _item, event) => {
      const widgetId = event.dataTransfer.getData("text/plain");
      if (!widgetId || !isKpiWidget(widgetId)) return;
      if (layout.some((entry) => entry.i === widgetId)) return;
      onDropKpi(widgetId);
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
      onLayoutChange(withoutPlaceholder);
    },
    [isExternalDrag, layout, onLayoutChange]
  );

  const handleLayoutStop = useCallback(
    (nextLayout) => {
      if (isExternalDrag) return;
      const withoutPlaceholder = nextLayout.filter((item) => item.i !== DROPPING_ITEM_ID);
      onLayoutStop(withoutPlaceholder);
    },
    [isExternalDrag, onLayoutStop]
  );

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
          onDragStop={handleLayoutStop}
          onResizeStop={handleLayoutStop}
          draggableHandle=".dashboard-drag-handle, .dashboard-kpi-widget"
          compactType={null}
          preventCollision
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
                {meta && <WidgetHeader metric={meta.metric} subMetric={meta.subMetric} />}
                <div className="tw-h-[calc(100%-52px)] tw-min-h-[300px] tw-overflow-hidden">
                  {renderWidget(item.i)}
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
