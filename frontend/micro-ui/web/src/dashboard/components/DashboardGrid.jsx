import React, { useCallback, useMemo } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  DROPPING_ITEM,
  DROPPING_ITEM_ID,
  KPI_ROW_HEIGHT,
  WIDGETS,
  getSizeConstraints,
  isChartWidget,
  isKpiWidget,
} from "../constants/layoutConfig";
import { isTableWidget, TABLE_WIDGET_CONFIG } from "../config/dashboardTables";
import { isDemoTableWidget, isDemoVizWidget, hasCustomChrome } from "../config/demoVisualizations";
import KpiCard from "./KpiCard";
import DashboardTable from "./DashboardTable";
import DemoVisualization from "./DemoVisualization";
import DepartmentBarChart, { WEEKDAY_CHART_ORDER } from "./DepartmentBarChart";
import ComplaintMap from "./ComplaintMap";
import ResizeGrip from "./ResizeGrip";

const ResponsiveGridLayout = WidthProvider(Responsive);

const ChartPlaceholder = ({ message }) => (
  <div className="tw-flex tw-h-full tw-items-center tw-justify-center tw-p-4 tw-text-[12px] tw-text-muted-foreground">
    {message}
  </div>
);

const RemoveIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="tw-h-3.5 tw-w-3.5"
    aria-hidden="true"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const WidgetRemoveButton = ({ label, onClick }) => (
  <button
    type="button"
    title="Remove from dashboard"
    onMouseDown={(e) => e.stopPropagation()}
    onClick={onClick}
    className="dashboard-widget-remove-btn"
    aria-label={label}
  >
    <RemoveIcon />
  </button>
);

const WidgetHeader = ({ metric, subMetric }) => (
  <header className="dashboard-drag-handle tw-min-w-0">
    <div className="tw-min-w-0 tw-flex-1">
      <h2 className="dashboard-drag-handle-title">{metric}</h2>
      {subMetric ? (
        <p className="dashboard-drag-handle-subtitle">{subMetric}</p>
      ) : null}
    </div>
  </header>
);

// Per-card "last updated" caption, pinned bottom-right (offset to clear the
// resize grip). No backend freshness signal yet, so it uses the load time.
const CardUpdatedStamp = ({ label }) => (
  <span className="dashboard-card-updated tw-pointer-events-none tw-absolute tw-bottom-1 tw-right-5 tw-z-[2] tw-rounded tw-bg-surface tw-px-1 tw-text-[10px] tw-leading-tight tw-text-muted-foreground">
    Updated {label}
  </span>
);

const GRID_MARGIN = [16, 16];
const DROP_SIZE = { w: DROPPING_ITEM.w, h: DROPPING_ITEM.h };
const RESIZE_HANDLES = ["se"];

const CHART_OVERFLOW_VISIBLE_TYPES = new Set([
  "bar-chart",
  "horizontal-bar",
  "line-chart",
  "pie-chart",
  "stacked-bar",
  "histogram",
  "sla-toggle",
]);

function gridItemClassName(widgetId) {
  if (isKpiWidget(widgetId)) return "dashboard-grid-item-kpi";
  if (isTableWidget(widgetId) || isDemoTableWidget(widgetId)) {
    return "dashboard-grid-item-chart-clipped";
  }
  const type = WIDGETS[widgetId]?.type;
  if (type === "bar-chart" || CHART_OVERFLOW_VISIBLE_TYPES.has(type)) {
    return "dashboard-grid-item-chart-visible";
  }
  if (isChartWidget(widgetId)) return "dashboard-grid-item-chart-clipped";
  return undefined;
}

const DashboardGrid = ({
  layout,
  onDragStop,
  onResizeStop,
  onRemoveWidget,
  onDropKpi,
  draggingKpiId,
  kpiCardData = {},
  chartData = {},
  loading = false,
}) => {
  const isExternalDrag = Boolean(draggingKpiId);

  // Stamp the load time once. Swap for the API's data-as-of timestamp once a
  // backend freshness signal is available.
  const lastUpdatedLabel = useMemo(
    () =>
      new Date().toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
    []
  );

  const layouts = useMemo(() => {
    const lg = layout.map((item) => ({
      ...item,
      ...getSizeConstraints(item.i),
      resizeHandles: RESIZE_HANDLES,
      className: gridItemClassName(item.i),
    }));
    return { lg, md: lg, sm: lg, xs: lg };
  }, [layout]);

  const renderKpi = (metricId, onRemove) => {
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
        loading={loading}
        onRemove={onRemove}
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

    if (isDemoVizWidget(widgetId)) {
      return <DemoVisualization widgetId={widgetId} />;
    }

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

  const handleDragStop = useCallback(
    (nextLayout, oldItem, newItem) => {
      if (isExternalDrag) return;
      const withoutPlaceholder = nextLayout.filter((item) => item.i !== DROPPING_ITEM_ID);
      onDragStop(withoutPlaceholder, oldItem, newItem);
    },
    [isExternalDrag, onDragStop]
  );

  const handleResizeStop = useCallback(
    (nextLayout, oldItem, newItem) => {
      if (isExternalDrag) return;
      const withoutPlaceholder = nextLayout.filter((item) => item.i !== DROPPING_ITEM_ID);
      onResizeStop(withoutPlaceholder, oldItem, newItem);
    },
    [isExternalDrag, onResizeStop]
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
          onDragStop={handleDragStop}
          onResizeStop={handleResizeStop}
          draggableHandle=".dashboard-drag-handle, .dashboard-kpi-widget"
          compactType={null}
          allowOverlap
          isResizable
          isDroppable={isExternalDrag}
          droppingItem={DROPPING_ITEM}
          onDrop={handleDrop}
          onDropDragOver={handleDropDragOver}
        >
          {layout.map((item) => {
            const isKpi = isKpiWidget(item.i);
            const meta = WIDGETS[item.i];
            const isTable = isTableWidget(item.i) || isDemoTableWidget(item.i);
            const customChrome = meta?.customChrome || hasCustomChrome(item.i);

            if (isKpi) {
              return (
                <div
                  key={item.i}
                  className="dashboard-kpi-widget tw-group tw-relative tw-flex tw-h-full tw-flex-col tw-transition-all"
                >
                  {renderKpi(item.i, (e) => handleRemove(e, item.i))}
                  <CardUpdatedStamp label={lastUpdatedLabel} />
                </div>
              );
            }

            return (
              <section
                key={item.i}
                className="tw-group tw-relative tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-overflow-hidden tw-rounded tw-border tw-border-border tw-bg-surface"
              >
                <WidgetRemoveButton
                  label={`Remove ${meta?.metric ?? item.i}`}
                  onClick={(e) => handleRemove(e, item.i)}
                />
                {customChrome ? (
                  <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden">
                    {renderWidget(item.i)}
                  </div>
                ) : (
                  <>
                    {meta && (
                      <WidgetHeader metric={meta.metric} subMetric={meta.subMetric} />
                    )}
                    <div
                      className={
                        isTable
                          ? "dashboard-table-body tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-p-4"
                          : "tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden tw-p-4"
                      }
                    >
                      {isTable ? (
                        <div className="dashboard-table-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto">
                          {renderWidget(item.i)}
                        </div>
                      ) : (
                        renderWidget(item.i)
                      )}
                    </div>
                  </>
                )}
                <CardUpdatedStamp label={lastUpdatedLabel} />
                <ResizeGrip />
              </section>
            );
          })}
        </ResponsiveGridLayout>
      </div>
    </div>
  );
};

export default DashboardGrid;
