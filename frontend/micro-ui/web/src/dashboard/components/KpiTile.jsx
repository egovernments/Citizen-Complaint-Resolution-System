import React from 'react';
import KpiCard from './KpiCard';
import KpiSparklineCard from './KpiSparklineCard';
import DepartmentBarChart from './DepartmentBarChart';
import HorizontalBarChart from './HorizontalBarChart';
import StackedBarChart from './StackedBarChart';
import PieChart from './PieChart';
import LineChart from './LineChart';
import DashboardTable from './DashboardTable';
import ComplaintsAtRiskTable from './ComplaintsAtRiskTable';
import OpenComplaintsByGeographyWidget from './OpenComplaintsByGeographyWidget';
import { evaluateCompose } from '../utils/composeKpi';
import { getNumberTileDeltaClass } from '../config/kpiDisplay';
import {
  resolveSlaRiskPresentation,
  computeBreachDurationMs,
  formatBreachDurationCompact,
  formatWorkflowStatusLabel,
  normalizeWorkflowStatusKey,
} from '../config/complaintsAtRiskPresentation';

/**
 * Generic viz-kind-driven tile renderer (the dashboard RENDERING ENGINE).
 *
 * Reads `def.viz` (from the backend KPI catalog descriptor) to choose a viz
 * kind, then dispatches to the existing polished dashboard component, adapting
 * the GENERIC analytics result into that component's props. No widget-id
 * literals, no per-tile domain knowledge: every shape decision is keyed off the
 * `viz` descriptor and the result's `columns[].role` (dimension/measure).
 *
 * The result shape (the generic /_query envelope):
 *   { columns: [{ name, role: 'dimension'|'measure', format? }],
 *     rows:    [ { <colName>: value, ... } ],
 *     value,   // pre-aggregated scalar (number-tiles)
 *     values,  // map of named scalars
 *     series,  // pre-shaped multi-series payload (line/stacked) when BE supplies it
 *     prior,   // prior-period scalar/series for deltas
 *     sparkline, // daily series for sparkline cards
 *     asOf, scope }
 *
 * The viz descriptor (`def.viz`) keys this engine understands:
 *   kind, format, accent, dimensionKey, measureKey(s), seriesKeys, stackKey,
 *   stackSeries, titleKey, valueKey, priorKey, sparklineKey, compose, breakEven,
 *   limit, colors, columns, deltaLabel, delta.
 *
 * Props:
 * - def: tile descriptor from catalog (viz, titleKey, kpiId, ...)
 * - result: generic data for this kpiId
 * - results: full results map (only needed for viz.compose multi-source rules)
 * - error: { code, message } | null  (e.g. pii_forbidden / kpi_forbidden)
 * - vizOverride: optional user-chosen viz kind
 * - loading: pass-through loading flag for the child components
 * - onRemove: pass-through remove handler for card chrome
 */
