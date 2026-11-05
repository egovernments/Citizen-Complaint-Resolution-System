import React, { useMemo } from "react";
import {
  DATA_TABLE_STYLES,
  getDataTableTdClass,
  getDataTableThClass,
  getSlaRiskBreachPillClass,
  getSlaRiskStatusPillClass,
  SLA_RISK_TABLE_STYLES,
} from "../config/visualizationStyles";
import { buildAtRiskColumns, complaintDetailHref } from "../config/complaintsAtRiskPresentation";
import useDashboardT from "../i18n/useDashboardT";
import useTableSort from "../hooks/useTableSort";
import TableSortHeader from "./TableSortHeader";
import DashboardTableFrame, { SrOnlyTableHead } from "./DashboardTableFrame";

const ComplaintsAtRiskTable = ({ rows = [] }) => {
  const { t, language, i18nTick } = useDashboardT();
  const COLUMNS = useMemo(() => buildAtRiskColumns(t), [t, language, i18nTick]);
  const tableStyles = DATA_TABLE_STYLES;
  const slaStyles = SLA_RISK_TABLE_STYLES;
  const { sortState, handleSort, sortRows } = useTableSort(COLUMNS, {
    defaultKey: "breachDurationMs",
    defaultDirection: "desc",
  });
  const sortedRows = useMemo(() => sortRows(rows), [rows, sortRows]);
  const tableClass = `${tableStyles.table} ${tableStyles.tableEqualCols} ${slaStyles.table}`;

  const colgroup = (
    <colgroup>
      {COLUMNS.map((col) => (
        <col key={col.id} style={{ width: `${100 / COLUMNS.length}%` }} />
      ))}
    </colgroup>
  );

  const headTable = (
    <table className={`${tableClass} ${DATA_TABLE_STYLES.tableHead}`}>
      {colgroup}
      <thead>
        <tr>
          {COLUMNS.map((col) => (
            <th key={col.id} className={getDataTableThClass(col.align)}>
              <TableSortHeader column={col} sortState={sortState} onSort={handleSort} />
            </th>
          ))}
        </tr>
      </thead>
    </table>
  );

  const bodyTable = (
    <table className={`${tableClass} ${DATA_TABLE_STYLES.tableBody}`}>
      {colgroup}
      <SrOnlyTableHead columns={COLUMNS} />
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

  return <DashboardTableFrame head={headTable} body={bodyTable} />;
};

export default ComplaintsAtRiskTable;
