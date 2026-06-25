/**
 * Threshold coloring and status tags for the employee performance table.
 */

/** @typedef {'breach' | 'watch' | 'good'} MetricTone */

export const EMPLOYEE_PERFORMANCE_METRIC_THRESHOLDS = {
  open: { higherIsBetter: false, watch: 8, breach: 15 },
  reopenRate: { higherIsBetter: false, watch: 0.12, breach: 0.2 },
  avgCsat: { higherIsBetter: true, watch: 3.8, breach: 3.2 },
  escalationRate: { higherIsBetter: false, watch: 0.15, breach: 0.3 },
};

const TAG_LABELS = {
  open: { breach: "High open", watch: "Open load" },
  reopenRate: { breach: "High reopen", watch: "Reopen risk" },
  avgCsat: { breach: "Low CSAT", watch: "CSAT watch" },
  escalationRate: { breach: "High escalation", watch: "Escalation risk" },
};

export function evaluateEmployeeMetricTone(value, config) {
  if (!Number.isFinite(value) || !config) return null;
  const { higherIsBetter, watch, breach } = config;

  if (higherIsBetter) {
    if (value < breach) return "breach";
    if (value < watch) return "watch";
    return "good";
  }

  if (value > breach) return "breach";
  if (value > watch) return "watch";
  return "good";
}

function buildStatusTags(cellTones) {
  const tags = [];
  for (const [metricKey, tone] of Object.entries(cellTones ?? {})) {
    if (tone === "good" || tone == null) continue;
    const label = TAG_LABELS[metricKey]?.[tone];
    if (label) tags.push(label);
  }
  return tags.length ? tags : ["On track"];
}

export function annotateEmployeePerformanceRows(rows) {
  if (!rows?.length) return rows;

  return rows.map((row) => {
    const cellTones = {};
    for (const [metricKey, config] of Object.entries(EMPLOYEE_PERFORMANCE_METRIC_THRESHOLDS)) {
      const tone = evaluateEmployeeMetricTone(row[metricKey], config);
      if (tone) cellTones[metricKey] = tone;
    }

    return {
      ...row,
      cellTones,
      statusTags: buildStatusTags(cellTones),
    };
  });
}
