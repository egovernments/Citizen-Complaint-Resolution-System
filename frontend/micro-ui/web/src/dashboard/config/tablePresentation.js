/**
 * Shared table presentation — threshold highlighting for dashboard data tables.
 */

/** @typedef {{ column: string, extremum?: 'min' | 'max', badge?: string }} TableThresholdConfig */

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
 * Highlight the row at the min or max of `column` (needs at least 2 finite values).
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

  return rows.map((row) => {
    const value = row[column];
    const isExtremum = Number.isFinite(value) && value === target;
    return {
      ...row,
      highlight: isExtremum,
      badge: isExtremum && badge ? badge : null,
    };
  });
}
