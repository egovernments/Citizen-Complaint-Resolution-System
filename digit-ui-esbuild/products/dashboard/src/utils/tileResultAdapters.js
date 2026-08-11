/**
 * React-free result-to-view-model adapters used by KpiTile.
 *
 * This module deliberately preserves the renderer's existing interpretation of
 * catalog viz descriptors and analytics results. Keeping these transformations
 * free of React makes the legacy result contract characterizable while the
 * backend presentation envelope is introduced incrementally.
 */

import { formatNumber } from './numberFormat';
import {
  GEO_MAP_LAYER_KEYS,
  partitionPinsByLayer,
  summarizeWardRows,
} from './complaintPins';
import { evaluateCompose, requiresBackendComposition } from './composeKpi';
import { getNumberTileDeltaClass, formatOfficerLabel, dimensionKindForName } from '../config/kpiDisplay';
import {
  resolveSlaRiskPresentation,
  computeBreachDurationMs,
  formatBreachDurationCompact,
  formatWorkflowStatusLabel,
  normalizeWorkflowStatusKey,
} from '../config/complaintsAtRiskPresentation';
import { dimensionLabel } from '../i18n/dimensionLabel';
import { translate as t } from '../i18n/localeRuntime';
import { seriesEntryLabel, resolveSeriesLabel } from '../i18n/textResolver';

export function dimensionColumns(result, viz) {
  const cols = (result.columns || []).filter((c) => c.role === 'dimension');
  if (cols.length) return cols;
  if (viz.dimensionKey) return [{ name: viz.dimensionKey }];
  return [];
}

export function measureColumns(result, viz) {
  const cols = (result.columns || []).filter((c) => c.role === 'measure');
  if (cols.length) return cols;
  const keys = viz.measureKeys || (viz.measureKey ? [viz.measureKey] : []);
  return keys.map((name) => ({ name }));
}

export function primaryDimensionKey(result, viz) {
  return dimensionColumns(result, viz)[0]?.name || viz.dimensionKey || 'label';
}

export function primaryMeasure(result, viz) {
  return measureColumns(result, viz)[0] || { name: viz.measureKey || 'total' };
}

export function resolveScalar(ctx) {
  const { viz, result, results } = ctx;
  // Calendar-aware averages are backend-owned. A malformed definition that
  // combines one with a raw query must fail closed instead of displaying a total.
  if (requiresBackendComposition(viz.compose)) {
    return result.value != null ? Number(result.value) : null;
  }
  if (viz.compose && results) {
    const composed = evaluateCompose(viz.compose, results);
    if (composed != null) return composed;
  }
  if (result.value != null) return result.value;
  if (result.values && viz.valueKey != null && result.values[viz.valueKey] != null) {
    return Number(result.values[viz.valueKey]);
  }
  if (result.values) {
    const first = Object.values(result.values)[0];
    if (first != null) return Number(first);
  }
  const row0 = result.rows?.[0];
  if (row0) {
    const key = viz.valueKey || primaryMeasure(result, viz).name;
    if (row0[key] != null) return Number(row0[key]);
  }
  return null;
}

export function resolvePrior(ctx) {
  const { viz, result } = ctx;
  if (result.prior != null) return Number(result.prior);
  if (viz.priorKey != null) {
    if (result.values && result.values[viz.priorKey] != null) return Number(result.values[viz.priorKey]);
    const row0 = result.rows?.[0];
    if (row0 && row0[viz.priorKey] != null) return Number(row0[viz.priorKey]);
  }
  return null;
}

