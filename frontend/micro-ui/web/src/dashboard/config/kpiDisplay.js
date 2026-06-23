/**
 * KPI card presentation — thresholds, context lines, and list data sources.
 */

import { VISUALIZATION_STYLES, VIZ_TYPE } from "./visualizationStyles";

export const KPI_STATUS = {
  ON_TRACK: "on_track",
  NORMAL: "normal",
  BREACHING: "breaching",
};

/** @type {Record<string, object>} */
export const KPI_DISPLAY = {
  "rs-metric-sla-compliance": {
    displayTitle: "On-time resolution rate",
    threshold: { kind: "percent", higherIsBetter: true, onTrack: 85, breaching: 60 },
    context: { type: "breachOpen" },
  },
  "rs-metric-breach-count": {
    displayTitle: "Breached SLA (open)",
    threshold: { kind: "count", higherIsBetter: false, onTrack: 5, breaching: 20 },
    context: { type: "outOfOpen" },
  },
  "cl-metric-total-resolved": {
    displayTitle: "Resolved complaints",
    threshold: { kind: "count", higherIsBetter: true, onTrack: 10, breaching: 0 },
  },
  "cl-metric-total-open": {
    displayTitle: "Open complaints",
    threshold: { kind: "count", higherIsBetter: false, onTrack: 20, breaching: 50 },
  },
  "cl-metric-new-created": {
    displayTitle: "New complaints created",
  },
  "cl-metric-created-today": {
    displayTitle: "Complaints created today",
  },
  "cl-metric-resolution-rate": {
    displayTitle: "Resolution rate",
    threshold: { kind: "percent", higherIsBetter: true, onTrack: 70, breaching: 40 },
  },
  "cl-metric-reopen-rate": {
    displayTitle: "Reopen rate",
    threshold: { kind: "percent", higherIsBetter: false, onTrack: 10, breaching: 25 },
  },
  "cl-metric-csat": {
    displayTitle: "CSAT",
    threshold: { kind: "rating", higherIsBetter: true, onTrack: 4, breaching: 3 },
  },
  "cl-metric-first-assignment-rate": {
    displayTitle: "First-assignment rate",
    threshold: { kind: "percent", higherIsBetter: true, onTrack: 90, breaching: 70 },
  },
  "cl-metric-sla-compliance-rate": {
    displayTitle: "SLA compliance rate",
    threshold: { kind: "percent", higherIsBetter: true, onTrack: 85, breaching: 60 },
  },
  "cl-metric-sla-non-compliance-rate": {
    displayTitle: "SLA non-compliance rate",
    threshold: { kind: "percent", higherIsBetter: false, onTrack: 15, breaching: 40 },
  },
  "cl-metric-resolved-on-time-rate": {
    displayTitle: "Resolved on time rate",
    threshold: { kind: "percent", higherIsBetter: true, onTrack: 85, breaching: 60 },
  },
  "cl-metric-oldest-open": {
    displayTitle: "Oldest complaint",
    threshold: { kind: "count", higherIsBetter: false, onTrack: 7, breaching: 30 },
  },
  "cl-metric-avg-resolution-time": {
    displayTitle: "Average resolution time",
  },
  "ce-metric-reopen-rate": {
    displayTitle: "Reopen rate",
    threshold: { kind: "percent", higherIsBetter: false, onTrack: 10, breaching: 25 },
    context: { type: "csatSnapshot" },
  },
  "ce-metric-csat": {
    displayTitle: "Citizen satisfaction",
    threshold: { kind: "rating", higherIsBetter: true, onTrack: 4, breaching: 3 },
    context: { type: "acrossResolved" },
  },
};

export function getKpiDisplayConfig(metricId) {
  return KPI_DISPLAY[metricId] || {};
}

export function isKpiListMetric(metricId) {
  return Boolean(KPI_DISPLAY[metricId]?.listQueryKey);
}

export function getKpiDisplayTitle(metric) {
  const config = getKpiDisplayConfig(metric.id);
  return config.displayTitle || metric.metric;
}

export function parseNumericValue(displayValue) {
  if (displayValue == null || displayValue === "—" || displayValue === "…") return null;
  const raw = String(displayValue).trim();
  const ratingMatch = raw.match(/^([\d.]+)\s*\/\s*5$/);
  if (ratingMatch) return Number(ratingMatch[1]);
  const pctMatch = raw.match(/^([\d.]+)\s*%$/);
  if (pctMatch) return Number(pctMatch[1]);
  const num = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(num) ? num : null;
}

export function resolveThresholdStatus(metricId, displayValue) {
  const config = getKpiDisplayConfig(metricId).threshold;
  if (!config) return KPI_STATUS.NORMAL;

  const value = parseNumericValue(displayValue);
  if (value == null) return KPI_STATUS.NORMAL;

  const { higherIsBetter, onTrack, breaching } = config;

  if (higherIsBetter) {
    if (value >= onTrack) return KPI_STATUS.ON_TRACK;
    if (value <= breaching) return KPI_STATUS.BREACHING;
    return KPI_STATUS.NORMAL;
  }

  if (value <= onTrack) return KPI_STATUS.ON_TRACK;
  if (value >= breaching) return KPI_STATUS.BREACHING;
  return KPI_STATUS.NORMAL;
}

