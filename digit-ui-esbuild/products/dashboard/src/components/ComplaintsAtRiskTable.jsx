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
import useDashboardT from "../i18n/useDashboardT";
import useTableSort from "../hooks/useTableSort";
import TableSortHeader from "./TableSortHeader";

// Built at render (never a module constant) so headers track the language.
const buildColumns = (t) => [
  { id: "id", label: t("DASHBOARD_COL_ID", "ID"), align: "left", type: "text" },
  { id: "typeLabel", label: t("DASHBOARD_COL_TYPE", "Type"), align: "left", type: "text" },
  { id: "subtypeLabel", label: t("DASHBOARD_COL_SUBTYPE", "Subtype"), align: "left", type: "text" },
  { id: "locality", label: t("DASHBOARD_COL_LOCALITY", "Locality"), align: "left", type: "text" },
  { id: "ownerName", label: t("DASHBOARD_COL_OWNER", "Owner"), align: "left", type: "text" },
  { id: "ownerRole", label: t("DASHBOARD_COL_OWNER_ROLE", "Owner role"), align: "left", type: "text" },
  { id: "statusLabel", label: t("DASHBOARD_COL_STATUS", "Status"), align: "left", type: "text" },
  { id: "slaLabel", label: t("DASHBOARD_COL_SLA_STATUS", "SLA status"), align: "left", type: "text" },
  { id: "breachDurationMs", label: t("DASHBOARD_COL_BREACH_DURATION", "Breach duration"), align: "left", type: "integer" },
];

const ComplaintsAtRiskTable = ({ rows = [] }) => {
  const { t, language } = useDashboardT();
  const COLUMNS = useMemo(() => buildColumns(t), [t, language]);
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
              {t("DASHBOARD_TABLE_EMPTY_AT_RISK", "No complaints at risk")}
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
