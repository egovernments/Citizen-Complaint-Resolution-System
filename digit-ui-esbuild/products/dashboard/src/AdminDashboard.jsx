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
import GroupByLevelSelect, { levelDisplayLabel } from "./components/GroupByLevelSelect";
import TypeFilterIgnoredNote, { typeFilterIgnored } from "./components/TypeFilterIgnoredNote";
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
import { resolveNumberFormatMask, setNumberFormatMask } from "./utils/numberFormat";

import useDashboardT from "./i18n/useDashboardT";
import { resolveTitle, resolveSubtitle } from "./i18n/textResolver";
import { useDashboardFilters } from "./hooks/useDashboardFilters";
import { useFilterOptions } from "./hooks/useFilterOptions";
import { useCatalog } from "./hooks/useCatalog";
import { useCatalogLayout } from "./hooks/useCatalogLayout";
import { runKpiBatch, getTenantId } from "./services/analyticsService";
import { fetchComplaintHierarchyLevels } from "./services/complaintHierarchyService";
import * as dashboardMetrics from "./services/dashboardMetrics";
import { GRID_COLS, KPI_ROW_HEIGHT, DROPPING_ITEM_ID } from "./constants/layoutConfig";
import { defaultSizeForKpi } from "./utils/layoutStore";
import { createPickerDragLifecycle } from "./utils/pickerDragLifecycle";
import {
  isCardKind,
  isSparklineKind,
  isMapKind,
  buildRefs,
  buildRefsKey,
} from "./utils/queryPlan";
import {
  hierLevelParam,
  effectiveHierLevel,
  buildGroupByOptions,
} from "./utils/hierLevelGrouping";

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

  // Per-LOCALE number-format mask (dss.DashboardConfig.numberFormat, #1213 /
  // #1272). `numberFormat` is either an object keyed by locale code (with
  // optional `default`) or a legacy string applied to every locale;
  // resolveNumberFormatMask picks the active language's mask. Primed
  // SYNCHRONOUSLY during render — the presentation configs are plain modules
  // (no hook access), and setting the module-level store before
  // AdminDashboardInner mounts means the first painted frame is already
  // masked: no useEffect priming, no unmasked flicker. useDashboardT
  // subscribes this component to the locale runtime, so a language switch
  // re-renders it and re-runs this prime with the new locale's mask BEFORE
  // any child re-renders (parents render first). Unconfigured tenants
  // (config null / field absent / no mask for the locale and no default)
  // clear the store and every formatter falls back to its pre-#1213
  // expression byte-for-byte.
  const { language } = useDashboardT();
  const { config: dashboardConfig, loading: dashboardConfigLoading } =
    useDashboardConfig();
  setNumberFormatMask(resolveNumberFormatMask(dashboardConfig?.numberFormat, language));

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
// globalParams / buildRefs / buildRefsKey and the kind sets live in
// utils/queryPlan.js (pure, unit-tested); this file owns the React state that
// feeds them.

/**
 * Per-widget "Group by" hierarchy-level overrides (#1111 PR2), persisted like
 * the saved layout: localStorage, kpiId-keyed. NOT part of `filters` state on
 * purpose — a Group-by level is structurally NOT a filter: it changes the
 * widget's own aggregation dimension (which hierarchy level the service_code
 * buckets roll up to), never which complaints qualify. Hierarchy FILTERING
 * lives where filters live: the global complaint-type TREE filter
 * (ComplaintTypeTreeFilter, the sanctioned revival of the abandoned July
 * demo) is part of `filters`/globalParams; this per-widget control must stay
 * out of the filter store so the two axes never blur — they compose at the
 * query level (subtree WHERE × level GROUP BY).
 */
const HIER_OVERRIDES_STORAGE_KEY = "ccrs.dashboard.hier-level-overrides.v1";

