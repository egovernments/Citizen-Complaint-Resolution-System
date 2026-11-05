/**
 * What a dashboard tile displays, as plain functions (#1977): the value and
 * prior-period lookups, the delta text, the viz.format formatter, dimension
 * labels, and the per-kind chart / table / map adapters.
 *
 * KpiTile renders from these, and the export (export/exportModel.js) writes
 * from the same calls, so the downloaded file says exactly what the tile shows.
 * Nothing here imports React.
 */

import { evaluateCompose, requiresBackendComposition } from './composeKpi';
import { applyGroupByToColumns } from './hierLevelGrouping';
import { formatNumber } from './numberFormat';
import { transformTableRows } from './tableRows';
import {
  GEO_MAP_LAYER_KEYS,
  partitionPinsByLayer,
  summarizeWardRows,
} from './complaintPins';
import { formatOfficerLabel, dimensionKindForName } from '../config/kpiDisplay';
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

/**
 * What a tile shows in place of its content, or null when it renders content:
 * the error label and message, "No data" when there is no result, or the
 * loading skeleton.
 */
export function tileState({ error, result, loading }) {
  if (error) {
    return {
      kind: 'error',
      code: error.code,
      label: errorLabel(error.code),
      message: error.message || t("DASHBOARD_TILE_ERR_FAILED_TO_LOAD", "Failed to load"),
    };
  }
  if (!result && !loading) return { kind: 'empty', label: t("DASHBOARD_COMMON_NO_DATA", "No data") };
  if (!result) return { kind: 'loading' };
  return null;
}

// ---------------------------------------------------------------------------
// Column-role helpers (zero hardcoded column names)
// ---------------------------------------------------------------------------

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
  // Calendar-aware averages are composed by pgr-services. If a malformed KPI definition
  // combines one with a raw query, fail closed instead of rendering that query's total as
  // an average. A valid backend-composed response always supplies result.value.
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

/**
 * Generalized WoW delta — mirrors resolveSparklineDelta / computeWowPercent:
 * percent metrics use a percentage-point delta, everything else a % change.
 */
export function computeDelta(current, prior, format, mode) {
  if (current == null || prior == null || !Number.isFinite(current) || !Number.isFinite(prior)) {
    return null;
  }
  // viz.delta.mode (when set) decides the unit; otherwise fall back to the format.
  const eff = mode || (isPercentFormat(format) ? 'percentPoint' : 'percent');
  if (eff === 'percentPoint') return normalizePct(current) - normalizePct(prior);
  if (eff === 'days') return (current - prior) / 86400000; // ms -> whole days
  if (eff === 'duration') return current - prior; // raw ms difference
  if (eff === 'rating') return current - prior; // rating points
  if (prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100; // relative %
}

// Delta numbers route their NUMERIC part through the tenant mask
// (formatNumber, null when unconfigured -> the pre-#1213 expression); the
// arrow and pp/%/day/hr unit suffixes stay here.
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

export function adaptBarRows(ctx) {
  const { viz, result, locale } = ctx;
  const dimKey = primaryDimensionKey(result, viz);
  const measure = primaryMeasure(result, viz);
  const isPercent = viz.format === 'percent' || viz.format === 'percentOneDecimal';

  let rows = (result.rows || []).map((row) => ({
    label: formatDimLabel(row[dimKey], viz, dimKey, locale),
    count: percentToChartScale(Number(row[measure.name]) || 0, isPercent),
  }));

  // Histograms keep the backend bucket order; bars rank by value desc unless
  // the descriptor pins an explicit category order.
  if (viz.kind !== 'histogram' && !viz.categoryOrder && viz.sort !== 'none') {
    rows = rows.sort((a, b) => b.count - a.count);
  }
  // Explicit category order (e.g. age buckets <1d,1-3d,3-7d,>7d) — apply it so the
  // backend's arbitrary row order doesn't scramble an ordered axis. Substring match
  // tolerates label formatting; unknown labels sink to the end.
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
  const numeratorKey = viz.numeratorKey;   // e.g. resolved
  const denominatorKey = viz.denominatorKey; // e.g. created
  // Roll up to display grain when several source rows share a dimension value
  // (e.g. service_code rows -> one department_code). Mirrors the reference
  // parseDepartmentFlowRatioBarChart roll-up; numerator/denominator sum, then
  // value is recomputed as the ratio.
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
  // Drop zero-denominator categories (reference filters created<=0).
  // Only hide zero *values* for ratio charts (e.g. flow ratio) — count bars
  // should still show an explicit zero bar (#1028 / review on #1311).
  if (isRatio) {
    rows = rows.filter((r) => (r.created || 0) > 0 && Number(r.value) > 0);
  }
  if (viz.sort !== 'none') rows = rows.sort((a, b) => a.value - b.value);
  if (viz.limit) rows = rows.slice(0, viz.limit);
  return rows;
}

export function adaptStacked(ctx) {
  const { viz, result, locale } = ctx;

  // BE-shaped passthrough.
  if (result.series && Array.isArray(result.series) && result.categories) {
    return { categories: result.categories, series: result.series, colors: result.colors || viz.colors || [] };
  }

  const dimKey = primaryDimensionKey(result, viz);
  const stackKey = viz.stackKey;
  const measureKey = viz.measureKey || 'total';
  const stackSeries = viz.stackSeries; // [{ key, label, color }]

  // Single-series stacked (e.g. complaints-by-type "Filed").
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

  // Pivot long-form rows into per-segment series.
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
    total: Object.values(segments).reduce((s, v) => s + v, 0),
  }));
  entries = entries.filter((e) => e.total > 0).sort((a, b) => {
    if (viz.sortBySegment) {
      const d = (b.segments[normalizeSeg(viz.sortBySegment)] ?? 0) - (a.segments[normalizeSeg(viz.sortBySegment)] ?? 0);
      if (d !== 0) return d;
    }
    return b.total - a.total;
  });
  if (viz.limit) entries = entries.slice(0, viz.limit);

  return {
    categories: entries.map((e) => formatDimLabel(e.key, viz, dimKey, locale)),
    series: stackSeries.map((def) => ({
      name: seriesEntryLabel(def, def.label),
      data: entries.map((e) => e.segments[normalizeSeg(def.key)] ?? 0),
    })),
    colors: stackSeries.map((def) => def.color),
  };
}

