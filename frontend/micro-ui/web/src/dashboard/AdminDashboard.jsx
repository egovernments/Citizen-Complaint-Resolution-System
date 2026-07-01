import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./styles/dashboard.css";

import DashboardLayout from "./components/DashboardLayout";
import KpiTile from "./components/KpiTile";
import CardUpdatedStamp from "./components/CardUpdatedStamp";
import ResizeGrip from "./components/ResizeGrip";
import {
  VIZ_TYPE,
  SHARED_CHROME,
  buildWidgetHeaderClassName,
  getWidgetBodyClassName,
} from "./config/visualizationStyles";
import DashboardLogin, {
  hasDashboardSession,
  clearDashboardSession,
} from "./components/DashboardLogin";

import { useDashboardFilters } from "./hooks/useDashboardFilters";
import { useCatalog } from "./hooks/useCatalog";
import { useCatalogLayout, getDroppingItemForKpi, defaultSizeForKpi } from "./hooks/useCatalogLayout";
import { runKpiBatch, getTenantId } from "./services/analyticsService";
import { GRID_COLS, KPI_ROW_HEIGHT, DROPPING_ITEM, DROPPING_ITEM_ID } from "./constants/layoutConfig";

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

function pixelToGridPosition(containerWidth, clientX, clientY, gridRect, kpiId, kpis) {
  const { w, h } = defaultSizeForKpi(kpiId, kpis);
  const colWidth = (containerWidth - GRID_MARGIN[0] * (GRID_COLS + 1)) / GRID_COLS;
  const left = clientX - gridRect.left;
  const top = clientY - gridRect.top;
  let x = Math.round((left - GRID_MARGIN[0]) / (colWidth + GRID_MARGIN[0]));
  let y = Math.round((top - GRID_MARGIN[1]) / (KPI_ROW_HEIGHT + GRID_MARGIN[1]));
  x = Math.max(0, Math.min(GRID_COLS - w, x));
  y = Math.max(0, y);
  return { x, y };
}

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

    // Backend-composed cards may need their source KPIs (and daily series) in the batch.
    const compose = def.viz?.compose;
    if (compose?.sourceKpiIds?.length) {
      for (const srcId of compose.sourceKpiIds) {
        if (!refs[srcId]) refs[srcId] = { kpiId: srcId, params: { ...gp } };
        if (isSparklineKind(kind) && !refs[`${srcId}__series`]) {
          refs[`${srcId}__series`] = { kpiId: srcId, params: { ...gp, series: "daily" } };
        }
      }
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
    const composedSparkline =
      composedSlaComplianceSparkline(results, viz.compose) ??
      composedResolvedOverFiledSparkline(results, viz.compose);
    if (composedSparkline?.length) {
      assembled.sparkline = composedSparkline;
    } else {
      const seriesRes = results?.[`${kpiId}__series`];
      if (seriesRes?.rows?.length) {
        assembled.sparkline = seriesToPoints(seriesRes.rows, viz, valueKey, seriesRes.columns);
      }
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

/** Daily compliant ÷ (resolved + open past SLA) for composed SLA / on-time tiles. */
function composedSlaComplianceSparkline(results, compose) {
  if (compose?.type !== "slaComplianceRate" || !Array.isArray(compose.sourceKpiIds)) {
    return null;
  }
  const [compliantId, resolvedId, openBreachedId] = compose.sourceKpiIds;
  const compliantRows = results?.[`${compliantId}__series`]?.rows;
  const resolvedRows = results?.[`${resolvedId}__series`]?.rows;
  const openBreachedRows = results?.[`${openBreachedId}__series`]?.rows;
  if (!compliantRows?.length || !resolvedRows?.length) return null;

  const compliantByDate = new Map();
  for (const row of compliantRows) {
    const d = String(row.resolved_date ?? row.created_date ?? "");
    if (!d) continue;
    compliantByDate.set(d, Number(row.total) || 0);
  }
  const resolvedByDate = new Map();
  for (const row of resolvedRows) {
    const d = String(row.resolved_date ?? row.created_date ?? "");
    if (!d) continue;
    resolvedByDate.set(d, Number(row.total) || 0);
  }
  const openBreachedByDate = new Map();
  for (const row of openBreachedRows || []) {
    const d = String(row.created_date ?? "");
    if (!d) continue;
    openBreachedByDate.set(d, Number(row.total) || 0);
  }

  const dates = [
    ...new Set([
      ...compliantByDate.keys(),
      ...resolvedByDate.keys(),
      ...openBreachedByDate.keys(),
    ]),
  ].sort();
  return dates.map((d) => {
    const compliant = compliantByDate.get(d) || 0;
    const resolved = resolvedByDate.get(d) || 0;
    const openBreached = openBreachedByDate.get(d) || 0;
    const eligible = resolved + openBreached;
    return eligible === 0 ? 0 : compliant / eligible;
  });
}

/** Daily resolved ÷ filed sparkline for the composed resolution-rate tile. */
function composedResolvedOverFiledSparkline(results, compose) {
  if (compose?.type !== "resolvedOverFiledRate" || !Array.isArray(compose.sourceKpiIds)) {
    return null;
  }
  const [resolvedId, filedId] = compose.sourceKpiIds;
  const resolvedRows = results?.[`${resolvedId}__series`]?.rows;
  const filedRows = results?.[`${filedId}__series`]?.rows;
  if (!resolvedRows?.length || !filedRows?.length) return null;

  const resolvedByDate = new Map();
  for (const row of resolvedRows) {
    const d = String(row.resolved_date ?? row.created_date ?? "");
    if (!d) continue;
    resolvedByDate.set(d, Number(row.total) || 0);
  }
  const filedByDate = new Map();
  for (const row of filedRows) {
    const d = String(row.created_date ?? "");
    if (!d) continue;
    filedByDate.set(d, Number(row.total) || 0);
  }

  const dates = [...new Set([...resolvedByDate.keys(), ...filedByDate.keys()])].sort();
  return dates.map((d) => {
    const filed = filedByDate.get(d) || 0;
    const resolved = resolvedByDate.get(d) || 0;
    return filed === 0 ? 0 : resolved / filed;
  });
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
    gridSyncKey,
    onLayoutChange,
    onDragStop,
    onResizeStop,
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    visibleLayoutIds,
    findDragHoverTarget,
  } = useCatalogLayout(kpis, pack?.layout);

  const [searchQuery, setSearchQuery] = useState("");
  const [draggingWidgetId, setDraggingWidgetId] = useState(null);
  const draggingWidgetIdRef = useRef(null);
  const gridWrapRef = useRef(null);
  const externalDropLockRef = useRef(false);
  const postDropWidgetRef = useRef(null);
  const userDragWidgetRef = useRef(null);
  const dragSwapTargetRef = useRef(null);
  const dragOriginLayoutRef = useRef(null);
  const lastHoverTargetRef = useRef(null);
  const [isGridDragging, setIsGridDragging] = useState(false);

  const handleDragWidgetStart = useCallback((widgetId) => {
    draggingWidgetIdRef.current = widgetId;
    setDraggingWidgetId(widgetId);
    // #region agent log
    fetch('http://127.0.0.1:7630/ingest/ed402528-2e82-4433-9e5e-44ba3731c608',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2c7b3'},body:JSON.stringify({sessionId:'e2c7b3',location:'AdminDashboard.jsx:handleDragWidgetStart',message:'parent received external drag start',data:{widgetId},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
  }, []);

  const handleDragWidgetEnd = useCallback(() => {
    // #region agent log
    fetch('http://127.0.0.1:7630/ingest/ed402528-2e82-4433-9e5e-44ba3731c608',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2c7b3'},body:JSON.stringify({sessionId:'e2c7b3',location:'AdminDashboard.jsx:handleDragWidgetEnd',message:'external drag ended',data:{widgetId:draggingWidgetIdRef.current,layoutCount:layout.length},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    draggingWidgetIdRef.current = null;
    setDraggingWidgetId(null);
  }, [layout.length]);

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
      // #region agent log
      fetch('http://127.0.0.1:7630/ingest/ed402528-2e82-4433-9e5e-44ba3731c608',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2c7b3'},body:JSON.stringify({sessionId:'e2c7b3',runId:'post-fix',location:'AdminDashboard.jsx:handleWrapDrop',message:'external drop on grid wrapper',data:{widgetId,draggingRef:draggingWidgetIdRef.current},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
      // #endregion
      completeExternalDrop(widgetId, null, event.clientX, event.clientY);
    },
    [completeExternalDrop]
  );

  const handleGridDrop = useCallback(
    (gridLayout, item, event) => {
      const widgetId = event.dataTransfer.getData("text/plain");
      const position = item ? { x: item.x, y: item.y } : null;
      const clientX = event.nativeEvent?.clientX ?? event.clientX;
      const clientY = event.nativeEvent?.clientY ?? event.clientY;
      completeExternalDrop(widgetId, position, clientX, clientY);
    },
    [completeExternalDrop]
  );

  const handleDropDragOver = useCallback(() => {
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
    // #region agent log
    fetch('http://127.0.0.1:7630/ingest/ed402528-2e82-4433-9e5e-44ba3731c608',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2c7b3'},body:JSON.stringify({sessionId:'e2c7b3',location:'AdminDashboard.jsx:onDragStart',message:'internal grid drag started',data:{itemId:widgetId,from:{x:newItem?.x,y:newItem?.y}},timestamp:Date.now(),hypothesisId:'H5'})}).catch(()=>{});
    // #endregion
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
      Object.values(kpis)
        .filter((def) => !def.viz?.internal) // hide internal companion sources (e.g. map pins)
        .map((def) => ({
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
        setBatch((prev) => ({
          ...prev,
          loading: false,
          errors: { ...(prev.errors || {}), __batch: err?.message || "Batch query failed" },
          partial: true,
        }));
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
      onDragWidgetStart={handleDragWidgetStart}
      onDragWidgetEnd={handleDragWidgetEnd}
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
        <div
          ref={gridWrapRef}
          className={`${isExternalDrag ? "dashboard-external-drag" : ""}${
            isGridDragging ? " dashboard-grid-dragging" : ""
          }`.trim() || undefined}
          onDragOver={handleWrapDragOver}
          onDrop={handleWrapDrop}
        >
        <GridLayoutWithWidth
          key={gridSyncKey}
          className="dashboard-grid-layout layout"
          layout={gridLayout}
          cols={GRID_COLS}
          rowHeight={KPI_ROW_HEIGHT}
          margin={GRID_MARGIN}
          containerPadding={[0, 0]}
          compactType={null}
          allowOverlap={false}
          isDraggable
          isResizable
          isDroppable
          droppingItem={droppingItem}
          onDrop={handleGridDrop}
          onDropDragOver={handleDropDragOver}
          draggableHandle=".dashboard-widget-surface"
          draggableCancel=".dashboard-widget-remove-btn, .dashboard-view-toggle, .dashboard-table-scroll, .dashboard-chart-scroll-viewport, .dashboard-kpi-list-body, .leaflet-container, a, button, input, select, textarea"
          onLayoutChange={handleLayoutChange}
          onDragStart={handleInternalDragStart}
          onDrag={handleInternalDrag}
          onDragStop={handleDragStop}
          onResizeStop={handleResizeStop}
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
            return (
              <section
                key={item.i}
                className={`dashboard-widget-surface tw-group tw-relative tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-overflow-hidden tw-rounded tw-border tw-border-border tw-bg-surface${
                  isTable ? " dashboard-widget-table" : ""
                }${dimClass}`}
              >
                {removeBtn}
                {!selfHeaders && (
                  <header className={`${buildWidgetHeaderClassName(vizType)} tw-min-w-0`}>
                    <div className="tw-min-w-0 tw-flex-1">
                      <h2 className={`${SHARED_CHROME.dragHandleTitle} tw-truncate`}>
                        {viz.title || item.i}
                      </h2>
                      {viz.subtitle && (
                        <p className={SHARED_CHROME.dragHandleSubtitle}>{viz.subtitle}</p>
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
                  {renderTile(item.i)}
                </div>
                <CardUpdatedStamp label={lastUpdatedLabel} />
                <ResizeGrip />
              </section>
            );
          })}
        </GridLayoutWithWidth>
        </div>
      )}
    </DashboardLayout>
  );
};

export default AdminDashboard;