export function computeDelta(current, prior, format, mode) {
  if (current == null || prior == null || !Number.isFinite(current) || !Number.isFinite(prior)) {
    return null;
  }
  const eff = mode || (isPercentFormat(format) ? 'percentPoint' : 'percent');
  if (eff === 'percentPoint') return normalizePct(current) - normalizePct(prior);
  if (eff === 'days') return (current - prior) / 86400000;
  if (eff === 'duration') return current - prior;
  if (eff === 'rating') return current - prior;
  if (prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

export function formatDeltaDisplay(delta, format, mode) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const arrow = delta >= 0 ? '▲' : '▼';
  const abs = Math.abs(delta);
  const eff = mode || (isPercentFormat(format) ? 'percentPoint' : 'percent');
  if (eff === 'duration') {
    return abs >= 86400000
      ? `${arrow} ${formatNumber(abs / 86400000, { decimals: 1 }) ?? (abs / 86400000).toFixed(1)} ${t("DASHBOARD_UNIT_DAYS", "days")}`
      : `${arrow} ${formatNumber(abs / 3600000, { decimals: 1 }) ?? (abs / 3600000).toFixed(1)} ${t("DASHBOARD_UNIT_HRS", "hrs")}`;
  }
  const rounded = Math.round(abs * 10) / 10;
  const formatted =
    formatNumber(rounded, { decimals: 1, trim: true }) ??
    (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1));
  if (eff === 'days') return `${arrow} ${formatted} ${rounded === 1 ? t("DASHBOARD_UNIT_DAY", "day") : t("DASHBOARD_UNIT_DAYS", "days")}`;
  if (eff === 'rating') return `${arrow} ${formatted}`;
  const unit = eff === 'percentPoint' ? 'pp' : '%';
  return `${arrow} ${formatted}${unit}`;
}

export function deltaClassFor(delta) {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return undefined;
  return delta > 0 ? 'dashboard-delta-up' : 'dashboard-delta-down';
}

export const KPI_STATUS = { ON_TRACK: 'on_track', NORMAL: 'normal', BREACHING: 'breaching' };

export function thresholdStatus(threshold, value) {
  if (!threshold || value == null || !Number.isFinite(Number(value))) return null;
  const n = threshold.kind === 'percent' ? normalizePct(value) : Number(value);
  const { higherIsBetter, onTrack, breaching } = threshold;
  if (higherIsBetter) {
    if (n >= onTrack) return KPI_STATUS.ON_TRACK;
    if (n <= breaching) return KPI_STATUS.BREACHING;
    return KPI_STATUS.NORMAL;
  }
  if (n <= onTrack) return KPI_STATUS.ON_TRACK;
  if (n >= breaching) return KPI_STATUS.BREACHING;
  return KPI_STATUS.NORMAL;
}

export function resolveTileStatus(viz, value) {
  return thresholdStatus(viz.threshold, value) ?? viz.accent;
}

export function resolveDeltaClass(viz, value, delta) {
  const status = thresholdStatus(viz.threshold, value);
  if (status) {
    const unavailable = value == null || !Number.isFinite(Number(value));
    return getNumberTileDeltaClass(status, { unavailable });
  }
  return deltaClassFor(delta);
}

export function statusToSeriesColor(status) {
  switch (status) {
    case KPI_STATUS.ON_TRACK: return 'var(--status-resolved)';
    case KPI_STATUS.BREACHING: return 'var(--status-breach)';
    default: return null;
  }
}

export function resolveSparkline(ctx) {
  const { viz, result } = ctx;
  if (Array.isArray(result.sparkline)) return result.sparkline.map((n) => Number(n) || 0);
  const seriesRows = viz.sparklineKey && result[viz.sparklineKey]?.rows
    ? result[viz.sparklineKey].rows
    : result.rows;
  if (!seriesRows?.length) return [];
  const dateKey = viz.dateKey || dimensionColumns(result, viz)[0]?.name || 'created_date';
  const measureKey = viz.sparklineMeasureKey || primaryMeasure(result, viz).name;
  return [...seriesRows]
    .sort((a, b) => String(a[dateKey] ?? '').localeCompare(String(b[dateKey] ?? '')))
    .map((row) => Number(row[measureKey]) || 0);
}

export function adaptBarRows(ctx) {
  const { viz, result, locale } = ctx;
  const dimKey = primaryDimensionKey(result, viz);
  const measure = primaryMeasure(result, viz);
  const isPercent = viz.format === 'percent' || viz.format === 'percentOneDecimal';
  let rows = (result.rows || []).map((row) => ({
    label: formatDimLabel(row[dimKey], viz, dimKey, locale),
    count: percentToChartScale(Number(row[measure.name]) || 0, isPercent),
  }));
  if (viz.kind !== 'histogram' && !viz.categoryOrder && viz.sort !== 'none') {
    rows = rows.sort((a, b) => b.count - a.count);
  }
  if (viz.categoryOrder) {
    const ord = viz.categoryOrder;
    const idx = (l) => {
      const i = ord.findIndex((o) => l === o || l.includes(o) || o.includes(l));
      return i < 0 ? ord.length : i;
    };
    rows = rows.slice().sort((a, b) => idx(a.label) - idx(b.label));
  }
  if (viz.limit) rows = rows.slice(0, viz.limit);
  return rows;
}

