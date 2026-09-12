import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AddKpiPreview from "./AddKpiPreview";
import useDashboardT from "../i18n/useDashboardT";
import { buildAvailableKpis } from "../utils/addKpiPicker";

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

function itemTypeLabel(item, t) {
  if (item.itemType === "kpi") return t("DASHBOARD_HEADER_TYPE_STAT", "STAT");
  if (item.type === "data-table" || item.type === "sla-risk-table")
    return t("DASHBOARD_HEADER_TYPE_TABLE", "TABLE");
  return t("DASHBOARD_HEADER_TYPE_CHART", "CHART");
}

const AddKpiDropdown = ({
  visibleLayoutIds,
  onAddWidget,
  onDragWidgetStart,
  onDragWidgetEnd,
  open,
  onOpenChange,
  containerRef,
  kpiCardData,
  allowedWidgetIds,
  catalogItems,
}) => {
  const { t } = useDashboardT();
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const [panelPosition, setPanelPosition] = useState(null);
  const [hoveredItem, setHoveredItem] = useState(null);
  const [hoverRect, setHoverRect] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Offer every role-visible catalog tile not already on the grid, sorted A→Z
  // and filtered by the search box (#1755). Catalog is role-filtered server-side.
  // Each item is { id:kpiId, metric:title, type:viz.kind, itemType }.
  const availableItems = useMemo(
    () => buildAvailableKpis(catalogItems, visibleLayoutIds, searchQuery),
    [visibleLayoutIds, catalogItems, searchQuery]
  );
  const unplacedCount = useMemo(
    () => buildAvailableKpis(catalogItems, visibleLayoutIds, "").length,
    [visibleLayoutIds, catalogItems]
  );

  useLayoutEffect(() => {
    if (!open) {
      setPanelPosition(null);
      setHoveredItem(null);
      setHoverRect(null);
      setSearchQuery("");
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
    // Focus search so users can type immediately when the picker opens.
    requestAnimationFrame(() => searchRef.current?.focus());
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
    setHoveredItem(null);
    setHoverRect(null);
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
      // dashboard-root: the panel portals to document.body, outside the styled
      // subtree — the class re-applies the scoped font/palette variables there.
      // Without it the standalone/public page (no vendor CSS on <body>) renders
      // the panel in the browser's default serif.
      className="dashboard-root dashboard-add-kpi-panel tw-flex tw-max-h-[min(24rem,70vh)] tw-flex-col tw-overflow-hidden"
      style={{
        position: "fixed",
        top: panelPosition.top,
        left: panelPosition.left,
        width: PANEL_WIDTH_PX,
        zIndex: 9999,
      }}
      role="menu"
    >
      <p className="dashboard-add-kpi-header">{t("DASHBOARD_HEADER_AVAILABLE_KPIS", "Available KPIs")}</p>
      <div className="dashboard-add-kpi-search-wrap">
        <input
          ref={searchRef}
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            // Keep Escape for the panel-level close handler; stop other keys
            // from bubbling into grid shortcuts.
            if (event.key !== "Escape") event.stopPropagation();
          }}
          placeholder={t("DASHBOARD_HEADER_SEARCH_KPIS", "Search KPIs")}
          aria-label={t("DASHBOARD_HEADER_SEARCH_KPIS", "Search KPIs")}
          className="dashboard-add-kpi-search"
          autoComplete="off"
        />
      </div>
      <ul className="dashboard-add-kpi-list tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-overscroll-contain">
        {availableItems.length === 0 ? (
          <li className="tw-px-4 tw-py-6 tw-text-center tw-text-[12px] tw-font-normal tw-text-muted-foreground">
            {(catalogItems || []).length === 0
              ? // Role-filtered catalog is empty — nothing this user could ever add.
                t("DASHBOARD_HEADER_NO_KPIS_FOR_ROLE", "No KPIs available for your role")
              : unplacedCount === 0
                ? // Catalog has tiles but every one is already placed — not a bug,
                  // but indistinguishable from one without saying so.
                  t(
                    "DASHBOARD_HEADER_ALL_KPIS_ON_DASHBOARD",
                    "All available KPIs are already on your dashboard"
                  )
                : // Search narrowed the list to nothing.
                  t("DASHBOARD_HEADER_NO_KPI_MATCHES", "No KPIs match your search")}
          </li>
        ) : (
          availableItems.map((item) => (
            <li key={item.id}>
              <div
                draggable
                onDragStart={(event) => handleDragStart(event, item.id)}
                onDragEnd={handleDragEnd}
                onMouseEnter={(event) => {
                  setHoveredItem(item);
                  setHoverRect(event.currentTarget.getBoundingClientRect());
                }}
                onMouseLeave={() => {
                  setHoveredItem(null);
                  setHoverRect(null);
                }}
                className={`dashboard-add-kpi-item${
                  hoveredItem?.id === item.id ? " dashboard-add-kpi-item--hover" : ""
                }`}
              >
                <div className="dashboard-add-kpi-item-main">
                  <MetricIcon kind={iconKind(item)} />
                  <span className="dashboard-add-kpi-item-label">{item.metric}</span>
                </div>
                <div className="dashboard-add-kpi-item-aside">
                  <span className="dashboard-add-kpi-type">{itemTypeLabel(item, t)}</span>
                  <button
                    type="button"
                    draggable={false}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => {
                      onAddWidget(item.id);
                      onOpenChange(false);
                    }}
                    className="dashboard-add-kpi-add-btn"
                    aria-label={`${t("DASHBOARD_HEADER_ADD", "Add")} ${item.metric}`}
                  >
                    +
                  </button>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );

  return (
    <>
      {createPortal(panel, document.body)}
      <AddKpiPreview
        item={hoveredItem}
        anchorRect={hoverRect}
        panelLeft={panelPosition?.left}
        kpiCardData={kpiCardData}
      />
    </>
  );
};

export default AddKpiDropdown;
