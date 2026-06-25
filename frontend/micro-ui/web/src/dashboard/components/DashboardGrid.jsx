import React, { useCallback, useMemo, useRef } from "react";
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
import ComplaintsAtRiskTable from "./ComplaintsAtRiskTable";
import HorizontalBarChart from "./HorizontalBarChart";
import OpenComplaintsByGeographyWidget from "./OpenComplaintsByGeographyWidget";
import DepartmentBarChart from "./DepartmentBarChart";
import StackedBarChart from "./StackedBarChart";
import LineChart from "./LineChart";
import PieChart from "./PieChart";
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
function isScrollableTableWidget(widgetId) {
  return (
    isTableWidget(widgetId) ||
    isDemoTableWidget(widgetId) ||
    widgetId === "cl-table-complaints-at-risk"
  );
}

function gridItemClassName(widgetId) {
  if (isKpiWidget(widgetId)) return "dashboard-grid-item-kpi";
  if (widgetId === "cl-map-geography-choropleth") {
    return "dashboard-grid-item-chart-visible dashboard-grid-item-map";
  }
  if (isScrollableTableWidget(widgetId)) {
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

function pixelToGridPosition(containerWidth, clientX, clientY, gridRect, widgetId) {
  const { w, h } = getDropPreviewSize(widgetId);
  const colWidth = (containerWidth - GRID_MARGIN[0] * (GRID_COLS + 1)) / GRID_COLS;
  const left = clientX - gridRect.left;
  const top = clientY - gridRect.top;
  let x = Math.round((left - GRID_MARGIN[0]) / (colWidth + GRID_MARGIN[0]));
  let y = Math.round((top - GRID_MARGIN[1]) / (KPI_ROW_HEIGHT + GRID_MARGIN[1]));
  x = Math.max(0, Math.min(GRID_COLS - w, x));
  y = Math.max(0, y);
  return { x, y };
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
  draggingWidgetIdRef,
  searchQuery = "",
  searchContext = {},
  kpiCardData = {},
  chartData = {},
  loading = false,
}) => {
  const gridWrapRef = useRef(null);
  const externalDropLockRef = useRef(false);
  const isExternalDrag = Boolean(draggingWidgetIdRef?.current ?? draggingWidgetId);
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
        deltaDisplay={card.deltaDisplay}
        deltaClass={card.deltaClass}
        listItems={card.listItems}
        hasList={card.hasList}
        loading={loading}
        onRemove={onRemove}
      />
    );
  };

  const renderBarChart = (widgetId) => {
    if (widgetId === "cl-chart-departments") {
      if (loading && !chartData.departments?.length) {
        return <ChartPlaceholder message="Loading…" />;
      }
      if (!chartData.departments?.length) return <ChartPlaceholder message="No data" />;
      return <DepartmentBarChart data={chartData.departments} scrollKey={widgetId} />;
    }

    if (widgetId === "cl-chart-department-resolution-rate") {
      if (loading && !chartData.departmentResolutionRates?.length) {
        return <ChartPlaceholder message="Loading…" />;
      }
      if (!chartData.departmentResolutionRates?.length) {
        return <ChartPlaceholder message="No data" />;
      }
      return (
        <DepartmentBarChart
          data={chartData.departmentResolutionRates}
          scrollKey={widgetId}
          valueFormat="percent"
        />
      );
    }

    return null;
  };

  const renderHistogram = (widgetId) => {
    if (widgetId === "cl-chart-complaints-by-age") {
      const hasData = (chartData.complaintsByAge ?? []).some((entry) => Number(entry.count) > 0);
      if (loading && !hasData) {
        return <ChartPlaceholder message="Loading…" />;
      }
      if (!hasData) return <ChartPlaceholder message="No data" />;
      return <DepartmentBarChart data={chartData.complaintsByAge} histogram />;
    }

    return null;
  };

  const renderPieChart = (widgetId) => {
    if (widgetId === "cl-chart-open-by-channel") {
      if (loading && !chartData.openByChannel?.length) {
        return <ChartPlaceholder message="Loading…" />;
      }
      if (!chartData.openByChannel?.length) {
        return <ChartPlaceholder message="No data" />;
      }
      return <PieChart data={chartData.openByChannel} />;
    }

    return null;
  };

  const renderStackedBar = (widgetId) => {
    const meta = WIDGETS[widgetId];
    const horizontal = meta?.stackOrientation === "horizontal";
    const datasetByWidget = {
      "cl-chart-officer-sla": chartData.officerSlaStacked,
      "cl-chart-open-by-type": chartData.openByTypeStacked,
      "cl-chart-complaints-by-type": chartData.complaintsByTypeStacked,
      "cl-chart-resolution-subtype": chartData.resolutionDwellStacked,
    };
    const dataset = datasetByWidget[widgetId];

    const { categories = [], series = [], colors = [] } = dataset || {};
    if (!dataset) return null;
    const valueFormat =
      widgetId === "cl-chart-resolution-subtype" ? "hours" : undefined;
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
        valueFormat={valueFormat}
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

  const renderSlaRiskTable = (widgetId) => {
    if (widgetId !== "cl-table-complaints-at-risk") return null;

    const rows = chartData.complaintsAtRisk || [];
    if (loading && !rows.length) return <ChartPlaceholder message="Loading…" />;
    if (!rows.length) return <ChartPlaceholder message="No data" />;

    return <ComplaintsAtRiskTable rows={rows} />;
  };

  const renderLineChart = (widgetId) => {
    if (widgetId !== "cl-chart-over-time") return null;

    const dataset = chartData.complaintsOverTime;
    const hasStructure =
      dataset?.periods &&
      Object.values(dataset.periods).some((period) => period.categories?.length > 0);

    if (loading && !hasStructure) {
      return <ChartPlaceholder message="Loading…" />;
    }
    if (!hasStructure) return <ChartPlaceholder message="No data" />;

    return (
      <LineChart
        headerTitle={dataset.title}
        periods={dataset.periods}
        defaultPeriod={dataset.defaultPeriod}
      />
    );
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

    if (meta.type === "sla-risk-table" && !isDemoVizWidget(widgetId)) {
      return renderSlaRiskTable(widgetId);
    }

    if (meta.type === "bar-chart") {
      return renderBarChart(widgetId);
    }

    if (meta.type === "horizontal-bar" && !isDemoVizWidget(widgetId)) {
      if (widgetId === "cl-chart-department-flow-ratio") {
        if (loading && !chartData.departmentFlowRatios?.length) {
          return <ChartPlaceholder message="Loading…" />;
        }
        if (!chartData.departmentFlowRatios?.length) {
          return <ChartPlaceholder message="No data" />;
        }
        return (
          <HorizontalBarChart
            data={chartData.departmentFlowRatios}
            breakEven={1}
            scrollKey={widgetId}
          />
        );
      }
    }

    if (meta.type === "stacked-bar") {
      return renderStackedBar(widgetId);
    }

    if (meta.type === "pie-chart" && !isDemoVizWidget(widgetId)) {
      return renderPieChart(widgetId);
    }

    if (meta.type === "histogram" && !isDemoVizWidget(widgetId)) {
      return renderHistogram(widgetId);
    }

    if (meta.type === "line-chart" && !isDemoVizWidget(widgetId)) {
      return renderLineChart(widgetId);
    }

    if (meta.type === "map" && !isDemoVizWidget(widgetId)) {
      if (widgetId === "cl-map-geography-choropleth") {
        return (
          <OpenComplaintsByGeographyWidget
            layers={chartData.geographyMap}
            loading={loading}
          />
        );
      }
    }

    return null;
  };

  const completeExternalDrop = useCallback(
    (widgetId, position, clientX, clientY) => {
      if (externalDropLockRef.current) return;
      const activeId = widgetId || draggingWidgetIdRef?.current;
      if (!activeId || !WIDGETS[activeId]) return;
      if (layout.some((entry) => entry.i === activeId)) return;

      let dropPosition = position;
      if (!dropPosition && clientX != null && clientY != null && gridWrapRef.current) {
        const gridEl = gridWrapRef.current.querySelector(".react-grid-layout");
        if (gridEl) {
          const rect = gridEl.getBoundingClientRect();
          dropPosition = pixelToGridPosition(
            rect.width,
            clientX,
            clientY,
            rect,
            activeId
          );
        }
      }
      if (!dropPosition) return;

      externalDropLockRef.current = true;
      onExternalDragEnd?.();
      requestAnimationFrame(() => {
        onDropWidget(activeId, dropPosition);
        externalDropLockRef.current = false;
      });
    },
    [layout, onDropWidget, onExternalDragEnd, draggingWidgetIdRef]
  );

  const handleWrapDragOver = useCallback(
    (event) => {
      const activeId = draggingWidgetIdRef?.current ?? draggingWidgetId;
      if (!activeId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },
    [draggingWidgetId, draggingWidgetIdRef]
  );

  const handleWrapDrop = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const widgetId = event.dataTransfer?.getData("text/plain");
      completeExternalDrop(widgetId, null, event.clientX, event.clientY);
    },
    [completeExternalDrop]
  );

  const handleRemove = (event, widgetId) => {
    event.preventDefault();
    event.stopPropagation();
    onRemoveWidget(widgetId);
  };

  const handleDrop = useCallback(
    (gridLayout, item, event) => {
      const widgetId = event.dataTransfer.getData("text/plain");
      const position = item ? { x: item.x, y: item.y } : null;
      const clientX = event.nativeEvent?.clientX ?? event.clientX;
      const clientY = event.nativeEvent?.clientY ?? event.clientY;
      completeExternalDrop(widgetId, position, clientX, clientY);
    },
    [completeExternalDrop]
  );

  const handleDropDragOver = useCallback(() => {
    const activeId = draggingWidgetIdRef?.current ?? draggingWidgetId;
    if (!activeId || !WIDGETS[activeId]) return false;
    if (layout.some((entry) => entry.i === activeId)) return false;
    return getDropPreviewSize(activeId);
  }, [draggingWidgetId, draggingWidgetIdRef, layout]);

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
    <div
      ref={gridWrapRef}
      className={isExternalDrag ? "dashboard-external-drag" : undefined}
      onDragOver={handleWrapDragOver}
      onDrop={handleWrapDrop}
    >
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
          isDroppable
          droppingItem={DROPPING_ITEM}
          onDrop={handleDrop}
          onDropDragOver={handleDropDragOver}
        >
          {layout.map((item) => {
            const isKpi = isKpiWidget(item.i);
            const meta = WIDGETS[item.i];
            const vizType = meta?.type;
            const isTable = isScrollableTableWidget(item.i);
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
  );
};

export default DashboardGrid;
