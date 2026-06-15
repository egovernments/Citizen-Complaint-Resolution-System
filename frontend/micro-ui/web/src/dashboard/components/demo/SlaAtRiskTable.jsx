import React, { useState } from "react";

const STATUS_OPTIONS = [
  { id: "in_progress", label: "In Progress" },
  { id: "reopened", label: "Reopened" },
];

const INITIAL_ROWS = [
  {
    id: "PGR-2026-T5039",
    type: "Sewerage overflow",
    locality: "Riverside",
    ownerName: "Mohan Lal",
    ownerRole: "Sewerage Supervisor",
    slaLabel: "Breached",
    slaOver: "+156h over",
    status: "reopened",
  },
  {
    id: "PGR-2026-T5041",
    type: "Water pipeline leakage",
    locality: "Park Lane",
    ownerName: "Ravi Kumar",
    ownerRole: "Water Engineer",
    slaLabel: "Breached",
    slaOver: "+89h over",
    status: "in_progress",
  },
  {
    id: "PGR-2026-T5045",
    type: "Garbage not collected",
    locality: "Mall Road",
    ownerName: "Priya Sharma",
    ownerRole: "Sanitation Lead",
    slaLabel: "Breached",
    slaOver: "+42h over",
    status: "in_progress",
  },
  {
    id: "PGR-2026-T5052",
    type: "Street light outage",
    locality: "Central Ward",
    ownerName: "James Otieno",
    ownerRole: "Electrical Supervisor",
    slaLabel: "Breached",
    slaOver: "+28h over",
    status: "reopened",
  },
];

function statusPillClass(status) {
  if (status === "reopened") {
    return "dashboard-sla-status-pill dashboard-sla-status-pill--reopened";
  }
  return "dashboard-sla-status-pill dashboard-sla-status-pill--in-progress";
}

const SlaAtRiskTable = () => {
  const [rows, setRows] = useState(INITIAL_ROWS);

  const updateStatus = (rowId, status) => {
    setRows((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, status } : row))
    );
  };

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col">
      <header className="dashboard-drag-handle tw-shrink-0 tw-border-b tw-border-border tw-px-4 tw-py-2.5 tw-pr-8">
        <h2 className="dashboard-drag-handle-title">SLA at risk — next 24 hours</h2>
      </header>
      <div className="dashboard-table-body tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-p-4">
        <div className="dashboard-table-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th className="dashboard-table-th">No.</th>
                <th className="dashboard-table-th">Type</th>
                <th className="dashboard-table-th">Locality</th>
                <th className="dashboard-table-th">Owner</th>
                <th className="dashboard-table-th">SLA</th>
                <th className="dashboard-table-th">Status</th>
                <th className="dashboard-table-th">Next action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="dashboard-table-td">
                    <a
                      href="#demo"
                      className="dashboard-sla-link"
                      onClick={(e) => e.preventDefault()}
                    >
                      {row.id}
                    </a>
                  </td>
                  <td className="dashboard-table-td">{row.type}</td>
                  <td className="dashboard-table-td">{row.locality}</td>
                  <td className="dashboard-table-td">
                    <div className="tw-font-medium">{row.ownerName}</div>
                    <div className="dashboard-table-muted">{row.ownerRole}</div>
                  </td>
                  <td className="dashboard-table-td">
                    <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1.5">
                      <span className="dashboard-sla-breach-pill">{row.slaLabel}</span>
                      <span className="tw-font-medium tw-text-status-breach">{row.slaOver}</span>
                    </div>
                  </td>
                  <td className="dashboard-table-td">
                    <select
                      value={row.status}
                      onChange={(e) => updateStatus(row.id, e.target.value)}
                      onMouseDown={(e) => e.stopPropagation()}
                      className={`${statusPillClass(row.status)} dashboard-sla-status-select`}
                      aria-label={`Status for ${row.id}`}
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="dashboard-table-td">
                    <button
                      type="button"
                      className="dashboard-sla-link tw-border-0 tw-bg-transparent tw-p-0"
                      onClick={(e) => e.preventDefault()}
                    >
                      Resolve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SlaAtRiskTable;
