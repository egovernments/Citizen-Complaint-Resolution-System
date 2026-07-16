import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./styles/dashboard.css";

import DashboardLayout from "./components/DashboardLayout";
import KpiTile from "./components/KpiTile";
import CardUpdatedStamp from "./components/CardUpdatedStamp";
import ResizeGrip from "./components/ResizeGrip";
import SubtleScroll from "./components/SubtleScroll";
import {
  VIZ_TYPE,
  SHARED_CHROME,
  buildWidgetHeaderClassName,
  getWidgetBodyClassName,
  getWidgetScrollClassName,
} from "./config/visualizationStyles";
import DashboardLogin, {
  hasDashboardSession,
  clearDashboardSession,
} from "./components/DashboardLogin";
import { useDashboardConfig } from "../useDashboardConfig";
import { setNumberFormatMask } from "./utils/numberFormat";

import useDashboardT from "./i18n/useDashboardT";
import { resolveTitle, resolveSubtitle } from "./i18n/textResolver";
import { useDashboardFilters } from "./hooks/useDashboardFilters";
import { useFilterOptions } from "./hooks/useFilterOptions";
import { useCatalog } from "./hooks/useCatalog";
import { useCatalogLayout } from "./hooks/useCatalogLayout";
import { runKpiBatch, getTenantId } from "./services/analyticsService";
import { GRID_COLS, KPI_ROW_HEIGHT } from "./constants/layoutConfig";

// Map the catalog's viz.kind onto the reference dashboard's VIZ_TYPE so each widget
// gets its type-specific header/body chrome (padding, insets, legend tuning) instead
// of a generic flex body. Mirrors the OLD DashboardGrid presentation path.
const KIND_TO_VIZTYPE = {
  bar: VIZ_TYPE.BAR_CHART,
  "bar-chart": VIZ_TYPE.BAR_CHART,
  histogram: VIZ_TYPE.HISTOGRAM,
  "horizontal-bar": VIZ_TYPE.HORIZONTAL_BAR,
  "stacked-bar": VIZ_TYPE.STACKED_BAR,
  line: VIZ_TYPE.LINE_CHART,
  "line-chart": VIZ_TYPE.LINE_CHART,
  pie: VIZ_TYPE.PIE_CHART,
  "pie-chart": VIZ_TYPE.PIE_CHART,
  "data-table": VIZ_TYPE.DATA_TABLE,
  table: VIZ_TYPE.DATA_TABLE,
  "sla-risk-table": VIZ_TYPE.SLA_RISK_TABLE,
  map: VIZ_TYPE.MAP,
  "choropleth-map": VIZ_TYPE.MAP,
};
const TABLE_KINDS = new Set(["data-table", "table", "sla-risk-table"]);

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

const WidgetRemoveButton = ({ label, onClick }) => {
  const { t } = useDashboardT();
  return (
    <button
      type="button"
      title={t("DASHBOARD_COMMON_REMOVE_FROM_DASHBOARD", "Remove from dashboard")}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className="dashboard-widget-remove-btn"
      aria-label={label}
    >
      <RemoveIcon />
    </button>
  );
};

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