export function adaptHorizontalRows(ctx) {
  const { viz, result, locale } = ctx;
  const dimKey = primaryDimensionKey(result, viz);
  const valueKey = viz.measureKey || primaryMeasure(result, viz).name;
  const numeratorKey = viz.numeratorKey;
  const denominatorKey = viz.denominatorKey;
  const grouped = new Map();
  for (const row of result.rows || []) {
    const key = String(row[dimKey] ?? 'Unknown');
    const bucket = grouped.get(key) || { num: 0, den: 0, val: 0 };
    if (numeratorKey != null) bucket.num += Number(row[numeratorKey]) || 0;
    if (denominatorKey != null) bucket.den += Number(row[denominatorKey]) || 0;
    bucket.val += Number(row[valueKey]) || 0;
    grouped.set(key, bucket);
  }
  const isRatio = numeratorKey != null && denominatorKey != null;
  let rows = [...grouped.entries()].map(([key, b]) => ({
    label: formatDimLabel(key, viz, dimKey, locale),
    value: isRatio ? (b.den > 0 ? b.num / b.den : 0) : b.val,
    resolved: numeratorKey != null ? b.num : undefined,
    created: denominatorKey != null ? b.den : undefined,
  }));
  if (isRatio) {
    rows = rows.filter((r) => (r.created || 0) > 0 && Number(r.value) > 0);
  }
  if (viz.sort !== 'none') rows = rows.sort((a, b) => a.value - b.value);
  if (viz.limit) rows = rows.slice(0, viz.limit);
  return rows;
}

export function adaptStacked(ctx) {
  const { viz, result, locale } = ctx;
  if (result.series && Array.isArray(result.series) && result.categories) {
    return { categories: result.categories, series: result.series, colors: result.colors || viz.colors || [] };
  }
  const dimKey = primaryDimensionKey(result, viz);
  const stackKey = viz.stackKey;
  const measureKey = viz.measureKey || 'total';
  const stackSeries = viz.stackSeries;
  if (!stackKey || !stackSeries?.length) {
    let rows = (result.rows || []).map((row) => ({
      label: formatDimLabel(row[dimKey], viz, dimKey, locale),
      value: Number(row[measureKey]) || 0,
    }));
    if (viz.sort !== 'none') rows = rows.sort((a, b) => b.value - a.value);
    if (viz.limit) rows = rows.slice(0, viz.limit);
    return {
      categories: rows.map((r) => r.label),
      series: [{ name: resolveSeriesLabel(viz, viz.seriesLabel || t("DASHBOARD_COMMON_COUNT", "Count")), data: rows.map((r) => r.value) }],
      colors: viz.colors || ['var(--chart-1)'],
    };
  }
  const segKeys = new Set(stackSeries.map((d) => normalizeSeg(d.key)));
  const categoryMap = new Map();
  for (const row of result.rows || []) {
    const seg = normalizeSeg(row[stackKey]);
    if (!segKeys.has(seg)) continue;
    const category = String(row[dimKey] ?? 'Unknown');
    if (!categoryMap.has(category)) categoryMap.set(category, {});
    const bucket = categoryMap.get(category);
    const value = viz.valueTransform === 'msToHours'
      ? msToHours(row[measureKey])
      : Number(row[measureKey]) || 0;
    bucket[seg] = viz.aggregate === 'set' ? value : (bucket[seg] ?? 0) + value;
  }
  let entries = [...categoryMap.entries()].map(([key, segments]) => ({
    key,
    segments,
    total: Object.values(segments).reduce((sum, value) => sum + value, 0),
  }));
  entries = entries.filter((entry) => entry.total > 0).sort((left, right) => {
    if (viz.sortBySegment) {
      const difference =
        (right.segments[normalizeSeg(viz.sortBySegment)] ?? 0) -
        (left.segments[normalizeSeg(viz.sortBySegment)] ?? 0);
      if (difference !== 0) return difference;
    }
    return right.total - left.total;
  });
  if (viz.limit) entries = entries.slice(0, viz.limit);
  return {
    categories: entries.map((entry) => formatDimLabel(entry.key, viz, dimKey, locale)),
    series: stackSeries.map((def) => ({
      name: seriesEntryLabel(def, def.label),
      data: entries.map((entry) => entry.segments[normalizeSeg(def.key)] ?? 0),
    })),
    colors: stackSeries.map((def) => def.color),
  };
}

