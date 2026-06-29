import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./styles/dashboard.css";

import DashboardLayout from "./components/DashboardLayout";
import KpiTile from "./components/KpiTile";
import CardUpdatedStamp from "./components/CardUpdatedStamp";
import DashboardLogin, {
  hasDashboardSession,
  clearDashboardSession,
} from "./components/DashboardLogin";

import { useDashboardFilters } from "./hooks/useDashboardFilters";
import { useCatalog } from "./hooks/useCatalog";
import { runKpiBatch, getTenantId } from "./services/analyticsService";
import { GRID_COLS, KPI_ROW_HEIGHT } from "./constants/layoutConfig";

/**
 * AdminDashboardV2 — a PARALLEL, pure-engine dashboard.
 *
 * Unlike the reference AdminDashboard (which builds inline batch queries via
 * useDashboardData/buildBatchQueries and renders through DashboardGrid against
 * the hardcoded local widget config), V2 renders ENTIRELY from the backend
 * catalog:
 *
 *   useCatalog(tenantId)  -> { kpis: {[kpiId]: def}, pack: { tiles, layout } }
 *   runKpiBatch(refs)     -> { results: { [tileKey]: { columns, rows, asOf, scope } } }
 *   <KpiTile def result /> -> the generic viz.kind render engine
 *
 * No useDashboardData, no buildBatchQueries, no DashboardGrid. Every tile's
 * shape decision is keyed off its catalog `viz` descriptor; every query is a
 * `{ kpiId, params }` reference the BE KpiQueryComposer resolves.
 */

const GridLayoutWithWidth = WidthProvider(GridLayout);
const GRID_MARGIN = [16, 16];

/* -------------------------------------------------------------------------- */
/* Auth gate (mirrors AdminDashboard)                                          */
/* -------------------------------------------------------------------------- */

const AdminDashboardV2 = () => {
  const [authed] = useState(() => hasDashboardSession());

  const handleLogin = useCallback(() => {
    window.location.reload();
  }, []);

  const handleSignOut = useCallback(() => {
    clearDashboardSession();
    window.location.reload();
  }, []);

  if (!authed) return <DashboardLogin onLogin={handleLogin} />;
  return <AdminDashboardV2Inner onSignOut={handleSignOut} />;
};

/* -------------------------------------------------------------------------- */
/* Query-plan helpers                                                          */
/* -------------------------------------------------------------------------- */

const CARD_KINDS = new Set([
  "number-tile-delta",
  "number-tile",
  "scalar",
  "number-tile-sparkline",
  "sparkline-card",
]);
const SPARKLINE_KINDS = new Set(["number-tile-sparkline", "sparkline-card"]);

function isCardKind(kind) {
  return CARD_KINDS.has(kind);
}
function isSparklineKind(kind) {
  return SPARKLINE_KINDS.has(kind);
}

/**
 * Map the dashboard filter bar -> the KpiQueryComposer param names.
 * Mirrors config/kpiQueries.js buildGlobalApiFilters: an active date range maps
 * to dateFrom/dateTo (yyyy-MM-dd, which the composer turns into a gte/lt on the
 * grain's time column and which drops the def's base window); a non-"all"
 * geography/complaintType narrows via ward/serviceCode. No global `window` is
 * emitted, so each def keeps its own baked window when no range is active —
 * exactly the reference path's behaviour.
 */
function globalParams(filters) {
  const params = {};
  if (filters?.geography && filters.geography !== "all") {
    params.ward = filters.geography;
  }
  if (filters?.complaintType && filters.complaintType !== "all") {
    params.serviceCode = filters.complaintType;
  }
  if (filters?.dateRangeActive && filters?.dateFrom && filters?.dateTo) {
    params.dateFrom = filters.dateFrom; // yyyy-MM-dd
    params.dateTo = filters.dateTo; // yyyy-MM-dd
  }
  return params;
}

