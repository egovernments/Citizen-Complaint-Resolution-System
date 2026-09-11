/**
 * Shared table presentation — threshold highlighting for dashboard data tables.
 */

import { translate as t } from "../i18n/localeRuntime";

/** @typedef {'breach' | 'watch' | 'good'} MetricTone */
/** @typedef {{ higherIsBetter: boolean, watch: number, breach: number }} MetricThresholdConfig */
/** @typedef {{ column: string, extremum?: 'min' | 'max', badge?: string }} TableThresholdConfig */

export function evaluateMetricTone(value, config) {
  if (!Number.isFinite(value) || !config) return null;
  const { higherIsBetter, watch, breach } = config;

  let v = value;
  if (watch <= 1 && breach <= 1 && v > 1 && v <= 100) {
    v = v / 100;
  }

  if (higherIsBetter) {
    if (v < breach) return "breach";
    if (v < watch) return "watch";
    return "good";
  }

  if (v > breach) return "breach";
  if (v > watch) return "watch";
  return "good";
}

/** Breach and watch tones are stored; only breach is surfaced as cell/row chrome. */
export function storeCellTone(cellTones, key, tone) {
  if (tone === "breach" || tone === "watch") {
    cellTones[key] = tone;
  }
}

/**
 * Red text/background scaled by severity (0–1), linear — no artificial floor.
 */
export function buildRedSeverityStyle(severity) {
  const s = Math.min(1, Math.max(0, severity));
  if (s <= 0) return null;
  return {
    "--sla-overrun-severity": String(s),
  };
}

/**
 * How far past a breach threshold a value is (0–1). Null when not in breach.
 */
export function breachSeverity(value, config) {
  if (!Number.isFinite(value) || !config) return null;
  const tone = evaluateMetricTone(value, config);
  if (tone !== "breach") return null;

  const { higherIsBetter, watch, breach } = config;
  let v = value;
  if (watch <= 1 && breach <= 1 && v > 1 && v <= 100) {
    v = v / 100;
  }

  if (higherIsBetter) {
    const floor = Math.max(0, breach - (watch - breach));
    const span = breach - floor || 1;
    return Math.min(1, (breach - v) / span);
  }

  const ceiling = breach + (breach - watch);
  const span = ceiling - breach || 1;
  return Math.min(1, (v - breach) / span);
}

/**
 * Map watch/breach thresholds to 0–1 severity for unified slaOverrun cell styling.
 */
export function metricCellSeverity(value, config) {
  if (!Number.isFinite(value) || !config) return null;
  const tone = evaluateMetricTone(value, config);
  if (!tone || tone === "good") return null;

  if (tone === "breach") {
    const breachSev = breachSeverity(value, config);
    return breachSev != null ? Math.min(1, 0.45 + breachSev * 0.55) : 0.55;
  }

  const { higherIsBetter, watch, breach } = config;
  let v = value;
  if (watch <= 1 && breach <= 1 && v > 1 && v <= 100) {
    v = v / 100;
  }

  if (higherIsBetter) {
    const span = watch - breach || 1;
    const depth = Math.min(1, Math.max(0, (watch - v) / span));
    return 0.25 + depth * 0.2;
  }

  const span = breach - watch || 1;
  const depth = Math.min(1, Math.max(0, (v - watch) / span));
  return 0.25 + depth * 0.2;
}

export const TABLE_THRESHOLDS = {
  "cl-table-workflow-stages": {
    column: "avgDwellMs",
    extremum: "max",
    badge: "BOTTLENECK",
  },
  "cl-chart-workflow-stages": {
    column: "avgDwellMs",
    extremum: "max",
    badge: "BOTTLENECK",
  },
  "cl-table-resolution": {
    column: "ontimePct",
    extremum: "min",
    badge: "LOW",
  },
  "cl-table-locality": {
    column: "ontimePct",
    extremum: "min",
    badge: "LOW",
  },
};

export function getTableThreshold(widgetId) {
  return TABLE_THRESHOLDS[widgetId] ?? null;
}

/** Badge literals resolve lazily (at annotate time) so seeded locales translate. */
function resolveBadgeLabel(badge) {
  if (badge === "BOTTLENECK") return t("DASHBOARD_BADGE_BOTTLENECK", "BOTTLENECK");
  if (badge === "LOW") return t("DASHBOARD_BADGE_LOW", "LOW");
  return badge;
}

/**
 * Highlight a single row at the min or max of `column` (needs at least 2 finite values).
 * When multiple rows tie, only the first extremum row is flagged.
 */
export function annotateTableThresholds(rows, threshold) {
  if (!threshold || !rows?.length || rows.length < 2) return rows;

  const { column, extremum = "max", badge } = threshold;
  const values = rows
    .map((row) => row[column])
    .filter((value) => Number.isFinite(value));
  if (values.length < 2) return rows;

  const target =
    extremum === "min" ? Math.min(...values) : Math.max(...values);

  const highlightIndex = rows.findIndex(
    (row) => Number.isFinite(row[column]) && row[column] === target
  );

  return rows.map((row, index) => ({
    ...row,
    highlight: index === highlightIndex,
    badge: index === highlightIndex && badge ? resolveBadgeLabel(badge) : null,
  }));
}