export function adaptPie(ctx) {
  const { viz, result, locale } = ctx;
  const dimKey = primaryDimensionKey(result, viz);
  const measure = primaryMeasure(result, viz);
  const colors = viz.colors || [];
  if (viz.channelMap?.length) return adaptChannelPie(result, dimKey, measure, viz);
  let rows = (result.rows || [])
    .map((row, index) => ({
      label: formatDimLabel(row[dimKey], viz, dimKey, locale),
      count: Number(row[measure.name]) || 0,
      color: colors[index],
    }))
    .filter((slice) => slice.count > 0);
  if (viz.sort !== 'none') rows = rows.sort((left, right) => right.count - left.count);
  return rows;
}

export function adaptChannelPie(result, dimKey, measure, viz) {
  const channels = viz.channelMap;
  const sourceToChannel = new Map();
  for (const channel of channels) {
    for (const source of channel.sources || []) {
      sourceToChannel.set(normalizeSourceKey(source), channel.id);
    }
  }
  const totals = new Map(channels.map((channel) => [channel.id, 0]));
  for (const row of result.rows || []) {
    const count = Number(row[measure.name]) || 0;
    if (count <= 0) continue;
    const key = normalizeSourceKey(row[dimKey]);
    const id = key ? (sourceToChannel.get(key) ?? 'other') : 'other';
    if (totals.has(id)) totals.set(id, totals.get(id) + count);
  }
  return channels
    .map((channel) => ({
      label: seriesEntryLabel(channel, dimensionLabel(channel.id, 'channel', channel.label)),
      count: totals.get(channel.id) ?? 0,
      color: channel.color,
    }))
    .filter((slice) => slice.count > 0)
    .sort((left, right) => (right.count - left.count) || left.label.localeCompare(right.label));
}

export function normalizeSourceKey(source) {
  return String(source ?? '').trim().toLowerCase().replace(/-/g, '_');
}

export function adaptLine(ctx) {
  const { viz, result, title, locale } = ctx;
  if (result.periods) {
    return { periods: result.periods, defaultPeriod: result.defaultPeriod || viz.defaultPeriod || 'daily', headerTitle: result.title || title };
  }
  if (result.series && result.categories) {
    return { categories: result.categories, series: result.series };
  }
  const dimKey = primaryDimensionKey(result, viz);
  const rows = [...(result.rows || [])].sort((left, right) =>
    String(left[dimKey] ?? '').localeCompare(String(right[dimKey] ?? ''))
  );
  const categories = rows.map((row) => formatDimLabel(row[dimKey], viz, dimKey, locale));
  if (viz.seriesDefs?.length) {
    return {
      categories,
      series: viz.seriesDefs.map((def) => ({
        name: seriesEntryLabel(def, def.name),
        color: def.color,
        yAxisGroup: def.yAxisGroup,
        dashArray: def.dashArray ?? 0,
        data: rows.map((row) => {
          if (def.numeratorKey != null && def.denominatorKey != null) {
            const numerator = Number(row[def.numeratorKey]) || 0;
            const denominator = Number(row[def.denominatorKey]) || 0;
            return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
          }
          return Number(row[def.measureKey]) || 0;
        }),
      })),
    };
  }
  const measures = measureColumns(result, viz);
  return {
    categories,
    series: measures.map((measure) => ({
      name: seriesEntryLabel(measure, measure.label || measure.name),
      data: rows.map((row) => Number(row[measure.name]) || 0),
    })),
  };
}

export function deriveColumnsFromResult(result) {
  return (result.columns || []).map((column) => ({
    id: column.name,
    label: column.label || column.name,
    labelKey: column.labelKey,
    align: column.role === 'measure' ? 'right' : 'left',
    type: mapFormatToCellType(column.format),
    thresholdKey: column.thresholdKey,
  }));
}

export function mapFormatToCellType(format) {
  switch (format) {
    case 'integer': return 'integer';
    case 'percent':
    case 'percentOneDecimal':
    case 'percentInteger': return 'percent';
    case 'hoursDecimal': return 'hours';
    case 'hoursDays': return 'hoursDays';
    case 'ratingOutOfFive': return 'rating';
    default: return 'text';
  }
}

