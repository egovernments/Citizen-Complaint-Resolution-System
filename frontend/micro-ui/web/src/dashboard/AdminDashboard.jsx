import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./styles/dashboard.css";

import DashboardLayout from "./components/DashboardLayout";
import KpiTile from "./components/KpiTile";
import CardUpdatedStamp from "./components/CardUpdatedStamp";
import ResizeGrip from "./components/ResizeGrip";
import DashboardLogin, {
  hasDashboardSession,
  clearDashboardSession,
} from "./components/DashboardLogin";

import { useDashboardFilters } from "./hooks/useDashboardFilters";
import { useCatalog } from "./hooks/useCatalog";
import { useCatalogLayout } from "./hooks/useCatalogLayout";
import { runKpiBatch, getTenantId } from "./services/analyticsService";
import { GRID_COLS, KPI_ROW_HEIGHT } from "./constants/layoutConfig";

const RemoveIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="tw-h-3.5 tw-w-3.5"
    aria-hidden="true"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const WidgetRemoveButton = ({ label, onClick }) => (
  <button
    type="button"
    title="Remove from dashboard"
    onMouseDown={(e) => e.stopPropagation()}
    onClick={onClick}
    className="dashboard-widget-remove-btn"
    aria-label={label}
  >
    <RemoveIcon />
  </button>
);

/**
 * AdminDashboard — a PARALLEL, pure-engine dashboard.
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

const AdminDashboard = () => {
  const [authed] = useState(() => hasDashboardSession());

  const handleLogin = useCallback(() => {
    window.location.reload();
  }, []);

  const handleSignOut = useCallback(() => {
    clearDashboardSession();
    window.location.reload();
  }, []);

  if (!authed) return <DashboardLogin onLogin={handleLogin} />;
  return <AdminDashboardInner onSignOut={handleSignOut} />;
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
      assembled.sparkline = seriesToPoints(seriesRes.rows, viz, valueKey, seriesRes.columns);
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

/** The series date dimension is grain-specific (facts: created_date, events:
 * occurred_date, daily: snapshot_date). Prefer viz.dateKey, else derive the
 * *_date column from the result, else fall back to created_date. */
function deriveDateKey(columns) {
  for (const col of columns || []) {
    const name = typeof col === "string" ? col : col?.name;
    if (name && /_date$/.test(name)) return name;
  }
  return null;
}

function seriesToPoints(rows, viz, valueKey, columns) {
  const dateKey = viz.dateKey || deriveDateKey(columns) || "created_date";
  const measureKey = viz.sparklineMeasureKey || valueKey || "total";
  return [...rows]
    .sort((a, b) =>
      String(a[dateKey] ?? "").localeCompare(String(b[dateKey] ?? ""))
    )
    .map((row) => Number(row[measureKey]) || 0);
}

/* -------------------------------------------------------------------------- */
/* Inner dashboard                                                             */
/* -------------------------------------------------------------------------- */

