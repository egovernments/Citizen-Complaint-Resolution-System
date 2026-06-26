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

/** Same gate as OVER SLA; severity = (avgMs − slaMs) / slaMs in raw time. */
function resolutionOverSlaSeverity(avgMs, slaMs) {
  if (!Number.isFinite(avgMs) || !Number.isFinite(slaMs)) return null;
  const avg = resolutionTableValue(avgMs);
  const sla = resolutionTableValue(slaMs);
  if (avg == null || sla == null || avg <= sla) return null;

  const overrunMs = avgMs - slaMs;
  const scaleMs = slaMs > 0 ? slaMs : MS_PER_DAY;
  return Math.min(1, overrunMs / scaleMs);
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
    const cellToneSeverity = {};

    const resolutionSeverity = resolutionOverSlaSeverity(row.avgResolutionMs, row.idealSlaMs);
    if (resolutionSeverity != null) {
      cellToneSeverity.avgResolutionMs = resolutionSeverity;
    }

    for (const [key, config] of Object.entries(COMPLAINT_TYPE_DETAILS_THRESHOLDS)) {
      storeCellTone(cellTones, key, evaluateMetricTone(row[key], config));
    }

    const overSla = isOverSla(row.avgResolutionMs, row.idealSlaMs);

    return {
      ...row,
      cellTones,
      cellToneSeverity,
      highlight: overSla,
      highlightSeverity: resolutionSeverity,
      badge: overSla ? "OVER SLA" : null,
    };
  });
}
