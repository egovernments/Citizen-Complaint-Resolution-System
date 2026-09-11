import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./styles/dashboard.css";

import DashboardLayout from "./components/DashboardLayout";
import KpiTile from "./components/KpiTile";
import CardUpdatedStamp from "./components/CardUpdatedStamp";
import ResizeGrip from "./components/ResizeGrip";
import GroupByLevelSelect, { levelDisplayLabel } from "./components/GroupByLevelSelect";
import SubtleScroll from "./components/SubtleScroll";
import TypeFilterIgnoredNote, { typeFilterIgnored } from "./components/TypeFilterIgnoredNote";
import {
  VIZ_TYPE,
  SHARED_CHROME,
  buildWidgetHeaderClassName,
  getWidgetBodyClassName,
} from "./config/visualizationStyles";
import { SESSION_EXPIRED_EVENT } from "./services/authService";
import DashboardLogin, {
  hasDashboardSession,
  clearDashboardSession,
} from "./components/DashboardLogin";
import { useDashboardConfig } from "../useDashboardConfig";
import { configurePublicDashboardRuntime } from "./services/dashboardRuntime";
import { resolveNumberFormatMask, setNumberFormatMask } from "./utils/numberFormat";
import { resolveConfiguredTimeZone } from "./utils/dashboardTimeZone";

import useDashboardT from "./i18n/useDashboardT";
import { resolveTitle, resolveSubtitle } from "./i18n/textResolver";
import { useDashboardFilters } from "./hooks/useDashboardFilters";
import { useFilterOptions } from "./hooks/useFilterOptions";
import { useCatalog } from "./hooks/useCatalog";
import { useCatalogLayout, getDroppingItemForKpi, defaultSizeForKpi } from "./hooks/useCatalogLayout";
import { runKpiBatch, runPublicKpiBatch, getTenantId } from "./services/analyticsService";
import { errorForTile } from "./services/analyticsBatch";
import { fetchComplaintHierarchyLevels } from "./services/complaintHierarchyService";
import * as dashboardMetrics from "./services/dashboardMetrics";
import { GRID_COLS, KPI_ROW_HEIGHT, DROPPING_ITEM, DROPPING_ITEM_ID } from "./constants/layoutConfig";
import {
  isCardKind,
  isSparklineKind,
  isMapKind,
  needsPriorComparison,
  buildRefs,
  buildRefsKey,
  buildPublicRefs,
  buildPublicRefsKey,
  PIN_ROW_CAP,
} from "./utils/queryPlan";
import {
  hierLevelParam,
  effectiveHierLevel,
  buildGroupByOptions,
} from "./utils/hierLevelGrouping";
import { createPickerDragLifecycle } from "./utils/pickerDragLifecycle";

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

function pixelToGridPosition(containerWidth, clientX, clientY, gridRect, kpiId, kpis) {
  const { w, h } = defaultSizeForKpi(kpiId, kpis);
  // containerPadding={[0,0]} → only (cols − 1) gutters between columns.
  const colWidth = (containerWidth - GRID_MARGIN[0] * (GRID_COLS - 1)) / GRID_COLS;
  const left = clientX - gridRect.left;
  const top = clientY - gridRect.top;
  let x = Math.round(left / (colWidth + GRID_MARGIN[0]));
  let y = Math.round(top / (KPI_ROW_HEIGHT + GRID_MARGIN[1]));
  x = Math.max(0, Math.min(GRID_COLS - w, x));
  y = Math.max(0, y);
  return { x, y };
}


/* -------------------------------------------------------------------------- */
/* Auth gate (mirrors AdminDashboard)                                          */
/* -------------------------------------------------------------------------- */

