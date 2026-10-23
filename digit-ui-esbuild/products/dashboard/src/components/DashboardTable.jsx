import React, { useMemo } from "react";
import {
  DATA_TABLE_STYLES,
  getDataTableTdClass,
  getDataTableThClass,
} from "../config/visualizationStyles";
import { buildRedSeverityStyle } from "../config/tablePresentation";
import useDashboardT from "../i18n/useDashboardT";
import { translate as t } from "../i18n/localeRuntime";
import useTableSort from "../hooks/useTableSort";
import TableSortHeader from "./TableSortHeader";
import DashboardTableFrame, { SrOnlyTableHead } from "./DashboardTableFrame";
import {
  annotateRowsFromThresholds,
  CELL_TEXT,
  formatTrend,
  statusTagItems,
} from "../utils/tableCellText";

const TrendCell = ({ value }) => {
  const { muted, trendUp, trendDown } = DATA_TABLE_STYLES;
  if (value == null || !Number.isFinite(value) || value === 0) {
    return <span className={muted}>{formatTrend(value)}</span>;
  }
  return <span className={value > 0 ? trendUp : trendDown}>{formatTrend(value)}</span>;
};

// Cell text comes from utils/tableCellText (shared with the export); only the
// trend and tags cells add markup here.
const CELL_RENDERERS = {
  ...CELL_TEXT,
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
  const items = statusTagItems(row);

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

const DashboardTable = ({ columns, rows, emptyMessage }) => {
  // Subscribes to language/bundle changes; `language` also invalidates the
  // annotation memo so translated tag labels re-resolve on a language switch.
  const { language, i18nTick } = useDashboardT();
  const styles = DATA_TABLE_STYLES;
  const safeRows = rows ?? [];
  const annotatedRows = useMemo(
    () => annotateRowsFromThresholds(safeRows, columns),
    [safeRows, columns, language, i18nTick]
  );
  const { sortState, handleSort, sortRows } = useTableSort(columns);
  const sortedRows = useMemo(() => sortRows(annotatedRows), [annotatedRows, sortRows]);

  const colgroup = (
    <colgroup>
      {columns.map((col) => (
        <col
          key={col.id}
          className={col.width ? styles.colFixed : undefined}
          style={col.width ? { width: col.width } : undefined}
        />
      ))}
    </colgroup>
  );

  const headTable = (
    <table className={`${styles.table} ${DATA_TABLE_STYLES.tableHead}`}>
      {colgroup}
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.id} className={getDataTableThClass(col.align)}>
              <TableSortHeader column={col} sortState={sortState} onSort={handleSort} />
            </th>
          ))}
        </tr>
      </thead>
    </table>
  );

  const bodyTable = (
    <table className={`${styles.table} ${DATA_TABLE_STYLES.tableBody}`}>
      {colgroup}
      <SrOnlyTableHead columns={columns} />
      <tbody>
        {sortedRows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className={styles.empty}>
              {emptyMessage ?? t("DASHBOARD_COMMON_NO_DATA", "No data")}
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
                    : render(raw, col);
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

  return <DashboardTableFrame head={headTable} body={bodyTable} />;
};

export default DashboardTable;