export function KpiTile({ def, result, results, error, vizOverride, loading = false, onRemove }) {
  const viz = def?.viz || {};
  const title = resolveTitle(def);

  if (error) {
    return (
      <div className="kpi-tile kpi-tile--error" data-error-code={error.code}>
        <span className="kpi-tile__error-code">{errorLabel(error.code)}</span>
        <span className="kpi-tile__error-msg">{error.message || 'Failed to load'}</span>
      </div>
    );
  }

  if (!result && !loading) {
    return <div className="kpi-tile kpi-tile--empty"><span className="kpi-tile__empty">No data</span></div>;
  }
  if (!result) {
    return <div className="kpi-tile kpi-tile--loading"><div className="kpi-tile__skeleton" /></div>;
  }

  const kind = vizOverride || viz.kind || 'scalar';
  const ctx = { def, viz, result, results, title, loading, onRemove };

  const content = renderByKind(kind, ctx);

  // Card components carry their own chrome (remove btn, sparkline). The wrapper
  // only adds the as-of / scope badges for the non-card kinds.
  if (isCardKind(kind)) return content;

  const { asOf, scope } = result;
  // Mirror the reference DashboardGrid chart body (SHARED_CHROME.defaultBody):
  // the chart components measure their own viewport (height:100%; flex:1), so the
  // wrapper MUST establish a definite height. Without these fill classes the
  // wrapper collapses to content height and the chart renders at 0px (blank).
  return (
    <div
      className={`kpi-tile kpi-tile--${kind} tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden`}
      data-accent={viz.accent}
    >
      {content}
      {asOf ? <span className="kpi-tile__asof">as of {formatAsOf(asOf)}</span> : null}
      {scope && scope.boundaryPrefixes ? (
        <span className="kpi-tile__scope">{scope.boundaryPrefixes.join(', ')}</span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function isCardKind(kind) {
  return (
    kind === 'number-tile-delta' ||
    kind === 'scalar' ||
    kind === 'number-tile' ||
    kind === 'number-tile-sparkline' ||
    kind === 'sparkline-card'
  );
}

function renderByKind(kind, ctx) {
  switch (kind) {
    case 'number-tile-delta':
    case 'scalar':
    case 'number-tile':
      return renderNumberTileDelta(ctx);

    case 'number-tile-sparkline':
    case 'sparkline-card':
      return renderNumberTileSparkline(ctx);

    case 'bar':
    case 'bar-chart':
      return renderBar(ctx, { histogram: false });

    case 'histogram':
      return renderBar(ctx, { histogram: true });

    case 'horizontal-bar':
      return renderHorizontalBar(ctx);

    case 'stacked-bar':
      return renderStackedBar(ctx);

    case 'pie':
    case 'pie-chart':
      return renderPie(ctx);

    case 'line':
    case 'line-chart':
      return renderLine(ctx);

    case 'sla-risk-table':
      return renderSlaRiskTable(ctx);

    case 'choropleth-map':
    case 'map':
      return renderChoroplethMap(ctx);

    case 'ranked-list':
    case 'rankedList':
      return <RankedListDisplay {...adaptRanked(ctx)} />;

    case 'dow':
    case 'day-of-week':
      return <DowDisplay {...adaptDow(ctx)} />;

    case 'table':
    case 'data-table':
    default:
      return renderTable(ctx);
  }
}

// ---------------------------------------------------------------------------
// Column-role helpers (zero hardcoded column names)
// ---------------------------------------------------------------------------

function dimensionColumns(result, viz) {
  const cols = (result.columns || []).filter((c) => c.role === 'dimension');
  if (cols.length) return cols;
  if (viz.dimensionKey) return [{ name: viz.dimensionKey }];
  return [];
}

function measureColumns(result, viz) {
  const cols = (result.columns || []).filter((c) => c.role === 'measure');
  if (cols.length) return cols;
  const keys = viz.measureKeys || (viz.measureKey ? [viz.measureKey] : []);
  return keys.map((name) => ({ name }));
}

function primaryDimensionKey(result, viz) {
  return dimensionColumns(result, viz)[0]?.name || viz.dimensionKey || 'label';
}

function primaryMeasure(result, viz) {
  return measureColumns(result, viz)[0] || { name: viz.measureKey || 'total' };
}

// ---------------------------------------------------------------------------
// Scalar / delta cards  -> KpiCard
// Ports the formatSubMetricValue + WoW delta shaping into a generic adapter
// driven by viz.format / viz.valueKey / viz.priorKey / viz.compose.
// ---------------------------------------------------------------------------

function resolveScalar(ctx) {
  const { viz, result, results } = ctx;
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

function resolvePrior(ctx) {
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
function computeDelta(current, prior, format) {
  if (current == null || prior == null || !Number.isFinite(current) || !Number.isFinite(prior)) {
    return null;
  }
  if (isPercentFormat(format)) {
    const cur = normalizePct(current);
    const pri = normalizePct(prior);
    return cur - pri; // percentage points
  }
  if (prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function formatDeltaDisplay(delta, format) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const arrow = delta >= 0 ? '▲' : '▼';
  const abs = Math.abs(delta);
  const rounded = Math.round(abs * 10) / 10;
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  const unit = isPercentFormat(format) ? 'pp' : '%';
  return `${arrow} ${formatted}${unit}`;
}

function deltaClassFor(delta) {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return undefined;
  return delta > 0 ? 'dashboard-delta-up' : 'dashboard-delta-down';
}

// ---------------------------------------------------------------------------
// Threshold-driven status for number cards. Ports kpiDisplay.resolveThresholdStatus
// so the catalog can carry the on-track / breaching bands per def via
//   viz.threshold = { kind, higherIsBetter, onTrack, breaching }
// and the KpiCard/KpiSparklineCard value (and sparkline) colour at parity with the
// live AdminDashboard path. When no threshold is present we fall back to the
// static viz.accent (legacy behaviour) so non-card tiles are unaffected.
// ---------------------------------------------------------------------------

const KPI_STATUS = { ON_TRACK: 'on_track', NORMAL: 'normal', BREACHING: 'breaching' };

function thresholdStatus(threshold, value) {
  if (!threshold || value == null || !Number.isFinite(Number(value))) return null;
  // Percent metrics come back as a 0..1 ratio from the composer; the thresholds
  // (e.g. onTrack: 70) are expressed in display units, so normalise to 0..100.
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

/** 3-state threshold status when viz.threshold is set, else the static accent. */
function resolveTileStatus(viz, value) {
  return thresholdStatus(viz.threshold, value) ?? viz.accent;
}

/**
 * Delta colour. With a threshold the live path colours the delta by status
 * (resolveKpiDeltaClass -> getNumberTileDeltaClass), so we hand KpiCard the same
 * status token and let it resolve the colour. Without a threshold we keep the
 * directional up/down class so legacy delta tiles are unchanged.
 */
function resolveDeltaClass(viz, value, delta) {
  const status = thresholdStatus(viz.threshold, value);
  if (status) {
    const unavailable = value == null || !Number.isFinite(Number(value));
    return getNumberTileDeltaClass(status, { unavailable });
  }
  return deltaClassFor(delta);
}

/** Series stroke colour mirrors the live KpiSparklineCard status-derived colour. */
function statusToSeriesColor(status) {
  switch (status) {
    case KPI_STATUS.ON_TRACK: return 'var(--status-resolved)';
    case KPI_STATUS.BREACHING: return 'var(--status-breach)';
    default: return null;
  }
}

function renderNumberTileDelta(ctx) {
  const { viz, title, loading, onRemove } = ctx;
  const value = resolveScalar(ctx);
  const prior = resolvePrior(ctx);
  const delta = computeDelta(value, prior, viz.format);
  const status = resolveTileStatus(viz, value);
  return (
    <KpiCard
      title={title}
      value={loading ? undefined : applyFormat(value, viz.format)}
      context={viz.contextLabel || viz.deltaLabel || ''}
      status={status}
      deltaDisplay={formatDeltaDisplay(delta, viz.format)}
      deltaClass={resolveDeltaClass(viz, value, delta)}
      loading={loading}
      onRemove={onRemove}
    />
  );
}

// ---------------------------------------------------------------------------
// Sparkline card  -> KpiSparklineCard
// Ports parseSparkline7d's "sort by date, map measure -> point" shaping into a
// generic adapter keyed off viz.sparklineKey / viz.dateKey / viz.measureKey.
// ---------------------------------------------------------------------------

function resolveSparkline(ctx) {
  const { viz, result } = ctx;
  if (Array.isArray(result.sparkline)) return result.sparkline.map((n) => Number(n) || 0);

  // Long-form rows -> ordered numeric series.
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

function renderNumberTileSparkline(ctx) {
  const { viz, title, loading, onRemove } = ctx;
  const value = resolveScalar(ctx);
  const prior = resolvePrior(ctx);
  const delta = computeDelta(value, prior, viz.format);
  const status = resolveTileStatus(viz, value);
  return (
    <KpiSparklineCard
      title={title}
      value={loading ? undefined : applyFormat(value, viz.format)}
      status={status}
      deltaDisplay={formatDeltaDisplay(delta, viz.format)}
      deltaClass={resolveDeltaClass(viz, value, delta)}
      seriesColor={viz.seriesColor || statusToSeriesColor(status) || 'var(--chart-1)'}
      sparkline={resolveSparkline(ctx)}
      loading={loading}
      onRemove={onRemove}
    />
  );
}

// ---------------------------------------------------------------------------
// Bar / histogram  -> DepartmentBarChart
// Ports parseBarChart / parseDepartmentsBarChart / parseOpenComplaintsByAgeHistogram:
// dimension -> { label, count }, optionally ranked by measure desc.
// ---------------------------------------------------------------------------

function adaptBarRows(ctx) {
  const { viz, result } = ctx;
  const dimKey = primaryDimensionKey(result, viz);
  const measure = primaryMeasure(result, viz);
  const isPercent = viz.format === 'percent' || viz.format === 'percentOneDecimal';

  let rows = (result.rows || []).map((row) => ({
    label: formatDimLabel(row[dimKey], viz),
    count: percentToChartScale(Number(row[measure.name]) || 0, isPercent),
  }));

  // Histograms keep the backend bucket order; bars rank by value desc unless
  // the descriptor pins an explicit category order.
  if (viz.kind !== 'histogram' && !viz.categoryOrder && viz.sort !== 'none') {
    rows = rows.sort((a, b) => b.count - a.count);
  }
  if (viz.limit) rows = rows.slice(0, viz.limit);
  return rows;
}

function renderBar(ctx, { histogram }) {
  const { viz, loading } = ctx;
  const data = adaptBarRows(ctx);
  if (loading && !data.length) return <Placeholder message="Loading…" />;
  if (!data.length) return <Placeholder message="No data" />;
  return (
    <DepartmentBarChart
      data={data}
      categoryOrder={viz.categoryOrder}
      colors={viz.colors}
      histogram={histogram}
      valueFormat={viz.format === 'percent' || viz.format === 'percentOneDecimal' ? 'percent' : 'count'}
      scrollKey={histogram ? undefined : def_scrollKey(ctx)}
    />
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar  -> HorizontalBarChart
// Ports parseDepartmentFlowRatioBarChart: dimension -> { label, value, resolved, created }.
// ---------------------------------------------------------------------------

function adaptHorizontalRows(ctx) {
  const { viz, result } = ctx;
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
    label: formatDimLabel(key, viz),
    value: isRatio ? (b.den > 0 ? b.num / b.den : 0) : b.val,
    resolved: numeratorKey != null ? b.num : undefined,
    created: denominatorKey != null ? b.den : undefined,
  }));
  // Drop zero-denominator categories (reference filters created<=0).
  if (isRatio) rows = rows.filter((r) => (r.created || 0) > 0);
  if (viz.sort !== 'none') rows = rows.sort((a, b) => a.value - b.value);
  if (viz.limit) rows = rows.slice(0, viz.limit);
  return rows;
}

function renderHorizontalBar(ctx) {
  const { viz, loading } = ctx;
  const data = adaptHorizontalRows(ctx);
  if (loading && !data.length) return <Placeholder message="Loading…" />;
  if (!data.length) return <Placeholder message="No data" />;
  return (
    <HorizontalBarChart
      data={data}
      breakEven={viz.breakEven ?? 1}
      scrollKey={def_scrollKey(ctx)}
    />
  );
}

// ---------------------------------------------------------------------------
// Stacked bar  -> StackedBarChart
// Ports parsePivotStackedChart / parseComplaintsByTypeStackedChart:
//  - if BE already shaped { categories, series, colors }, pass through;
//  - else pivot long-form rows (category x stackKey -> measure) into series,
//    keyed off viz.stackSeries [{ key, label, color }].
// ---------------------------------------------------------------------------

function adaptStacked(ctx) {
  const { viz, result } = ctx;

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
      label: formatDimLabel(row[dimKey], viz),
      value: Number(row[measureKey]) || 0,
    }));
    if (viz.sort !== 'none') rows = rows.sort((a, b) => b.value - a.value);
    if (viz.limit) rows = rows.slice(0, viz.limit);
    return {
      categories: rows.map((r) => r.label),
      series: [{ name: viz.seriesLabel || 'Count', data: rows.map((r) => r.value) }],
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
    categories: entries.map((e) => formatDimLabel(e.key, viz)),
    series: stackSeries.map((def) => ({
      name: def.label,
      data: entries.map((e) => e.segments[normalizeSeg(def.key)] ?? 0),
    })),
    colors: stackSeries.map((def) => def.color),
  };
}

function renderStackedBar(ctx) {
  const { viz, loading } = ctx;
  const { categories, series, colors } = adaptStacked(ctx);
  const hasData = categories.length > 0 && series.some((s) => s.data?.some((v) => Number(v) > 0));
  if (loading && !hasData) return <Placeholder message="Loading…" />;
  if (!hasData) return <Placeholder message="No data" />;
  return (
    <StackedBarChart
      categories={categories}
      series={series}
      colors={colors}
      horizontal={viz.orientation === 'horizontal'}
      valueFormat={viz.valueFormat || (viz.valueTransform === 'msToHours' ? 'hours' : undefined)}
      scrollKey={def_scrollKey(ctx)}
    />
  );
}

// ---------------------------------------------------------------------------
// Pie  -> PieChart
// Ports parseOpenComplaintsByChannelPieChart: dimension -> { label, count, color }.
// ---------------------------------------------------------------------------

function adaptPie(ctx) {
  const { viz, result } = ctx;
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
      label: formatDimLabel(row[dimKey], viz),
      count: Number(row[measure.name]) || 0,
      color: colors[i],
    }))
    .filter((s) => s.count > 0);
  if (viz.sort !== 'none') rows = rows.sort((a, b) => b.count - a.count);
  return rows;
}

/** source -> channel rollup with verbatim COMPLAINT_CHANNELS labels/colours. */
function adaptChannelPie(result, dimKey, measure, viz) {
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
    .map((c) => ({ label: c.label, count: totals.get(c.id) ?? 0, color: c.color }))
    .filter((s) => s.count > 0)
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));
}

