import React from "react";
import useDashboardT from "../i18n/useDashboardT";

const TableSortHeader = ({ column, sortState, onSort }) => {
  const { t, exists } = useDashboardT();
  const active = sortState.key === column.id;
  const nextDirection =
    active && sortState.direction === "asc"
      ? t("DASHBOARD_TABLE_SORT_DESCENDING", "descending")
      : t("DASHBOARD_TABLE_SORT_ASCENDING", "ascending");
  // Column descriptors may carry a labelKey (DASHBOARD_COL_*) that wins when seeded.
  const label = column.labelKey && exists(column.labelKey) ? t(column.labelKey) : column.label;

  return (
    <button
      type="button"
      className="dashboard-table-sort-btn"
      onClick={() => onSort(column.id)}
      aria-label={`${t("DASHBOARD_TABLE_SORT_BY", "Sort by")} ${label} ${nextDirection}`}
    >
      <span className="dashboard-table-sort-label">{label}</span>
      <span className="dashboard-table-sort-indicator" aria-hidden>
        {active ? (sortState.direction === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
};

export default TableSortHeader;
