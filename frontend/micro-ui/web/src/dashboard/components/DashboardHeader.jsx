import React, { useMemo, useRef, useState } from "react";
import { getProductLabel } from "../config/dashboardConfig";
import { GEOGRAPHY_OPTIONS } from "../config/globalFilterGroups";
import { formatDimensionLabel } from "../config/labelFormat";
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
    .map((code) => formatDimensionLabel(code))
    .join(", ");
  // Last segment of a dotted/slashed boundary code, e.g. "ke.bomet.CENTRAL" → "CENTRAL".
  const areaLabel = boundaryPrefix
    ? boundaryPrefix.split(/[./]/).filter(Boolean).pop() || boundaryPrefix
    : null;

  return { deptLabel, areaLabel, hasDepartments: departments.length > 0 };
}

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
  const productLabel = useMemo(() => getProductLabel(), []);
  const rowScope = useMemo(() => buildRowScope(scope), [scope]);
  const subtitle = useMemo(
    () => buildSubtitle(filters, filterOptions),
    [filters, filterOptions]
  );
  const title = productLabel.toLowerCase().includes("pgr")
    ? "PGR Operations"
    : `${productLabel} Operations`;

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
                title="Dashboard tiles are scoped to your role by the analytics catalog"
                className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-full tw-border tw-border-border tw-bg-surface-2 tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted-foreground"
              >
                <span
                  className="tw-h-1.5 tw-w-1.5 tw-rounded-full tw-bg-primary"
                  aria-hidden
                />
                Scoped to: {scopedRole}
              </span>
            ) : null}
            {scopedRole && officerAccess != null ? (
              <span
                title={
                  officerAccess
                    ? "Your role can see officer-level (per-employee) KPIs"
                    : "Officer-level (per-employee) KPIs are hidden from your role"
                }
                className={
                  "tw-inline-flex tw-items-center tw-gap-1 tw-rounded-full tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-medium " +
                  (officerAccess
                    ? "tw-bg-status-resolved-bg tw-text-status-resolved"
                    : "tw-bg-status-breach-bg tw-text-destructive")
                }
              >
                {officerAccess ? "Officer KPIs: visible" : "Officer KPIs: hidden"}
              </span>
            ) : null}
            {scopedRole && visibleKpiCount != null ? (
              <span className="tw-text-[10px] tw-text-muted-foreground">
                {visibleKpiCount} KPIs available to your role
              </span>
            ) : null}
            {rowScope ? (
              <span
                title="Dashboard data is row-scoped to your department(s)"
                className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-full tw-bg-status-assigned-bg tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-medium tw-text-status-assigned"
              >
                <span
                  className="tw-h-1.5 tw-w-1.5 tw-rounded-full tw-bg-status-assigned"
                  aria-hidden
                />
                {rowScope.hasDepartments ? `Showing: ${rowScope.deptLabel}` : "Area-scoped"}
                {rowScope.areaLabel ? ` · Area: ${rowScope.areaLabel}` : ""}
              </span>
            ) : null}
          </div>
        </div>

        <div className="dashboard-header-controls">
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
    </header>
  );
};

export default DashboardHeader;