/**
 * Build the per-tile refs map for runKpiBatch. The tileKey convention is:
 *   <kpiId>           base query (global params applied)
 *   <kpiId>__prior    delta cards: same params + compare:'prior'
 *   <kpiId>__series   sparkline cards: same params + series:'daily'
 *
 * The prior/series refs are gated on viz.kind (the only series signal exposed by
 * the catalog tile — supportsSeries is not serialised), so non-card tiles only
 * issue the single base query.
 */
function buildRefs(tiles, kpis, filters) {
  const gp = globalParams(filters);
  const refs = {};
  for (const tile of tiles) {
    const kpiId = tile.kpiId;
    const def = kpis[kpiId];
    if (!def) continue;
    const kind = def.viz?.kind;

    refs[kpiId] = { kpiId, params: { ...gp } };

    if (isCardKind(kind)) {
      refs[`${kpiId}__prior`] = { kpiId, params: { ...gp, compare: "prior" } };
    }
    if (isSparklineKind(kind)) {
      refs[`${kpiId}__series`] = { kpiId, params: { ...gp, series: "daily" } };
    }
  }
  return refs;
}

/**
 * Assemble the single result object KpiTile expects for one tile, merging the
 * base result with its __prior / __series companions.
 *
 * KpiTile's resolvers read (in priority order):
 *   resolveScalar   -> result.value, else result.values[viz.valueKey], else rows[0][viz.valueKey]
 *   resolvePrior    -> result.prior
 *   resolveSparkline-> result.sparkline (number[]), else result.rows + viz.dateKey/sparklineMeasureKey
 * plus the wrapper reads result.asOf / result.scope for non-card tiles, and the
 * chart adapters read result.columns / result.rows.
 *
 * So we keep columns/rows/scope/asOf verbatim, and additionally hoist:
 *   value    <- base scalar (rows[0][valueKey] / single measure)
 *   prior    <- __prior scalar
 *   sparkline<- __series rows -> ordered numeric series
 */
function assembleResult(kpiId, def, results) {
  const base = results?.[kpiId];
  if (!base) return null;

  const viz = def.viz || {};
  const valueKey = viz.valueKey || firstMeasureName(base);

  const assembled = {
    columns: base.columns,
    rows: base.rows,
    scope: base.scope,
    asOf: base.asOf,
  };

  // Scalar value (cards). For non-card tiles this is harmless extra metadata
  // that the chart adapters ignore.
  if (isCardKind(viz.kind)) {
    const v = scalarFromResult(base, valueKey);
    if (v != null) assembled.value = v;

    const priorRes = results?.[`${kpiId}__prior`];
    if (priorRes) {
      const p = scalarFromResult(priorRes, valueKey);
      if (p != null) assembled.prior = p;
    }
  }

  // Daily sparkline series.
  if (isSparklineKind(viz.kind)) {
    const seriesRes = results?.[`${kpiId}__series`];
    if (seriesRes?.rows?.length) {
      assembled.sparkline = seriesToPoints(seriesRes.rows, viz, valueKey);
    }
  }

  return assembled;
}

function firstMeasureName(result) {
  const measure = (result?.columns || []).find((c) => c.role === "measure");
  return measure?.name;
}

