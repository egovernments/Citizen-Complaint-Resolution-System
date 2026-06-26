import React, { useMemo } from "react";
import {
  DATA_TABLE_STYLES,
  getDataTableTdClass,
  getDataTableThClass,
} from "../config/visualizationStyles";
import { buildRedSeverityStyle } from "../config/tablePresentation";
import useTableSort from "../hooks/useTableSort";
import TableSortHeader from "./TableSortHeader";

const TrendCell = ({ value }) => {
  const { muted, trendUp, trendDown } = DATA_TABLE_STYLES;
  if (value == null || !Number.isFinite(value)) {
    return <span className={muted}>—</span>;
  }
  if (value === 0) {
    return <span className={muted}>0.0%</span>;
  }
  const up = value > 0;
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

const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

const formatHoursDays = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const hours = ms / MS_PER_HOUR;
  if (hours < 48) {
    const rounded = Math.round(hours * 10) / 10;
    const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${formatted} ${rounded === 1 ? "hr" : "hrs"}`;
  }
  const days = ms / MS_PER_DAY;
  const rounded = Math.round(days * 10) / 10;
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${formatted} ${rounded === 1 ? "day" : "days"}`;
};

const formatRating = (value) => {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Number(value).toFixed(1)}/5`;
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
  hoursDays: (value) => formatHoursDays(value),
  rating: (value) => formatRating(value),
  trend: (value) => <TrendCell value={value} />,
  tags: (value) => value,
};

function resolveToneClass(tone, styles) {
  if (tone === "breach") return styles.cellToneBreach;
  if (tone === "watch") return styles.cellToneWatch;
  return undefined;
}

function resolveToneTextClass(tone, styles) {
  if (tone === "breach") return styles.thresholdCell;
  if (tone === "watch") return styles.thresholdWatch;
  return undefined;
}

function resolveStatusTagClass(tone, styles) {
  if (tone === "breach") return `${styles.statusTag} ${styles.statusTagBreach}`;
  if (tone === "watch") return `${styles.statusTag} ${styles.statusTagWatch}`;
  return undefined;
}

function renderStatusTags(row, styles) {
  const items = row.statusTagItems?.length
    ? row.statusTagItems
    : (Array.isArray(row.statusTags) ? row.statusTags : []).map((label) => ({
        label,
        tone: String(label).toLowerCase().includes("on track") ? "good" : "watch",
      }));

  if (!items.length) return <span className={styles.muted}>—</span>;

  return (
    <span className="tw-flex tw-flex-wrap tw-gap-1">
      {items.map((item) =>
        item.tone ? (
          <span
            key={item.label}
            className={resolveStatusTagClass(item.tone, styles)}
          >
            {item.label}
          </span>
        ) : (
          <span key={item.label} className={styles.muted}>
            {item.label}
          </span>
        )
      )}
    </span>
  );
}

const DashboardTable = ({ columns, rows, emptyMessage = "No data" }) => {
  const styles = DATA_TABLE_STYLES;
  const safeRows = rows ?? [];
  const { sortState, handleSort, sortRows } = useTableSort(columns);
  const sortedRows = useMemo(() => sortRows(safeRows), [safeRows, sortRows]);

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
              <TableSortHeader column={col} sortState={sortState} onSort={handleSort} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sortedRows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className={styles.empty}>
              {emptyMessage}
            </td>
          </tr>
        ) : (
          sortedRows.map((row, rowIndex) => (
          <tr
            key={row.id ?? rowIndex}
            className={row.highlight ? styles.rowHighlight : undefined}
            style={
              row.highlight
                ? {
                    "--row-sla-severity": String(
                      row.highlightSeverity != null ? row.highlightSeverity : 1
                    ),
                  }
                : undefined
            }
          >
            {columns.map((col) => {
              const raw = row[col.id];
              const isLabel =
                col.id === "label" || col.id === "subtypeLabel" || col.id === "officerName";
              const render = CELL_RENDERERS[col.type] ?? CELL_RENDERERS.text;
              const content =
                col.type === "tags"
                  ? renderStatusTags(row, styles)
                  : col.type === "trend"
                    ? render(raw)
                    : render(raw);
              const labelText = typeof raw === "string" ? raw : String(raw ?? "");
              const toneKey = col.thresholdKey ?? col.id;
              const tone = row.cellTones?.[toneKey];
              const severity = row.cellToneSeverity?.[toneKey];
              const severityStyle =
                severity != null ? buildRedSeverityStyle(severity) : undefined;
              const usesSeverity = severityStyle != null;
              const suppressCellBackground = Boolean(row.highlight);
              const cellToneClass =
                suppressCellBackground || usesSeverity
                  ? undefined
                  : resolveToneClass(tone, styles);
              const textToneClass = usesSeverity
                ? styles.slaOverrun
                : resolveToneTextClass(tone, styles);
              const legacyHighlight =
                !tone && !usesSeverity && !suppressCellBackground && row.cellHighlights?.[col.id]
                  ? styles.cellToneBreach
                  : undefined;

              return (
                <td
                  key={col.id}
                  className={`${getDataTableTdClass(col.align)} ${
                    cellToneClass ?? legacyHighlight ?? ""
                  }`.trim()}
                >
                  {isLabel ? (
                    <span className={styles.primary} title={labelText}>
                      <span className={styles.label}>{content}</span>
                      {row.badge ? (
                        <span className={styles.badge}>{row.badge}</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className={textToneClass} style={usesSeverity ? severityStyle : undefined}>
                      {content}
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
          ))
        )}
      </tbody>
    </table>
  );
};

export default DashboardTable;
