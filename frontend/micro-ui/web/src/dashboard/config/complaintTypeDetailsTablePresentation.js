/**
 * Per-cell threshold coloring for the complaint type details table.
 */

import { evaluateMetricTone, storeCellTone } from "./tablePresentation";

const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

export const COMPLAINT_TYPE_DETAILS_THRESHOLDS = {
  reopenRate: { higherIsBetter: false, watch: 0.1, breach: 0.25 },
  ontimeRate: { higherIsBetter: true, watch: 0.85, breach: 0.6 },
  avgCsat: { higherIsBetter: true, watch: 4, breach: 3 },
  oldestOpenMs: { higherIsBetter: false, watch: 7 * MS_PER_DAY, breach: 30 * MS_PER_DAY },
};

/** Same rounding as `formatHoursDays` in DashboardTable — compare what the user sees. */
function resolutionTableValue(ms) {
  if (!Number.isFinite(ms)) return null;
  const hours = ms / MS_PER_HOUR;
  if (hours < 48) return Math.round(hours * 10) / 10;
  return Math.round((ms / MS_PER_DAY) * 10) / 10 * 24;
}

function toneForResolutionVsSla(avgMs, slaMs) {
  const avg = resolutionTableValue(avgMs);
  const sla = resolutionTableValue(slaMs);
  if (avg == null || sla == null || avg <= sla) return null;
  if (sla === 0) return "breach";
  const ratio = avg / sla;
  if (ratio > 1.15) return "breach";
  if (ratio > 1) return "watch";
  return null;
}

function isOverSla(avgMs, slaMs) {
  const avg = resolutionTableValue(avgMs);
  const sla = resolutionTableValue(slaMs);
  return avg != null && sla != null && avg > sla;
}

export function annotateComplaintTypeDetailsRows(rows) {
  if (!rows?.length) return rows;

  return rows.map((row) => {
    const cellTones = {};

    const resolutionTone = toneForResolutionVsSla(row.avgResolutionMs, row.idealSlaMs);
    if (resolutionTone) {
      cellTones.avgResolutionMs = resolutionTone;
    }

    for (const [key, config] of Object.entries(COMPLAINT_TYPE_DETAILS_THRESHOLDS)) {
      storeCellTone(cellTones, key, evaluateMetricTone(row[key], config));
    }

    const overSla = isOverSla(row.avgResolutionMs, row.idealSlaMs);

    return {
      ...row,
      cellTones,
      highlight: overSla,
      badge: overSla ? "OVER SLA" : null,
    };
  });
}
