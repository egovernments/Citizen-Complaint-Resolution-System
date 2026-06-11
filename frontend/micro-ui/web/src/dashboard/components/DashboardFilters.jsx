import React from "react";
import { GLOBAL_FILTER_GROUPS } from "../config/globalFilterGroups";

const DashboardFilters = ({ filters, onFilterChange }) => {
  return (
    <div className="tw-flex tw-flex-shrink-0 tw-flex-wrap tw-items-center tw-gap-2 tw-border-b tw-border-slate-200 tw-bg-white tw-px-6 tw-py-3">
      <span className="tw-text-xs tw-font-medium tw-text-slate-500">Filters</span>
      {GLOBAL_FILTER_GROUPS.map((group) => (
        <label key={group.id} className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-text-xs tw-text-slate-600">{group.label}</span>
          <select
            value={filters[group.id] ?? group.defaultValue}
            onChange={(e) => onFilterChange(group.id, e.target.value)}
            aria-label={group.label}
            className="tw-max-w-full tw-rounded-md tw-border tw-border-slate-300 tw-bg-white tw-px-2 tw-py-1.5 tw-text-xs tw-text-slate-700 focus:tw-border-brand-teal focus:tw-outline-none"
          >
            {group.options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
};

export default DashboardFilters;
