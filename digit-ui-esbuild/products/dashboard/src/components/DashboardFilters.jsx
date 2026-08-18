import React, { useCallback, useMemo } from "react";
import {
  COMPLAINT_TYPE_OPTIONS,
  DEPARTMENT_OPTIONS,
  GEOGRAPHY_OPTIONS,
  buildDefaultFilters,
  hasActiveFilters,
} from "../config/globalFilterGroups";
import ComplaintTypeTreeFilter from "./ComplaintTypeTreeFilter";
import GeographyTreeFilter from "./GeographyTreeFilter";
import { nodeDisplayLabel } from "./ComplaintTypeTreeFilter";
import { boundaryDisplayLabel } from "./GeographyTreeFilter";
import MultiSelectFilter from "./MultiSelectFilter";
import useDashboardT from "../i18n/useDashboardT";
import { dimensionLabel } from "../i18n/dimensionLabel";
import {
  normalizeHierarchySelections,
  normalizeStringList,
  removeHierarchySelection,
} from "../utils/multiSelectFilters";

const FunnelIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="tw-shrink-0 tw-text-muted-foreground"
    aria-hidden
  >
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
  </svg>
);

const DashboardFilters = ({
  filters,
  onFilterChange,
  onClearFilters,
  timeZone,
  filterOptions,
  filterOptionsLoading = false,
}) => {
  const { t } = useDashboardT();
  const canClear = hasActiveFilters(filters, timeZone);

  const geographyOptions = filterOptions?.geography ?? GEOGRAPHY_OPTIONS;
  const complaintTypeOptions =
    filterOptions?.complaintType ?? COMPLAINT_TYPE_OPTIONS;
  const departmentOptions = filterOptions?.department ?? DEPARTMENT_OPTIONS;
  const complaintTypeTree = filterOptions?.complaintTypeTree ?? null;
  const geographyTree = filterOptions?.geographyTree ?? null;

  // Date fallbacks resolve from buildDefaultFilters(timeZone) at render time — never
  // GLOBAL_FILTER_FIELDS' module-load defaultValue, which would freeze on whatever
  // calendar day the JS bundle happened to first evaluate in the browser's local zone.
  const defaultFilters = useMemo(() => buildDefaultFilters(timeZone), [
    timeZone,
  ]);
  const dateFrom = filters?.dateFrom ?? defaultFilters.dateFrom;
  const dateTo = filters?.dateTo ?? defaultFilters.dateTo;
  const geographies = normalizeHierarchySelections(filters?.geographies);
  const complaintTypes = normalizeHierarchySelections(filters?.complaintTypes);
  const departments = normalizeStringList(filters?.departments);
  const applyLabel = t("DASHBOARD_FILTERS_APPLY", "Apply");
  const cancelLabel = t("DASHBOARD_FILTERS_CANCEL", "Cancel");
  const noMatchesLabel = t(
    "DASHBOARD_FILTERS_NO_MATCHES",
    "No matching options"
  );

  const flatHierarchyValues = (selections) =>
    selections.map((selection) => selection.code);
  const flatHierarchySelections = (codes) =>
    normalizeStringList(codes).map((code) => ({
      code,
      path: null,
      leaf: true,
      codes: [code],
    }));

  const activeChips = [
    ...geographies.map((selection) => ({
      key: `geography-${selection.code}`,
      label: geographyTree
        ? boundaryDisplayLabel(geographyTree, selection.code)
        : geographyOptions.find((option) => option.id === selection.code)
            ?.label ?? dimensionLabel(selection.code, "boundary"),
      onRemove: () =>
        onFilterChange(
          "geographies",
          removeHierarchySelection(geographies, selection.code)
        ),
    })),
    ...complaintTypes.map((selection) => ({
      key: `complaint-${selection.code}`,
      label: complaintTypeTree
        ? nodeDisplayLabel(complaintTypeTree, selection.code)
        : complaintTypeOptions.find((option) => option.id === selection.code)
            ?.label ?? dimensionLabel(selection.code, "complaintType"),
      onRemove: () =>
        onFilterChange(
          "complaintTypes",
          removeHierarchySelection(complaintTypes, selection.code)
        ),
    })),
    ...departments.map((code) => ({
      key: `department-${code}`,
      label:
        departmentOptions.find((option) => option.id === code)?.label ??
        dimensionLabel(code, "department"),
      onRemove: () =>
        onFilterChange(
          "departments",
          departments.filter((department) => department !== code)
        ),
    })),
  ];

  const openCalendar = useCallback((input) => {
    if (!input) return;
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch {
        /* fall through */
      }
    }
    input.focus();
  }, []);

  return (
    <div className="dashboard-filters-bar tw-mb-4">
      <div className="dashboard-filters-card">
        <div className="dashboard-filters-row">
          <div className="dashboard-filters-heading">
            <FunnelIcon />
            <span className="dashboard-filters-title">
              {t("DASHBOARD_FILTERS_TITLE", "Filters")}
            </span>
          </div>

          <div className="dashboard-filters-date-range">
            <div className="dashboard-filter-inline-date-wrap">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => onFilterChange("dateFrom", e.target.value)}
                onClick={(e) => openCalendar(e.currentTarget)}
                aria-label={t("DASHBOARD_FILTERS_FROM_DATE", "From date")}
                className="dashboard-filter-inline-date"
              />
            </div>
            <span className="dashboard-filters-date-arrow" aria-hidden>
              →
            </span>
            <div className="dashboard-filter-inline-date-wrap">
              <input
                type="date"
                value={dateTo}
                onChange={(e) => onFilterChange("dateTo", e.target.value)}
                onClick={(e) => openCalendar(e.currentTarget)}
                aria-label={t("DASHBOARD_FILTERS_TO_DATE", "To date")}
                className="dashboard-filter-inline-date"
              />
            </div>
          </div>

          {geographyTree ? (
            <GeographyTreeFilter
              tree={geographyTree}
              filters={filters}
              onFilterChange={onFilterChange}
              t={t}
            />
          ) : (
            <MultiSelectFilter
              options={geographyOptions}
              values={flatHierarchyValues(geographies)}
              label={t("DASHBOARD_FILTERS_WARDS", "Wards")}
              allLabel={t("DASHBOARD_FILTERS_ALL_WARDS", "All wards")}
              ariaLabel={t("DASHBOARD_FILTERS_WARD_FILTER", "Ward filter")}
              loading={filterOptionsLoading && geographyOptions.length <= 1}
              searchable
              searchPlaceholder={t(
                "DASHBOARD_FILTERS_SEARCH_WARDS",
                "Search wards"
              )}
              applyLabel={applyLabel}
              cancelLabel={cancelLabel}
              emptyLabel={noMatchesLabel}
              onChange={(codes) =>
                onFilterChange("geographies", flatHierarchySelections(codes))
              }
            />
          )}

          {complaintTypeTree ? (
            // Staged, ABAC-pruned hierarchy multi-select. Hierarchy nodes expand
            // to exact scoped service codes before the query is issued.
            <ComplaintTypeTreeFilter
              tree={complaintTypeTree}
              filters={filters}
              onFilterChange={onFilterChange}
              t={t}
            />
          ) : (
            <MultiSelectFilter
              options={complaintTypeOptions}
              values={flatHierarchyValues(complaintTypes)}
              label={t("DASHBOARD_FILTERS_COMPLAINT_TYPES", "Complaint types")}
              allLabel={t("DASHBOARD_FILTERS_ALL_TYPES", "All types")}
              ariaLabel={t(
                "DASHBOARD_FILTERS_COMPLAINT_TYPE_FILTER",
                "Complaint type filter"
              )}
              loading={filterOptionsLoading && complaintTypeOptions.length <= 1}
              applyLabel={applyLabel}
              cancelLabel={cancelLabel}
              emptyLabel={noMatchesLabel}
              onChange={(codes) =>
                onFilterChange("complaintTypes", flatHierarchySelections(codes))
              }
            />
          )}

          <MultiSelectFilter
            options={departmentOptions}
            values={departments}
            label={t("DASHBOARD_FILTERS_DEPARTMENTS", "Departments")}
            allLabel={t("DASHBOARD_FILTERS_ALL_DEPARTMENTS", "All departments")}
            ariaLabel={t(
              "DASHBOARD_FILTERS_DEPARTMENT_FILTER",
              "Department filter"
            )}
            loading={filterOptionsLoading && departmentOptions.length <= 1}
            applyLabel={applyLabel}
            cancelLabel={cancelLabel}
            emptyLabel={noMatchesLabel}
            onChange={(codes) => onFilterChange("departments", codes)}
          />

          <button
            type="button"
            onClick={onClearFilters}
            disabled={!canClear}
            className="dashboard-filters-clear-inline"
            aria-disabled={!canClear}
          >
            {t("DASHBOARD_FILTERS_CLEAR", "Clear")}
          </button>
        </div>
        {activeChips.length > 0 && (
          <div
            className="dashboard-active-filter-chips"
            aria-label={t("DASHBOARD_FILTERS_ACTIVE", "Active filters")}
          >
            {activeChips.map((chip) => (
              <span key={chip.key} className="dashboard-active-filter-chip">
                <span>{chip.label}</span>
                <button
                  type="button"
                  onClick={chip.onRemove}
                  aria-label={`${t("DASHBOARD_FILTERS_REMOVE", "Remove")} ${
                    chip.label
                  }`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardFilters;