export function adaptPie(ctx) {
  const { viz, result, locale } = ctx;
  const dimKey = primaryDimensionKey(result, viz);
  const measure = primaryMeasure(result, viz);
  const colors = viz.colors || [];
  // Optional source->channel rollup (parity with parseOpenComplaintsByChannelPieChart):
  // when viz.channelMap is present, fold raw `source` rows into named channels
  // with fixed colours/labels before slicing.
  if (viz.channelMap?.length) {
    return adaptChannelPie(result, dimKey, measure, viz);
  }
  let rows = (result.rows || [])
    .map((row, i) => ({
      label: formatDimLabel(row[dimKey], viz, dimKey, locale),
      count: Number(row[measure.name]) || 0,
      color: colors[i],
    }))
    .filter((s) => s.count > 0);
  if (viz.sort !== 'none') rows = rows.sort((a, b) => b.count - a.count);
  return rows;
}

/** source -> channel rollup with verbatim COMPLAINT_CHANNELS labels/colours. */
export function adaptChannelPie(result, dimKey, measure, viz) {
  const channels = viz.channelMap; // [{ id, label, color, sources:[...] }]
  const sourceToChannel = new Map();
  for (const ch of channels) {
    for (const src of ch.sources || []) {
      sourceToChannel.set(normalizeSourceKey(src), ch.id);
    }
  }
  const totals = new Map(channels.map((c) => [c.id, 0]));
  for (const row of result.rows || []) {
    const count = Number(row[measure.name]) || 0;
    if (count <= 0) continue;
    const key = normalizeSourceKey(row[dimKey]);
    const id = key ? (sourceToChannel.get(key) ?? 'other') : 'other';
    if (totals.has(id)) totals.set(id, totals.get(id) + count);
  }
  return channels
    .map((c) => ({
      label: seriesEntryLabel(c, dimensionLabel(c.id, 'channel', c.label)),
      count: totals.get(c.id) ?? 0,
      color: c.color,
    }))
    .filter((s) => s.count > 0)
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));
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
  const rows = [...(result.rows || [])].sort((a, b) =>
    String(a[dimKey] ?? '').localeCompare(String(b[dimKey] ?? ''))
  );
  const categories = rows.map((r) => formatDimLabel(r[dimKey], viz, dimKey, locale));

  // Descriptor-driven multi-series with per-series colour / dual y-axis grouping.
  // Each seriesDef is either a direct measure ({ measureKey }) or a computed
  // ratio percent ({ numeratorKey, denominatorKey }) — ports the reference
  // COMPLAINTS_OVER_TIME_SERIES_DEFS (Created / Resolved counts + Resolution
  // rate / SLA compliance percents on a second axis).
  if (viz.seriesDefs?.length) {
    return {
      categories,
      series: viz.seriesDefs.map((def) => ({
        name: seriesEntryLabel(def, def.name),
        color: def.color,
        yAxisGroup: def.yAxisGroup,
        dashArray: def.dashArray ?? 0,
        data: rows.map((r) => {
          if (def.numeratorKey != null && def.denominatorKey != null) {
            const num = Number(r[def.numeratorKey]) || 0;
            const den = Number(r[def.denominatorKey]) || 0;
            return den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
          }
          return Number(r[def.measureKey]) || 0;
        }),
      })),
    };
  }

  // Long-form fallback -> single/multi series keyed off viz.measureKeys.
  const measures = measureColumns(result, viz);
  return {
    categories,
    series: measures.map((m) => ({
      name: seriesEntryLabel(m, m.label || m.name),
      data: rows.map((r) => Number(r[m.name]) || 0),
    })),
  };
}

