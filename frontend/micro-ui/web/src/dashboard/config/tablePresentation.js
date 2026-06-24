/**
 * Shared table presentation — threshold highlighting for dashboard data tables.
 */

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
    badge: index === highlightIndex && badge ? badge : null,
  }));
}