export function adaptSlaRiskRows(ctx) {
  const { viz, result } = ctx;
  const limit = viz.limit || 50;
  return (result.rows || [])
    .map((row, index) => {
      const complaintId = String(row.service_request_id ?? '').trim();
      if (!complaintId || complaintId === 'null') return null;
      const slaBucket = String(row.sla_status_bucket ?? '');
      const { slaLabel, slaLevel } = resolveSlaRiskPresentation(slaBucket);
      const breachDurationMs = computeBreachDurationMs(
        row.open_age_ms,
        row.sla_target_ms,
        slaBucket
      );
      const applicationStatus = String(row.application_status ?? '');
      const subtypeKey = String(row.service_code ?? '');
      const typeKey = String(row.service_group ?? '');
      return {
        id: complaintId,
        typeLabel: typeKey ? dimensionLabel(typeKey, 'complaintType') : '—',
        subtypeLabel: subtypeKey ? dimensionLabel(subtypeKey, 'complaintType') : '—',
        locality: row.ward_code ? dimensionLabel(String(row.ward_code), 'boundary') : '—',
        ownerName: formatOfficerLabel(row.current_assignee_uuid),
        ownerRole: '—',
        status: normalizeWorkflowStatusKey(applicationStatus),
        statusLabel: formatWorkflowStatusLabel(applicationStatus),
        slaLabel,
        slaLevel,
        breachDurationMs,
        breachDurationLabel: formatBreachDurationCompact(breachDurationMs),
        _rowKey: `risk-${index}-${complaintId}`,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (right.breachDurationMs ?? -1) - (left.breachDurationMs ?? -1))
    .slice(0, limit);
}

export function adaptMapLayers(ctx) {
  const { viz, result } = ctx;
  const dimKey = viz.dimensionKey || 'ward_code';
  const wards = (result.rows || [])
    .filter((row) => {
      const code = String(row[dimKey] ?? '').trim();
      return code && code !== 'null';
    })
    .map((row) => {
      const wardCode = String(row[dimKey]);
      const filed = Number(row.filed) || 0;
      const open = Number(row.open) || 0;
      const resolved = Number(row.resolved) || 0;
      return {
        wardCode,
        label: dimensionLabel(wardCode, 'boundary'),
        count: filed,
        total: filed,
        created: filed,
        open,
        resolved,
        openPct: filed > 0 ? (open / filed) * 100 : 0,
        resolvedPct: filed > 0 ? (resolved / filed) * 100 : 0,
      };
    });
  const pins = result.pins || [];
  const statusKnown = result.pinsStatusKnown === true;
  const { layerTotals, unmapped } = summarizeWardRows(result.rows || [], dimKey);
  const layers = {
    wardDetails: {},
    complaintPinsByLayer: partitionPinsByLayer(pins, statusKnown),
    complaintPinsError: null,
    pinSemantics: statusKnown ? 'per-layer' : 'open-only',
    pinsTruncated: result.pinsTruncated === true,
    layerTotals,
    unmapped,
  };
  for (const key of GEO_MAP_LAYER_KEYS) layers[key] = wards;
  return layers;
}

export function adaptRanked(ctx) {
  const { viz, result, locale } = ctx;
  const dimKey = primaryDimensionKey(result, viz);
  const measure = primaryMeasure(result, viz);
  let rows = (result.rows || []).map((row) => ({
    label: formatDimLabel(row[dimKey], viz, dimKey, locale),
    value: Number(row[measure.name]) || 0,
  }));
  if (viz.sort !== 'none') rows = rows.sort((left, right) => right.value - left.value);
  rows = rows.slice(0, viz.limit || 10);
  return { rows, format: measure.format || viz.format };
}

export function adaptDow(ctx) {
  const { viz, result } = ctx;
  const dimKey = primaryDimensionKey(result, viz);
  const measure = primaryMeasure(result, viz);
  const rows = (result.rows || []).map((row) => ({
    dow: Number(row[dimKey]),
    value: Number(row[measure.name]) || 0,
  }));
  return { rows, format: measure.format || viz.format };
}

const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;

export function applyFormat(val, format, locale) {
  if (val == null || !Number.isFinite(Number(val))) return '—';
  const n = Number(val);
  switch (format) {
    case 'integer':           return formatNumber(n, 'integer') ?? Math.round(n).toLocaleString(locale);
    case 'percentInteger':
    case 'percentNoDecimal':  return `${formatNumber(normalizePct(n), 'percentInteger') ?? Math.round(normalizePct(n))}%`;
    case 'percentOneDecimal':
    case 'percent':           return `${formatNumber(normalizePct(n), 'percent') ?? normalizePct(n).toFixed(1)}%`;
    case 'decimalOne':        return formatNumber(n, 'decimalOne') ?? n.toFixed(1);
    case 'decimalTwo':        return formatNumber(n, 'decimalTwo') ?? n.toFixed(2);
    case 'ratingOutOfFive':   return `${formatNumber(n, 'ratingOutOfFive') ?? n.toFixed(1)}/5`;
    case 'hoursDays': {
      const hours = n / MS_PER_HOUR;
      if (hours < 48) {
        const rounded = Math.round(hours * 10) / 10;
        const number = formatNumber(rounded, { decimals: 1, trim: true }) ?? (Number.isInteger(rounded) ? rounded : rounded.toFixed(1));
        return `${number} ${rounded === 1 ? t("DASHBOARD_UNIT_HR", "hr") : t("DASHBOARD_UNIT_HRS", "hrs")}`;
      }
      const days = n / MS_PER_DAY;
      const rounded = Math.round(days * 10) / 10;
      const number = formatNumber(rounded, { decimals: 1, trim: true }) ?? (Number.isInteger(rounded) ? rounded : rounded.toFixed(1));
      return `${number} ${rounded === 1 ? t("DASHBOARD_UNIT_DAY", "day") : t("DASHBOARD_UNIT_DAYS", "days")}`;
    }
    case 'hoursDecimal':      return `${formatNumber(n / MS_PER_HOUR, 'hoursDecimal') ?? (n / MS_PER_HOUR).toFixed(1)}h`;
    case 'signedInteger':     return `${n >= 0 ? '+' : ''}${formatNumber(n, 'signedInteger') ?? Math.round(n).toLocaleString(locale)}`;
    case 'ordinal': {
      const value = Math.round(n) % 100;
      const suffix = ['th', 'st', 'nd', 'rd'];
      return (formatNumber(n, 'integer') ?? Math.round(n)) + (suffix[(value - 20) % 10] || suffix[value] || suffix[0]);
    }
    default: return String(val);
  }
}

export function isPercentFormat(format) {
  return (
    format === 'percent' ||
    format === 'percentInteger' ||
    format === 'percentNoDecimal' ||
    format === 'percentOneDecimal'
  );
}

export function normalizePct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return number <= 1 ? number * 100 : number;
}

export function percentToChartScale(value, isPercent) {
  return isPercent ? normalizePct(value) : value;
}

export function msToHours(ms) {
  const hours = Number(ms) / MS_PER_HOUR;
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * 10) / 10;
}

