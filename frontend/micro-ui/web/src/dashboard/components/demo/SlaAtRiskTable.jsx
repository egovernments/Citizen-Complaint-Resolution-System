import React, { useMemo, useState } from "react";
import DataTableChrome from "../DataTableChrome";
import {
  DATA_TABLE_STYLES,
  getDataTableTdClass,
  getDataTableThClass,
  getSlaRiskBreachPillClass,
  getSlaRiskStatusPillClass,
  SLA_RISK_TABLE_STYLES
} from "../../config/visualizationStyles";

const STATUS_LABELS = {
  assigned: "Assigned",
  open: "Open",
  in_progress: "In Progress",
  reopened: "Reopened",
};

const INITIAL_ROWS = [
  {
    id: "PGR-2026-T5039",
    type: "Sewerage overflow",
    subtype: "Manhole overflow",
    locality: "Riverside",
    ownerName: "Mohan Lal",
    ownerRole: "Sewerage Supervisor",
    slaLabel: "Breached",
    slaLevel: "breached",
    durationDays: 7,
    status: "reopened",
  },
  {
    id: "PGR-2026-T5038",
    type: "Water pipeline leakage",
    subtype: "Mainline leakage",
    locality: "Park Lane",
    ownerName: "Baljeet Kaur",
    ownerRole: "Water Works Officer",
    slaLabel: "Nearing breach",
    slaLevel: "nearing",
    durationDays: 6,
    status: "assigned",
  },
  {
    id: "PGR-2026-T5036",
    type: "Garbage not collected",
    subtype: "Door-to-door collection skipped",
    locality: "Mall Road",
    ownerName: "Ramesh Kumar",
    ownerRole: "Sanitary Inspector",
    slaLabel: "Breached",
    slaLevel: "breached",
    durationDays: 5,
    status: "in_progress",
  },
  {
    id: "PGR-2026-T5033",
    type: "No water supply",
    subtype: "Supply interruption",
    locality: "Crown Plaza",
    ownerName: "Baljeet Kaur",
    ownerRole: "Water Works Officer",
    slaLabel: "Nearing breach",
    slaLevel: "nearing",
    durationDays: 4,
    status: "open",
  },
  {
    id: "PGR-2026-T5037",
    type: "Streetlight not working",
    subtype: "Pole non-functional",
    locality: "Trade Centre",
    ownerName: "Gurmeet Singh",
    ownerRole: "Lineman",
    slaLabel: "Breached",
    slaLevel: "breached",
    durationDays: 4,
    status: "in_progress",
  },
];

const SORTABLE_COLUMNS = [
  { id: "id", label: "Complaint ID" },
  { id: "type", label: "Complaint Type" },
  { id: "subtype", label: "Complaint Subtype" },
  { id: "locality", label: "Locality" },
  { id: "ownerName", label: "Owner" },
  { id: "status", label: "Status" },
  { id: "slaLabel", label: "SLA Status" },
  { id: "durationDays", label: "Duration of Breach" },
];

function compareValues(a, b, key) {
  if (key === "durationDays") return (a.durationDays ?? 0) - (b.durationDays ?? 0);
  if (key === "status") {
    const left = STATUS_LABELS[a.status] ?? a.status;
    const right = STATUS_LABELS[b.status] ?? b.status;
    return left.localeCompare(right);
  }
  return String(a[key] ?? "").localeCompare(String(b[key] ?? ""));
}

const SlaAtRiskTable = () => {
  const tableStyles = DATA_TABLE_STYLES;
  const slaStyles = SLA_RISK_TABLE_STYLES;
  const [sortState, setSortState] = useState({ key: null, direction: "asc" });

  const rows = useMemo(() => {
    if (!sortState.key) return INITIAL_ROWS;
    const next = [...INITIAL_ROWS];
    next.sort((left, right) => {
      const result = compareValues(left, right, sortState.key);
      return sortState.direction === "asc" ? result : -result;
    });
    return next;
  }, [sortState]);

  const handleSort = (key) => {
    setSortState((current) => {
      if (current.key !== key) {
        return { key, direction: "asc" };
      }
      return {
        key,
        direction: current.direction === "asc" ? "desc" : "asc",
      };
    });
  };

  return (
    <DataTableChrome title="Complaints at risk">
      <table className={tableStyles.table}>
        <thead>
          <tr>
            {SORTABLE_COLUMNS.map((col) => {
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
          {rows.map((row) => (
            <tr key={row.id}>
              <td className={getDataTableTdClass()}>
                <a
                  href="#demo"
                  className={slaStyles.link}
                  onClick={(e) => e.preventDefault()}
                >
                  {row.id}
                </a>
              </td>
              <td className={getDataTableTdClass()}>{row.type}</td>
              <td className={getDataTableTdClass()}>{row.subtype}</td>
              <td className={getDataTableTdClass()}>{row.locality}</td>
              <td className={getDataTableTdClass()}>
                <div className={slaStyles.ownerName}>{row.ownerName}</div>
                <div className={tableStyles.muted}>{row.ownerRole}</div>
              </td>
              <td className={getDataTableTdClass()}>
                <span className={getSlaRiskStatusPillClass(row.status)}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </span>
              </td>
              <td className={getDataTableTdClass()}>
                <span className={getSlaRiskBreachPillClass(row.slaLevel)}>
                  {row.slaLabel}
                </span>
              </td>
              <td className={getDataTableTdClass()}>
                <span className={slaStyles.overdue}>{`+${row.durationDays}d`}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableChrome>
  );
};

export default SlaAtRiskTable;
