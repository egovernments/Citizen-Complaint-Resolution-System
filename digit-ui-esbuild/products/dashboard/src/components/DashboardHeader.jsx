import React, { useMemo, useRef, useState } from "react";
import { getProductLabel } from "../config/dashboardConfig";
import { GEOGRAPHY_OPTIONS } from "../config/globalFilterGroups";
import { dimensionLabel } from "../i18n/dimensionLabel";
import useDashboardT from "../i18n/useDashboardT";
import AddKpiDropdown from "./AddKpiDropdown";

/**
 * Derive the row-scope indicator from the analytics `scope` object the backend
 * echoes on every /v2/analytics/_query response. Returns null when the scope is
 * tenant-only (no departments, no boundaryPrefix) so admins/supervisors — who
 * see everything — get no chip. Also null when `scope` is undefined (older
 * backend that doesn't emit departments/boundaryPrefix yet).
 */
function buildRowScope(scope) {
  if (!scope || typeof scope !== "object") return null;

  const departments = Array.isArray(scope.departments)
    ? scope.departments.filter((d) => d != null && d !== "")
    : [];
  const boundaryPrefix =
    typeof scope.boundaryPrefix === "string" && scope.boundaryPrefix.trim()
      ? scope.boundaryPrefix.trim()
      : null;

  if (departments.length === 0 && !boundaryPrefix) return null;

  const deptLabel = departments
    .map((code) => dimensionLabel(code, "department"))
    .join(", ");
  // Last segment of a dotted/slashed boundary code, e.g. "ke.bomet.CENTRAL" → "CENTRAL".
  const areaSegment = boundaryPrefix
    ? boundaryPrefix.split(/[./]/).filter(Boolean).pop() || boundaryPrefix
    : null;
  const areaLabel = areaSegment ? dimensionLabel(areaSegment, "boundary") : null;

  return { deptLabel, areaLabel, hasDepartments: departments.length > 0 };
}

function formatDisplayDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

