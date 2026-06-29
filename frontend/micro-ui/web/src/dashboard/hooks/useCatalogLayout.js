import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GRID_COLS,
  UNIFORM_CHART_SIZE_CONSTRAINTS,
  MAP_SIZE_CONSTRAINTS,
  FULL_WIDTH_TABLE_GRID,
  findFirstOpenPosition,
} from "../constants/layoutConfig";
import { compactVertically, swapOnDrop } from "./useDashboardLayout";

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

/** Seed layout from the pack, clamped to the constraints, kpiId-keyed. */
function buildSeedLayout(packLayout, kpis) {
  return (packLayout || [])
    .filter((item) => kpis[item.kpiId])
    .map((item) => {
      const c = sizeConstraintsForKpi(item.kpiId, kpis);
      return {
        i: item.kpiId,
        x: item.x ?? 0,
        y: item.y ?? 0,
        w: item.w ?? c.minW,
        h: item.h ?? c.minH,
        ...c,
      };
    });
}

function readSaved() {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
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

  // Seed once the catalog + pack resolve. Re-key a saved layout against the
  // current catalog (drop tiles the role can no longer see) and re-apply the
  // current size constraints so a viz.kind change can't leave a stale clamp.
  useEffect(() => {
    if (!seed.length) return;
    const saved = readSaved();
    const source = saved || seed;
    const reconciled = source
      .filter((item) => kpis[item.i])
      .map((item) => ({ ...item, ...sizeConstraintsForKpi(item.i, kpis) }));
    setLayout(reconciled.length ? reconciled : seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const commit = useCallback((next) => {
    const compacted = compactVertically(next);
    setLayout(compacted);
    persist(compacted);
  }, []);

  const onLayoutChange = useCallback(
    (next) => {
      // RGL fires layoutChange with stripped items (no constraints); re-merge the
      // per-item min/max from the current state so resize bounds survive.
      setLayout((prev) =>
        next.map((item) => {
          const existing = prev.find((p) => p.i === item.i);
          return existing ? { ...existing, x: item.x, y: item.y, w: item.w, h: item.h } : item;
        })
      );
    },
    []
  );

  const onDragStop = useCallback(
    (next, oldItem, newItem) => {
      // Swap-on-collision (mirrors the legacy grid): if the dragged tile lands on
      // another, swap their slots, else accept the new positions.
      const swapped = swapOnDrop(next, newItem.i, oldItem);
      commit(swapped);
    },
    [commit]
  );

  const onResizeStop = useCallback(
    (next) => {
      commit(next);
    },
    [commit]
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
    onDragStop,
    onResizeStop,
    onLayoutChange,
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    addWidgetToLayout: addKpiToLayout, // charts + cards share one add path now
    visibleLayoutIds,
  };
}

export default useCatalogLayout;