export function formatLabel(value) {
  const string = String(value ?? '');
  if (!string || string === 'null' || string === 'undefined') return t("DASHBOARD_COMMON_UNKNOWN", "Unknown");
  return string;
}

export function formatDimLabel(value, viz, dim, locale) {
  switch (viz?.labelFormat) {
    case 'dimension': {
      const kind = dimensionKindForName(dim);
      return kind ? dimensionLabel(value, kind) : String(value);
    }
    case 'department': return dimensionLabel(value, 'department');
    case 'officer':    return formatOfficerLabel(value);
    case 'date-dow':   return formatDateDow(value, locale);
    default:           return formatLabel(value);
  }
}

export function formatDateDow(value, locale) {
  const key = epochOrIsoToDateKey(value);
  if (!key) return formatLabel(value);
  const date = new Date(`${key}T12:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString(locale, { weekday: 'short' });
}

export function epochOrIsoToDateKey(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  const string = String(value).trim();
  if (/^\d{13}$/.test(string)) return new Date(Number(string)).toISOString().slice(0, 10);
  const iso = string.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : string;
}

export function normalizeSeg(value) {
  return String(value ?? '').toUpperCase();
}

export function errorLabel(code) {
  switch (code) {
    case 'pii_forbidden': return t("DASHBOARD_TILE_ERR_RESTRICTED", "Restricted");
    case 'kpi_forbidden': return t("DASHBOARD_TILE_ERR_NO_ACCESS", "No access");
    case 'scope_forbidden': return t("DASHBOARD_TILE_ERR_OUT_OF_SCOPE", "Out of scope");
    default: return code || t("DASHBOARD_TILE_ERR_GENERIC", "ERROR");
  }
}

export function defScrollKey(ctx) {
  return ctx.def?.kpiId || ctx.def?.id || undefined;
}
