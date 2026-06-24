import React, { useMemo, useState } from "react";
import {
  DATA_TABLE_STYLES,
  getDataTableTdClass,
  getDataTableThClass,
  getSlaRiskBreachPillClass,
  getSlaRiskStatusPillClass,
  SLA_RISK_TABLE_STYLES,
} from "../config/visualizationStyles";
import { complaintDetailHref } from "../config/complaintsAtRiskPresentation";

const COLUMNS = [
  { id: "id", label: "ID", align: "left" },
  { id: "typeLabel", label: "Type", align: "left" },
  { id: "subtypeLabel", label: "Subtype", align: "left" },
  { id: "locality", label: "Locality", align: "left" },
  { id: "ownerName", label: "Owner", align: "left" },
  { id: "ownerRole", label: "Owner role", align: "left" },
  { id: "statusLabel", label: "Status", align: "left" },
  { id: "slaLabel", label: "SLA status", align: "left" },
  { id: "breachDurationMs", label: "Breach duration", align: "right" },
];

function compareRows(left, right, key) {
  if (key === "breachDurationMs") {
    return (left.breachDurationMs ?? -1) - (right.breachDurationMs ?? -1);
  }
  const leftValue = left[key] ?? "";
  const rightValue = right[key] ?? "";
  return String(leftValue).localeCompare(String(rightValue));
}

const ComplaintsAtRiskTable = ({ rows = [] }) => {
  const tableStyles = DATA_TABLE_STYLES;
  const slaStyles = SLA_RISK_TABLE_STYLES;
  const [sortState, setSortState] = useState({ key: "breachDurationMs", direction: "desc" });

  const sortedRows = useMemo(() => {
    if (!sortState.key) return rows;
    const next = [...rows];
    next.sort((left, right) => {
      const result = compareRows(left, right, sortState.key);
      return sortState.direction === "asc" ? result : -result;
    });
    return next;
  }, [rows, sortState]);

  const handleSort = (key) => {
    setSortState((current) => {
      if (current.key !== key) {
        return { key, direction: key === "breachDurationMs" ? "desc" : "asc" };
      }
      return {
        key,
        direction: current.direction === "asc" ? "desc" : "asc",
      };
    });
  };

  return (
    <table className={tableStyles.table}>
      <thead>
        <tr>
          {COLUMNS.map((col) => {
            const active = sortState.key === col.id;
            return (
              <th key={col.id} className={getDataTableThClass(col.align)}>
                <button
                  type="button"
                  className="dashboard-table-sort-btn"
                  onClick={() => handleSort(col.id)}
                  aria-label={`Sort by ${col.label} ${active && sortState.direction === "asc" ? "descending" : "ascending"}`}
                >
                  <span>{col.label}</span>
                  <span className="dashboard-table-sort-indicator" aria-hidden>
                    {active ? (sortState.direction === "asc" ? "↑" : "↓") : "↕"}
                  </span>
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => (
          <tr key={row.id}>
            <td className={getDataTableTdClass()}>
              <a href={complaintDetailHref(row.id)} className={slaStyles.link}>
                {row.id}
              </a>
            </td>
            <td className={getDataTableTdClass()}>{row.typeLabel}</td>
            <td className={getDataTableTdClass()}>{row.subtypeLabel}</td>
            <td className={getDataTableTdClass()}>{row.locality}</td>
            <td className={getDataTableTdClass()}>
              <span className={slaStyles.ownerName}>{row.ownerName}</span>
            </td>
            <td className={getDataTableTdClass()}>
              <span className={tableStyles.muted}>{row.ownerRole}</span>
            </td>
            <td className={getDataTableTdClass()}>
              <span className={getSlaRiskStatusPillClass(row.status)}>
                {row.statusLabel}
              </span>
            </td>
            <td className={getDataTableTdClass()}>
              <span className={getSlaRiskBreachPillClass(row.slaLevel)}>
                {row.slaLabel}
              </span>
            </td>
            <td className={getDataTableTdClass("right")}>
              {row.breachDurationLabel ? (
                <span className={slaStyles.overdue}>{row.breachDurationLabel}</span>
              ) : (
                <span className={tableStyles.muted}>—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default ComplaintsAtRiskTable;
