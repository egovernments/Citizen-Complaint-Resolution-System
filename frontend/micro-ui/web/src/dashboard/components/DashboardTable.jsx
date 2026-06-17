import React from "react";
import {
  DATA_TABLE_STYLES,
  getDataTableTdClass,
  getDataTableThClass,
} from "../config/dataTablePresentation";

const TrendCell = ({ value }) => {
  const { muted, trendUp, trendDown } = DATA_TABLE_STYLES;
  if (value == null || !Number.isFinite(value)) {
    return <span className={muted}>—</span>;
  }
  const up = value >= 0;
  return (
    <span className={up ? trendUp : trendDown}>
      {up ? "↑" : "↓"} {Math.abs(value).toFixed(1)}%
    </span>
  );
};

const formatPercent = (value, decimals = 1) => {
  if (value == null || !Number.isFinite(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(decimals)}%`;
};

const formatHours = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const hours = ms / 3600000;
  const formatted =
    Math.abs(hours - Math.round(hours)) < 0.05
      ? String(Math.round(hours))
      : hours.toFixed(1);
  return `${formatted}h`;
};

const formatInteger = (value) => {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value));
};

const CELL_RENDERERS = {
  text: (value) => value ?? "—",
  integer: (value) => formatInteger(value),
  percent: (value) => formatPercent(value),
  hours: (value) => formatHours(value),
  trend: (value) => <TrendCell value={value} />,
};

const DashboardTable = ({ columns, rows }) => {
  const styles = DATA_TABLE_STYLES;

  if (!rows?.length) {
    return <p className={styles.empty}>No data</p>;
  }

  return (
    <table className={styles.table}>
      <colgroup>
        {columns.map((col) => (
          <col
            key={col.id}
            className={col.width ? styles.colFixed : undefined}
            style={col.width ? { width: col.width } : undefined}
          />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.id} className={getDataTableThClass(col.align)}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr
            key={row.id ?? rowIndex}
            className={row.highlight ? styles.rowHighlight : undefined}
          >
            {columns.map((col) => {
              const raw = row[col.id];
              const isLabel = col.id === "label";
              const render = CELL_RENDERERS[col.type] ?? CELL_RENDERERS.text;
              const content = col.type === "trend" ? render(raw) : render(raw);
              const labelText = typeof raw === "string" ? raw : String(raw ?? "");

              return (
                <td key={col.id} className={getDataTableTdClass(col.align)}>
                  {isLabel ? (
                    <span className={styles.primary} title={labelText}>
                      <span className={styles.label}>{content}</span>
                      {row.badge ? (
                        <span className={styles.badge}>{row.badge}</span>
                      ) : null}
                    </span>
                  ) : (
                    content
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default DashboardTable;
