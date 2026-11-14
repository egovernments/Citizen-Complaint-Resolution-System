/**
 * The text a DashboardTable cell shows, as plain functions (#1977), shared by
 * DashboardTable and the dashboard export so the downloaded cell matches it.
 *
 * Cell formatters route their NUMERIC part through the tenant mask
 * (formatNumber, null when unconfigured -> each `??` fallback keeps the
 * pre-#1213 expression byte-for-byte); unit suffixes (%, h, hr/hrs/day/days,
 * /5) stay here.
 */

import { formatOfficerLabel, dimensionKindForName } from "../config/kpiDisplay";
import { dimensionLabel } from "../i18n/dimensionLabel";
import { translate as t } from "../i18n/localeRuntime";
import { seriesEntryLabel } from "../i18n/textResolver";
import { formatNumber } from "./numberFormat";

export const formatPercent = (value, decimals = 1) => {
  if (value == null || !Number.isFinite(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${formatNumber(pct, { decimals }) ?? pct.toFixed(decimals)}%`;
};

export const formatHours = (ms) => {
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

export const formatHoursDays = (ms) => {
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

export const formatRating = (value) => {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, { decimals: 1 }) ?? Number(value).toFixed(1)}/5`;
};

export const formatInteger = (value) => {
  if (value == null || !Number.isFinite(value)) return "—";
  // Masked path adds thousands grouping — the ungrouped String(Math.round())
  // was part of bug #1251; unconfigured tenants keep it unchanged.
  return formatNumber(value, { decimals: 0 }) ?? String(Math.round(value));
};

// Legacy humaniser — retained verbatim as the dimensionLabel fallback so
// unseeded environments render exactly what they render today.
export const humanizeCellCode = (value) =>
  String(value).replace(/[_.]+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());


/** A trend cell's text: "↑ 3.2%", "↓ 1.0%", "0.0%" or "—". */
export const formatTrend = (value) => {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return `${formatNumber(0, { decimals: 1 }) ?? "0.0"}%`;
  const up = value > 0;
  return `${up ? "↑" : "↓"} ${formatNumber(Math.abs(value), { decimals: 1 }) ?? Math.abs(value).toFixed(1)}%`;
};

/** Cell text by column type; DashboardTable wraps trend and tags in markup. */
export const CELL_TEXT = {
  text: (value) => value ?? "—",
  integer: (value) => formatInteger(value),
  percent: (value) => formatPercent(value),
  hours: (value) => formatHours(value),
  hoursDays: (value) => formatHoursDays(value),
  rating: (value) => formatRating(value),
  trend: (value) => formatTrend(value),
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

/** The status tags a row shows in a "tags" column. */
export function statusTagItems(row) {
  return row.statusTagItems?.length
    ? row.statusTagItems
    : (Array.isArray(row.statusTags) ? row.statusTags : []).map((label) => ({
        label,
        tone: String(label).toLowerCase().includes("on track") ? "good" : "watch",
      }));
}

/** One cell's text, exactly as DashboardTable renders it. */
export function cellText(col, row) {
  if (col.type === "tags") {
    const items = statusTagItems(row);
    return items.length ? items.map((item) => item.label).join(", ") : "—";
  }
  const render = CELL_TEXT[col.type] ?? CELL_TEXT.text;
  return String(render(row[col.id], col) ?? "");
}

/** A column header as TableSortHeader shows it (a seeded labelKey wins). */
export function columnLabel(col) {
  return seriesEntryLabel(col, col.label);
}

// Config-driven cell tinting: a column declares
//   threshold: { higherIsBetter, watch, breach, tag?: { watch, breach } }
// and the table derives the per-cell tone (+ status tags) itself — so any catalog
// table gets threshold coloring from MDMS with no per-KPI code. Mirrors the reference
// watch/breach band model (TYPE_DETAILS_THRESHOLDS / EMPLOYEE_THRESHOLDS).
export function evaluateThresholdTone(value, t) {
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

export function annotateRowsFromThresholds(rows, columns) {
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