const AdminDashboard = ({ embedded = false, mode }) => {
  // `mode` splits the two concerns the old boolean `embedded` conflated:
  // WHO OWNS THE CHROME, and WHETHER A SESSION IS REQUIRED.
  //
  //   embedded   host chrome (DigitUI), session guaranteed by AppModules
  //   standalone own shell, own login gate
  //   public     own shell, NO login — requests go out anonymously and the
  //              backend's PUBLIC floor decides what comes back
  //
  // `embedded` is kept as a legacy alias so Module.js (and any other caller)
  // keeps working unchanged; an explicit `mode` always wins.
  const resolvedMode = mode || (embedded ? "embedded" : "standalone");
  // The prop and the process-level runtime flag must agree: services decide
  // storage namespaces / anonymous transport off the flag, this component
  // decides fetch paths off the prop. Setting the flag here (idempotent, before
  // the first child render) means a public mount can never read or write an
  // employee's saved layout/filters because an entry forgot the explicit call.
  if (resolvedMode === "public") configurePublicDashboardRuntime();
  const isEmbedded = resolvedMode === "embedded";
  // Only the standalone shell owns a session: embedded inherits the host's,
  // public deliberately has none.
  const requiresSession = resolvedMode === "standalone";

  const [authed, setAuthed] = useState(() => !requiresSession || hasDashboardSession());
  const [expired, setExpired] = useState(false);

  // The gate used to be evaluated once at mount, so a session that died while
  // the tab was open could never flip it — the 401 just rendered as a raw error
  // banner and a reload re-passed the gate on the stale token (#1466).
  // authService announces an unrecoverable session and we drop to the login
  // screen with an explanation.
  //
  // Only in standalone mode. Embedded, the surrounding DigitUI chrome owns the
  // session and its own expiry handling, and rendering our standalone login form
  // inside it would be wrong. Public has no session to expire — dropping a
  // public visitor onto a login form would be a regression, not a recovery.
  // authService has already cleared the dead token, so the host sees the same
  // state on its next call.
  useEffect(() => {
    if (!requiresSession) return undefined;
    const onExpired = () => {
      setExpired(true);
      setAuthed(false);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [requiresSession]);

  // Per-LOCALE number-format mask (dss.DashboardConfig.numberFormat, #1213 /
  // #1272). Primed synchronously so the first painted frame is already masked.
  const { language } = useDashboardT();
  const { config: dashboardConfig, loading: dashboardConfigLoading } =
    useDashboardConfig();
  setNumberFormatMask(resolveNumberFormatMask(dashboardConfig?.numberFormat, language));
  // Resolved once dashboardConfig settles (dashboardConfigLoading gates AdminDashboardInner's
  // mount below), then threaded explicitly through every default-date consumer — no
  // module-global mutable timezone state, unlike the numberFormat mask above.
  const timeZone = resolveConfiguredTimeZone(dashboardConfig);

  const handleLogin = useCallback(() => {
    window.location.reload();
  }, []);

  const handleSignOut = useCallback(() => {
    clearDashboardSession();
    window.location.reload();
  }, []);

  if (!authed) return <DashboardLogin onLogin={handleLogin} expired={expired} />;
  if (dashboardConfigLoading) {
    return <div className="kpi-tile kpi-tile--loading"><div className="kpi-tile__skeleton" /></div>;
  }
  // Public renders the standalone shell (embedded=false) but with no sign-out —
  // Sidebar only draws that control when onSignOut is supplied.
  return (
    <AdminDashboardInner
      embedded={isEmbedded}
      publicMode={resolvedMode === "public"}
      onSignOut={requiresSession ? handleSignOut : undefined}
      timeZone={timeZone}
    />
  );
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
 * buckets roll up to), never which complaints qualify. Hierarchy FILTERS were
 * built and deliberately abandoned; this control must stay out of the filter
 * store so it can never be mistaken for (or grow into) one.
 */
const HIER_OVERRIDES_STORAGE_KEY = "ccrs.dashboard.hier-level-overrides.v1";

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
 *   prior    <- __prior scalar (cards)
 *   priorRows<- __prior rows (comparison tables)
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

  if (needsPriorComparison(def)) {
    const priorRes = results?.[`${kpiId}__prior`];
    assembled.priorRows = priorRes?.rows || [];
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
      // Whether the pin source projects the open/resolved state at all. The
      // legacy def (cl_map_complaint_pins) does not — its rows are open-only —
      // so the UI must fall back to "pins do not follow this layer" rather than
      // silently classing every pin as neither open nor resolved.
      assembled.pinsStatusKnown = (pinRes.columns || []).some(
        (c) => (typeof c === "string" ? c : c?.name) === "is_open"
      );
      // The server clamps every query at AnalyticsPlanner.MAX_LIMIT, so a
      // result exactly at the cap is indistinguishable from a truncated one.
      assembled.pinsTruncated = pinRes.rows.length >= PIN_ROW_CAP;
      assembled.pins = pinRes.rows
        .map((r) => ({
          id: r.service_request_id,
          serviceRequestId: r.service_request_id,
          // Booleans arrive as true/"true" depending on the JDBC/JSON path.
          isOpen: r.is_open === true || r.is_open === "true",
          isResolved: r.is_resolved === true || r.is_resolved === "true",
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

const AdminDashboardInner = ({ onSignOut, embedded = false, publicMode = false, timeZone }) => {
  // Render-lag instrumentation (#1110): begin the load SYNCHRONOUSLY at mount.
  useState(() => {
    dashboardMetrics.beginLoad();
    return null;
  });
  useEffect(() => () => dashboardMetrics.flush("unmount"), []);
  const { t, language, i18nTick } = useDashboardT();
  // Public persists too (#1797) — under public-only storage keys, see
  // config/dashboardConfig.js — and draws its option lists from the anonymous
  // /public/_options endpoint instead of the inline distinct batch.
  const { filters, setFilter, clearFilters, applyFilterOptions } =
    useDashboardFilters({ persistent: true, timeZone });
  const { options: filterOptions, loading: filterOptionsLoading } =
    useFilterOptions({ enabled: true, publicMode });
  const tenantId = useMemo(() => getTenantId(), []);

  // Feed the server-scoped option lists into the filter store so persisted
  // filter values that no longer match any option get reconciled
  // (reconcileFiltersWithOptions) instead of silently sending dead params.
  useEffect(() => {
    if (filterOptions) applyFilterOptions(filterOptions);
  }, [filterOptions, applyFilterOptions]);
  const { loading: catalogLoading, kpis, pack, error: catalogError } =
    useCatalog(tenantId, { publicMode });

  // Deployment complaint-hierarchy levels for the per-widget "Group by"
  // control. NO_HIERARCHY-shaped until the fetch resolves (control hidden).
  const [hierarchy, setHierarchy] = useState(null);
  useEffect(() => {
    if (publicMode) return undefined;
    let cancelled = false;
    fetchComplaintHierarchyLevels().then((h) => {
      if (!cancelled) setHierarchy(h);
    });
    return () => {
      cancelled = true;
    };
  }, [publicMode]);

  // Per-widget hierLevel overrides — see the module comment on
  // HIER_OVERRIDES_STORAGE_KEY for why this is NOT in `filters`.
  const [hierOverrides, setHierOverrides] = useState(() =>
    publicMode ? {} : readHierOverrides()
  );
  const setHierLevelOverride = useCallback((kpiId, value) => {
    setHierOverrides((prev) => {
      const next = { ...prev, [kpiId]: value };
      if (!publicMode) persistHierOverrides(next);
      return next;
    });
  }, [publicMode]);

  const [batch, setBatch] = useState({
    loading: true,
    results: {},
    errors: null,
    partial: false,
    asOf: null,
    calendar: null,
  });
  const reqIdRef = useRef(0);

  const {
    layout,
    gridSyncKey,
    onLayoutChange,
    onDragStop,
    onResizeStop,
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    visibleLayoutIds,
    findDragHoverTarget,
  } = useCatalogLayout(kpis, pack?.layout, { persistent: true });

  const [draggingWidgetId, setDraggingWidgetId] = useState(null);
  const draggingWidgetIdRef = useRef(null);
  const gridWrapRef = useRef(null);
  const externalDropLockRef = useRef(false);
  const postDropWidgetRef = useRef(null);
  const userDragWidgetRef = useRef(null);
  const dragSwapTargetRef = useRef(null);
  const dragOriginLayoutRef = useRef(null);
  const lastHoverTargetRef = useRef(null);
  const dragLifecycleRef = useRef(null);
  if (!dragLifecycleRef.current) dragLifecycleRef.current = createPickerDragLifecycle();
  const [isGridDragging, setIsGridDragging] = useState(false);

  const handleDragWidgetStart = useCallback((widgetId) => {
    dragLifecycleRef.current.start();
    draggingWidgetIdRef.current = widgetId;
    setDraggingWidgetId(widgetId);
  }, []);

  // RGL 1.3.4 has no cancel path for external drags (#1287 / #1311 review).
  // If the picker drag engaged the grid then ended without a grid drop (ESC /
  // drop outside), dispatch a synthetic drop so RGL clears activeDrag.
  const handleDragWidgetEnd = useCallback(() => {
    draggingWidgetIdRef.current = null;
    const { needsSyntheticCleanup } = dragLifecycleRef.current.end();
    if (needsSyntheticCleanup) {
      const gridEl = gridWrapRef.current?.querySelector(".react-grid-layout");
      if (gridEl && typeof DragEvent === "function") {
        try {
          gridEl.dispatchEvent(
            new DragEvent("drop", { bubbles: true, cancelable: true })
          );
        } catch {
          /* jsdom / older engines */
        }
      }
    }
    setDraggingWidgetId(null);
  }, []);

  const isExternalDrag = Boolean(draggingWidgetId);

  const droppingItem = useMemo(() => {
    if (draggingWidgetId && kpis[draggingWidgetId]) {
      return getDroppingItemForKpi(draggingWidgetId, kpis);
    }
    return DROPPING_ITEM;
  }, [draggingWidgetId, kpis]);

  const completeExternalDrop = useCallback(
    (widgetId, position, clientX, clientY) => {
      if (externalDropLockRef.current) return;
      const activeId = widgetId || draggingWidgetIdRef.current;
      if (!activeId || !kpis[activeId]) return;
      if (layout.some((entry) => entry.i === activeId)) return;

      let dropPosition = position;
      if (!dropPosition && clientX != null && clientY != null && gridWrapRef.current) {
        const gridEl = gridWrapRef.current.querySelector(".react-grid-layout");
        if (gridEl) {
          const rect = gridEl.getBoundingClientRect();
          dropPosition = pixelToGridPosition(
            rect.width,
            clientX,
            clientY,
            rect,
            activeId,
            kpis
          );
        }
      }
      if (!dropPosition) return;

      externalDropLockRef.current = true;
      postDropWidgetRef.current = activeId;
      requestAnimationFrame(() => {
        addKpiToLayout(activeId, dropPosition);
        handleDragWidgetEnd();
        externalDropLockRef.current = false;
      });
    },
    [addKpiToLayout, handleDragWidgetEnd, kpis, layout]
  );

  const handleWrapDragOver = useCallback(
    (event) => {
      if (!draggingWidgetIdRef.current) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },
    []
  );

  const handleWrapDrop = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const widgetId = event.dataTransfer?.getData("text/plain");
      completeExternalDrop(widgetId, null, event.clientX, event.clientY);
    },
    [completeExternalDrop]
  );

  const handleGridDrop = useCallback(
    (_gridLayout, item, event) => {
      dragLifecycleRef.current.gridDrop();
      let widgetId = null;
      try {
        widgetId = event?.dataTransfer?.getData("text/plain") || null;
      } catch {
        /* some browsers throw on getData outside dragstart/drop */
      }
      if (!widgetId) widgetId = draggingWidgetIdRef.current;
      // Synthetic cleanup drops (ESC / drop-outside) clear RGL only — no add.
      if (!widgetId || !item) return;
      const position = { x: item.x, y: item.y };
      const clientX = event?.nativeEvent?.clientX ?? event?.clientX;
      const clientY = event?.nativeEvent?.clientY ?? event?.clientY;
      completeExternalDrop(widgetId, position, clientX, clientY);
    },
    [completeExternalDrop]
  );

  const handleDropDragOver = useCallback(() => {
    dragLifecycleRef.current.gridDragOver();
    const activeId = draggingWidgetIdRef.current;
    if (!activeId || !kpis[activeId]) return false;
    if (layout.some((entry) => entry.i === activeId)) return false;
    return defaultSizeForKpi(activeId, kpis);
  }, [kpis, layout]);

  const handleLayoutChange = useCallback(
    (next) => {
      if (draggingWidgetIdRef.current) return;
      const withoutPlaceholder = next.filter((item) => item.i !== DROPPING_ITEM_ID);
      onLayoutChange(withoutPlaceholder);
    },
    [onLayoutChange]
  );

  const handleInternalDragStart = useCallback((_, __, newItem) => {
    const widgetId = newItem?.i;
    setIsGridDragging(true);
    dragOriginLayoutRef.current = layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    lastHoverTargetRef.current = null;
    dragSwapTargetRef.current = null;
    if (widgetId && postDropWidgetRef.current === widgetId) {
      return;
    }
    if (postDropWidgetRef.current && widgetId && postDropWidgetRef.current !== widgetId) {
      postDropWidgetRef.current = null;
    }
    userDragWidgetRef.current = widgetId ?? null;
  }, [layout]);

  const handleInternalDrag = useCallback(
    (currentLayout, _oldItem, newItem) => {
      if (!newItem?.i || !findDragHoverTarget) return;
      const staticLayout = dragOriginLayoutRef.current ?? currentLayout;
      const originItem = staticLayout.find((item) => item.i === newItem.i) ?? null;
      const target = findDragHoverTarget(staticLayout, newItem, newItem.i, originItem);
      if (target) {
        lastHoverTargetRef.current = target.i;
        dragSwapTargetRef.current = target.i;
      } else {
        lastHoverTargetRef.current = null;
        dragSwapTargetRef.current = null;
      }
    },
    [findDragHoverTarget]
  );

  const handleDragStop = useCallback(
    (nextLayout, oldItem, newItem) => {
      if (draggingWidgetIdRef.current) return;
      const widgetId = newItem?.i;
      if (widgetId && postDropWidgetRef.current === widgetId) {
        userDragWidgetRef.current = null;
        dragSwapTargetRef.current = null;
        dragOriginLayoutRef.current = null;
        lastHoverTargetRef.current = null;
        postDropWidgetRef.current = null;
        setIsGridDragging(false);
        return;
      }
      if (userDragWidgetRef.current === widgetId) {
        postDropWidgetRef.current = null;
      }
      userDragWidgetRef.current = null;
      setIsGridDragging(false);
      const withoutPlaceholder = nextLayout.filter((item) => item.i !== DROPPING_ITEM_ID);
      const hoverTargetId = lastHoverTargetRef.current ?? dragSwapTargetRef.current;
      const originLayout = dragOriginLayoutRef.current;
      dragSwapTargetRef.current = null;
      dragOriginLayoutRef.current = null;
      lastHoverTargetRef.current = null;
      onDragStop(withoutPlaceholder, oldItem, newItem, hoverTargetId, originLayout);
    },
    [onDragStop]
  );

  const handleResizeStop = useCallback(
    (nextLayout, oldItem, newItem) => {
      if (draggingWidgetIdRef.current) return;
      const withoutPlaceholder = nextLayout.filter((item) => item.i !== DROPPING_ITEM_ID);
      onResizeStop(withoutPlaceholder, oldItem, newItem);
    },
    [onResizeStop]
  );


  const tiles = useMemo(
    () => layout.map((item) => ({ kpiId: item.i })),
    [layout]
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
    () => publicMode
      ? buildPublicRefsKey(tiles, kpis, filters)
      : buildRefsKey(tiles, kpis, filters, hierOverrides),
    [tiles, filters, kpis, hierOverrides, publicMode]
  );

  useEffect(() => {
    if (!pack || !tiles.length) {
      setBatch({ loading: false, results: {}, errors: null, partial: false, asOf: null, calendar: null });
      return;
    }
    const refs = publicMode
      ? buildPublicRefs(tiles, kpis, filters)
      : buildRefs(tiles, kpis, filters, hierOverrides);
    const reqId = ++reqIdRef.current;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    dashboardMetrics.markBatchStart(reqId);
    // A changed query plan must not leave the prior values visible/exportable
    // beneath new filter labels while the replacement request is in flight.
    setBatch({
      loading: true,
      results: {},
      errors: null,
      partial: false,
      asOf: null,
      calendar: null,
    });

    const requestOptions = {
      signal: controller?.signal,
      shouldContinue: () => reqId === reqIdRef.current,
    };
    const request = publicMode
      ? runPublicKpiBatch(refs, tenantId, pack?.maxBatchQueries, requestOptions)
      : runKpiBatch(refs, tenantId, pack?.maxBatchQueries, requestOptions);
    request
      .then((res) => {
        if (reqId !== reqIdRef.current) return;
        setBatch({
          loading: false,
          results: res?.results || {},
          errors: res?.errors || null,
          partial: Boolean(res?.partial),
          // Batch authority for "Last updated" (#29): the response's own top-level
          // asOf/calendar, never a fresh client-side clock reading.
          asOf: typeof res?.asOf === "number" ? res.asOf : null,
          calendar: res?.calendar || null,
        });
        dashboardMetrics.markAllWidgetsReady(
          countErrorWidgets(res?.errors, tiles.length),
          reqId,
          res?.roundTrips
        );
      })
      .catch((err) => {
        if (reqId !== reqIdRef.current) return;
        setBatch({
          loading: false,
          results: {},
          errors: {
            __batch:
              err?.payload?.message ||
              err?.message ||
              t("DASHBOARD_COMMON_BATCH_FAILED", "Batch query failed"),
          },
          partial: true,
          asOf: null,
          calendar: null,
        });
        dashboardMetrics.markAllWidgetsReady(tiles.length, reqId);
      });
    return () => {
      if (reqIdRef.current === reqId) reqIdRef.current += 1;
      controller?.abort();
    };
    // refsKey captures both the tile set and the resolved params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey, pack, tenantId, publicMode]);

  // "Last updated" reads the batch's OWN echoed asOf/calendar (#29) — the single
  // clock reading every tile in this batch was judged against — never a fresh
  // new Date() at render time, which would drift from what's actually on screen.
  // No stamp (rather than a fabricated "now") when the batch hasn't supplied one.
  const lastUpdatedLabel = useMemo(() => {
    if (batch.asOf == null) return null;
    const zone = batch.calendar?.timeZone || timeZone;
    return new Date(batch.asOf).toLocaleString(language?.replace("_", "-"), {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      ...(zone ? { timeZone: zone } : {}),
    });
  }, [batch.asOf, batch.calendar, timeZone, language]);

  // RGL reads min/max W/H straight off each layout item (the hook bakes in the
  // viz.kind-derived constraints), so the grid layout passes items through verbatim.
  const gridLayout = useMemo(() => layout, [layout]);

  const renderTile = (kpiId, groupBy = null) => {
    const def = kpis[kpiId];
    if (!def) return null;

    const assembled = assembleResult(kpiId, def, batch.results);
    const tileError = errorForTile(batch.errors, kpiId);

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

  const showPublicDisabled = publicMode && !catalogLoading && pack?.enabled === false;
  const showEmpty = !showPublicDisabled && !catalogLoading && pack && layout.length === 0;

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

  return (
    <DashboardLayout
      embedded={embedded}
      readOnly={false}
      publicMode={publicMode}
      visibleLayoutIds={visibleLayoutIds}
      catalogItems={catalogItems}
      onAddWidget={addKpiToLayout}
      onResetLayout={resetLayout}
      onDragWidgetStart={handleDragWidgetStart}
      onDragWidgetEnd={handleDragWidgetEnd}
      onExport={handleExport}
      filters={filters}
      onFilterChange={handleFilterChange}
      onClearFilters={handleClearFilters}
      timeZone={timeZone}
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
      {showPublicDisabled && (
        <div className="tw-mx-auto tw-mt-12 tw-max-w-xl tw-rounded-lg tw-border tw-border-border tw-bg-surface tw-p-8 tw-text-center tw-shadow-sm">
          <h1 className="tw-text-xl tw-font-semibold tw-text-foreground">
            {t("DASHBOARD_PUBLIC_NOT_AVAILABLE_TITLE", "Public dashboard is not available")}
          </h1>
          <p className="tw-mt-3 tw-text-sm tw-leading-6 tw-text-muted-foreground">
            {t(
              "DASHBOARD_PUBLIC_NOT_AVAILABLE_DESCRIPTION",
              "This dashboard has not been enabled for this tenant."
            )}
          </p>
        </div>
      )}
      {batch.errors && batch.errors.__batch && (
        <div className="tw-mb-4 tw-rounded-md tw-border tw-border-[color-mix(in_srgb,var(--destructive)_30%,transparent)] tw-bg-status-breach-bg tw-px-4 tw-py-3 tw-text-sm tw-text-destructive">
          {batch.errors.__batch}
        </div>
      )}

      {/* Grid stays mounted when empty: drop target + cancelled-drag recovery
          (#1287). Empty copy overlays the grid (pointer-events-none) and hides
          while a picker drag is live so the RGL placeholder stays visible. */}
      <div
        ref={gridWrapRef}
        className={`dashboard-grid-wrap${showPublicDisabled ? " tw-hidden" : ""}${isExternalDrag ? " dashboard-external-drag" : ""}${
          isGridDragging ? " dashboard-grid-dragging" : ""
        }${showEmpty ? " dashboard-grid-wrap--empty tw-relative tw-rounded tw-border tw-border-dashed tw-border-border tw-bg-surface" : ""}`}
        onDragOver={handleWrapDragOver}
        onDrop={handleWrapDrop}
      >
        {showEmpty && !isExternalDrag ? (
          <div className="tw-pointer-events-none tw-absolute tw-inset-0 tw-z-[1] tw-flex tw-min-h-[12rem] tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-text-center">
            <p className="tw-text-[12px] tw-text-muted-foreground">
              {t("DASHBOARD_COMMON_NO_TILES_FOR_ROLE", "No tiles in the catalog pack for this role.")}
            </p>
          </div>
        ) : null}
        <GridLayoutWithWidth
          key={gridSyncKey}
          className={`dashboard-grid-layout layout${showEmpty ? " dashboard-grid-layout--empty" : ""}`}
          layout={gridLayout}
          cols={GRID_COLS}
          rowHeight={KPI_ROW_HEIGHT}
          margin={GRID_MARGIN}
          containerPadding={[0, 0]}
          compactType={null}
          allowOverlap={false}
          isDraggable
          isResizable
          isDroppable={isExternalDrag}
          droppingItem={droppingItem}
          onDrop={handleGridDrop}
          onDropDragOver={handleDropDragOver}
          draggableHandle=".dashboard-widget-surface"
          draggableCancel=".dashboard-widget-remove-btn, .dashboard-view-toggle, .dashboard-table-scroll, .dashboard-chart-scroll-viewport, .dashboard-kpi-list-body, .dashboard-widget-header-subtitle, .leaflet-container, a, button, input, select, textarea"
          onLayoutChange={handleLayoutChange}
          onDragStart={handleInternalDragStart}
          onDrag={handleInternalDrag}
          onDragStop={handleDragStop}
          onResizeStop={handleResizeStop}
        >
          {layout.map((item) => {
            const isKpi = isCardKind(kpis[item.i]?.viz?.kind);
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
                  className="dashboard-kpi-widget dashboard-widget-surface tw-group tw-relative tw-flex tw-h-full tw-flex-col"
                >
                  {removeBtn}
                  {renderTile(item.i)}
                  {ignoredNote}
                  {lastUpdatedLabel && <CardUpdatedStamp label={lastUpdatedLabel} />}
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
            const hasGroupBy = Boolean(groupBy.options && !selfHeaders);
            return (
              <section
                key={item.i}
                className="dashboard-widget-surface tw-group tw-relative tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-overflow-hidden tw-rounded tw-border tw-border-border tw-bg-surface"
              >
                {removeBtn}
                {!selfHeaders && (
                  <header className={`${buildWidgetHeaderClassName(vizType)} dashboard-widget-header tw-min-w-0`}>
                    <div className="dashboard-widget-header-title-row tw-flex tw-min-w-0 tw-items-start tw-gap-2">
                      <h2
                        className={`${SHARED_CHROME.dragHandleTitle} tw-min-w-0 tw-flex-1`}
                        title={headerTitle}
                      >
                        {headerTitle}
                      </h2>
                      {hasGroupBy && (
                        <GroupByLevelSelect
                          value={groupBy.value}
                          options={groupBy.options}
                          hierarchyType={hierarchy?.hierarchyType}
                          onChange={(value) => setHierLevelOverride(item.i, value)}
                        />
                      )}
                    </div>
                    {headerSubtitle && (
                      <SubtleScroll className="dashboard-widget-header-subtitle">
                        <p className={SHARED_CHROME.dragHandleSubtitle}>{headerSubtitle}</p>
                      </SubtleScroll>
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
                  {renderTile(item.i, groupBy.info)}
                </div>
                {ignoredNote}
                {lastUpdatedLabel && <CardUpdatedStamp label={lastUpdatedLabel} />}
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
