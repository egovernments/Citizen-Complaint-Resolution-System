import React, { useMemo, useRef, useState } from "react";
import { getProductLabel } from "../config/dashboardConfig";
import { buildSubtitle, dashboardTitle } from "../config/dashboardHeaderText";
import { dimensionLabel } from "../i18n/dimensionLabel";
import useDashboardT from "../i18n/useDashboardT";
import AddKpiDropdown from "./AddKpiDropdown";
import LanguageMenu from "./LanguageMenu";

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
  readOnly = false,
  publicMode = false,
  // The standalone/public shell has no host TopBar, so it carries its own
  // language switcher (#1797); embedded leaves that to DigitUI.
  showLanguageMenu = false,
}) => {
  const [addKpiOpen, setAddKpiOpen] = useState(false);
  const addKpiRef = useRef(null);
  const { t, exists, language, i18nTick } = useDashboardT();
  const productLabel = useMemo(() => getProductLabel(), []);
  // `language` re-keys the memos on language switch; `i18nTick` re-keys them
  // when a locale bundle arrives asynchronously after the switch (t is stable).
  const rowScope = useMemo(() => buildRowScope(scope), [scope, language, i18nTick]);
  // Every mode shows the same "<ward> · <period>" context line — the public
  // page now has the filter bar too (#1797) and its visitors need to see what
  // the numbers are scoped to. "Public view" survives as a pill beside the title.
  const subtitle = useMemo(
    () => buildSubtitle(filters, filterOptions, t, language),
    [filters, filterOptions, t, language, i18nTick]
  );
  // See dashboardTitle for why one full-phrase key wins when seeded.
  const title = dashboardTitle(t, exists, productLabel);

  return (
    <header className="dashboard-header tw-flex-shrink-0 tw-bg-background">
      <div className="dashboard-header-top tw-flex tw-h-12 tw-shrink-0 tw-items-center tw-justify-between tw-gap-4 tw-border-b tw-border-border tw-bg-surface tw-px-4 lg:tw-px-6">
        <div className="tw-min-w-0">
          <div className="tw-flex tw-flex-wrap tw-items-baseline tw-gap-x-3 tw-gap-y-0.5">
            <h1 className="tw-text-[15px] tw-font-semibold tw-leading-tight tw-text-foreground">
              {title}
            </h1>
            <p className="tw-text-[11px] tw-text-muted-foreground">{subtitle}</p>
            {publicMode ? (
              <span className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-full tw-border tw-border-border tw-bg-surface-2 tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted-foreground">
                {t("DASHBOARD_HEADER_PUBLIC_SUBTITLE", "Public view")}
              </span>
            ) : null}
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
          {showLanguageMenu && <LanguageMenu />}

          {!readOnly && <div className="dashboard-header-kpi-anchor">
            <button
              ref={addKpiRef}
              type="button"
              onClick={() => setAddKpiOpen((v) => !v)}
              aria-expanded={addKpiOpen}
              aria-haspopup="dialog"
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
          </div>}

          {!readOnly && <button
            type="button"
            onClick={onResetLayout}
            className="dashboard-header-btn dashboard-header-reset"
            title={t("DASHBOARD_HEADER_RESET_LAYOUT", "Reset layout")}
          >
            {t("DASHBOARD_HEADER_RESET", "Reset")}
          </button>}

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
