import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GRID_COLS,
  UNIFORM_CHART_SIZE_CONSTRAINTS,
  MAP_SIZE_CONSTRAINTS,
  FULL_WIDTH_TABLE_GRID,
  DEFAULT_CHART_GRID,
  DROPPING_ITEM_ID,
} from "../constants/layoutConfig";
import { createCatalogDragGeometry, isCatalogCard } from "../utils/catalogDragGeometry";

/**
 * useCatalogLayout — catalog-world layout hook (kpiId-keyed).
 *
 * Drag/resize behaviour ported from useDashboardLayout.js @ 482143e34:
 * allowOverlap=false during drag, hover-target tracking in AdminDashboard,
 * swap + column-aware compaction on stop, RGL re-sync via moved flag.
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
      return UNIFORM_CHART_SIZE_CONSTRAINTS;
  }
}

export function defaultSizeForKpi(kpiId, kpis) {
  const kind = kpis?.[kpiId]?.viz?.kind;
  if (CARD_KINDS.has(kind)) return { w: 2, h: 2 };
  if (kind === "map" || kind === "choropleth-map") return { w: 8, h: 6 };
  if (kind === "sla-risk-table" || kind === "table" || kind === "data-table") {
    return { w: FULL_WIDTH_TABLE_GRID.w, h: FULL_WIDTH_TABLE_GRID.h };
  }
  if (kind === "rankedList" || kind === "dow") {
    return { w: 6, h: 6 };
  }
  return { ...DEFAULT_CHART_GRID };
}

export function getDroppingItemForKpi(kpiId, kpis) {
  const c = sizeConstraintsForKpi(kpiId, kpis);
  const { w, h } = defaultSizeForKpi(kpiId, kpis);
  return { i: DROPPING_ITEM_ID, w, h, x: 0, y: 0, ...c };
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeItem(item, kpis) {
  const c = sizeConstraintsForKpi(item.i, kpis);
  const w = clampNum(item.w, c.minW, c.maxW, c.minW);
  const h = clampNum(item.h, c.minH, c.maxH, c.minH);
  const x = Math.min(clampNum(item.x, 0, GRID_COLS - 1, 0), GRID_COLS - w);
  const y = clampNum(item.y, 0, Number.MAX_SAFE_INTEGER, 0);
  return { i: item.i, x, y, w, h, ...c };
}

function buildSeedLayout(packLayout, kpis) {
  return (packLayout || [])
    .filter((item) => kpis[item.kpiId])
    .map((item) =>
      normalizeItem({ i: item.kpiId, x: item.x, y: item.y, w: item.w, h: item.h }, kpis)
    );
}

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

function persistPositions(layout) {
  try {
    window.localStorage?.setItem(
      STORAGE_KEY,
      JSON.stringify(layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })))
    );
  } catch {
    /* ignore */
  }
}

/** Re-attach min/max constraints after geometry helpers strip them to positions only. */
function canonicalizeLayout(layout, kpis) {
  return (layout || [])
    .filter((item) => item?.i && kpis[item.i])
    .map((item) =>
      normalizeItem(
        { i: item.i, x: item.x, y: item.y, w: item.w, h: item.h },
        kpis
      )
    );
}

function persist(layout) {
  persistPositions(layout);
}