function normalizeSourceKey(source) {
  return String(source ?? '').trim().toLowerCase().replace(/-/g, '_');
}

function renderPie(ctx) {
  const { loading } = ctx;
  const data = adaptPie(ctx);
  if (loading && !data.length) return <Placeholder message="Loading…" />;
  if (!data.length) return <Placeholder message="No data" />;
  return <PieChart data={data} />;
}

// ---------------------------------------------------------------------------
// Line  -> LineChart
// Pass-through of a multi-period / multi-series payload. The over-time period
// rewriting (daily/weekly/monthly) is a BE-side concern; the engine only needs
// the BE-shaped { periods, defaultPeriod } or a flat { categories, series }.
// ---------------------------------------------------------------------------

function adaptLine(ctx) {
  const { viz, result, title } = ctx;
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
  const categories = rows.map((r) => formatDimLabel(r[dimKey], viz));

  // Descriptor-driven multi-series with per-series colour / dual y-axis grouping.
  // Each seriesDef is either a direct measure ({ measureKey }) or a computed
  // ratio percent ({ numeratorKey, denominatorKey }) — ports the reference
  // COMPLAINTS_OVER_TIME_SERIES_DEFS (Created / Resolved counts + Resolution
  // rate / SLA compliance percents on a second axis).
  if (viz.seriesDefs?.length) {
    return {
      categories,
      series: viz.seriesDefs.map((def) => ({
        name: def.name,
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
      name: m.label || m.name,
      data: rows.map((r) => Number(r[m.name]) || 0),
    })),
  };
}

function renderLine(ctx) {
  const { loading } = ctx;
  const props = adaptLine(ctx);
  const hasStructure = props.periods
    ? Object.values(props.periods).some((p) => p.categories?.length > 0)
    : (props.categories?.length > 0 && props.series?.length > 0);
  if (loading && !hasStructure) return <Placeholder message="Loading…" />;
  if (!hasStructure) return <Placeholder message="No data" />;
  return <LineChart {...props} />;
}

// ---------------------------------------------------------------------------
// Data table  -> DashboardTable
// Column config comes from viz.columns (matches DashboardTable's column shape:
// { id, label, align, type, width, thresholdKey }). Rows pass through verbatim.
// ---------------------------------------------------------------------------

function renderTable(ctx) {
  const { viz, result, loading } = ctx;
  const columns = viz.columns || deriveColumnsFromResult(result);
  const rows = result.rows || [];
  if (loading && !rows.length) return <Placeholder message="Loading…" />;
  return <DashboardTable columns={columns} rows={rows} emptyMessage={viz.emptyMessage || 'No data'} />;
}

function deriveColumnsFromResult(result) {
  return (result.columns || []).map((c) => ({
    id: c.name,
    label: c.label || c.name,
    align: c.role === 'measure' ? 'right' : 'left',
    type: mapFormatToCellType(c.format),
    thresholdKey: c.thresholdKey,
  }));
}

function mapFormatToCellType(format) {
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

// ---------------------------------------------------------------------------
// SLA-risk table  -> ComplaintsAtRiskTable
// The component owns its own columns; rows already carry the per-row display
// shape (id, typeLabel, ownerName, slaLabel, breachDurationLabel, ...).
// ---------------------------------------------------------------------------

/**
 * Shape the generic at-risk grain rows into the ComplaintsAtRiskTable row
 * contract. Ports config/kpiQueries.parseComplaintsAtRiskTable verbatim (it
 * relies only on the pure presentation helpers, which survive the inversion),
 * so the inverted engine renders the rich SLA-risk table at parity with the
 * reference instead of a degraded ranked list.
 */
function adaptSlaRiskRows(ctx) {
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
        typeLabel: typeKey ? formatDimensionLabel(typeKey) : '—',
        subtypeLabel: subtypeKey ? formatDimensionLabel(subtypeKey) : '—',
        locality: row.ward_code ? formatDimensionLabel(String(row.ward_code)) : '—',
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

function renderSlaRiskTable(ctx) {
  const { loading } = ctx;
  const rows = adaptSlaRiskRows(ctx);
  if (loading && !rows.length) return <Placeholder message="Loading…" />;
  return <ComplaintsAtRiskTable rows={rows} />;
}

// ---------------------------------------------------------------------------
// Choropleth map  -> OpenComplaintsByGeographyWidget (Kajal's geography map)
// Her widget fetches its own ward geometry and toggles created/open/resolved
// layers; it reads layers[layerKey] (ward series), layers.wardDetails, and
// layers.complaintPinsByLayer[layerKey]. We shape the tile's ward aggregate +
// the companion pin source into that contract. (Per-layer distinct counts —
// created vs open vs resolved — is a refinement; today every layer shows the
// tile's aggregate so the toggle always renders data.)
// ---------------------------------------------------------------------------

const GEO_MAP_LAYER_KEYS = ['created', 'open', 'resolved'];

function adaptMapLayers(ctx) {
  const { viz, result } = ctx;
  const dimKey = viz.dimensionKey || 'ward_code';
  const measure = viz.measureKey || 'total';
  const wards = (result.rows || [])
    .filter((row) => {
      const code = String(row[dimKey] ?? '').trim();
      return code && code !== 'null';
    })
    .map((row) => {
      const wardCode = String(row[dimKey]);
      const count = Number(row[measure]) || 0;
      return { wardCode, label: formatLabel(wardCode), count, total: count };
    });
  const pins = result.pins || [];
  const layers = { wardDetails: {}, complaintPinsByLayer: {}, complaintPinsError: null };
  for (const key of GEO_MAP_LAYER_KEYS) {
    layers[key] = wards;
    layers.complaintPinsByLayer[key] = pins;
  }
  return layers;
}

function renderChoroplethMap(ctx) {
  const { loading } = ctx;
  return <OpenComplaintsByGeographyWidget layers={adaptMapLayers(ctx)} loading={loading} />;
}

// ---------------------------------------------------------------------------
// Ranked list + day-of-week  -> KpiTile internal displays (kept generic)
// ---------------------------------------------------------------------------

function adaptRanked(ctx) {
  const { viz, result } = ctx;
  const dimKey = primaryDimensionKey(result, viz);
  const measure = primaryMeasure(result, viz);
  let rows = (result.rows || []).map((row) => ({
    label: formatDimLabel(row[dimKey], viz),
    value: Number(row[measure.name]) || 0,
  }));
  if (viz.sort !== 'none') rows = rows.sort((a, b) => b.value - a.value);
  rows = rows.slice(0, viz.limit || 10);
  return { rows, format: measure.format || viz.format };
}

function adaptDow(ctx) {
  const { viz, result } = ctx;
  const dimKey = primaryDimensionKey(result, viz);
  const measure = primaryMeasure(result, viz);
  const rows = (result.rows || []).map((row) => ({
    dow: Number(row[dimKey]),
    value: Number(row[measure.name]) || 0,
  }));
  return { rows, format: measure.format || viz.format };
}

function RankedListDisplay({ rows, format }) {
  if (!rows?.length) return <Placeholder message="No data" />;
  return (
    <ol className="kpi-ranked-list">
      {rows.map((row, i) => (
        <li key={i}>
          <span className="kpi-ranked-list__rank">{i + 1}</span>
          <span className="kpi-ranked-list__label" title={row.label}>{row.label}</span>
          <span className="kpi-ranked-list__value">{applyFormat(row.value, format)}</span>
        </li>
      ))}
    </ol>
  );
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function DowDisplay({ rows, format }) {
  if (!rows?.length) return <Placeholder message="No data" />;
  return (
    <div className="kpi-dow">
      {rows.map((row, i) => (
        <div key={i} className="kpi-dow__bar">
          <span className="kpi-dow__label">{DOW_LABELS[row.dow] ?? row.dow}</span>
          <span className="kpi-dow__value">{applyFormat(row.value, format)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting (ported from formatSubMetricValue / DashboardTable formatters)
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;

function applyFormat(val, format) {
  if (val == null || !Number.isFinite(Number(val))) return '—';
  const n = Number(val);
  switch (format) {
    case 'integer':           return Math.round(n).toLocaleString();
    case 'percentInteger':
    case 'percentNoDecimal':  return `${Math.round(normalizePct(n))}%`;
    case 'percentOneDecimal':
    case 'percent':           return `${normalizePct(n).toFixed(1)}%`;
    case 'decimalOne':        return n.toFixed(1);
    case 'decimalTwo':        return n.toFixed(2);
    case 'ratingOutOfFive':   return `${n.toFixed(1)}/5`;
    case 'hoursDays': {
      const hours = n / MS_PER_HOUR;
      if (hours < 48) {
        const r = Math.round(hours * 10) / 10;
        return `${Number.isInteger(r) ? r : r.toFixed(1)} ${r === 1 ? 'hr' : 'hrs'}`;
      }
      const days = n / MS_PER_DAY;
      const r = Math.round(days * 10) / 10;
      return `${Number.isInteger(r) ? r : r.toFixed(1)} ${r === 1 ? 'day' : 'days'}`;
    }
    case 'hoursDecimal':      return `${(n / MS_PER_HOUR).toFixed(1)}h`;
    case 'signedInteger':     return `${n >= 0 ? '+' : ''}${Math.round(n).toLocaleString()}`;
    case 'ordinal': {
      const v = Math.round(n) % 100;
      const s = ['th', 'st', 'nd', 'rd'];
      return Math.round(n) + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    default: return String(val);
  }
}

function isPercentFormat(format) {
  return (
    format === 'percent' ||
    format === 'percentInteger' ||
    format === 'percentNoDecimal' ||
    format === 'percentOneDecimal'
  );
}

function normalizePct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n <= 1 ? n * 100 : n;
}

// DepartmentBarChart's percent mode plots 0..100, so scale ratios up.
function percentToChartScale(value, isPercent) {
  return isPercent ? normalizePct(value) : value;
}

function msToHours(ms) {
  const hours = Number(ms) / MS_PER_HOUR;
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * 10) / 10;
}

function formatLabel(value) {
  const s = String(value ?? 'Unknown');
  if (!s || s === 'null' || s === 'undefined') return 'Unknown';
  return s;
}

/**
 * Dimension-label formatter keyed off `viz.labelFormat`. Ports the reference
 * client-side label shaping (kpiQueries.formatDimensionLabel /
 * formatOfficerStackedLabel) into the engine so chart categories match the
 * reference verbatim without per-tile code.
 *   - "dimension": humanise CamelCase / snake_case / dotted codes
 *   - "officer":   mask an assignee UUID -> "Officer …<last6>" / "Unassigned"
 * No labelFormat => identity (formatLabel).
 */
function formatDimLabel(value, viz) {
  switch (viz?.labelFormat) {
    case 'dimension':  return formatDimensionLabel(value);
    case 'department': return formatDepartmentLabel(value);
    case 'officer':    return formatOfficerLabel(value);
    case 'date-dow':   return formatDateDow(value);
    default:           return formatLabel(value);
  }
}

// Port of kpiQueries.formatOverTimeDailyLabel: epoch-ms / yyyy-MM-dd -> short weekday.
function formatDateDow(value) {
  const key = epochOrIsoToDateKey(value);
  if (!key) return formatLabel(value);
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function epochOrIsoToDateKey(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{13}$/.test(s)) return new Date(Number(s)).toISOString().slice(0, 10);
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : s;
}

// Port of complaintTypeDepartmentConfig.formatDepartmentLabel.
function formatDepartmentLabel(code) {
  const c = String(code ?? '').trim();
  if (!c || c === 'Unknown' || c === 'Unmapped' || c === 'null' || c === 'undefined') return 'Unknown';
  return c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
}

// Port of kpiQueries.formatDimensionLabel (humanise service/ward/dept codes).
function formatDimensionLabel(code) {
  const humanized = String(code ?? '').replace(/([a-z])([A-Z])/g, '$1 $2');
  const wardMatch = humanized.match(/ward[_\s-]?(\d+)/i);
  if (wardMatch) return `Ward ${wardMatch[1]}`;
  const dot = humanized.lastIndexOf('.');
  if (dot >= 0) {
    return humanized.slice(dot + 1).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const parts = humanized.split('_').filter(Boolean);
  if (parts.length > 2) return parts.slice(-2).join(' ').replace(/_/g, ' ');
  const out = humanized.replace(/_/g, ' ');
  return out || 'Unknown';
}

// Port of kpiQueries.formatOfficerStackedLabel.
function formatOfficerLabel(uuid) {
  const id = String(uuid ?? 'Unknown');
  if (!id || id === 'null' || id === 'undefined') return 'Unassigned';
  if (id.length <= 8) return id;
  return `Officer …${id.slice(-6)}`;
}

function normalizeSeg(value) {
  return String(value ?? '').toUpperCase();
}

/**
 * Title resolution for the inverted catalog. The MDMS def now carries a human
 * `viz.title` (the single source of truth, sourced from the reference dashboard
 * labels); prefer it. `titleKey` is retained on the def for a future i18n layer
 * but is a raw key (RAINMAKER-PGR.DASHBOARD_KPI_*) so it is only ever used as a
 * last-resort, prettified, fallback — never rendered verbatim.
 */
function resolveTitle(def) {
  return (
    def?.viz?.title ||
    def?.title ||
    def?.name ||
    prettifyTitleKey(def?.viz?.titleKey || def?.titleKey) ||
    ''
  );
}

function prettifyTitleKey(key) {
  if (!key) return '';
  const tail = String(key).split('.').pop().replace(/^DASHBOARD_KPI_/, '');
  if (!tail) return '';
  return tail
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function errorLabel(code) {
  switch (code) {
    case 'pii_forbidden': return 'Restricted';
    case 'kpi_forbidden': return 'No access';
    case 'scope_forbidden': return 'Out of scope';
    default: return code || 'ERROR';
  }
}

function def_scrollKey(ctx) {
  return ctx.def?.kpiId || ctx.def?.id || undefined;
}

function formatAsOf(asOf) {
  try { return new Date(asOf).toLocaleString(); } catch { return String(asOf); }
}

const Placeholder = ({ message }) => (
  <div className="kpi-tile__placeholder tw-flex tw-h-full tw-items-center tw-justify-center tw-p-4 tw-text-[12px] tw-text-muted-foreground">
    {message}
  </div>
);

export default KpiTile;
