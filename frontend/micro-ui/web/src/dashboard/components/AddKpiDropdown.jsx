import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  INVENTORY_CHART_WIDGETS,
  INVENTORY_KPI_METRICS,
} from "../config/supervisorMetrics";

const PANEL_WIDTH_PX = 320; // ~tw-w-80

function iconKind(item) {
  if (
    item.type === "bar-chart" ||
    item.type === "stacked-bar" ||
    item.type === "line-chart" ||
    item.type === "pie-chart" ||
    item.type === "histogram" ||
    item.type === "map" ||
    item.type === "data-table" ||
    item.type === "sla-risk-table" ||
    item.type === "sla-toggle" ||
    item.type === "gauge"
  ) {
    return "chart";
  }
  const id = item.id || "";
  if (/open|breach|escalat|risk|hot|ward/i.test(item.metric || id)) return "alert";
  if (/resolution|dwell|sla|time|inflow|median|avg/i.test(item.metric || id)) return "clock";
  if (/officer|employee|assignee|citizen|complainant/i.test(item.metric || id)) return "user";
  return "trend";
}

function MetricIcon({ kind }) {
  const cls = "tw-h-3.5 tw-w-3.5 tw-shrink-0 tw-text-muted-foreground";
  if (kind === "alert") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  if (kind === "clock") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (kind === "user") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    );
  }
  if (kind === "chart") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    );
  }
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function itemTypeLabel(item) {
  return item.itemType === "kpi" ? "STAT" : "CHART";
}

const AddKpiDropdown = ({
  visibleLayoutIds,
  onAddWidget,
  onDragWidgetStart,
  onDragWidgetEnd,
  open,
  onOpenChange,
  containerRef,
}) => {
  const panelRef = useRef(null);
  const [panelPosition, setPanelPosition] = useState(null);

  const availableItems = useMemo(() => {
    const metrics = INVENTORY_KPI_METRICS.filter(
      (m) => !visibleLayoutIds.includes(m.id)
    ).map((m) => ({
      ...m,
      itemType: "kpi",
    }));
    const widgets = INVENTORY_CHART_WIDGETS.filter(
      (w) => !visibleLayoutIds.includes(w.id)
    ).map((w) => ({
      ...w,
      itemType: "widget",
    }));
    return [...metrics, ...widgets];
  }, [visibleLayoutIds]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPosition(null);
      return undefined;
    }

    const syncPosition = () => {
      const anchor = containerRef?.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPanelPosition({
        top: rect.bottom + 6,
        left: Math.max(8, rect.right - PANEL_WIDTH_PX),
      });
    };

    syncPosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [open, containerRef]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event) => {
      const insideTrigger =
        containerRef?.current && containerRef.current.contains(event.target);
      const insidePanel = panelRef.current && panelRef.current.contains(event.target);
      if (insideTrigger || insidePanel) return;
      onOpenChange(false);
    };
    const handleKey = (event) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onOpenChange, containerRef]);

  const handleDragStart = (event, widgetId) => {
    event.dataTransfer.setData("text/plain", widgetId);
    event.dataTransfer.effectAllowed = "copy";
    onDragWidgetStart?.(widgetId);
    // Defer hiding so React does not re-render during dragstart (that cancels the drag).
    requestAnimationFrame(() => {
      panelRef.current?.classList.add("dashboard-add-kpi-panel--dragging");
    });
  };

  const handleDragEnd = () => {
    panelRef.current?.classList.remove("dashboard-add-kpi-panel--dragging");
    onDragWidgetEnd?.();
    onOpenChange(false);
  };

  if (!open || !panelPosition) return null;

  const panel = (
    <div
      ref={panelRef}
      className="dashboard-add-kpi-panel tw-flex tw-max-h-[min(24rem,70vh)] tw-flex-col tw-overflow-hidden"
      style={{
        position: "fixed",
        top: panelPosition.top,
        left: panelPosition.left,
        width: PANEL_WIDTH_PX,
        zIndex: 9999,
      }}
      role="menu"
    >
      <p className="dashboard-add-kpi-header">Available KPIs</p>
      <ul className="dashboard-add-kpi-list tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-overscroll-contain">
        {availableItems.length === 0 ? (
          <li className="tw-px-4 tw-py-6 tw-text-center tw-text-[12px] tw-font-normal tw-text-muted-foreground">
            All KPIs are on the dashboard
          </li>
        ) : (
          availableItems.map((item) => (
            <li key={item.id}>
              <div
                draggable
                onDragStart={(event) => handleDragStart(event, item.id)}
                onDragEnd={handleDragEnd}
                className="dashboard-add-kpi-item tw-flex tw-cursor-grab tw-select-none tw-items-center tw-gap-2.5 tw-px-4 tw-py-2.5 active:tw-cursor-grabbing"
              >
                <MetricIcon kind={iconKind(item)} />
                <span className="dashboard-add-kpi-item-label tw-min-w-0 tw-flex-1 tw-truncate">
                  {item.metric}
                </span>
                <span className="dashboard-add-kpi-type">{itemTypeLabel(item)}</span>
                <button
                  type="button"
                  draggable={false}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    onAddWidget(item.id);
                    onOpenChange(false);
                  }}
                  className="dashboard-add-kpi-add-btn"
                  aria-label={`Add ${item.metric}`}
                >
                  +
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );

  return createPortal(panel, document.body);
};

export default AddKpiDropdown;
