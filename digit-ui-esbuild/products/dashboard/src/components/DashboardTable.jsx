import React, { useMemo } from "react";
import {
  DATA_TABLE_STYLES,
  getDataTableTdClass,
  getDataTableThClass,
} from "../config/visualizationStyles";
import { buildRedSeverityStyle } from "../config/tablePresentation";
import { formatOfficerLabel, dimensionKindForName } from "../config/kpiDisplay";
import useDashboardT from "../i18n/useDashboardT";
import { dimensionLabel } from "../i18n/dimensionLabel";
import { translate as t } from "../i18n/localeRuntime";
import { seriesEntryLabel } from "../i18n/textResolver";
import useTableSort from "../hooks/useTableSort";
import TableSortHeader from "./TableSortHeader";
import DashboardTableFrame from "./DashboardTableFrame";
import { formatNumber } from "../utils/numberFormat";

// Cell formatters route their NUMERIC part through the tenant mask
// (formatNumber, null when unconfigured -> each `??` fallback keeps the
// pre-#1213 expression byte-for-byte); unit suffixes (%, h, hr/hrs/day/days,
// /5) stay here.
const TrendCell = ({ value }) => {
  const { muted, trendUp, trendDown } = DATA_TABLE_STYLES;
  if (value == null || !Number.isFinite(value)) {
    return <span className={muted}>—</span>;
  }
  if (value === 0) {
    return <span className={muted}>{formatNumber(0, { decimals: 1 }) ?? "0.0"}%</span>;
  }
  const up = value > 0;
  return (
    <span className={up ? trendUp : trendDown}>
      {up ? "↑" : "↓"} {formatNumber(Math.abs(value), { decimals: 1 }) ?? Math.abs(value).toFixed(1)}%
    </span>
  );
};

const formatPercent = (value, decimals = 1) => {
  if (value == null || !Number.isFinite(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${formatNumber(pct, { decimals }) ?? pct.toFixed(decimals)}%`;
};

const formatHours = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const hours = ms / 3600000;
  const nearWhole = Math.abs(hours - Math.round(hours)) < 0.05;
  const formatted =
    formatNumber(nearWhole ? Math.round(hours) : hours, { decimals: nearWhole ? 0 : 1 }) ??
    (nearWhole ? String(Math.round(hours)) : hours.toFixed(1));
  return `${formatted}h`;
};

const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

const formatHoursDays = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const hours = ms / MS_PER_HOUR;
  if (hours < 48) {
    const rounded = Math.round(hours * 10) / 10;
    const formatted =
      formatNumber(rounded, { decimals: 1, trim: true }) ??
      (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1));
    return `${formatted} ${rounded === 1 ? t("DASHBOARD_UNIT_HR", "hr") : t("DASHBOARD_UNIT_HRS", "hrs")}`;
  }
  const days = ms / MS_PER_DAY;
  const rounded = Math.round(days * 10) / 10;
  const formatted =
    formatNumber(rounded, { decimals: 1, trim: true }) ??
    (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1));
  return `${formatted} ${rounded === 1 ? t("DASHBOARD_UNIT_DAY", "day") : t("DASHBOARD_UNIT_DAYS", "days")}`;
};

const formatRating = (value) => {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, { decimals: 1 }) ?? Number(value).toFixed(1)}/5`;
};

const formatInteger = (value) => {
  if (value == null || !Number.isFinite(value)) return "—";
  // Masked path adds thousands grouping — the ungrouped String(Math.round())
  // was part of bug #1251; unconfigured tenants keep it unchanged.
  return formatNumber(value, { decimals: 0 }) ?? String(Math.round(value));
};

// Legacy humaniser — retained verbatim as the dimensionLabel fallback so
// unseeded environments render exactly what they render today.
const humanizeCellCode = (value) =>
  String(value).replace(/[_.]+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());

const CELL_RENDERERS = {
  text: (value) => value ?? "—",
  integer: (value) => formatInteger(value),
  percent: (value) => formatPercent(value),
  hours: (value) => formatHours(value),
  hoursDays: (value) => formatHoursDays(value),
  rating: (value) => formatRating(value),
  trend: (value) => <TrendCell value={value} />,
  tags: (value) => value,
  officer: (value) => formatOfficerLabel(value),
  department: (value) =>
    !value || value === "null" || value === "undefined"
      ? "—"
      : dimensionLabel(String(value), "department", humanizeCellCode(value)),
  dimension: (value, col) => {
    if (!value || value === "null" || value === "undefined") return "—";
    const kind = dimensionKindForName(col?.dimension ?? col?.id);
    return kind
      ? dimensionLabel(String(value), kind, humanizeCellCode(value))
      : humanizeCellCode(value);
  },
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

// Config-driven cell tinting: a column declares
//   threshold: { higherIsBetter, watch, breach, tag?: { watch, breach } }
// and the table derives the per-cell tone (+ status tags) itself — so any catalog
// table gets threshold coloring from MDMS with no per-KPI code. Mirrors the reference
// watch/breach band model (TYPE_DETAILS_THRESHOLDS / EMPLOYEE_THRESHOLDS).
function evaluateThresholdTone(value, t) {
  const v = Number(value);
  if (!t || !Number.isFinite(v)) return null;
  if (t.higherIsBetter) {
    if (v <= t.breach) return "breach";
    if (v <= t.watch) return "watch";
  } else {
    if (v >= t.breach) return "breach";
    if (v >= t.watch) return "watch";
  }
  return null;
}

function annotateRowsFromThresholds(rows, columns) {
  const tcols = columns.filter((c) => c.threshold);
  const hasTagsCol = columns.some((c) => c.type === "tags");
  if (!tcols.length) return rows;
  return rows.map((row) => {
    if (row.cellTones || row.statusTagItems) return row; // already annotated upstream
    const cellTones = {};
    const tags = [];
    for (const c of tcols) {
      const tone = evaluateThresholdTone(row[c.id], c.threshold);
      if (!tone) continue;
      cellTones[c.id] = tone;
      // threshold.tagKey.{watch,breach} (DASHBOARD_BADGE_*) wins when seeded,
      // else the descriptor's literal threshold.tag.{watch,breach}.
      const label = seriesEntryLabel(
        { labelKey: c.threshold.tagKey?.[tone] },
        c.threshold.tag?.[tone]
      );
      if (label) tags.push({ label, tone });
    }
    if (!Object.keys(cellTones).length && !hasTagsCol) return row;
    const next = { ...row, cellTones };
    if (hasTagsCol) {
      next.statusTagItems = tags.length
        ? tags
        : [{ label: t("DASHBOARD_BADGE_ON_TRACK", "On track"), tone: null }];
    }
    return next;
  });
}

const DashboardTable = ({ columns, rows, emptyMessage }) => {
  // Subscribes to language/bundle changes; `language` also invalidates the
  // annotation memo so translated tag labels re-resolve on a language switch.
  const { language } = useDashboardT();
  const styles = DATA_TABLE_STYLES;
  const safeRows = rows ?? [];
  const annotatedRows = useMemo(
    () => annotateRowsFromThresholds(safeRows, columns),
    [safeRows, columns, language]
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
