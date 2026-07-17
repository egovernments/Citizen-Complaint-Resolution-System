import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GRID_COLS,
  UNIFORM_CHART_SIZE_CONSTRAINTS,
  MAP_SIZE_CONSTRAINTS,
  FULL_WIDTH_TABLE_GRID,
  findFirstOpenPosition,
} from "../constants/layoutConfig";
import { compactVertically } from "../utils/gridGeometry";

/**
 * useCatalogLayout — the catalog-world layout hook (kpiId-keyed).
 *
 * The legacy useDashboardLayout is keyed on dash-case widget-ids and carries a
 * decade of migration/legacy-id machinery for the inline-query dashboard. The
 * inverted dashboard renders straight from the MDMS catalog (snake_case kpiIds)
 * and seeds its grid from the DashboardPack layout, so it gets a fresh, far
 * smaller hook that speaks kpiIds and reuses only the pure geometry/collision
 * helpers (GRID_COLS, findFirstOpenPosition, compactVertically, swapOnDrop).
 *
 * Inputs:
 *   kpis        — { [kpiId]: def }  (catalog map; used for size-constraint by viz.kind)
 *   packLayout  — [{ kpiId, x, y, w, h }]  (DashboardPack defaultLayout — the seed)
 *
 * Returns the same interaction surface AdminDashboard's grid expects:
 *   { layout, onDragStop, onResizeStop, onLayoutChange, resetLayout,
 *     removeWidgetFromLayout, addKpiToLayout, visibleLayoutIds }
 * where every layout item.i is a kpiId.
 */

const STORAGE_KEY = "ccrs.dashboard.catalog-layout.v1";

const CARD_KINDS = new Set([
  "number-tile-delta",
  "number-tile",
  "scalar",
  "number-tile-sparkline",
  "sparkline-card",
]);

const KPI_CARD_CONSTRAINTS = { minW: 2, minH: 2, maxW: 6, maxH: 3 };
const LIST_CONSTRAINTS = { minW: 3, minH: 4, maxW: 12, maxH: 12 };

/** Map a tile's viz.kind to its grid size constraints (the single id-space seam). */
export function sizeConstraintsForKpi(kpiId, kpis) {
  const kind = kpis?.[kpiId]?.viz?.kind;
  if (CARD_KINDS.has(kind)) return KPI_CARD_CONSTRAINTS;
  switch (kind) {
    case "map":
    case "choropleth-map":
      return MAP_SIZE_CONSTRAINTS;
    case "sla-risk-table":
    case "table":
    case "data-table":
      return {
        minW: FULL_WIDTH_TABLE_GRID.minW,
        minH: FULL_WIDTH_TABLE_GRID.minH,
        maxW: FULL_WIDTH_TABLE_GRID.maxW,
        maxH: FULL_WIDTH_TABLE_GRID.maxH,
      };
    case "rankedList":
    case "dow":
      return LIST_CONSTRAINTS;
    default:
      return UNIFORM_CHART_SIZE_CONSTRAINTS; // bar / stacked-bar / horizontal-bar / line / pie
  }
}