function readHierOverrides() {
  try {
    const raw = window.localStorage?.getItem(HIER_OVERRIDES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function persistHierOverrides(overrides) {
  try {
    window.localStorage?.setItem(HIER_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* ignore quota/serialisation errors — override state is non-critical */
  }
}

/**
 * Errored-widget count for dashboard.error_widgets.count (#1110): companion
 * refs (__prior/__series/__pins) collapse to their base kpiId so a tile whose
 * base AND companion queries failed still counts as ONE broken widget; a
 * whole-batch failure (`__batch`) counts every laid-out tile.
 */
function countErrorWidgets(errors, tileCount) {
  const keys = Object.keys(errors || {});
  if (!keys.length) return 0;
  if (keys.includes("__batch")) return tileCount;
  return new Set(keys.map((k) => k.replace(/__(prior|series|pins)$/, ""))).size;
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
  // Render-lag instrumentation (#1110): begin the load SYNCHRONOUSLY at mount,
  // BEFORE useCatalog/useFilterOptions fire their fetches, so every request of
  // this load carries the load's traceparent/x-trace-id (useState initializer
  // runs during the first render; the hooks' effects run after it).
  useState(() => {
    dashboardMetrics.beginLoad();
    return null;
  });
  // Soft-nav away: ship whatever telemetry is still pending for this load.
  useEffect(() => () => dashboardMetrics.flush("unmount"), []);
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

  // Deployment complaint-hierarchy levels for the per-widget "Group by"
  // control. NO_HIERARCHY-shaped until the fetch resolves (control hidden).
  const [hierarchy, setHierarchy] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchComplaintHierarchyLevels().then((h) => {
      if (!cancelled) setHierarchy(h);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Per-widget hierLevel overrides — see the module comment on
  // HIER_OVERRIDES_STORAGE_KEY for why this is NOT in `filters`.
  const [hierOverrides, setHierOverrides] = useState(readHierOverrides);
  const setHierLevelOverride = useCallback((kpiId, value) => {
    setHierOverrides((prev) => {
      const next = { ...prev, [kpiId]: value };
      persistHierOverrides(next);
      return next;
    });
  }, []);

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

  // Drag-and-drop placement from the Add-KPI picker: the picker item is an
  // HTML5 drag source (dataTransfer carries the kpiId); the grid accepts it
  // via RGL's external-drop support. isDroppable is only enabled while a
  // picker drag is live, so foreign drags (files, text) never conjure a
  // placeholder. The drop funnels into the SAME addKpiToLayout path as a
  // picker click — one code path for attach + persist + batch refetch.
  const [droppingKpiId, setDroppingKpiId] = useState(null);
  const droppingKpiIdRef = useRef(null);
  // RGL 1.3.4 has no cancel path for external drags: a drag that engaged the
  // grid (placeholder shown, synthetic GridItem drag started → activeDrag set)
  // but ended WITHOUT a drop on the grid leaves activeDrag/droppingDOMNode/
  // __dropping-elem__ stuck forever. With activeDrag stuck, RGL ignores every
  // future layout prop, so all later adds (drop OR click) persist to storage
  // but never render — the "does not attach" + collapsed-grid repro (#1287).
  // Track the drag lifecycle and, on a cancelled-after-engage dragend, fire a
  // synthetic drop at the grid so RGL runs its own onDrop cleanup (counter
  // reset + removeDroppingPlaceholder). droppingKpiIdRef is nulled FIRST, so
  // handleGridDrop treats the synthetic drop as cleanup, never as an add.
  const dragLifecycleRef = useRef(null);
  if (!dragLifecycleRef.current) dragLifecycleRef.current = createPickerDragLifecycle();
  const gridWrapRef = useRef(null);
  const handlePickerDragStart = useCallback((kpiId) => {
    dragLifecycleRef.current.start();
    droppingKpiIdRef.current = kpiId;
    setDroppingKpiId(kpiId);
  }, []);
  // RGL calls onDropDragOver on every dragover tick — the earliest reliable
  // signal that its dropping state now exists. Return undefined so the
  // droppingItem prop is used as-is.
  const handleGridDropDragOver = useCallback(() => {
    dragLifecycleRef.current.gridDragOver();
    return undefined;
  }, []);
  const handlePickerDragEnd = useCallback(() => {
    droppingKpiIdRef.current = null;
    const { needsSyntheticCleanup } = dragLifecycleRef.current.end();
    if (needsSyntheticCleanup) {
      // Must dispatch before setDroppingKpiId(null) commits: RGL's onDrop is
      // detached once isDroppable flips false, and only onDrop resets the
      // dragEnterCounter and removes the dropping placeholder + activeDrag.
      const gridEl = gridWrapRef.current?.querySelector(".react-grid-layout");
      if (gridEl && typeof DragEvent === "function") {
        try {
          gridEl.dispatchEvent(
            new DragEvent("drop", { bubbles: true, cancelable: true })
          );
        } catch {
          /* jsdom/older engines: nothing to clean without real DnD anyway */
        }
      }
    }
    setDroppingKpiId(null);
  }, []);
  // RGL sizes the drop placeholder from droppingItem, and its calcXY uses the
  // same w/h to compute the drop cell — matching the tile's real default size
  // keeps the preview honest and the landing coordinates in-bounds.
  const droppingItem = useMemo(() => {
    if (!droppingKpiId) return undefined;
    return { i: DROPPING_ITEM_ID, ...defaultSizeForKpi(droppingKpiId, kpis) };
  }, [droppingKpiId, kpis]);
  const handleGridDrop = useCallback(
    (_layout, item, e) => {
      dragLifecycleRef.current.gridDrop();
      // Prefer the dataTransfer payload (survives re-renders mid-drag); the
      // ref covers browsers that gate getData to the drop handler proper.
      let kpiId = null;
      try {
        kpiId = e?.dataTransfer?.getData("text/plain") || null;
      } catch {
        /* some browsers throw on getData outside dragstart/drop */
      }
      if (!kpiId) kpiId = droppingKpiIdRef.current;
      droppingKpiIdRef.current = null;
      setDroppingKpiId(null);
      if (!kpiId || !item) return;
      addKpiToLayout(kpiId, { x: item.x, y: item.y });
    },
    [addKpiToLayout]
  );

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

  // Re-run the batch whenever the catalog resolves, the filters change, or a
  // per-widget "Group by" override changes. buildRefsKey includes each tile's
  // viz.kind (a def flipping card<->chart must re-trigger even when ids/params
  // are unchanged) AND the applied hierLevel overrides (R7c — without them a
  // Group-by change would never refire this effect).
  const refsKey = useMemo(
    () => buildRefsKey(tiles, kpis, filters, hierOverrides),
    [tiles, filters, kpis, hierOverrides]
  );

  useEffect(() => {
    if (!pack || !tiles.length) {
      setBatch({ loading: false, results: {}, errors: null, partial: false });
      return;
    }
    const refs = buildRefs(tiles, kpis, filters, hierOverrides);
    const reqId = ++reqIdRef.current;
    // A new batch actually fired: opens a pending interaction window (R6) —
    // an intent whose filter change didn't change refsKey never reaches here.
    dashboardMetrics.markBatchStart(reqId);
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
        // AFTER the staleness guard; companion-ref errors (__prior/__series/
        // __pins) collapse to their base kpiId so one broken tile counts once.
        dashboardMetrics.markAllWidgetsReady(
          countErrorWidgets(res?.errors, tiles.length),
          reqId
        );
      })
      .catch((err) => {
        if (reqId !== reqIdRef.current) return;
        setBatch({
          loading: false,
          results: {},
          errors: { __batch: err?.message || t("DASHBOARD_COMMON_BATCH_FAILED", "Batch query failed") },
          partial: true,
        });
        // Whole-batch failure: every laid-out tile is an errored widget.
        dashboardMetrics.markAllWidgetsReady(tiles.length, reqId);
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

  const renderTile = (kpiId, groupBy = null) => {
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
        groupBy={groupBy}
      />
    );
  };

  /**
   * Group-by state for one widget: select options (null hides the control),
   * the effective level shown in the select, and — when the effective level is
   * non-leaf — the { level, label } info table tiles need to hide the
   * service_group ("Type") column and relabel service_code (R4). The effective
   * level mirrors the def's declared default even before the user touches the
   * control, because the backend applies that default server-side.
   */
  const groupByStateFor = (kpiId) => {
    const def = kpis[kpiId];
    const param = hierLevelParam(def);
    if (!param || !hierarchy?.hasHierarchy) return { options: null, value: null, info: null };
    const options = buildGroupByOptions(hierarchy.levels, param);
    if (!options) return { options: null, value: null, info: null };
    const value = effectiveHierLevel(def, hierOverrides);
    const level = value !== "leaf" ? hierarchy.levels[Number(value) - 1] : null;
    const info = level
      ? { level: value, label: levelDisplayLabel(level, hierarchy.hierarchyType) }
      : null;
    return { options, value, info };
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

  // Filter interactions register an intent with the metrics module first (the
  // window only opens if the change actually re-fires the batch — R6); the
  // filters hook itself stays untouched.
  const handleFilterChange = useCallback(
    (...args) => {
      dashboardMetrics.markInteraction("filter");
      return setFilter(...args);
    },
    [setFilter]
  );
  const handleClearFilters = useCallback(
    (...args) => {
      dashboardMetrics.markInteraction("filter");
      return clearFilters(...args);
    },
    [clearFilters]
  );

  const showEmpty = !catalogLoading && pack && layout.length === 0;

  return (
    <DashboardLayout
      embedded={embedded}
      visibleLayoutIds={visibleLayoutIds}
      catalogItems={catalogItems}
      onAddWidget={addKpiToLayout}
      onResetLayout={resetLayout}
      onDragWidgetStart={handlePickerDragStart}
      onDragWidgetEnd={handlePickerDragEnd}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      onExport={handleExport}
      filters={filters}
      onFilterChange={handleFilterChange}
      onClearFilters={handleClearFilters}
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

      {/* The grid stays mounted even when the layout is empty: it is the sole
          drop target for picker drags (isDroppable/onDrop) AND the anchor for
          the cancelled-drag synthetic-drop recovery (gridWrapRef), and an
          empty-seed role's first load / a fully-cleared layout must still
          accept drag-and-drop (review on #1287). The empty-state copy overlays
          the (zero-tile) grid instead of replacing it — pointer-events-none so
          HTML5 dragover/drop reach react-grid-layout underneath — and hides
          while a picker drag is live so RGL's drop placeholder stays visible
          inside the dashed drop surface. */}
      <div
        ref={gridWrapRef}
        className={
          showEmpty
            ? "tw-relative tw-rounded tw-border tw-border-dashed tw-border-border tw-bg-surface"
            : undefined
        }
      >
        {showEmpty && !droppingKpiId && (
          <div className="tw-pointer-events-none tw-absolute tw-inset-0 tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-text-center">
            <p className="tw-text-[12px] tw-text-muted-foreground">
              {t("DASHBOARD_COMMON_NO_TILES_FOR_ROLE", "No tiles in the catalog pack for this role.")}
            </p>
          </div>
        )}
        <GridLayoutWithWidth
          className={`dashboard-grid-layout layout${
            droppingKpiId ? " dashboard-grid-layout--dropping" : ""
          }${showEmpty ? " dashboard-grid-layout--empty" : ""}`}
          layout={gridLayout}
          cols={GRID_COLS}
          rowHeight={KPI_ROW_HEIGHT}
          margin={GRID_MARGIN}
          containerPadding={[0, 0]}
          compactType="vertical"
          isDraggable
          isResizable
          isDroppable={Boolean(droppingKpiId)}
          droppingItem={droppingItem}
          onDrop={handleGridDrop}
          onDropDragOver={handleGridDropDragOver}
          draggableHandle=".dashboard-widget-surface"
          draggableCancel=".dashboard-widget-remove-btn, .dashboard-view-toggle, .dashboard-table-scroll, .dashboard-chart-scroll-viewport, .dashboard-kpi-list-body, .leaflet-container, a, button, input, select, textarea"
          onLayoutChange={onLayoutChange}
        >
          {layout.map((item) => {
            const isKpi = isCardKind(kpis[item.i]?.viz?.kind);
            const dimClass = matchesSearch(item.i) ? "" : " dashboard-search-dimmed";
            // Subtle per-tile note when the backend ignored the subtree
            // complaint-type filter on this KPI's grain (daily has no
            // complaint_node_path) — the field is ABSENT unless it happened.
            const ignoredNote = typeFilterIgnored(batch.results?.[item.i]) ? (
              <TypeFilterIgnoredNote />
            ) : null;
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
                  {ignoredNote}
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
            // Per-widget "Group by" hierarchy-level control (#1111 PR2). Table
            // kinds share this same header chrome (they are not selfHeaders),
            // so one placement covers charts AND tables; card tiles never
            // declare hierLevel and KpiTile carries no header of its own (R7b).
            const groupBy = groupByStateFor(item.i);
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
                    {groupBy.options && (
                      <GroupByLevelSelect
                        value={groupBy.value}
                        options={groupBy.options}
                        hierarchyType={hierarchy?.hierarchyType}
                        onChange={(value) => setHierLevelOverride(item.i, value)}
                      />
                    )}
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
                      {renderTile(item.i, groupBy.info)}
                    </SubtleScroll>
                  ) : (
                    renderTile(item.i, groupBy.info)
                  )}
                </div>
                {ignoredNote}
                <CardUpdatedStamp label={lastUpdatedLabel} />
                <ResizeGrip />
              </section>
            );
          })}
        </GridLayoutWithWidth>
      </div>
    </DashboardLayout>
  );
};

export default AdminDashboard;