export function deriveColumnsFromResult(result) {
  return (result.columns || []).map((c) => ({
    id: c.name,
    label: c.label || c.name,
    labelKey: c.labelKey,
    align: c.role === 'measure' ? 'right' : 'left',
    type: mapFormatToCellType(c.format),
    thresholdKey: c.thresholdKey,
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

/**
 * Shape the generic at-risk grain rows into the ComplaintsAtRiskTable row
 * contract. Ports config/kpiQueries.parseComplaintsAtRiskTable verbatim (it
 * relies only on the pure presentation helpers, which survive the inversion),
 * so the inverted engine renders the rich SLA-risk table at parity with the
 * reference instead of a degraded ranked list.
 */
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
  // The map tile's query returns filed/open/resolved per ward. Her map colours the
  // Created layer by `count`, and the Open/Resolved layers by `openPct`/`resolvedPct`
  // (share of filed, 0–100). One ward series carries all three so any layer renders.
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
        // named counts so the choropleth hover tooltip (reads created/open/resolved) has values
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
    // 'open-only' = the tenant's catalog still has the legacy pin def, so pins
    // cannot follow the layer; the legend says so instead of lying by omission.
    pinSemantics: statusKnown ? 'per-layer' : 'open-only',
    pinsTruncated: result.pinsTruncated === true,
    layerTotals,
    unmapped,
  };
  for (const key of GEO_MAP_LAYER_KEYS) {
    layers[key] = wards;
  }
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
  if (viz.sort !== 'none') rows = rows.sort((a, b) => b.value - a.value);
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

// Invoked at render (never a module constant) so labels track the language.
export const dowLabels = () => [
  t("DASHBOARD_DOW_SUN", "Sun"),
  t("DASHBOARD_DOW_MON", "Mon"),
  t("DASHBOARD_DOW_TUE", "Tue"),
  t("DASHBOARD_DOW_WED", "Wed"),
  t("DASHBOARD_DOW_THU", "Thu"),
  t("DASHBOARD_DOW_FRI", "Fri"),
  t("DASHBOARD_DOW_SAT", "Sat"),
];

// ---------------------------------------------------------------------------
// Formatting (ported from formatSubMetricValue / DashboardTable formatters)
// ---------------------------------------------------------------------------

export const MS_PER_DAY = 86400000;
export const MS_PER_HOUR = 3600000;

// Every case routes its NUMERIC part through the tenant mask via formatNumber
// (utils/numberFormat.js): null when no dss.DashboardConfig.numberFormat is
// configured, so each `??` fallback keeps the pre-#1213 expression untouched.
// Unit suffixes (%, /5, h, hr/hrs/day/days, ordinal) stay here — the mask
// contributes separators only, decimal counts stay per-format (R3); durations
// take the mask decimal separator too (R7).
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
        const r = Math.round(hours * 10) / 10;
        const num = formatNumber(r, { decimals: 1, trim: true }) ?? (Number.isInteger(r) ? r : r.toFixed(1));
        return `${num} ${r === 1 ? t("DASHBOARD_UNIT_HR", "hr") : t("DASHBOARD_UNIT_HRS", "hrs")}`;
      }
      const days = n / MS_PER_DAY;
      const r = Math.round(days * 10) / 10;
      const num = formatNumber(r, { decimals: 1, trim: true }) ?? (Number.isInteger(r) ? r : r.toFixed(1));
      return `${num} ${r === 1 ? t("DASHBOARD_UNIT_DAY", "day") : t("DASHBOARD_UNIT_DAYS", "days")}`;
    }
    case 'hoursDecimal':      return `${formatNumber(n / MS_PER_HOUR, 'hoursDecimal') ?? (n / MS_PER_HOUR).toFixed(1)}h`;
    case 'signedInteger':     return `${n >= 0 ? '+' : ''}${formatNumber(n, 'signedInteger') ?? Math.round(n).toLocaleString(locale)}`;
    case 'ordinal': {
      const v = Math.round(n) % 100;
      const s = ['th', 'st', 'nd', 'rd'];
      return (formatNumber(n, 'integer') ?? Math.round(n)) + (s[(v - 20) % 10] || s[v] || s[0]);
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
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n <= 1 ? n * 100 : n;
}

// DepartmentBarChart's percent mode plots 0..100, so scale ratios up.
export function percentToChartScale(value, isPercent) {
  return isPercent ? normalizePct(value) : value;
}

export function msToHours(ms) {
  const hours = Number(ms) / MS_PER_HOUR;
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * 10) / 10;
}

