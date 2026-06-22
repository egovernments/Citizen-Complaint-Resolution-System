import React, { useCallback, useMemo } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  DROPPING_ITEM,
  DROPPING_ITEM_ID,
  GRID_COLS,
  KPI_ROW_HEIGHT,
  WIDGETS,
  getSizeConstraints,
  getDefaultChartItem,
  getDefaultKpiLayoutItem,
  getResizeHandles,
  isChartWidget,
  isKpiWidget,
} from "../constants/layoutConfig";
import { widgetMatchesSearch } from "../utils/dashboardSearch";
import { isTableWidget, TABLE_WIDGET_CONFIG } from "../config/dashboardTables";
import {
  SHARED_CHROME,
  buildWidgetHeaderClassName,
  getWidgetBodyClassName,
  getWidgetScrollClassName,
  isChartOverflowVisibleType,
  VIZ_TYPE,
} from "../config/visualizationStyles";
import { isDemoTableWidget, isDemoVizWidget, hasCustomChrome } from "../config/demoVisualizations";
import KpiCard from "./KpiCard";
import KpiSparklineCard from "./KpiSparklineCard";
import DashboardTable from "./DashboardTable";
import DemoVisualization from "./DemoVisualization";
import DepartmentBarChart, { WEEKDAY_CHART_ORDER } from "./DepartmentBarChart";
import StackedBarChart from "./StackedBarChart";
import ResizeGrip from "./ResizeGrip";
import CardUpdatedStamp from "./CardUpdatedStamp";

const GridLayoutWithWidth = WidthProvider(GridLayout);

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

const WidgetHeader = ({
  metric,
  subMetric,
  headerClassName = SHARED_CHROME.dragHandle,
}) => (
  <header className={`${headerClassName} tw-min-w-0`}>
    <div className="tw-min-w-0 tw-flex-1">
      <h2 className={SHARED_CHROME.dragHandleTitle}>{metric}</h2>
      {subMetric ? (
        <p className={SHARED_CHROME.dragHandleSubtitle}>{subMetric}</p>
      ) : null}
    </div>
  </header>
);

// Per-card "last updated" caption — absolute bottom-right on every card.
const GRID_MARGIN = [16, 16];
function gridItemClassName(widgetId) {
  if (isKpiWidget(widgetId)) return "dashboard-grid-item-kpi";
  if (isTableWidget(widgetId) || isDemoTableWidget(widgetId)) {
    return "dashboard-grid-item-chart-clipped";
  }
  const vizType = WIDGETS[widgetId]?.type;
  if (vizType && isChartOverflowVisibleType(vizType)) {
    return "dashboard-grid-item-chart-visible";
  }
  if (isChartWidget(widgetId)) return "dashboard-grid-item-chart-clipped";
  return undefined;
}

function getDropPreviewSize(widgetId) {
  if (isKpiWidget(widgetId)) {
    const defaults = getDefaultKpiLayoutItem(widgetId);
    return { w: defaults.w, h: defaults.h };
  }
  const defaults = getDefaultChartItem(widgetId);
  if (defaults) return { w: defaults.w, h: defaults.h };
  return { w: DROPPING_ITEM.w, h: DROPPING_ITEM.h };
}

