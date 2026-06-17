import React, { useEffect, useMemo, useRef } from "react";
import {
  CHART_WIDGETS,
  KPI_METRICS,
} from "../config/supervisorMetrics";

const SHORT_LABELS = {
  "cl-metric-total-registered": "Total",
  "cl-metric-total-open": "Open",
  "cl-metric-total-resolved": "Resolved",
  "cl-metric-channel-mix": "Channel mix",
  "cl-metric-new-vs-repeat": "New vs repeat",
  "cl-metric-inflow-rate": "Inflow rate",
  "cl-metric-hot-ward": "Hot ward",
  "demo-viz-stacked": "Stacked bar",
  "demo-viz-stacked-horizontal": "Team SLA load",
  "demo-viz-leaderboard": "Leaderboard",
  "demo-viz-line": "Line chart",
  "demo-viz-pie": "Channel donut",
  "demo-viz-sla-toggle": "SLA table/bar",
  "demo-viz-sla-risk": "SLA at risk",
  "demo-viz-map": "Map demo",
  "demo-viz-histogram": "Histogram",
  "demo-viz-gauge": "Gauge",
};

function shortLabel(item) {
  return SHORT_LABELS[item.id] || item.metric.split(/[·(]/)[0].trim();
}

function iconKind(item) {
  if (item.type === "bar-chart" || item.type === "map" || item.type === "data-table") {
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

  const availableItems = useMemo(() => {
    const metrics = KPI_METRICS.filter((m) => !visibleLayoutIds.includes(m.id)).map((m) => ({
      ...m,
      itemType: "kpi",
    }));
    const widgets = CHART_WIDGETS.filter((w) => !visibleLayoutIds.includes(w.id)).map((w) => ({
      ...w,
      itemType: "widget",
    }));
    return [...metrics, ...widgets];
  }, [visibleLayoutIds]);

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

  if (!open) return null;

  const handleDragStart = (event, widgetId) => {
    event.dataTransfer.setData("text/plain", widgetId);
    event.dataTransfer.effectAllowed = "copy";
    onDragWidgetStart?.(widgetId);
  };

  return (
    <div
      ref={panelRef}
      className="dashboard-add-kpi-panel tw-w-72 tw-overflow-hidden tw-rounded tw-border tw-border-border tw-bg-surface tw-shadow-lg"
      role="menu"
    >
      <p className="tw-border-b tw-border-border tw-px-3 tw-py-2 tw-text-[10px] tw-font-semibold tw-uppercase tw-tracking-wider tw-text-muted-foreground">
        Available KPIs
      </p>
      <ul className="dashboard-add-kpi-list tw-max-h-80 tw-overflow-y-auto tw-py-1">
        {availableItems.length === 0 ? (
          <li className="tw-px-3 tw-py-4 tw-text-center tw-text-[12px] tw-text-muted-foreground">
            All KPIs are on the dashboard
          </li>
        ) : (
          availableItems.map((item) => (
            <li key={item.id}>
              <div
                draggable
                onDragStart={(event) => handleDragStart(event, item.id)}
                onDragEnd={() => onDragWidgetEnd?.()}
                className="dashboard-add-kpi-item tw-flex tw-cursor-grab tw-items-center tw-gap-2.5 tw-px-3 tw-py-2 active:tw-cursor-grabbing"
              >
                <MetricIcon kind={iconKind(item)} />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onAddWidget(item.id);
                    onOpenChange(false);
                  }}
                  className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2.5 tw-border-0 tw-bg-transparent tw-p-0 tw-text-left"
                >
                  <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-[12px] tw-text-foreground">
                    {shortLabel(item)}
                  </span>
                  <span className="tw-shrink-0 tw-text-[10px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-muted-foreground">
                    Stat +
                  </span>
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
};

export default AddKpiDropdown;