function scalarFromResult(result, valueKey) {
  const row0 = result?.rows?.[0];
  if (!row0) return null;
  const key = valueKey || firstMeasureName(result) || Object.keys(row0)[0];
  const raw = row0[key];
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function seriesToPoints(rows, viz, valueKey) {
  const dateKey =
    viz.dateKey ||
    "created_date"; // facts grain daily dimension (events use occurred_date)
  const measureKey = viz.sparklineMeasureKey || valueKey || "total";
  return [...rows]
    .sort((a, b) =>
      String(a[dateKey] ?? "").localeCompare(String(b[dateKey] ?? ""))
    )
    .map((row) => Number(row[measureKey]) || 0);
}

/* -------------------------------------------------------------------------- */
/* Default layout                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The reference supervisor-default pack (ansible/.../DashboardPack.json). Used
 * as the layout when the backend /packs endpoint returns an empty defaultLayout
 * (the local shim currently serves the full catalog with no layout). Falls back
 * further to an auto-flow grid for any tiles not pinned here.
 */
const DEFAULT_PACK_LAYOUT = [
  { kpiId: "cl_resolution_rate_count", x: 0, y: 0, w: 2, h: 2 },
  { kpiId: "rs_breach_total", x: 2, y: 0, w: 2, h: 2 },
  { kpiId: "cl_resolved_date_range_count", x: 4, y: 0, w: 2, h: 2 },
  { kpiId: "cl_reopen_rate_count", x: 6, y: 0, w: 2, h: 2 },
  { kpiId: "ce_csat_avg_week", x: 8, y: 0, w: 2, h: 2 },
  { kpiId: "cl_chart_officer_sla", x: 0, y: 2, w: 8, h: 6 },
  { kpiId: "ev_chart_resolution_dwell_subtype", x: 8, y: 2, w: 4, h: 6 },
  { kpiId: "cl_map_ward_wow_current", x: 0, y: 8, w: 8, h: 6 },
  { kpiId: "cl_chart_department_resolution_rate", x: 8, y: 8, w: 4, h: 6 },
  { kpiId: "cl_chart_over_time_created_daily", x: 0, y: 14, w: 12, h: 6 },
  { kpiId: "cl_table_complaints_at_risk", x: 0, y: 20, w: 12, h: 5 },
];

/**
 * Resolve the grid layout to render: the backend pack layout when present, else
 * the default pack layout intersected with the tiles the catalog actually
 * returned (so we never render a tile the role can't see).
 */
function resolveLayout(pack, kpis) {
  const packLayout = pack?.layout || [];
  const source = packLayout.length ? packLayout : DEFAULT_PACK_LAYOUT;
  const available = source.filter((item) => kpis[item.kpiId]);
  return available.map((item) => ({
    i: item.kpiId,
    x: item.x ?? 0,
    y: item.y ?? 0,
    w: item.w ?? 2,
    h: item.h ?? 2,
    static: true, // V2 is a read-only parity render; no drag/resize yet.
  }));
}

/* -------------------------------------------------------------------------- */
/* Inner dashboard                                                             */
/* -------------------------------------------------------------------------- */

const AdminDashboardV2Inner = ({ onSignOut }) => {
  const { filters, setFilter, clearFilters } = useDashboardFilters();
  const tenantId = useMemo(() => getTenantId(), []);
  const { loading: catalogLoading, kpis, pack, error: catalogError } =
    useCatalog(tenantId);

  const [batch, setBatch] = useState({
    loading: true,
    results: {},
    errors: null,
    partial: false,
  });
  const reqIdRef = useRef(0);

  const layout = useMemo(
    () => (pack ? resolveLayout(pack, kpis) : []),
    [pack, kpis]
  );

  const tiles = useMemo(
    () => layout.map((item) => ({ kpiId: item.i })),
    [layout]
  );

  // Re-run the batch whenever the catalog resolves or the filters change.
  const refsKey = useMemo(
    () => JSON.stringify({ ids: tiles.map((t) => t.kpiId), gp: globalParams(filters) }),
    [tiles, filters]
  );

  useEffect(() => {
    if (!pack || !tiles.length) {
      setBatch({ loading: false, results: {}, errors: null, partial: false });
      return;
    }
    const refs = buildRefs(tiles, kpis, filters);
    const reqId = ++reqIdRef.current;
    setBatch((prev) => ({ ...prev, loading: true }));

    runKpiBatch(refs, tenantId)
      .then((res) => {
        if (reqId !== reqIdRef.current) return;
        setBatch({
          loading: false,
          results: res?.results || {},
          errors: res?.errors || null,
          partial: Boolean(res?.partial),
        });
      })
      .catch((err) => {
        if (reqId !== reqIdRef.current) return;
        setBatch({
          loading: false,
          results: {},
          errors: { __batch: err?.message || "Batch query failed" },
          partial: true,
        });
      });
    // refsKey captures both the tile set and the resolved params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey, pack, tenantId]);

  const lastUpdatedLabel = useMemo(
    () =>
      new Date().toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
    [batch.results]
  );

  const gridLayout = useMemo(
    () => layout.map((item) => ({ ...item, className: gridItemClassName(item.i) })),
    [layout]
  );

  const renderTile = (kpiId) => {
    const def = kpis[kpiId];
    if (!def) return null;

    const assembled = assembleResult(kpiId, def, batch.results);
    const errCode = batch.errors && batch.errors[kpiId];
    const tileError = errCode ? { code: errCode, message: String(errCode) } : null;

    return (
      <KpiTile
        def={def}
        result={assembled}
        results={batch.results}
        error={tileError}
        loading={batch.loading && !assembled}
      />
    );
  };

  const showEmpty = !catalogLoading && pack && layout.length === 0;

  return (
    <DashboardLayout
      visibleLayoutIds={layout.map((i) => i.i)}
      onAddWidget={() => {}}
      onResetLayout={() => {}}
      onDragWidgetStart={() => {}}
      onDragWidgetEnd={() => {}}
      searchQuery=""
      onSearchQueryChange={() => {}}
      onExport={() => {}}
      filters={filters}
      onFilterChange={setFilter}
      onClearFilters={clearFilters}
      filterOptions={null}
      filterOptionsLoading={catalogLoading}
      kpiCardData={{}}
      allowedWidgetIds={null}
      scopedRole={null}
      username={null}
      officerAccess={null}
      visibleKpiCount={layout.length}
      scope={null}
      onSignOut={onSignOut}
    >
      <div className="tw-mb-3 tw-inline-flex tw-items-center tw-gap-2 tw-rounded tw-bg-muted tw-px-3 tw-py-1 tw-text-[11px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-muted-foreground">
        Engine V2 · catalog-driven
      </div>

      {catalogError && (
        <div className="tw-mb-4 tw-rounded-md tw-border tw-border-[color-mix(in_srgb,var(--destructive)_30%,transparent)] tw-bg-status-breach-bg tw-px-4 tw-py-3 tw-text-sm tw-text-destructive">
          Catalog unavailable: {catalogError}
        </div>
      )}
      {batch.errors && batch.errors.__batch && (
        <div className="tw-mb-4 tw-rounded-md tw-border tw-border-[color-mix(in_srgb,var(--destructive)_30%,transparent)] tw-bg-status-breach-bg tw-px-4 tw-py-3 tw-text-sm tw-text-destructive">
          {batch.errors.__batch}
        </div>
      )}

      {showEmpty ? (
        <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-rounded tw-border tw-border-dashed tw-border-border tw-bg-surface tw-py-16 tw-text-center">
          <p className="tw-text-[12px] tw-text-muted-foreground">
            No tiles in the catalog pack for this role.
          </p>
        </div>
      ) : (
        <GridLayoutWithWidth
          className="layout"
          layout={gridLayout}
          cols={GRID_COLS}
          rowHeight={KPI_ROW_HEIGHT}
          margin={GRID_MARGIN}
          containerPadding={[0, 0]}
          compactType={null}
          allowOverlap
          isDraggable={false}
          isResizable={false}
        >
          {layout.map((item) => {
            const isKpi = isCardKind(kpis[item.i]?.viz?.kind);
            if (isKpi) {
              return (
                <div
                  key={item.i}
                  className="dashboard-kpi-widget tw-group tw-relative tw-flex tw-h-full tw-flex-col"
                >
                  {renderTile(item.i)}
                  <CardUpdatedStamp label={lastUpdatedLabel} />
                </div>
              );
            }
            return (
              <section
                key={item.i}
                className="tw-group tw-relative tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-overflow-hidden tw-rounded tw-border tw-border-border tw-bg-surface"
              >
                <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden">
                  {renderTile(item.i)}
                </div>
                <CardUpdatedStamp label={lastUpdatedLabel} />
              </section>
            );
          })}
        </GridLayoutWithWidth>
      )}
    </DashboardLayout>
  );
};

/** Match DashboardGrid's per-item wrapper classes for KPI vs chart tiles. */
function gridItemClassName(kpiId) {
  return undefined;
}

export default AdminDashboardV2;
