import React from "react";
import DataTableChrome from "../DataTableChrome";
import {
  DATA_TABLE_STYLES,
  getDataTableTdClass,
  getDataTableThClass,
  getSlaRiskStatusPillClass,
  SLA_RISK_TABLE_STYLES,
} from "../../config/visualizationStyles";

const STATUS_LABELS = {
  in_progress: "In Progress",
  reopened: "Reopened",
};

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

const SlaAtRiskTable = () => {
  const tableStyles = DATA_TABLE_STYLES;
  const slaStyles = SLA_RISK_TABLE_STYLES;
  const rows = INITIAL_ROWS;

  return (
    <DataTableChrome title="SLA at risk — next 24 hours">
      <table className={tableStyles.table}>
        <thead>
          <tr>
            <th className={getDataTableThClass()}>No.</th>
            <th className={getDataTableThClass()}>Type</th>
            <th className={getDataTableThClass()}>Locality</th>
            <th className={getDataTableThClass()}>Owner</th>
            <th className={getDataTableThClass()}>SLA</th>
            <th className={getDataTableThClass()}>Status</th>
            <th className={getDataTableThClass()}>Next action</th>
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
              <td className={getDataTableTdClass()}>{row.locality}</td>
              <td className={getDataTableTdClass()}>
                <div className={slaStyles.ownerName}>{row.ownerName}</div>
                <div className={tableStyles.muted}>{row.ownerRole}</div>
              </td>
              <td className={getDataTableTdClass()}>
                <div className={slaStyles.slaCell}>
                  <span className={slaStyles.breachPill}>{row.slaLabel}</span>
                  <span className={slaStyles.overdue}>{row.slaOver}</span>
                </div>
              </td>
              <td className={getDataTableTdClass()}>
                <span className={getSlaRiskStatusPillClass(row.status)}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </span>
              </td>
              <td className={getDataTableTdClass()}>
                <button
                  type="button"
                  className={slaStyles.linkButton}
                  onClick={(e) => e.preventDefault()}
                >
                  Resolve
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableChrome>
  );
};

export default SlaAtRiskTable;