const AdminDashboard = ({ embedded = false }) => {
  // Embedded (inside the DigitUI employee chrome) the host guarantees the
  // session and owns sign-out, so the standalone login gate is skipped.
  const [authed] = useState(() => embedded || hasDashboardSession());

  // Tenant number-format mask (dss.DashboardConfig.numberFormat, #1213).
  // Primed SYNCHRONOUSLY during render — the presentation configs are plain
  // modules (no hook access), and setting the module-level store before
  // AdminDashboardInner mounts means the first painted frame is already
  // masked: no useEffect priming, no unmasked flicker. Unconfigured tenants
  // (config null / field absent) clear the store and every formatter falls
  // back to its pre-#1213 expression byte-for-byte.
  const { config: dashboardConfig, loading: dashboardConfigLoading } =
    useDashboardConfig();
  setNumberFormatMask(dashboardConfig?.numberFormat);

  const handleLogin = useCallback(() => {
    window.location.reload();
  }, []);

  const handleSignOut = useCallback(() => {
    clearDashboardSession();
    window.location.reload();
  }, []);

  if (!authed) return <DashboardLogin onLogin={handleLogin} />;
  // Hold the dashboard until the DashboardConfig query settles (one
  // session-cached request, retry: false) so tiles never paint with default
  // separators and then re-render masked. Mirrors the accessLoading -> Loader
  // gate #1258 adds in Module.js; when both land, that single gate (fed by
  // the shared useDashboardConfig cache entry) makes this one settle
  // instantly.
  if (dashboardConfigLoading) {
    return <div className="kpi-tile kpi-tile--loading"><div className="kpi-tile__skeleton" /></div>;
  }
  return <AdminDashboardInner embedded={embedded} onSignOut={embedded ? undefined : handleSignOut} />;
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
const MAP_KINDS = new Set(["map", "choropleth-map"]);

// The internal pin source: map tiles fetch this alongside their ward aggregates
// to overlay per-complaint pins (the FE map widget has the pin layer; this feeds it).
const PIN_KPI_ID = "cl_map_complaint_pins";

function isCardKind(kind) {
  return CARD_KINDS.has(kind);
}
function isSparklineKind(kind) {
  return SPARKLINE_KINDS.has(kind);
}
function isMapKind(kind) {
  return MAP_KINDS.has(kind);
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
    if (isMapKind(kind)) {
      // Per-complaint pins (same filters/scope) overlaid on the ward choropleth.
      refs[`${kpiId}__pins`] = { kpiId: PIN_KPI_ID, params: { ...gp } };
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

  // Map complaint pins: shape the companion pin source -> { lat, lng, id } for the
  // map widget's pin layer (it drops 0,0 / out-of-area pins itself).
  if (isMapKind(viz.kind)) {
    const pinRes = results?.[`${kpiId}__pins`];
    if (pinRes?.rows?.length) {
      assembled.pins = pinRes.rows
        .map((r) => ({
          id: r.service_request_id,
          serviceRequestId: r.service_request_id,
          // Kajal's resolveComplaintPinPositions needs wardCode to place a pin
          // (snaps/jitters around the ward centroid when the geo-pin is unusable).
          wardCode: String(r.ward_code ?? ""),
          lat: Number(r.latitude),
          lng: Number(r.longitude),
          // detail fields for the click popup
          serviceCode: r.service_code,
          status: r.application_status,
          createdDate: r.created_date,
          source: r.source,
          slaStatus: r.sla_status_bucket,
        }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
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

const AdminDashboardInner = ({ onSignOut, embedded = false }) => {
  const { t, language, i18nTick } = useDashboardT();
  const { filters, setFilter, clearFilters, applyFilterOptions } =
    useDashboardFilters();
  const { options: filterOptions, loading: filterOptionsLoading } =
    useFilterOptions();
  const tenantId = useMemo(() => getTenantId(), []);

  // Feed the server-scoped option lists into the filter store so persisted
  // filter values that no longer match any option get reconciled
  // (reconcileFiltersWithOptions) instead of silently sending dead params.
  useEffect(() => {
    if (filterOptions) applyFilterOptions(filterOptions);
  }, [filterOptions, applyFilterOptions]);
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
  // Matches against the LOCALIZED title (what the user sees on the tile).
  const matchesSearch = useCallback(
    (kpiId) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      const title = (resolveTitle(kpis[kpiId]) || kpiId).toLowerCase();
      return title.includes(q);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- i18nTick re-resolves titles on late bundle arrival
    [searchQuery, kpis, i18nTick]
  );

  // Add-KPI picker source: every role-visible catalog tile (already filtered
  // server-side), shaped to the picker's { id, metric, type, itemType } contract.
  // `language` re-localizes the resolved names on a language switch; `i18nTick`
  // covers the async gap behind it — the host fires i18next.changeLanguage
  // BEFORE the new locale's bundles finish fetching, so the names must also
  // re-resolve when the messages actually land ("added" store event).
  const catalogItems = useMemo(
    () =>
      Object.values(kpis)
        .filter((def) => !def.viz?.internal) // hide internal companion sources (e.g. map pins)
        .map((def) => ({
          id: def.kpiId,
          metric: resolveTitle(def) || def.kpiId,
          type: def.viz?.kind,
          itemType: isCardKind(def.viz?.kind) ? "kpi" : "widget",
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- i18nTick re-resolves titles on late bundle arrival
    [kpis, language, i18nTick]
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
          errors: { __batch: err?.message || t("DASHBOARD_COMMON_BATCH_FAILED", "Batch query failed") },
          partial: true,
        });
      });
    // refsKey captures both the tile set and the resolved params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey, pack, tenantId]);

  const lastUpdatedLabel = useMemo(
    () =>
      new Date().toLocaleString(language?.replace("_", "-"), {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
    [batch.results, language]
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
      // CSV values stay RAW (unmasked, dot-decimal, no grouping) on purpose:
      // the tenant numberFormat mask (#1213) is display-only — a masked
      // "52.560" would be re-parsed as 52.56 by Excel/imports expecting
      // machine-readable CSV.
      const value =
        assembled?.value != null
          ? assembled.value
          : assembled?.rows
          ? `${assembled.rows.length} ${t("DASHBOARD_EXPORT_ROWS", "rows")}`
          : "";
      return [resolveTitle(def) || item.i, item.i, value];
    });
    // Column headers go through t() like the tile titles (resolveTitle above);
    // the filename stays ASCII-English on purpose — a stable machine-facing
    // identifier, not display copy.
    const header = [
      t("DASHBOARD_EXPORT_COL_TITLE", "Title"),
      t("DASHBOARD_EXPORT_COL_KPI", "KPI"),
      t("DASHBOARD_EXPORT_COL_VALUE", "Value"),
    ];
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dashboard-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [layout, kpis, batch.results, t]);

  const showEmpty = !catalogLoading && pack && layout.length === 0;

  return (
    <DashboardLayout
      embedded={embedded}
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
      filterOptions={filterOptions}
      filterOptionsLoading={filterOptionsLoading}
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
          {t("DASHBOARD_COMMON_CATALOG_UNAVAILABLE", "Catalog unavailable")}: {catalogError}
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
            {t("DASHBOARD_COMMON_NO_TILES_FOR_ROLE", "No tiles in the catalog pack for this role.")}
          </p>
        </div>
      ) : (
        <GridLayoutWithWidth
          className="dashboard-grid-layout layout"
          layout={gridLayout}
          cols={GRID_COLS}
          rowHeight={KPI_ROW_HEIGHT}
          margin={GRID_MARGIN}
          containerPadding={[0, 0]}
          compactType="vertical"
          isDraggable
          isResizable
          draggableHandle=".dashboard-widget-surface"
          draggableCancel=".dashboard-widget-remove-btn, .dashboard-view-toggle, .dashboard-table-scroll, .dashboard-chart-scroll-viewport, .dashboard-kpi-list-body, .leaflet-container, a, button, input, select, textarea"
          onLayoutChange={onLayoutChange}
        >
          {layout.map((item) => {
            const isKpi = isCardKind(kpis[item.i]?.viz?.kind);
            const dimClass = matchesSearch(item.i) ? "" : " dashboard-search-dimmed";
            const removeBtn = (
              <WidgetRemoveButton
                label={`${t("DASHBOARD_COMMON_REMOVE", "Remove")} ${resolveTitle(kpis[item.i]) || item.i}`}
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
                </div>
              );
            }
            // Map + choropleth widgets render their own internal header; every other
            // chart/table tile gets the reference DashboardGrid chrome: a typed header
            // (title + sub-line), the type-specific body insets, and a scroll wrapper
            // for tables.
            const viz = kpis[item.i]?.viz || {};
            const kind = viz.kind;
            const vizType = KIND_TO_VIZTYPE[kind] || kind;
            const isTable = TABLE_KINDS.has(kind);
            const selfHeaders = kind === "map" || kind === "choropleth-map";
            // Header text resolves through the i18n seam (titleKey/subtitleKey
            // win when seeded, else the catalog's English) — same pipeline as
            // the card tiles' KpiTile resolvers.
            const headerTitle = resolveTitle(kpis[item.i]) || item.i;
            const headerSubtitle = resolveSubtitle(viz);
            return (
              <section
                key={item.i}
                className={`dashboard-widget-surface tw-group tw-relative tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-overflow-hidden tw-rounded tw-border tw-border-border tw-bg-surface${dimClass}`}
              >
                {removeBtn}
                {!selfHeaders && (
                  <header className={`${buildWidgetHeaderClassName(vizType)} tw-min-w-0`}>
                    <div className="tw-min-w-0 tw-flex-1">
                      <h2 className={`${SHARED_CHROME.dragHandleTitle} tw-truncate`}>
                        {headerTitle}
                      </h2>
                      {headerSubtitle && (
                        <p className={SHARED_CHROME.dragHandleSubtitle}>{headerSubtitle}</p>
                      )}
                    </div>
                  </header>
                )}
                <div
                  className={
                    selfHeaders
                      ? "tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden"
                      : getWidgetBodyClassName(vizType, { isTable })
                  }
                >
                  {isTable ? (
                    <SubtleScroll className={getWidgetScrollClassName()}>
                      {renderTile(item.i)}
                    </SubtleScroll>
                  ) : (
                    renderTile(item.i)
                  )}
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