/** Default size for a freshly-added tile, by kind. */
function defaultSizeForKpi(kpiId, kpis) {
  const c = sizeConstraintsForKpi(kpiId, kpis);
  const kind = kpis?.[kpiId]?.viz?.kind;
  if (CARD_KINDS.has(kind)) return { w: 2, h: 2 };
  if (kind === "map") return { w: 8, h: 6 };
  if (kind === "sla-risk-table" || kind === "table" || kind === "data-table")
    return { w: 12, h: 5 };
  return { w: Math.max(c.minW, 6), h: Math.max(c.minH, 6) };
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Normalise a layout item to finite, in-bounds geometry. A malformed MDMS pack
 * or stale localStorage entry can carry NaN / out-of-range w/h/x/y; RGL throws or
 * produces impossible resize bounds on those, so clamp every field to the tile's
 * viz.kind constraints and the grid width. Item must already carry `i` (kpiId).
 */
function normalizeItem(item, kpis) {
  const c = sizeConstraintsForKpi(item.i, kpis);
  const w = clampNum(item.w, c.minW, c.maxW, c.minW);
  const h = clampNum(item.h, c.minH, c.maxH, c.minH);
  const x = Math.min(clampNum(item.x, 0, GRID_COLS - 1, 0), GRID_COLS - w);
  const y = clampNum(item.y, 0, Number.MAX_SAFE_INTEGER, 0);
  return { i: item.i, x, y, w, h, ...c };
}

/** Seed layout from the pack, normalised, kpiId-keyed. */
function buildSeedLayout(packLayout, kpis) {
  return (packLayout || [])
    .filter((item) => kpis[item.kpiId])
    .map((item) =>
      normalizeItem({ i: item.kpiId, x: item.x, y: item.y, w: item.w, h: item.h }, kpis)
    );
}

/**
 * Read the saved layout. Returns `null` ONLY when there is no stored layout (key
 * absent / unparseable); an intentionally-empty array (user cleared every tile)
 * is returned as `[]` so the seed does not re-add the removed tiles on reload.
 */
function readSaved() {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persist(layout) {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* ignore quota/serialisation errors — layout is non-critical state */
  }
}

export function useCatalogLayout(kpis, packLayout) {
  const seed = useMemo(() => buildSeedLayout(packLayout, kpis), [packLayout, kpis]);

  const [layout, setLayout] = useState([]);

  // Seed once the catalog + pack resolve. Prefer a SAVED layout (the user's
  // arrangement, including an intentional empty one) over the pack seed; drop
  // tiles the role can no longer see and re-normalise geometry so a viz.kind
  // change or a malformed entry can't leave a stale/invalid clamp. Only seeds
  // from the pack when there is no saved layout at all (saved === null). A saved
  // layout is taken as-is — newly-published pack tiles are added via the picker
  // or a layout reset, not auto-injected.
  useEffect(() => {
    if (!seed.length) return;
    const saved = readSaved();
    const source = saved !== null ? saved : seed;
    const reconciled = source
      .filter((item) => kpis[item.i])
      .map((item) => normalizeItem(item, kpis));
    setLayout(reconciled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // Debounced persistence — onLayoutChange fires on every drag/resize tick.
  const persistTimerRef = useRef(null);
  const persistDebounced = useCallback((lay) => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => persist(lay), 300);
  }, []);

  /**
   * The single source of layout truth during interaction. With compactType=
   * "vertical" (set on the grid), react-grid-layout owns collision + compaction:
   * dragging a tile pushes the others and the layout RGL emits here is already the
   * flowed, non-overlapping result. We accept it verbatim — re-merging only the
   * per-item min/max constraints RGL strips — and feed it straight back as the
   * controlled prop. Because the prop we return equals RGL's internal state,
   * getDerivedStateFromProps never has a stale copy to discard, so there is no
   * snap-back (this replaces the old swapOnDrop + compactVertically + rAF/moved
   * machinery that fought RGL's controlled-sync model).
   */
  const onLayoutChange = useCallback(
    (next) => {
      setLayout((prev) => {
        const merged = next.map((item) => {
          const existing = prev.find((p) => p.i === item.i);
          return existing
            ? { ...existing, x: item.x, y: item.y, w: item.w, h: item.h }
            : item;
        });
        persistDebounced(merged);
        return merged;
      });
    },
    [persistDebounced]
  );

  const removeWidgetFromLayout = useCallback(
    (kpiId) => {
      setLayout((prev) => {
        const next = compactVertically(prev.filter((item) => item.i !== kpiId));
        persist(next);
        return next;
      });
    },
    []
  );

  const addKpiToLayout = useCallback(
    (kpiId, position) => {
      if (!kpis[kpiId]) return;
      setLayout((prev) => {
        if (prev.some((item) => item.i === kpiId)) return prev; // no duplicates
        const c = sizeConstraintsForKpi(kpiId, kpis);
        const { w, h } = defaultSizeForKpi(kpiId, kpis);
        const pos = position || findFirstOpenPosition(prev, w, h, GRID_COLS);
        const next = compactVertically([
          ...prev,
          { i: kpiId, x: pos.x, y: pos.y, w, h, ...c },
        ]);
        persist(next);
        return next;
      });
    },
    [kpis]
  );

  const resetLayout = useCallback(() => {
    const fresh = buildSeedLayout(packLayout, kpis);
    setLayout(fresh);
    persist(fresh);
  }, [packLayout, kpis]);

  const visibleLayoutIds = useMemo(() => layout.map((item) => item.i), [layout]);

  return {
    layout,
    onLayoutChange, // RGL (compactType="vertical") drives drag/resize natively
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    addWidgetToLayout: addKpiToLayout, // charts + cards share one add path now
    visibleLayoutIds,
  };
}

export default useCatalogLayout;