function buildSubtitle(filters, filterOptions, t) {
  const geoOptions = filterOptions?.geography ?? GEOGRAPHY_OPTIONS;
  const geoId = filters?.geography;
  // The geography chip is a raw boundary code — route it through the
  // dimension-label seam; the "all" sentinel renders its localized label.
  const geo =
    geoId && geoId !== "all"
      ? dimensionLabel(geoId, "boundary")
      : geoOptions.find((o) => o.id === geoId)?.label ??
        t("DASHBOARD_HEADER_ALL_LOCALITIES", "All Localities");

  let period = t("DASHBOARD_HEADER_LAST_7_DAYS", "Last 7 days");
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

const ExportIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const DashboardHeader = ({
  visibleLayoutIds,
  catalogItems,
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
  allowedWidgetIds,
  scopedRole,
  officerAccess,
  visibleKpiCount,
  scope,
}) => {
  const [addKpiOpen, setAddKpiOpen] = useState(false);
  const addKpiRef = useRef(null);
  const { t, language } = useDashboardT();
  const productLabel = useMemo(() => getProductLabel(), []);
  // `language` re-keys the memos on language switch (t itself is stable).
  const rowScope = useMemo(() => buildRowScope(scope), [scope, language]);
  const subtitle = useMemo(
    () => buildSubtitle(filters, filterOptions, t),
    [filters, filterOptions, t, language]
  );
  const title = productLabel.toLowerCase().includes("pgr")
    ? t("DASHBOARD_HEADER_PGR_OPERATIONS", "PGR Operations")
    : `${productLabel} ${t("DASHBOARD_HEADER_OPERATIONS", "Operations")}`;

  return (
    <header className="dashboard-header tw-flex-shrink-0 tw-bg-background">
      <div className="dashboard-header-top tw-flex tw-h-12 tw-shrink-0 tw-items-center tw-justify-between tw-gap-4 tw-border-b tw-border-border tw-bg-surface tw-px-4 lg:tw-px-6">
        <div className="tw-min-w-0">
          <div className="tw-flex tw-flex-wrap tw-items-baseline tw-gap-x-3 tw-gap-y-0.5">
            <h1 className="tw-text-[15px] tw-font-semibold tw-leading-tight tw-text-foreground">
              {title}
            </h1>
            <p className="tw-text-[11px] tw-text-muted-foreground">{subtitle}</p>
            {scopedRole ? (
              <span
                title={t(
                  "DASHBOARD_HEADER_ROLE_SCOPE_TOOLTIP",
                  "Dashboard tiles are scoped to your role by the analytics catalog"
                )}
                className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-full tw-border tw-border-border tw-bg-surface-2 tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted-foreground"
              >
                <span
                  className="tw-h-1.5 tw-w-1.5 tw-rounded-full tw-bg-primary"
                  aria-hidden
                />
                {t("DASHBOARD_HEADER_SCOPED_TO", "Scoped to")}: {scopedRole}
              </span>
            ) : null}
            {scopedRole && officerAccess != null ? (
              <span
                title={
                  officerAccess
                    ? t(
                        "DASHBOARD_HEADER_OFFICER_KPIS_VISIBLE_TOOLTIP",
                        "Your role can see officer-level (per-employee) KPIs"
                      )
                    : t(
                        "DASHBOARD_HEADER_OFFICER_KPIS_HIDDEN_TOOLTIP",
                        "Officer-level (per-employee) KPIs are hidden from your role"
                      )
                }
                className={
                  "tw-inline-flex tw-items-center tw-gap-1 tw-rounded-full tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-medium " +
                  (officerAccess
                    ? "tw-bg-status-resolved-bg tw-text-status-resolved"
                    : "tw-bg-status-breach-bg tw-text-destructive")
                }
              >
                {officerAccess
                  ? t("DASHBOARD_HEADER_OFFICER_KPIS_VISIBLE", "Officer KPIs: visible")
                  : t("DASHBOARD_HEADER_OFFICER_KPIS_HIDDEN", "Officer KPIs: hidden")}
              </span>
            ) : null}
            {scopedRole && visibleKpiCount != null ? (
              <span className="tw-text-[10px] tw-text-muted-foreground">
                {visibleKpiCount} {t("DASHBOARD_HEADER_KPIS_AVAILABLE", "KPIs available to your role")}
              </span>
            ) : null}
            {rowScope ? (
              <span
                title={t(
                  "DASHBOARD_HEADER_ROW_SCOPE_TOOLTIP",
                  "Dashboard data is row-scoped to your department(s)"
                )}
                className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-full tw-bg-status-assigned-bg tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-medium tw-text-status-assigned"
              >
                <span
                  className="tw-h-1.5 tw-w-1.5 tw-rounded-full tw-bg-status-assigned"
                  aria-hidden
                />
                {rowScope.hasDepartments
                  ? `${t("DASHBOARD_HEADER_SHOWING", "Showing")}: ${rowScope.deptLabel}`
                  : t("DASHBOARD_HEADER_AREA_SCOPED", "Area-scoped")}
                {rowScope.areaLabel
                  ? ` · ${t("DASHBOARD_HEADER_AREA", "Area")}: ${rowScope.areaLabel}`
                  : ""}
              </span>
            ) : null}
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
              placeholder={t(
                "DASHBOARD_HEADER_SEARCH_PLACEHOLDER",
                "Search complaints, wards, citizens."
              )}
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
              + {t("DASHBOARD_HEADER_ADD_KPI", "Add KPI")}
            </button>
            <AddKpiDropdown
              visibleLayoutIds={visibleLayoutIds}
              catalogItems={catalogItems}
              onAddWidget={onAddWidget}
              onDragWidgetStart={onDragWidgetStart}
              onDragWidgetEnd={onDragWidgetEnd}
              open={addKpiOpen}
              onOpenChange={setAddKpiOpen}
              containerRef={addKpiRef}
              kpiCardData={kpiCardData}
              allowedWidgetIds={allowedWidgetIds}
            />
          </div>

          <button
            type="button"
            onClick={onResetLayout}
            className="dashboard-header-btn dashboard-header-reset"
            title={t("DASHBOARD_HEADER_RESET_LAYOUT", "Reset layout")}
          >
            {t("DASHBOARD_HEADER_RESET", "Reset")}
          </button>

          <button
            type="button"
            onClick={onExport}
            className="dashboard-header-btn dashboard-header-export"
            title={t("DASHBOARD_HEADER_EXPORT_DASHBOARD", "Export dashboard")}
          >
            <ExportIcon />
            <span>{t("DASHBOARD_HEADER_EXPORT", "Export")}</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
