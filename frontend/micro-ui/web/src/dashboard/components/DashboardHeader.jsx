import React, { useMemo, useRef, useState } from "react";
import { getProductLabel } from "../config/dashboardConfig";
import { GEOGRAPHY_OPTIONS } from "../config/globalFilterGroups";
import AddKpiDropdown from "./AddKpiDropdown";

function formatDisplayDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

function buildSubtitle(filters, filterOptions) {
  const geoOptions = filterOptions?.geography ?? GEOGRAPHY_OPTIONS;
  const geo =
    geoOptions.find((o) => o.id === filters?.geography)?.label ?? "All Localities";

  let period = "Last 7 days";
  if (filters?.dateRangeActive && filters?.dateFrom && filters?.dateTo) {
    period = `${formatDisplayDate(filters.dateFrom)} – ${formatDisplayDate(filters.dateTo)}`;
  } else if (filters?.dateFrom && filters?.dateTo) {
    period = `${formatDisplayDate(filters.dateFrom)} – ${formatDisplayDate(filters.dateTo)}`;
  }

  return `${geo} · ${period}`;
}

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const MenuIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const ExportIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const DashboardHeader = ({
  showMenuButton = false,
  onMenuToggle,
  visibleLayoutIds,
  onAddWidget,
  onResetLayout,
  onDragWidgetStart,
  onDragWidgetEnd,
  searchQuery,
  onSearchQueryChange,
  onExport,
  filters,
  filterOptions,
  kpiCardData,
}) => {
  const [addKpiOpen, setAddKpiOpen] = useState(false);
  const addKpiRef = useRef(null);
  const productLabel = useMemo(() => getProductLabel(), []);
  const subtitle = useMemo(
    () => buildSubtitle(filters, filterOptions),
    [filters, filterOptions]
  );
  const title = productLabel.toLowerCase().includes("pgr")
    ? "PGR Operations"
    : `${productLabel} Operations`;

  return (
    <header className="dashboard-header tw-flex-shrink-0 tw-bg-background">
      <div className="dashboard-header-top tw-flex tw-min-h-12 tw-shrink-0 tw-items-center tw-justify-between tw-gap-3 tw-border-b tw-border-border tw-bg-surface tw-px-3 sm:tw-gap-4 sm:tw-px-4 lg:tw-px-6">
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2 sm:tw-gap-3">
          {showMenuButton ? (
            <button
              type="button"
              className="dashboard-header-menu-btn"
              onClick={onMenuToggle}
              aria-label="Open navigation"
            >
              <MenuIcon />
            </button>
          ) : null}
          <div className="tw-min-w-0 tw-flex-1">
          <div className="tw-flex tw-flex-wrap tw-items-baseline tw-gap-x-3 tw-gap-y-0.5">
            <h1 className="tw-text-[15px] tw-font-semibold tw-leading-tight tw-text-foreground">
              {title}
            </h1>
            <p className="dashboard-header-subtitle tw-text-[11px] tw-text-muted-foreground">{subtitle}</p>
          </div>
          </div>
        </div>

        <div className="dashboard-header-controls">
          <label className="dashboard-header-search tw-hidden sm:tw-inline-flex">
            <span className="dashboard-header-search-icon" aria-hidden>
              <SearchIcon />
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Search complaints, wards, citizens."
              className="dashboard-header-search-input"
            />
          </label>

          <div className="dashboard-header-kpi-anchor">
            <button
              ref={addKpiRef}
              type="button"
              onClick={() => setAddKpiOpen((v) => !v)}
              aria-expanded={addKpiOpen}
              aria-haspopup="menu"
              className="dashboard-header-btn dashboard-add-kpi-trigger"
            >
              + Add KPI
            </button>
            <AddKpiDropdown
              visibleLayoutIds={visibleLayoutIds}
              onAddWidget={onAddWidget}
              onDragWidgetStart={onDragWidgetStart}
              onDragWidgetEnd={onDragWidgetEnd}
              open={addKpiOpen}
              onOpenChange={setAddKpiOpen}
              containerRef={addKpiRef}
              kpiCardData={kpiCardData}
            />
          </div>

          <button
            type="button"
            onClick={onResetLayout}
            className="dashboard-header-btn dashboard-header-reset"
            title="Reset layout"
          >
            Reset
          </button>

          <button
            type="button"
            onClick={onExport}
            className="dashboard-header-btn dashboard-header-export"
            title="Export dashboard"
          >
            <ExportIcon />
            <span>Export</span>
          </button>
        </div>
      </div>
      <div className="dashboard-header-mobile-search">
        <label className="dashboard-header-search dashboard-header-search--mobile">
          <span className="dashboard-header-search-icon" aria-hidden>
            <SearchIcon />
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search complaints, wards, citizens."
            className="dashboard-header-search-input"
          />
        </label>
      </div>
    </header>
  );
};

export default DashboardHeader;