const AdminDashboardInner = ({ onSignOut }) => {
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

  const {
    layout,
    onDragStop,
    onResizeStop,
    onLayoutChange,
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    visibleLayoutIds,
  } = useCatalogLayout(kpis, pack?.layout);

  const [searchQuery, setSearchQuery] = useState("");

  const tiles = useMemo(
    () => layout.map((item) => ({ kpiId: item.i })),
    [layout]
  );

  // Title-based tile search: dim tiles whose title doesn't match the query.
  const matchesSearch = useCallback(
    (kpiId) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      const title = (kpis[kpiId]?.viz?.title || kpiId).toLowerCase();
      return title.includes(q);
    },
    [searchQuery, kpis]
  );

  // Add-KPI picker source: every role-visible catalog tile (already filtered
  // server-side), shaped to the picker's { id, metric, type, itemType } contract.
  const catalogItems = useMemo(
    () =>
      Object.values(kpis).map((def) => ({
        id: def.kpiId,
        metric: def.viz?.title || def.kpiId,
        type: def.viz?.kind,
        itemType: isCardKind(def.viz?.kind) ? "kpi" : "widget",
      })),
    [kpis]
  );

  // Re-run the batch whenever the catalog resolves or the filters change.
  // Include each tile's viz.kind: it drives buildRefs' __prior/__series companion
  // refs, so a def flipping card<->chart (or gaining sparkline) must re-trigger the
  // batch even when the id set and global params are unchanged.
  const refsKey = useMemo(
    () =>
      JSON.stringify({
        ids: tiles.map((t) => t.kpiId),
        kinds: tiles.map((t) => kpis[t.kpiId]?.viz?.kind),
        gp: globalParams(filters),
      }),
    [tiles, filters, kpis]
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

  // RGL reads min/max W/H straight off each layout item (the hook bakes in the
  // viz.kind-derived constraints), so the grid layout passes items through verbatim.
  const gridLayout = useMemo(() => layout, [layout]);

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

  // CSV export of the laid-out tiles (title + scalar value, or row count for
  // charts/tables). Reads straight from the catalog result map — no dependence on
  // the old kpiCardData/chartData shapes.
  const handleExport = useCallback(() => {
    const csvEscape = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = layout.map((item) => {
      const def = kpis[item.i];
      const assembled = assembleResult(item.i, def, batch.results);
      const value =
        assembled?.value != null
          ? assembled.value
          : assembled?.rows
          ? `${assembled.rows.length} rows`
          : "";
      return [def?.viz?.title || item.i, item.i, value];
    });
    const csv = ["Title,KPI,Value", ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dashboard-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [layout, kpis, batch.results]);

  const showEmpty = !catalogLoading && pack && layout.length === 0;

  return (
    <DashboardLayout
      visibleLayoutIds={visibleLayoutIds}
      catalogItems={catalogItems}
      onAddWidget={addKpiToLayout}
      onResetLayout={resetLayout}
      onDragWidgetStart={() => {}}
      onDragWidgetEnd={() => {}}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      onExport={handleExport}
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
          isDraggable
          isResizable
          draggableHandle=".dashboard-widget-surface"
          draggableCancel=".dashboard-widget-remove-btn, .dashboard-view-toggle, .dashboard-table-scroll, .dashboard-chart-scroll-viewport, .dashboard-kpi-list-body, .leaflet-container, a, button, input, select, textarea"
          onDragStop={onDragStop}
          onResizeStop={onResizeStop}
          onLayoutChange={onLayoutChange}
        >
          {layout.map((item) => {
            const isKpi = isCardKind(kpis[item.i]?.viz?.kind);
            const dimClass = matchesSearch(item.i) ? "" : " dashboard-search-dimmed";
            const removeBtn = (
              <WidgetRemoveButton
                label={`Remove ${kpis[item.i]?.viz?.title || item.i}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removeWidgetFromLayout(item.i);
                }}
              />
            );
            if (isKpi) {
              return (
                <div
                  key={item.i}
                  className={`dashboard-kpi-widget dashboard-widget-surface tw-group tw-relative tw-flex tw-h-full tw-flex-col${dimClass}`}
                >
                  {removeBtn}
                  {renderTile(item.i)}
                  <CardUpdatedStamp label={lastUpdatedLabel} />
                  <ResizeGrip />
                </div>
              );
            }
            return (
              <section
                key={item.i}
                className={`dashboard-widget-surface tw-group tw-relative tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-overflow-hidden tw-rounded tw-border tw-border-border tw-bg-surface${dimClass}`}
              >
                {removeBtn}
                <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden">
                  {renderTile(item.i)}
                </div>
                <CardUpdatedStamp label={lastUpdatedLabel} />
                <ResizeGrip />
              </section>
            );
          })}
        </GridLayoutWithWidth>
      )}
    </DashboardLayout>
  );
};

export default AdminDashboard;
