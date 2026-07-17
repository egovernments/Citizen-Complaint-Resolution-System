import React, { useCallback } from "react";
import {
  COMPLAINT_TYPE_OPTIONS,
  GEOGRAPHY_OPTIONS,
  GLOBAL_FILTER_FIELDS,
  hasActiveFilters,
} from "../config/globalFilterGroups";
import useDashboardT from "../i18n/useDashboardT";

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

const FilterChevron = () => (
  <svg
    className="dashboard-filter-inline-chevron"
    xmlns="http://www.w3.org/2000/svg"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/**
 * Render a flat {id,label,group?} option list, batching consecutive same-group
 * runs into native <optgroup>s. The list arrives group-contiguous (sentinel
 * first, grouped options sorted by group, strays last), so a single pass
 * yields: plain sentinel option → one <optgroup> per root complaint category →
 * plain trailing options for codes missing from the hierarchy master. Lists
 * without any `group` (wards; hierarchy-fetch failure) render exactly as the
 * old flat <option> list.
 */
function renderGroupedOptions(options) {
  const rendered = [];
  let run = null; // { group, items } — current <optgroup> being accumulated

  const flushRun = () => {
    if (!run) return;
    rendered.push(
      <optgroup key={`group-${run.group}`} label={run.group}>
        {run.items}
      </optgroup>
    );
    run = null;
  };

  for (const opt of options) {
    const node = (
      <option key={opt.id} value={opt.id}>
        {opt.label}
      </option>
    );
    if (opt.group) {
      if (!run || run.group !== opt.group) {
        flushRun();
        run = { group: opt.group, items: [] };
      }
      run.items.push(node);
    } else {
      flushRun();
      rendered.push(node);
    }
  }
  flushRun();
  return rendered;
}

const DashboardFilters = ({
  filters,
  onFilterChange,
  onClearFilters,
  filterOptions,
  filterOptionsLoading = false,
}) => {
  const { t } = useDashboardT();
  const canClear = hasActiveFilters(filters);

  const geographyOptions = filterOptions?.geography ?? GEOGRAPHY_OPTIONS;
  const complaintTypeOptions =
    filterOptions?.complaintType ?? COMPLAINT_TYPE_OPTIONS;

  const dateFrom = filters?.dateFrom ?? GLOBAL_FILTER_FIELDS.find((f) => f.id === "dateFrom")?.defaultValue;
  const dateTo = filters?.dateTo ?? GLOBAL_FILTER_FIELDS.find((f) => f.id === "dateTo")?.defaultValue;
  const geography = filters?.geography ?? "all";
  const complaintType = filters?.complaintType ?? "all";

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
          <span className="dashboard-filters-title">{t("DASHBOARD_FILTERS_TITLE", "Filters")}</span>
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

        <div className="dashboard-filter-inline-select-wrap">
          <select
            value={filterOptionsLoading && geographyOptions.length <= 1 ? "" : geography}
            disabled={filterOptionsLoading && geographyOptions.length <= 1}
            onChange={(e) => onFilterChange("geography", e.target.value)}
            aria-label={t("DASHBOARD_FILTERS_WARD_FILTER", "Ward filter")}
            className="dashboard-filter-inline-select"
          >
            {filterOptionsLoading && geographyOptions.length <= 1 ? (
              <option value="">{t("DASHBOARD_COMMON_LOADING", "Loading…")}</option>
            ) : (
              geographyOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))
            )}
          </select>
          <FilterChevron />
        </div>

        <div className="dashboard-filter-inline-select-wrap">
          <select
            value={filterOptionsLoading && complaintTypeOptions.length <= 1 ? "" : complaintType}
            disabled={filterOptionsLoading && complaintTypeOptions.length <= 1}
            onChange={(e) => onFilterChange("complaintType", e.target.value)}
            aria-label={t("DASHBOARD_FILTERS_COMPLAINT_TYPE_FILTER", "Complaint type filter")}
            className="dashboard-filter-inline-select"
          >
            {filterOptionsLoading && complaintTypeOptions.length <= 1 ? (
              <option value="">{t("DASHBOARD_COMMON_LOADING", "Loading…")}</option>
            ) : (
              renderGroupedOptions(complaintTypeOptions)
            )}
          </select>
          <FilterChevron />
        </div>

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
      </div>
    </div>
  );
};

export default DashboardFilters;