const DashboardGrid = ({
  layout,
  onDragStop,
  onResizeStop,
  onLayoutChange,
  onRemoveWidget,
  onDropWidget,
  onExternalDragEnd,
  draggingWidgetId,
  searchQuery = "",
  searchContext = {},
  kpiCardData = {},
  chartData = {},
  loading = false,
}) => {
  const isExternalDrag = Boolean(draggingWidgetId);
  const isSearchActive = Boolean(searchQuery?.trim());

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

  const gridLayout = useMemo(
    () =>
      layout.map((item) => ({
        ...item,
        ...getSizeConstraints(item.i),
        resizeHandles: getResizeHandles(item.i),
        className: gridItemClassName(item.i),
      })),
    [layout]
  );

  const renderKpi = (metricId, onRemove) => {
    const card = kpiCardData?.[metricId];
    if (!card) return null;

    if (card.vizType === VIZ_TYPE.NUMBER_TILE_SPARKLINE) {
      return (
        <KpiSparklineCard
          title={card.title}
          value={card.value}
          status={card.status}
          deltaDisplay={card.deltaDisplay}
          deltaClass={card.deltaClass}
          seriesColor={card.seriesColor}
          sparkline={card.sparkline}
          loading={loading}
          onRemove={onRemove}
        />
      );
    }

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
      return <DepartmentBarChart data={chartData.categories} scrollKey={widgetId} />;
    }

    if (widgetId === "cl-chart-wards") {
      if (loading && !chartData.wards?.length) {
        return <ChartPlaceholder message="Loading…" />;
      }
      if (!chartData.wards?.length) return <ChartPlaceholder message="No data" />;
      return <DepartmentBarChart data={chartData.wards} scrollKey={widgetId} />;
    }

    if (widgetId === "cl-chart-dow") {
      if (loading) return <ChartPlaceholder message="Loading…" />;
      return (
        <DepartmentBarChart
          data={chartData.dow}
          categoryOrder={WEEKDAY_CHART_ORDER}
          scrollKey={widgetId}
        />
      );
    }

    return null;
  };

  const renderStackedBar = (widgetId) => {
    const meta = WIDGETS[widgetId];
    const horizontal = meta?.stackOrientation === "horizontal";
    const dataset =
      widgetId === "cl-chart-officer-sla"
        ? chartData.officerSlaStacked
        : chartData.statusWeekStacked;

    const { categories = [], series = [], colors = [] } = dataset || {};
    const hasData =
      categories.length > 0 &&
      series.some((entry) => entry.data?.some((value) => Number(value) > 0));

    if (loading && !hasData) {
      return <ChartPlaceholder message="Loading…" />;
    }
    if (!hasData) return <ChartPlaceholder message="No data" />;

    return (
      <StackedBarChart
        categories={categories}
        series={series}
        colors={colors}
        horizontal={horizontal}
        scrollKey={widgetId}
      />
    );
  };

  const renderTableWidget = (widgetId) => {
    const config = TABLE_WIDGET_CONFIG[widgetId];
    if (!config) return null;

    const rows = chartData[config.dataKey] || [];
    if (loading && !rows.length) return <ChartPlaceholder message="Loading…" />;
    if (!rows.length) return <ChartPlaceholder message="No data" />;

    return <DashboardTable columns={config.columns} rows={rows} />;
  };

  const renderWidget = (widgetId) => {
    const meta = WIDGETS[widgetId];
    if (!meta) return null;

    if (isDemoVizWidget(widgetId)) {
      return (
        <DemoVisualization
          widgetId={widgetId}
          lastUpdatedLabel={lastUpdatedLabel}
        />
      );
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

    if (meta.type === "stacked-bar") {
      return renderStackedBar(widgetId);
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
      // Clear external-drag mode before RGL re-syncs so dropping state can't
      // stick and block normal grid drags until refresh.
      onExternalDragEnd?.();

      const widgetId = event.dataTransfer.getData("text/plain");
      if (!widgetId || !WIDGETS[widgetId]) return;
      if (layout.some((entry) => entry.i === widgetId)) return;

      requestAnimationFrame(() => {
        onDropWidget(widgetId, { x: item.x, y: item.y });
      });
    },
    [layout, onDropWidget, onExternalDragEnd]
  );

  const handleDropDragOver = useCallback(() => {
    if (!draggingWidgetId || !WIDGETS[draggingWidgetId]) return false;
    if (layout.some((entry) => entry.i === draggingWidgetId)) return false;
    return getDropPreviewSize(draggingWidgetId);
  }, [draggingWidgetId, layout]);

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

  const handleLayoutChange = useCallback(
    (nextLayout) => {
      if (isExternalDrag) return;
      const withoutPlaceholder = nextLayout.filter((item) => item.i !== DROPPING_ITEM_ID);
      onLayoutChange(withoutPlaceholder);
    },
    [isExternalDrag, onLayoutChange]
  );

  return (
    <div>
      <div className={isExternalDrag ? "dashboard-external-drag" : undefined}>
        <GridLayoutWithWidth
          className="layout"
          layout={gridLayout}
          cols={GRID_COLS}
          rowHeight={KPI_ROW_HEIGHT}
          margin={GRID_MARGIN}
          containerPadding={[0, 0]}
          onDragStop={handleDragStop}
          onResizeStop={handleResizeStop}
          onLayoutChange={handleLayoutChange}
          draggableHandle=".dashboard-widget-surface"
          draggableCancel=".dashboard-widget-remove-btn, .dashboard-view-toggle, .dashboard-gauge-target-marker, .dashboard-table-scroll, .dashboard-chart-scroll-viewport, .dashboard-kpi-list-body, .leaflet-container, a, button, input, select, textarea"
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
            const vizType = meta?.type;
            const isTable = isTableWidget(item.i) || isDemoTableWidget(item.i);
            const customChrome = meta?.customChrome || hasCustomChrome(item.i);
            const isSearchMatch =
              !isSearchActive ||
              widgetMatchesSearch(item.i, searchQuery, {
                kpiCardData,
                chartData,
                ...searchContext,
              });
            const dimClass = isSearchMatch ? "" : " dashboard-search-dimmed";

            if (isKpi) {
              return (
                <div
                  key={item.i}
                  className={`dashboard-kpi-widget dashboard-widget-surface tw-group tw-relative tw-flex tw-h-full tw-flex-col tw-transition-all${dimClass}`}
                >
                  {renderKpi(item.i, (e) => handleRemove(e, item.i))}
                  <CardUpdatedStamp label={lastUpdatedLabel} />
                </div>
              );
            }

            return (
              <section
                key={item.i}
                className={`dashboard-widget-surface tw-group tw-relative tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-overflow-hidden tw-rounded tw-border tw-border-border tw-bg-surface${dimClass}`}
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
                      <WidgetHeader
                        metric={meta.metric}
                        subMetric={meta.subMetric}
                        headerClassName={buildWidgetHeaderClassName(vizType)}
                      />
                    )}
                    <div
                      className={getWidgetBodyClassName(vizType, { isTable })}
                    >
                      {isTable ? (
                        <div className={getWidgetScrollClassName()}>
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
        </GridLayoutWithWidth>
      </div>
    </div>
  );
};

export default DashboardGrid;
