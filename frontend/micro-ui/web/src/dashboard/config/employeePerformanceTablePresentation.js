/**
 * Threshold coloring and status tags for the employee performance table.
 */

import { evaluateMetricTone, storeCellTone } from "./tablePresentation";

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

function buildStatusTagItems(cellTones) {
  const items = [];
  for (const [metricKey, tone] of Object.entries(cellTones ?? {})) {
    const label = TAG_LABELS[metricKey]?.[tone];
    if (label) items.push({ label, tone });
  }
  if (!items.length) return [{ label: "On track", tone: null }];
  return items;
}

export function annotateEmployeePerformanceRows(rows) {
  if (!rows?.length) return rows;

  return rows.map((row) => {
    const cellTones = {};
    for (const [metricKey, config] of Object.entries(EMPLOYEE_PERFORMANCE_METRIC_THRESHOLDS)) {
      storeCellTone(cellTones, metricKey, evaluateMetricTone(row[metricKey], config));
    }

    const statusTagItems = buildStatusTagItems(cellTones);

    return {
      ...row,
      cellTones,
      statusTagItems,
      statusTags: statusTagItems.map((item) => item.label),
    };
  });
}
