import React, { useMemo } from "react";
import {
  DATA_TABLE_STYLES,
  getDataTableTdClass,
  getDataTableThClass,
  getSlaRiskBreachPillClass,
  getSlaRiskStatusPillClass,
  SLA_RISK_TABLE_STYLES,
} from "../config/visualizationStyles";
import { complaintDetailHref } from "../config/complaintsAtRiskPresentation";
import useTableSort from "../hooks/useTableSort";
import TableSortHeader from "./TableSortHeader";

const COLUMNS = [
  { id: "id", label: "ID", align: "left", type: "text" },
  { id: "typeLabel", label: "Type", align: "left", type: "text" },
  { id: "subtypeLabel", label: "Subtype", align: "left", type: "text" },
  { id: "locality", label: "Locality", align: "left", type: "text" },
  { id: "ownerName", label: "Owner", align: "left", type: "text" },
  { id: "ownerRole", label: "Owner role", align: "left", type: "text" },
  { id: "statusLabel", label: "Status", align: "left", type: "text" },
  { id: "slaLabel", label: "SLA status", align: "left", type: "text" },
  { id: "breachDurationMs", label: "Breach duration", align: "left", type: "integer" },
];

const ComplaintsAtRiskTable = ({ rows = [] }) => {
  const tableStyles = DATA_TABLE_STYLES;
  const slaStyles = SLA_RISK_TABLE_STYLES;
  const { sortState, handleSort, sortRows } = useTableSort(COLUMNS, {
    defaultKey: "breachDurationMs",
    defaultDirection: "desc",
  });
  const sortedRows = useMemo(() => sortRows(rows), [rows, sortRows]);

  return (
    <table
      className={`${tableStyles.table} ${tableStyles.tableEqualCols} ${slaStyles.table}`}
    >
      <colgroup>
        {COLUMNS.map((col) => (
          <col key={col.id} style={{ width: `${100 / COLUMNS.length}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {COLUMNS.map((col) => (
            <th key={col.id} className={getDataTableThClass(col.align)}>
              <TableSortHeader column={col} sortState={sortState} onSort={handleSort} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sortedRows.length === 0 ? (
          <tr>
            <td colSpan={COLUMNS.length} className={tableStyles.empty}>
              No complaints at risk
            </td>
          </tr>
        ) : (
          sortedRows.map((row) => (
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
            <td className={getDataTableTdClass()}>
              {row.breachDurationLabel ? (
                <span
                  className={
                    row.slaLevel === "breached" ? slaStyles.overdue : tableStyles.muted
                  }
                >
                  {row.breachDurationLabel}
                </span>
              ) : (
                <span className={tableStyles.muted}>—</span>
              )}
            </td>
          </tr>
          ))
        )}
      </tbody>
    </table>
  );
};

export default ComplaintsAtRiskTable;