export function getStatusValueClass(status) {
  switch (status) {
    case KPI_STATUS.ON_TRACK:
      return "tw-text-status-resolved";
    case KPI_STATUS.BREACHING:
      return "tw-text-status-breach";
    default:
      return "tw-text-foreground";
  }
}

/** Value color for number tiles — threshold-driven, shared by every metric card. */
export function getNumberTileValueClass(status, { unavailable = false } = {}) {
  const styles = VISUALIZATION_STYLES[VIZ_TYPE.NUMBER_TILE_DELTA];
  if (unavailable) return styles.valueUnavailable;
  return getStatusValueClass(status);
}

/** Delta arrow color — uses metric threshold when set, else treats volume increases as negative. */
export function getSparklineDeltaClass(deltaPercent, metricId) {
  const {
    deltaMuted,
    deltaNeutral,
    deltaPositive,
    deltaNegative,
  } = VISUALIZATION_STYLES[VIZ_TYPE.NUMBER_TILE_SPARKLINE];

  if (deltaPercent == null || !Number.isFinite(deltaPercent)) {
    return deltaMuted;
  }
  if (deltaPercent === 0) return deltaNeutral;

  const threshold = getKpiDisplayConfig(metricId).threshold;
  const higherIsBetter = threshold?.higherIsBetter ?? false;
  const improving = higherIsBetter ? deltaPercent > 0 : deltaPercent < 0;
  return improving ? deltaPositive : deltaNegative;
}

export function statusValueToCssColor(statusClass) {
  switch (statusClass) {
    case "tw-text-status-resolved":
      return "var(--status-resolved)";
    case "tw-text-status-breach":
      return "var(--status-breach)";
    case "tw-text-muted-foreground":
      return "var(--muted-foreground)";
    default:
      return "var(--foreground)";
  }
}

function formatServiceCode(code) {
  return String(code ?? "Unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatOfficerLabel(uuid) {
  const id = String(uuid ?? "Unknown");
  if (id.length <= 8) return id;
  return `Officer …${id.slice(-6)}`;
}

function formatListLabel(labelKey, raw) {
  if (labelKey === "service_code") return formatServiceCode(raw);
  if (labelKey === "current_assignee_uuid") return formatOfficerLabel(raw);
  if (labelKey === "account_id") {
    const id = String(raw ?? "Unknown");
    return id.length > 10 ? `…${id.slice(-8)}` : id;
  }
  return String(raw ?? "Unknown");
}

function formatListMeasureValue(raw, format) {
  if (raw == null) return "—";
  if (format === "percentInteger") {
    const pct = Number(raw) <= 1 ? Number(raw) * 100 : Number(raw);
    return Number.isFinite(pct) ? `${Math.round(pct)}%` : "—";
  }
  return String(Math.round(Number(raw)) || 0);
}

export function parseKpiListItems(results, metricId, limit = 5) {
  const config = getKpiDisplayConfig(metricId);
  const queryKey = config.listQueryKey;
  if (!queryKey) return [];

  const rows = results?.[queryKey]?.rows;
  if (!rows?.length) return [];

  const labelKey = config.listLabelKey || "label";
  const measureKey = config.listMeasureKey || "total";

  const sorted = [...rows].sort((a, b) => {
    const diff = (Number(b[measureKey]) || 0) - (Number(a[measureKey]) || 0);
    if (diff !== 0) return diff;
    return String(a[labelKey] ?? "").localeCompare(String(b[labelKey] ?? ""));
  });

  return sorted.slice(0, limit).map((row, index) => ({
    rank: index + 1,
    label: formatListLabel(labelKey, row[labelKey]),
    value: formatListMeasureValue(row[measureKey], config.listValueFormat),
  }));
}

function readCount(results, queryKey, measureKey = "total") {
  const raw = results?.[queryKey]?.rows?.[0]?.[measureKey];
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function readPercentOneDecimal(results, queryKey, measureKey = "avg") {
  const raw = results?.[queryKey]?.rows?.[0]?.[measureKey];
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n.toFixed(1) : null;
}

export function buildKpiContextText(metricId, results, subMetricLabel) {
  const config = getKpiDisplayConfig(metricId).context;
  if (!config) return subMetricLabel || null;

  switch (config.type) {
    case "breachOpen": {
      const n = readCount(results, "rs_breach_total");
      return n == null ? null : `Breached open: ${n}`;
    }
    case "outOfOpen": {
      const open = readCount(results, "cl_open_weekly");
      const breach = readCount(results, "rs_breach_total");
      if (open == null || breach == null) return null;
      return `Out of ${open} open complaints`;
    }
    case "outOfRegistered": {
      const total = readCount(results, "cl_reg_weekly");
      if (total == null) return null;
      return `Out of ${total} complaints`;
    }
    case "csatSnapshot": {
      const csat = readPercentOneDecimal(results, "ce_csat_avg_week", "avg");
      return csat == null ? null : `CSAT ${csat}/5`;
    }
    case "acrossResolved":
      return "Across resolved";
    case "timeWindow":
      return subMetricLabel || null;
    default:
      return subMetricLabel || null;
  }
}