export function formatLabel(value) {
  const s = String(value ?? '');
  if (!s || s === 'null' || s === 'undefined') return t("DASHBOARD_COMMON_UNKNOWN", "Unknown");
  return s;
}

/**
 * Dimension-label formatter keyed off `viz.labelFormat`. Ports the reference
 * client-side label shaping (kpiQueries.formatDimensionLabel /
 * formatOfficerStackedLabel) into the engine so chart categories match the
 * reference verbatim without per-tile code.
 *   - "dimension": localize via the dimensionLabel seam (kind derived from the
 *     query dimension name `dim`), falling back to the legacy humaniser
 *   - "officer":   mask an assignee UUID -> "Officer …<last6>" / "Unassigned"
 * No labelFormat => identity (formatLabel).
 */
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

// Port of kpiQueries.formatOverTimeDailyLabel: epoch-ms / yyyy-MM-dd -> short weekday.
export function formatDateDow(value, locale) {
  const key = epochOrIsoToDateKey(value);
  if (!key) return formatLabel(value);
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(locale, { weekday: 'short' });
}

export function epochOrIsoToDateKey(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{13}$/.test(s)) return new Date(Number(s)).toISOString().slice(0, 10);
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : s;
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
// ---------------------------------------------------------------------------
// Table / chart content checks shared by the renderers and the export
// ---------------------------------------------------------------------------

/** A table tile's columns and rows as DashboardTable receives them. */
export function adaptTable(ctx) {
  const { viz, result, groupBy } = ctx;
  // #1111 PR2 (R4): at a non-leaf "Group by" level, drop the redundant
  // service_group ("Type") column and relabel service_code to the level's
  // name — see applyGroupByToColumns. The ideal_sla_ms avg-of-heterogeneous-
  // SLAs caveat at non-leaf levels is documented in the KPI catalog docs
  // (PR1), not surfaced in-cell.
  return {
    columns: applyGroupByToColumns(viz.columns || deriveColumnsFromResult(result), groupBy),
    rows: transformTableRows(result, viz),
  };
}

/** A stacked bar draws only when some category has a non-zero segment. */
export function stackedHasData({ categories, series }) {
  return categories.length > 0 && series.some((s) => s.data?.some((v) => Number(v) > 0));
}

/** A line chart draws only when it has categories and series (or a populated period). */
export function lineHasStructure(props) {
  return props.periods
    ? Object.values(props.periods).some((p) => p.categories?.length > 0)
    : (props.categories?.length > 0 && props.series?.length > 0);
}
