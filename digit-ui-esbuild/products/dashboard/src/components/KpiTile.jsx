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
import { applyGroupByToColumns } from '../utils/hierLevelGrouping';
import { transformTableRows } from '../utils/tableRows';
import {
  adaptBarRows,
  adaptDow,
  adaptHorizontalRows,
  adaptLine,
  adaptMapLayers,
  adaptPie,
  adaptRanked,
  adaptSlaRiskRows,
  adaptStacked,
  applyFormat,
  computeDelta,
  defScrollKey,
  deriveColumnsFromResult,
  errorLabel,
  formatDeltaDisplay,
  resolveDeltaClass,
  resolvePrior,
  resolveScalar,
  resolveSparkline,
  resolveTileStatus,
  statusToSeriesColor,
} from '../utils/tileResultAdapters';
import useDashboardT from '../i18n/useDashboardT';
import { translate as t } from '../i18n/localeRuntime';
import { resolveTitle, resolveSubtitle } from '../i18n/textResolver';
import { markFirstWidgetVisible } from '../services/dashboardMetrics';

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
 *     priorRows, // prior-period rows for catalog-declared table comparisons
 *     sparkline, // daily series for sparkline cards
 *     asOf, scope }
 *
 * The viz descriptor (`def.viz`) keys this engine understands:
 *   kind, format, accent, dimensionKey, measureKey(s), seriesKeys, stackKey,
 *   stackSeries, titleKey, subtitleKey, valueKey, priorKey, sparklineKey, compose,
 *   breakEven, limit, colors, columns, deltaLabel, delta. i18n: titleKey/subtitleKey
 *   resolve through the locale seam when seeded; stackSeries/seriesDefs entries and
 *   viz.columns may carry a `labelKey` that wins over their `label`/`name`.
 *
 * Props:
 * - def: tile descriptor from catalog (viz, titleKey, kpiId, ...)
 * - result: generic data for this kpiId
 * - results: full results map (only needed for viz.compose multi-source rules)
 * - error: { code, message } | null  (e.g. pii_forbidden / kpi_forbidden)
 * - vizOverride: optional user-chosen viz kind
 * - loading: pass-through loading flag for the child components
 * - onRemove: pass-through remove handler for card chrome
 * - groupBy: { level, label } | null — the widget's effective non-leaf
 *   "Group by" hierarchy level (#1111 PR2). The backend already aliases the
 *   level code back AS service_code, so charts need nothing; table kinds use
 *   this to drop the now-redundant service_group column and relabel the
 *   service_code column to the level's name.
 */
export function KpiTile({ def, result, results, error, vizOverride, loading = false, onRemove, groupBy = null }) {
  // Subscribes the whole tile to language/bundle changes so every label
  // computed below re-renders on a language switch.
  const { language } = useDashboardT();
  const viz = def?.viz || {};
  const title = resolveTitle(def);

  // first_widget_visible (#1110): one-shot per load, fired by whichever tile
  // first renders NON-skeleton content — including the error and "No data"
  // paths (R9/F8) so failed loads still measure. The metrics module dedupes
  // and stamps post-paint, so repeat calls are cheap no-ops.
  const isSkeleton = !result && !error && loading;
  React.useEffect(() => {
    if (!isSkeleton) markFirstWidgetVisible();
  }, [isSkeleton]);

  if (error) {
    return (
      <div className="kpi-tile kpi-tile--error" data-error-code={error.code}>
        <span className="kpi-tile__error-code">{errorLabel(error.code)}</span>
        <span className="kpi-tile__error-msg">{error.message || t("DASHBOARD_TILE_ERR_FAILED_TO_LOAD", "Failed to load")}</span>
      </div>
    );
  }

  if (!result && !loading) {
    return <div className="kpi-tile kpi-tile--empty"><span className="kpi-tile__empty">{t("DASHBOARD_COMMON_NO_DATA", "No data")}</span></div>;
  }
  if (!result) {
    return <div className="kpi-tile kpi-tile--loading"><div className="kpi-tile__skeleton" /></div>;
  }

  const kind = vizOverride || viz.kind || 'scalar';
  const ctx = { def, viz, result, results, title, loading, onRemove, groupBy, locale: language?.replace('_', '-') };

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
// Scalar / delta cards  -> KpiCard
// Ports the formatSubMetricValue + WoW delta shaping into a generic adapter
// driven by viz.format / viz.valueKey / viz.priorKey / viz.compose.
// ---------------------------------------------------------------------------

function renderNumberTileDelta(ctx) {
  const { viz, title, loading, onRemove, locale } = ctx;
  const value = resolveScalar(ctx);
  const prior = resolvePrior(ctx);
  const delta = computeDelta(value, prior, viz.format, viz.delta?.mode);
  const status = resolveTileStatus(viz, value);
  return (
    <KpiCard
      title={title}
      value={loading ? undefined : applyFormat(value, viz.format, locale)}
      context={resolveSubtitle(viz)}
      status={status}
      deltaDisplay={formatDeltaDisplay(delta, viz.format, viz.delta?.mode)}
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

function renderNumberTileSparkline(ctx) {
  const { viz, title, loading, onRemove, locale } = ctx;
  const value = resolveScalar(ctx);
  const prior = resolvePrior(ctx);
  const delta = computeDelta(value, prior, viz.format, viz.delta?.mode);
  const status = resolveTileStatus(viz, value);
  return (
    <KpiSparklineCard
      title={title}
      value={loading ? undefined : applyFormat(value, viz.format, locale)}
      status={status}
      deltaDisplay={formatDeltaDisplay(delta, viz.format, viz.delta?.mode)}
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

function renderBar(ctx, { histogram }) {
  const { viz, loading } = ctx;
  const data = adaptBarRows(ctx);
  if (loading && !data.length) return <Placeholder message={t("DASHBOARD_COMMON_LOADING", "Loading…")} />;
  if (!data.length) return <Placeholder message={t("DASHBOARD_COMMON_NO_DATA", "No data")} />;
  return (
    <DepartmentBarChart
      data={data}
      categoryOrder={viz.categoryOrder}
      colors={viz.colors}
      histogram={histogram}
      valueFormat={viz.format === 'percent' || viz.format === 'percentOneDecimal' ? 'percent' : 'count'}
      scrollKey={histogram ? undefined : defScrollKey(ctx)}
    />
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar  -> HorizontalBarChart
// Ports parseDepartmentFlowRatioBarChart: dimension -> { label, value, resolved, created }.
// ---------------------------------------------------------------------------

function renderHorizontalBar(ctx) {
  const { viz, loading } = ctx;
  const data = adaptHorizontalRows(ctx);
  if (loading && !data.length) return <Placeholder message={t("DASHBOARD_COMMON_LOADING", "Loading…")} />;
  if (!data.length) return <Placeholder message={t("DASHBOARD_COMMON_NO_DATA", "No data")} />;
  return (
    <HorizontalBarChart
      data={data}
      breakEven={viz.breakEven ?? 1}
      scrollKey={defScrollKey(ctx)}
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

function renderStackedBar(ctx) {
  const { viz, loading } = ctx;
  const { categories, series, colors } = adaptStacked(ctx);
  const hasData = categories.length > 0 && series.some((s) => s.data?.some((v) => Number(v) > 0));
  if (loading && !hasData) return <Placeholder message={t("DASHBOARD_COMMON_LOADING", "Loading…")} />;
  if (!hasData) return <Placeholder message={t("DASHBOARD_COMMON_NO_DATA", "No data")} />;
  return (
    <StackedBarChart
      categories={categories}
      series={series}
      colors={colors}
      horizontal={viz.orientation === 'horizontal'}
      valueFormat={viz.valueFormat || (viz.valueTransform === 'msToHours' ? 'hours' : undefined)}
      scrollKey={defScrollKey(ctx)}
    />
  );
}

// ---------------------------------------------------------------------------
// Pie  -> PieChart
// Ports parseOpenComplaintsByChannelPieChart: dimension -> { label, count, color }.
// ---------------------------------------------------------------------------

function renderPie(ctx) {
  const { loading } = ctx;
  const data = adaptPie(ctx);
  if (loading && !data.length) return <Placeholder message={t("DASHBOARD_COMMON_LOADING", "Loading…")} />;
  if (!data.length) return <Placeholder message={t("DASHBOARD_COMMON_NO_DATA", "No data")} />;
  return <PieChart data={data} />;
}

// ---------------------------------------------------------------------------
// Line  -> LineChart
// Pass-through of a multi-period / multi-series payload. The over-time period
// rewriting (daily/weekly/monthly) is a BE-side concern; the engine only needs
// the BE-shaped { periods, defaultPeriod } or a flat { categories, series }.
// ---------------------------------------------------------------------------

function renderLine(ctx) {
  const { loading } = ctx;
  const props = adaptLine(ctx);
  const hasStructure = props.periods
    ? Object.values(props.periods).some((p) => p.categories?.length > 0)
    : (props.categories?.length > 0 && props.series?.length > 0);
  if (loading && !hasStructure) return <Placeholder message={t("DASHBOARD_COMMON_LOADING", "Loading…")} />;
  if (!hasStructure) return <Placeholder message={t("DASHBOARD_COMMON_NO_DATA", "No data")} />;
  return <LineChart {...props} />;
}

// ---------------------------------------------------------------------------
// Data table  -> DashboardTable
// Column config comes from viz.columns (matches DashboardTable's column shape:
// { id, label, align, type, width, thresholdKey }). Rows pass through verbatim.
// ---------------------------------------------------------------------------

function renderTable(ctx) {
  const { viz, result, loading, groupBy } = ctx;
  // #1111 PR2 (R4): at a non-leaf "Group by" level, drop the redundant
  // service_group ("Type") column and relabel service_code to the level's
  // name — see applyGroupByToColumns. The ideal_sla_ms avg-of-heterogeneous-
  // SLAs caveat at non-leaf levels is documented in the KPI catalog docs
  // (PR1), not surfaced in-cell.
  const columns = applyGroupByToColumns(viz.columns || deriveColumnsFromResult(result), groupBy);
  const rows = transformTableRows(result, viz);
  if (loading && !rows.length) return <Placeholder message={t("DASHBOARD_COMMON_LOADING", "Loading…")} />;
  return <DashboardTable columns={columns} rows={rows} emptyMessage={viz.emptyMessage || t("DASHBOARD_COMMON_NO_DATA", "No data")} />;
}

// ---------------------------------------------------------------------------
// SLA-risk table  -> ComplaintsAtRiskTable
// The component owns its own columns; rows already carry the per-row display
// shape (id, typeLabel, ownerName, slaLabel, breachDurationLabel, ...).
// ---------------------------------------------------------------------------

function renderSlaRiskTable(ctx) {
  const { loading } = ctx;
  const rows = adaptSlaRiskRows(ctx);
  if (loading && !rows.length) return <Placeholder message={t("DASHBOARD_COMMON_LOADING", "Loading…")} />;
  return <ComplaintsAtRiskTable rows={rows} />;
}

// ---------------------------------------------------------------------------
// Choropleth map  -> OpenComplaintsByGeographyWidget (Kajal's geography map)
// Her widget fetches its own ward geometry and toggles created/open/resolved
// layers; it reads layers[layerKey] (ward series), layers.wardDetails, and
// layers.complaintPinsByLayer[layerKey]. We shape the tile's ward aggregate +
// the companion pin source into that contract. The ward series carries all
// three counts so any layer renders; the PINS are now partitioned per layer
// (previously the same open-only array was pinned to all three, so the Resolved
// layer shaded "0 resolved" underneath still-open complaints).
// ---------------------------------------------------------------------------

/**
 * The map branch is memoized on its own inputs: adaptMapLayers re-derives fresh
 * ward/pin ARRAYS on every parent render, and the Leaflet pin effect keys off
 * that identity — so an unmemoized call tore down and rebuilt up to 1,000
 * circle markers (closing any open popup) on every unrelated re-render.
 */
function MapTile({ ctx, loading }) {
  const layers = React.useMemo(
    () => adaptMapLayers(ctx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.result, ctx.viz, ctx.locale]
  );
  return <OpenComplaintsByGeographyWidget layers={layers} loading={loading} />;
}

function renderChoroplethMap(ctx) {
  return <MapTile ctx={ctx} loading={ctx.loading} />;
}

// ---------------------------------------------------------------------------
// Ranked list + day-of-week  -> KpiTile internal displays (kept generic)
// ---------------------------------------------------------------------------

function RankedListDisplay({ rows, format }) {
  const { language } = useDashboardT();
  if (!rows?.length) return <Placeholder message={t("DASHBOARD_COMMON_NO_DATA", "No data")} />;
  const locale = language?.replace('_', '-');
  return (
    <ol className="kpi-ranked-list">
      {rows.map((row, i) => (
        <li key={i}>
          <span className="kpi-ranked-list__rank">{i + 1}</span>
          <span className="kpi-ranked-list__label" title={row.label}>{row.label}</span>
          <span className="kpi-ranked-list__value">{applyFormat(row.value, format, locale)}</span>
        </li>
      ))}
    </ol>
  );
}

// Invoked at render (never a module constant) so labels track the language.
const dowLabels = () => [
  t("DASHBOARD_DOW_SUN", "Sun"),
  t("DASHBOARD_DOW_MON", "Mon"),
  t("DASHBOARD_DOW_TUE", "Tue"),
  t("DASHBOARD_DOW_WED", "Wed"),
  t("DASHBOARD_DOW_THU", "Thu"),
  t("DASHBOARD_DOW_FRI", "Fri"),
  t("DASHBOARD_DOW_SAT", "Sat"),
];
function DowDisplay({ rows, format }) {
  const { language } = useDashboardT();
  if (!rows?.length) return <Placeholder message={t("DASHBOARD_COMMON_NO_DATA", "No data")} />;
  const locale = language?.replace('_', '-');
  const labels = dowLabels();
  return (
    <div className="kpi-dow">
      {rows.map((row, i) => (
        <div key={i} className="kpi-dow__bar">
          <span className="kpi-dow__label">{labels[row.dow] ?? row.dow}</span>
          <span className="kpi-dow__value">{applyFormat(row.value, format, locale)}</span>
        </div>
      ))}
    </div>
  );
}

const Placeholder = ({ message }) => (
  <div className="kpi-tile__placeholder tw-flex tw-h-full tw-items-center tw-justify-center tw-p-4 tw-text-[12px] tw-text-muted-foreground">
    {message}
  </div>
);

export default KpiTile;
