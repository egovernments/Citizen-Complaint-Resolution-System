import React, { useCallback, useMemo, useRef, useState } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout";
import useBreakpoint from "../hooks/useBreakpoint";
import { adaptLayoutForBreakpoint } from "../utils/responsiveLayout";
import { findDragHoverTarget } from "../hooks/useDashboardLayout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  DROPPING_ITEM,
  DROPPING_ITEM_ID,
  GRID_COLS,
  KPI_ROW_HEIGHT,
  WIDGETS,
  getDropPreviewSize,
  getDroppingItem,
  getSizeConstraints,
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
import SubtleScroll from "./SubtleScroll";

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
  gridSyncKey = 0,
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
  const breakpoint = useBreakpoint();
  const isDesktopLayout = breakpoint === "lg";
  const gridWrapRef = useRef(null);
  const externalDropLockRef = useRef(false);
  const postDropWidgetRef = useRef(null);
  const userDragWidgetRef = useRef(null);
  const dragSwapTargetRef = useRef(null);
  const dragOriginLayoutRef = useRef(null);
  const lastHoverTargetRef = useRef(null);
  const [isGridDragging, setIsGridDragging] = useState(false);
  const activeDragWidgetId = draggingWidgetIdRef?.current ?? draggingWidgetId;
  const isExternalDrag = Boolean(activeDragWidgetId);
  const droppingItem = useMemo(
    () => (activeDragWidgetId ? getDroppingItem(activeDragWidgetId) : DROPPING_ITEM),
    [activeDragWidgetId]
  );
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

  const displayLayout = useMemo(
    () => adaptLayoutForBreakpoint(layout, breakpoint),
    [layout, breakpoint]
  );

  const gridLayout = useMemo(
    () =>
      displayLayout.map((item) => {
        const constraints = getSizeConstraints(item.i);
        return {
          ...item,
          ...constraints,
          minW: isDesktopLayout ? constraints.minW : 2,
          resizeHandles: getResizeHandles(item.i),
          className: gridItemClassName(item.i),
          static: !isDesktopLayout,
        };
      }),
    [displayLayout, isDesktopLayout]
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
      "cl-chart-resolution-subtype": chartData.openByTypeStacked,
    };
    const dataset = datasetByWidget[widgetId];

    const { categories = [], series = [], colors = [] } = dataset || {};
    if (!dataset) return null;
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

    return <DashboardTable columns={config.columns} rows={rows} />;
  };

  const renderSlaRiskTable = (widgetId) => {
    if (widgetId !== "cl-table-complaints-at-risk") return null;

    const rows = chartData.complaintsAtRisk || [];
    if (loading && !rows.length) return <ChartPlaceholder message="Loading…" />;

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
      postDropWidgetRef.current = activeId;
      requestAnimationFrame(() => {
        onDropWidget(activeId, dropPosition);
        onExternalDragEnd?.();
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

  const handleDragStart = useCallback((_, __, newItem) => {
    const widgetId = newItem?.i;
    setIsGridDragging(true);
    dragOriginLayoutRef.current = gridLayout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    lastHoverTargetRef.current = null;
    dragSwapTargetRef.current = null;
    if (widgetId && postDropWidgetRef.current === widgetId) {
      return;
    }
    if (postDropWidgetRef.current && widgetId && postDropWidgetRef.current !== widgetId) {
      postDropWidgetRef.current = null;
    }
    userDragWidgetRef.current = widgetId ?? null;
  }, [gridLayout]);

  const handleDrag = useCallback((currentLayout, _oldItem, newItem) => {
    if (!newItem?.i) return;
    const staticLayout = dragOriginLayoutRef.current ?? currentLayout;
    const target = findDragHoverTarget(staticLayout, newItem, newItem.i);
    if (target) {
      lastHoverTargetRef.current = target.i;
      dragSwapTargetRef.current = target.i;
    } else {
      lastHoverTargetRef.current = null;
      dragSwapTargetRef.current = null;
    }
  }, []);

  const handleDragStop = useCallback(
    (nextLayout, oldItem, newItem) => {
      if (isExternalDrag) return;
      const widgetId = newItem?.i;
      if (widgetId && postDropWidgetRef.current === widgetId) {
        userDragWidgetRef.current = null;
        dragSwapTargetRef.current = null;
        dragOriginLayoutRef.current = null;
        lastHoverTargetRef.current = null;
        setIsGridDragging(false);
        return;
      }
      if (userDragWidgetRef.current === widgetId) {
        postDropWidgetRef.current = null;
      }
      userDragWidgetRef.current = null;
      setIsGridDragging(false);
      const withoutPlaceholder = nextLayout.filter((item) => item.i !== DROPPING_ITEM_ID);
      const hoverTargetId = lastHoverTargetRef.current ?? dragSwapTargetRef.current;
      const originLayout = dragOriginLayoutRef.current;
      dragSwapTargetRef.current = null;
      dragOriginLayoutRef.current = null;
      lastHoverTargetRef.current = null;
      onDragStop(withoutPlaceholder, oldItem, newItem, hoverTargetId, originLayout);
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
      className={`dashboard-grid-wrap tw-min-w-0 tw-w-full tw-max-w-full${
        isExternalDrag ? " dashboard-external-drag" : ""
      }${isGridDragging ? " dashboard-grid-dragging" : ""}`}
      onDragOver={handleWrapDragOver}
      onDrop={handleWrapDrop}
    >
      <GridLayoutWithWidth
          key={gridSyncKey}
          className="dashboard-grid-layout"
          layout={gridLayout}
          cols={GRID_COLS}
          rowHeight={KPI_ROW_HEIGHT}
          margin={GRID_MARGIN}
          containerPadding={[0, 0]}
          onDragStart={handleDragStart}
          onDrag={handleDrag}
          onDragStop={handleDragStop}
          onResizeStop={handleResizeStop}
          onLayoutChange={handleLayoutChange}
          draggableHandle=".dashboard-widget-surface"
          draggableCancel=".dashboard-widget-remove-btn, .dashboard-view-toggle, .dashboard-gauge-target-marker, .dashboard-table-scroll, .dashboard-chart-scroll-viewport, .dashboard-kpi-list-body, .leaflet-container, a, button, input, select, textarea"
          compactType={null}
          allowOverlap={false}
          isResizable={isDesktopLayout}
          isDraggable={isDesktopLayout}
          isDroppable={isDesktopLayout}
          droppingItem={droppingItem}
          onDrop={handleDrop}
          onDropDragOver={handleDropDragOver}
        >
          {displayLayout.map((item) => {
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
                        <SubtleScroll className={getWidgetScrollClassName()}>
                          {renderWidget(item.i)}
                        </SubtleScroll>
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
