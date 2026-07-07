import React from "react";

const TableSortHeader = ({ column, sortState, onSort }) => {
  const active = sortState.key === column.id;
  const nextDirection =
    active && sortState.direction === "asc" ? "descending" : "ascending";

  return (
    <button
      type="button"
      className="dashboard-table-sort-btn"
      onClick={() => onSort(column.id)}
      aria-label={`Sort by ${column.label} ${nextDirection}`}
    >
      <span className="dashboard-table-sort-label">{column.label}</span>
      <span className="dashboard-table-sort-indicator" aria-hidden>
        {active ? (sortState.direction === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
};

export default TableSortHeader;
