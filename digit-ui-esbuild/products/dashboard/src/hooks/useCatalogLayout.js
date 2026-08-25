import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GRID_COLS, DROPPING_ITEM_ID } from "../constants/layoutConfig";
import { getEmployeeInfo, getTenantId } from "../services/authService";
import { isPublicDashboardRuntime } from "../services/dashboardRuntime";
import { createCatalogDragGeometry, isCatalogCard } from "../utils/catalogDragGeometry";
import {
  storageKeyFor,
  publicStorageKeyFor,
  readSavedLayout,
  persistLayout,
  buildSeedLayout,
  normalizeItem,
  resolveInitialLayout,
  sizeConstraintsForKpi,
  defaultSizeForKpi,
} from "../utils/layoutStore";

/**
 * useCatalogLayout — catalog-world layout hook (kpiId-keyed).
 *
 * Drag/resize behaviour ported from useDashboardLayout.js @ 482143e34:
 * allowOverlap=false during drag, hover-target tracking in AdminDashboard,
 * swap + column-aware compaction on stop, RGL re-sync via moved flag.
 */

export { sizeConstraintsForKpi, defaultSizeForKpi };

export function getDroppingItemForKpi(kpiId, kpis) {
  const c = sizeConstraintsForKpi(kpiId, kpis);
  const { w, h } = defaultSizeForKpi(kpiId, kpis);
  return { i: DROPPING_ITEM_ID, w, h, x: 0, y: 0, ...c };
}

function scopedStorageKey() {
  if (isPublicDashboardRuntime()) return publicStorageKeyFor(getTenantId());
  return storageKeyFor(getTenantId(), getEmployeeInfo()?.uuid);
}

function readSaved() {
  return readSavedLayout(window.localStorage, scopedStorageKey());
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
  persistLayout(window.localStorage, scopedStorageKey(), layout);
}

export function useCatalogLayout(kpis, packLayout, { persistent = true } = {}) {
  const seed = useMemo(() => buildSeedLayout(packLayout, kpis), [packLayout, kpis]);
  const geom = useMemo(() => createCatalogDragGeometry(kpis), [kpis]);
  const catalogReady = Object.keys(kpis || {}).length > 0;

  const [layout, setLayout] = useState([]);
  const [gridSyncKey, setGridSyncKey] = useState(0);
  const layoutRef = useRef(layout);
  const intendedLayoutRef = useRef(null);
  const resyncGenerationRef = useRef(0);
  const layoutChangeCorrectionRef = useRef(false);
  const desyncCorrectionRef = useRef(false);

  layoutRef.current = layout;

  useEffect(() => {
    if (!catalogReady) return;
    const saved = persistent ? readSaved() : null;
    const reconciled = resolveInitialLayout(saved, seed, kpis);
    const repaired = geom.hasOverlaps(reconciled)
      ? geom.resolveRemainingOverlaps(reconciled, [])
      : reconciled;
    setLayout(repaired);
    if (persistent && repaired !== reconciled) persist(repaired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, catalogReady, geom, persistent]);

  const syncFlagRef = useRef(false);
  const stampSync = useCallback((next) => {
    syncFlagRef.current = !syncFlagRef.current;
    const moved = syncFlagRef.current;
    return next.map((item) => ({ ...item, moved }));
  }, []);

  const applyLayout = useCallback(
    (next) => {
      const normalized = canonicalizeLayout(next, kpis);
      if (persistent) persist(normalized);
      setLayout(stampSync(normalized));
    },
    [stampSync, kpis, persistent]
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
