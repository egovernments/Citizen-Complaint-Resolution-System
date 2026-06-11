import React, { useCallback, useMemo } from "react";
import {
  COMPLAINT_TYPE_OPTIONS,
  GEOGRAPHY_OPTIONS,
  GLOBAL_FILTER_FIELDS,
  hasActiveFilters,
} from "../config/globalFilterGroups";

const FunnelIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="tw-shrink-0 tw-text-slate-800"
    aria-hidden
  >
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
  </svg>
);

const SELECT_FIELD_CLASS = {
  geography: "dashboard-filter-field--geography",
  complaintType: "dashboard-filter-field--complaint-type",
};

const FilterField = ({ label, className = "", children }) => (
  <div className={`dashboard-filter-field ${className}`.trim()}>
    <span className="dashboard-filter-label">{label}</span>
    {children}
  </div>
);

const CalendarIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const FilterDateField = ({ label, value, onChange }) => {
  const openCalendar = useCallback((input) => {
    if (!input) return;
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch {
        /* fall through to focus */
      }
    }
    input.focus();
  }, []);

  return (
    <FilterField label={label}>
      <div className="dashboard-filter-date-wrap">
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => openCalendar(e.currentTarget)}
          aria-label={label}
          className="dashboard-filter-input dashboard-filter-date"
        />
        <span className="dashboard-filter-date-icon">
          <CalendarIcon />
        </span>
      </div>
    </FilterField>
  );
};

const DashboardFilters = ({
  filters,
  onFilterChange,
  onClearFilters,
  filterOptions,
  filterOptionsLoading = false,
}) => {
  const canClear = hasActiveFilters(filters);
  const fields = useMemo(() => {
    const geographyOptions = filterOptions?.geography ?? GEOGRAPHY_OPTIONS;
    const complaintTypeOptions =
      filterOptions?.complaintType ?? COMPLAINT_TYPE_OPTIONS;

    return GLOBAL_FILTER_FIELDS.map((field) => {
      if (field.id === "geography") {
        return { ...field, options: geographyOptions };
      }
      if (field.id === "complaintType") {
        return { ...field, options: complaintTypeOptions };
      }
      return field;
    });
  }, [filterOptions]);

  return (
    <div className="dashboard-filters-bar tw-mb-4">
      <div className="dashboard-filters-card">
        <div className="dashboard-filters-heading">
          <FunnelIcon />
          <span className="dashboard-filters-title">Filters</span>
        </div>

        {fields.map((field) => {
          const value = filters[field.id] ?? field.defaultValue;

          if (field.type === "date") {
            return (
              <FilterDateField
                key={field.id}
                label={field.label}
                value={value}
                onChange={(nextValue) => onFilterChange(field.id, nextValue)}
              />
            );
          }

          const optionsLoading =
            filterOptionsLoading && field.options.length <= 1;

          return (
            <FilterField
              key={field.id}
              label={field.label}
              className={SELECT_FIELD_CLASS[field.id] || ""}
            >
              <div className="dashboard-filter-select-wrap">
                <select
                  value={optionsLoading ? "" : value}
                  disabled={optionsLoading}
                  onChange={(e) => onFilterChange(field.id, e.target.value)}
                  aria-label={field.label}
                  aria-busy={optionsLoading}
                  className="dashboard-filter-input dashboard-filter-select"
                >
                  {optionsLoading ? (
                    <option value="">Loading…</option>
                  ) : (
                    field.options.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </FilterField>
          );
        })}

        <button
          type="button"
          onClick={onClearFilters}
          disabled={!canClear}
          className="dashboard-filters-clear"
          aria-label="Clear all filters"
        >
          Clear
        </button>
      </div>
    </div>
  );
};

export default DashboardFilters;