export function useCatalogLayout(kpis, packLayout) {
  const seed = useMemo(() => buildSeedLayout(packLayout, kpis), [packLayout, kpis]);
  const geom = useMemo(() => createCatalogDragGeometry(kpis), [kpis]);

  const [layout, setLayout] = useState([]);
  const [gridSyncKey, setGridSyncKey] = useState(0);
  const layoutRef = useRef(layout);
  const intendedLayoutRef = useRef(null);
  const resyncGenerationRef = useRef(0);
  const layoutChangeCorrectionRef = useRef(false);
  const desyncCorrectionRef = useRef(false);

  layoutRef.current = layout;

  useEffect(() => {
    if (!seed.length) return;
    const saved = readSaved();
    const source = saved !== null ? saved : seed;
    const reconciled = source
      .filter((item) => kpis[item.i])
      .map((item) => normalizeItem(item, kpis));
    const repaired = geom.hasOverlaps(reconciled)
      ? geom.resolveRemainingOverlaps(reconciled, [])
      : reconciled;
    setLayout(repaired);
    if (repaired !== reconciled) persist(repaired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, geom]);

  const syncFlagRef = useRef(false);
  const stampSync = useCallback((next) => {
    syncFlagRef.current = !syncFlagRef.current;
    const moved = syncFlagRef.current;
    return next.map((item) => ({ ...item, moved }));
  }, []);

  const applyLayout = useCallback(
    (next) => {
      const normalized = canonicalizeLayout(next, kpis);
      persistPositions(normalized);
      setLayout(stampSync(normalized));
    },
    [stampSync, kpis]
  );

  const commitLayoutWithReflow = useCallback(
    (next, reflowItemIds = null) => {
      const normalized = canonicalizeLayout(next, kpis);
      const positions = geom.stripLayoutPositions(normalized);
      intendedLayoutRef.current = positions;
      layoutChangeCorrectionRef.current = false;

      const nudged = geom.nudgeLayoutForReflow(normalized, reflowItemIds);
      const didNudge = !geom.layoutPositionsEqual(
        geom.stripLayoutPositions(nudged),
        positions
      );

      applyLayout(didNudge ? nudged : normalized);

      const generation = resyncGenerationRef.current + 1;
      resyncGenerationRef.current = generation;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (resyncGenerationRef.current !== generation) return;
          applyLayout(normalized);
          layoutChangeCorrectionRef.current = false;
          if (!geom.layoutPositionsEqual(layoutRef.current, normalized)) {
            setGridSyncKey((key) => key + 1);
          }
        });
      });
    },
    [applyLayout, geom, kpis]
  );

  const commitLayoutAfterInteraction = useCallback(
    (next, reflowItemIds = null) => {
      if (reflowItemIds?.length) {
        commitLayoutWithReflow(next, reflowItemIds);
        return;
      }
      let normalized = canonicalizeLayout(next, kpis);
      let positions = geom.stripLayoutPositions(normalized);
      intendedLayoutRef.current = positions;
      layoutChangeCorrectionRef.current = false;
      if (geom.hasOverlaps(positions)) {
        normalized = canonicalizeLayout(
          geom.resolveRemainingOverlaps(positions, []),
          kpis
        );
        positions = geom.stripLayoutPositions(normalized);
        intendedLayoutRef.current = positions;
      }
      applyLayout(normalized);

      const generation = resyncGenerationRef.current + 1;
      resyncGenerationRef.current = generation;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (resyncGenerationRef.current !== generation) return;
          applyLayout(normalized);
          layoutChangeCorrectionRef.current = false;
        });
      });
    },
    [applyLayout, commitLayoutWithReflow, geom, kpis]
  );

  const commitInventoryDrop = useCallback(
    (next) => {
      const normalized = canonicalizeLayout(next, kpis);
      intendedLayoutRef.current = geom.stripLayoutPositions(normalized);
      layoutChangeCorrectionRef.current = false;
      applyLayout(normalized);

      const generation = resyncGenerationRef.current + 1;
      resyncGenerationRef.current = generation;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (resyncGenerationRef.current !== generation) return;
          applyLayout(normalized);
          layoutChangeCorrectionRef.current = false;
        });
      });
    },
    [applyLayout, geom, kpis]
  );

  const onLayoutChange = useCallback(
    (rglLayout) => {
      const intended = intendedLayoutRef.current;
      const canonical = geom.stripLayoutPositions(layoutRef.current);

      if (intended) {
        if (geom.layoutPositionsEqual(rglLayout, intended)) {
          intendedLayoutRef.current = null;
          layoutChangeCorrectionRef.current = false;
          return;
        }

        if (layoutChangeCorrectionRef.current) return;
        layoutChangeCorrectionRef.current = true;
        applyLayout(intended);
        return;
      }

      if (
        geom.hasOverlaps(rglLayout) &&
        !geom.hasOverlaps(canonical) &&
        !geom.layoutPositionsEqual(rglLayout, canonical) &&
        !desyncCorrectionRef.current
      ) {
        desyncCorrectionRef.current = true;
        intendedLayoutRef.current = canonical;
        applyLayout(canonical);
        requestAnimationFrame(() => {
          desyncCorrectionRef.current = false;
        });
      }
    },
    [applyLayout, geom]
  );

  const onDragStop = useCallback(
    (rglLayout, oldItem, newItem, hoverTargetId = null, originLayout = null) => {
      if (!newItem) return;
      const origin = { x: oldItem.x, y: oldItem.y };
      const originItem = originLayout?.find((item) => item.i === newItem.i) ?? oldItem;
      const swappedTarget = geom.resolveSwapTarget(
        originLayout ?? rglLayout,
        newItem,
        newItem.i,
        hoverTargetId,
        originItem
      );
      const didSwap = Boolean(swappedTarget);
      const resolved = geom.applyDragResult(
        rglLayout,
        newItem.i,
        origin,
        newItem,
        hoverTargetId,
        originLayout
      );
      const next = geom.finalizeAfterDrag(
        resolved,
        newItem.i,
        didSwap,
        origin,
        swappedTarget
      );
      const repaired = geom.hasOverlaps(next)
        ? geom.resolveRemainingOverlaps(next, [
            newItem.i,
            ...geom.getPinnedKpiIds(next),
          ])
        : next;
      const movedItem = repaired.find((item) => item.i === newItem.i) ?? newItem;
      const isKpi = isCatalogCard(newItem.i, kpis);
      const dropBelow =
        isKpi && geom.isDropBelowKpiBand(repaired, movedItem, newItem.i, origin);
      const vacatedTop = geom.vacatedTopBandSlot(origin);
      const gapFillPins = [
        ...new Set([
          ...(isKpi ? [newItem.i] : []),
          ...geom.getPinnedKpiIds(repaired),
        ]),
      ];
      const landsInTop = geom.vacatedTopBandSlot(movedItem);
      const shouldPackTop = isKpi && (vacatedTop || landsInTop);
      const packKpiPin = shouldPackTop && !dropBelow ? newItem.i : null;
      let filled;
      if (isKpi && dropBelow && !vacatedTop) {
        filled = repaired;
      } else if (isKpi) {
        filled = geom.compactGapsUpward(repaired, gapFillPins, {
          packKpis: shouldPackTop,
          packKpiPin,
        });
      } else {
        const colStart = Math.min(origin.x, movedItem.x);
        const colEnd = Math.min(
          GRID_COLS,
          Math.max(origin.x + oldItem.w, movedItem.x + movedItem.w)
        );
        filled = geom.compactGapsUpward(
          repaired,
          [...gapFillPins, newItem.i],
          { packKpis: false, colStart, colEnd }
        );
      }
      commitLayoutAfterInteraction(filled);
    },
    [commitLayoutAfterInteraction, geom, kpis]
  );

  const onResizeStop = useCallback(
    (rglLayout, _oldItem, newItem) => {
      let next = newItem
        ? geom.compactVertically(rglLayout, newItem.i)
        : rglLayout;
      if (newItem) {
        const pinIds = [
          ...new Set([newItem.i, ...geom.getPinnedKpiIds(next)]),
        ];
        next = geom.compactGapsUpward(next, pinIds);
      }
      commitLayoutAfterInteraction(next, newItem ? [newItem.i] : null);
    },
    [commitLayoutAfterInteraction, geom]
  );

  const resetLayout = useCallback(() => {
    const fresh = geom.compactGapsUpward(buildSeedLayout(packLayout, kpis), []);
    intendedLayoutRef.current = null;
    layoutChangeCorrectionRef.current = false;
    desyncCorrectionRef.current = false;
    applyLayout(fresh);
    setGridSyncKey((key) => key + 1);
  }, [applyLayout, geom, packLayout, kpis]);

  const removeWidgetFromLayout = useCallback(
    (kpiId) => {
      const prev = layoutRef.current;
      const removed = prev.find((item) => item.i === kpiId);
      const without = prev.filter((item) => item.i !== kpiId);
      let next = without;
      if (removed) {
        const pinIds = geom.getPinnedKpiIds(without);
        next = geom.finalizeLocalCompaction(without, [removed], pinIds);
      }
      applyLayout(next);
    },
    [applyLayout, geom]
  );

  const addKpiToLayout = useCallback(
    (kpiId, position) => {
      if (!kpis[kpiId]) return;
      const prev = layoutRef.current;
      if (prev.some((item) => item.i === kpiId)) return;

      const c = sizeConstraintsForKpi(kpiId, kpis);
      const { w, h } = defaultSizeForKpi(kpiId, kpis);
      const dropPosition =
        position != null && (position.x != null || position.y != null)
          ? { x: position.x, y: position.y }
          : undefined;

      const newItem = normalizeItem(
        {
          i: kpiId,
          x: dropPosition?.x ?? 0,
          y: dropPosition?.y ?? 0,
          w,
          h,
        },
        kpis
      );

      const hasExplicitDrop =
        dropPosition != null &&
        dropPosition.x != null &&
        dropPosition.y != null;

      let next;
      if (hasExplicitDrop) {
        next = geom.applyExplicitDrop(prev, newItem);
      } else {
        next = geom.finalizeAfterAdd(geom.placeNewItemInLayout(prev, newItem));
      }
      if (geom.hasOverlaps(next)) {
        next = geom.resolveRemainingOverlaps(next, [kpiId]);
      }
      commitInventoryDrop(next);
    },
    [commitInventoryDrop, geom, kpis]
  );

  const visibleLayoutIds = useMemo(() => layout.map((item) => item.i), [layout]);

  return {
    layout,
    gridSyncKey,
    onLayoutChange,
    onDragStop,
    onResizeStop,
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    addWidgetToLayout: addKpiToLayout,
    visibleLayoutIds,
    findDragHoverTarget: geom.findDragHoverTarget,
  };
}

export default useCatalogLayout;
