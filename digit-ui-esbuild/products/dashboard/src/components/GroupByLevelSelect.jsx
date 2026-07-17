import React from "react";
import useDashboardT from "../i18n/useDashboardT";
import { translate as t, exists } from "../i18n/localeRuntime";

/**
 * Per-widget "Group by" hierarchy-level control (#1111 PR2).
 *
 * A compact select rendered in the widget header's title row (right-aligned)
 * for tiles whose KPI def declares the `hierLevel` param on a tenant with a
 * usable complaint hierarchy. Options come from buildGroupByOptions
 * (definition levels + Leaf); the RGL draggableCancel whitelist already
 * covers `select`, so interacting with it never starts a widget drag.
 *
 * This is deliberately NOT a dashboard filter: it changes the widget's own
 * aggregation dimension (which level the service_code buckets roll up to),
 * never which complaints qualify.
 */

/**
 * Localized display name for a hierarchy level. Resolution mirrors the
 * dashboard's key-wins-else-data-owned convention:
 *   1. dashboard-owned DASHBOARD_GROUPBY_LEVEL_<LEVELCODE> (seeded pack)
 *   2. the PGR pages' <HIERARCHYTYPE>_<LEVELCODE> convention (operator-seeded)
 *   3. the definition's data-owned label (when it isn't just the raw code)
 *   4. the raw levelCode — a visible localisation gap, not a humanised guess
 */
export function levelDisplayLabel(level, hierarchyType) {
  if (!level) return "";
  const code = String(level.levelCode || "");
  const own = `DASHBOARD_GROUPBY_LEVEL_${code.toUpperCase()}`;
  if (exists(own)) return t(own);
  if (hierarchyType) {
    const pgrKey = `${String(hierarchyType)}_${code}`.toUpperCase();
    if (exists(pgrKey)) return t(pgrKey);
  }
  if (level.label && level.label !== code) return level.label;
  return code;
}

const ChevronIcon = () => (
  <svg
    className="dashboard-widget-group-by-chevron"
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

const GroupByLevelSelect = ({ value, options, hierarchyType, onChange }) => {
  // Subscribes the control to language/bundle changes so option labels
  // re-resolve on a language switch.
  const { t: tt } = useDashboardT();
  const label = tt("DASHBOARD_GROUPBY_LABEL", "Group by");
  return (
    <span className="dashboard-filter-inline-select-wrap dashboard-widget-group-by-wrap">
      <select
        className="dashboard-filter-inline-select dashboard-widget-group-by-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        title={label}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.leaf
              ? tt("DASHBOARD_GROUPBY_LEAF", "Leaf")
              : levelDisplayLabel(opt.level, hierarchyType)}
          </option>
        ))}
      </select>
      <ChevronIcon />
    </span>
  );
};

export default GroupByLevelSelect;
