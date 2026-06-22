import { useCallback, useRef, useState } from "react";
import { getLayoutStorageKey } from "../config/dashboardConfig";
import {
  DEFAULT_KPI_LAYOUT_ITEM,
  DEFAULT_LAYOUT,
  GRID_COLS,
  WIDGETS,
  getDefaultChartItem,
  getDefaultKpiLayoutItem,
  getChartTypeSizeConstraints,
  isHeightLockedChart,
  isKpiWidget,
  DEFAULT_CHART_LAYOUT,
} from "../constants/layoutConfig";
import { isSparklineKpi } from "../config/kpiSparkline";

/** Demo stacked bars always included in the default dashboard view. */
const DEFAULT_VIEW_STACKED_WIDGETS = new Set([
  "demo-viz-stacked",
  "demo-viz-stacked-horizontal",
]);

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                            */
/* -------------------------------------------------------------------------- */

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function overlapArea(a, b) {
  const xOverlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

function collidesAt(item, x, y, placed) {
  const candidate = { ...item, x, y };
  return placed.some((other) => rectsOverlap(candidate, other));
}

export function hasOverlaps(layout) {
  for (let i = 0; i < layout.length; i += 1) {
    for (let j = i + 1; j < layout.length; j += 1) {
      if (rectsOverlap(layout[i], layout[j])) return true;
    }
  }
  return false;
}

function layoutPositionsEqual(a, b) {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((item) => [item.i, item]));
  return a.every((item) => {
    const other = byId.get(item.i);
    return (
      other &&
      item.x === other.x &&
      item.y === other.y &&
      item.w === other.w &&
      item.h === other.h
    );
  });
}

/**
 * Compact every item upward in its own column to the lowest free row.
 * Items are placed in reading order (top-to-bottom, left-to-right) at the
 * first slot that doesn't collide with an already-placed item. This both
 * removes vertical gaps and resolves any overlaps (e.g. left after a swap or
 * after a card was enlarged) by stacking the colliding items downward.
 */
export function compactVertically(layout) {
  const sorted = [...layout]
    .map((item) => ({ ...item }))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const placed = [];
  for (const item of sorted) {
    let y = 0;
    while (collidesAt(item, item.x, y, placed)) y += 1;
    placed.push({ ...item, y });
  }
  return placed;
}

/**
 * Swap the dragged card with the card it was dropped onto.
 * The dragged card snaps to the displaced card's position, and the displaced
 * card moves to where the dragged card started. If the card was dropped on
 * empty space, nothing is swapped and the dragged card keeps its new position.
 */
export function swapOnDrop(layout, activeId, origin) {
  const dragged = layout.find((item) => item.i === activeId);
  if (!dragged) return layout;

  let target = null;
  let bestArea = 0;
  for (const item of layout) {
    if (item.i === activeId) continue;
    const area = overlapArea(dragged, item);
    if (area > bestArea) {
      bestArea = area;
      target = item;
    }
  }

  if (!target) return layout;

  const targetPos = { x: target.x, y: target.y };
  return layout.map((item) => {
    if (item.i === activeId) return { ...item, x: targetPos.x, y: targetPos.y };
    if (item.i === target.i) return { ...item, x: origin.x, y: origin.y };
    return item;
  });
}

/* -------------------------------------------------------------------------- */
/* Item normalization (only for newly added widgets)                          */
/* -------------------------------------------------------------------------- */

function normalizeKpiItem(item) {
  const defaults = getDefaultKpiLayoutItem(item.i);
  return {
    ...defaults,
    ...item,
    minW: item.minW ?? defaults.minW,
    minH: Math.max(item.minH ?? defaults.minH, defaults.minH),
    maxH: defaults.maxH ?? item.maxH ?? DEFAULT_KPI_LAYOUT_ITEM.maxH,
  };
}

function normalizeChartItem(item) {
  const defaults = DEFAULT_CHART_LAYOUT[item.i];
  if (!defaults) return item;
  const heightLocked = isHeightLockedChart(item.i);
  return {
    ...defaults,
    ...item,
    ...(heightLocked ? { h: defaults.h } : {}),
    minW: item.minW ?? defaults.minW,
    minH: heightLocked ? defaults.minH : (item.minH ?? defaults.minH),
    maxW: defaults.maxW ?? item.maxW,
    maxH: heightLocked ? defaults.maxH : (defaults.maxH ?? item.maxH),
  };
}

/* -------------------------------------------------------------------------- */
/* localStorage persistence                                                    */
/* -------------------------------------------------------------------------- */

const LEGACY_LAYOUT_VERSIONS = [
  "v20", "v19", "v18", "v17", "v16", "v15", "v14", "v13", "v12", "v11", "v10", "v9",
];

function getAllLayoutStorageKeys() {
  const currentKey = getLayoutStorageKey();
  const tenantPrefix = currentKey.replace(/-supervisor-dashboard-layout-v\d+$/, "");
  return [
    currentKey,
    ...LEGACY_LAYOUT_VERSIONS.map((v) => `${tenantPrefix}-supervisor-dashboard-layout-${v}`),
  ];
}

function readSavedLayoutRaw() {
  for (const key of getAllLayoutStorageKeys()) {
    const saved = localStorage.getItem(key);
    if (saved) return saved;
  }
  return null;
}

function persistLayout(layout) {
  localStorage.setItem(getLayoutStorageKey(), JSON.stringify(layout));
}

function clearSavedLayout() {
  for (const key of getAllLayoutStorageKeys()) {
    localStorage.removeItem(key);
  }
}

/** Add default stacked-bar demos when missing from a persisted layout. */
function mergeDefaultStackedWidgets(layout) {
  const existing = new Set(layout.map((item) => item.i));
  const missing = DEFAULT_LAYOUT.filter(
    (item) => DEFAULT_VIEW_STACKED_WIDGETS.has(item.i) && !existing.has(item.i)
  );
  if (!missing.length) return layout;
  return compactVertically([...layout, ...missing]);
}

/**
 * Load the saved layout exactly as it was persisted. No reflow, no repack, no
 * compaction, no merging of default widgets. The only processing is dropping
 * entries for widgets that no longer exist (so rendering can't crash) and, as a
 * safety net, repairing data that was saved with real overlaps (e.g. corrupt
 * layouts left by an older implementation). A clean saved layout is returned
 * untouched so the user's exact arrangement is preserved on refresh.
 */
function loadLayout() {
  try {
    const saved = readSavedLayoutRaw();
    if (!saved) return DEFAULT_LAYOUT;

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_LAYOUT;

    const valid = parsed.filter((item) => item && WIDGETS[item.i]);
    if (valid.length === 0) return DEFAULT_LAYOUT;

    const normalized = valid.map((item) => {
      if (isSparklineKpi(item.i)) {
        const defaults = getDefaultKpiLayoutItem(item.i);
        return {
          ...item,
          minH: defaults.minH,
          maxH: defaults.maxH,
        };
      }
      if (isHeightLockedChart(item.i)) {
        const defaults = DEFAULT_CHART_LAYOUT[item.i];
        const constraints = getChartTypeSizeConstraints(WIDGETS[item.i]?.type);
        return {
          ...item,
          h: defaults?.h ?? item.h,
          minH: constraints.minH ?? defaults?.minH ?? item.minH,
          maxH: constraints.maxH ?? defaults?.maxH ?? item.maxH,
          minW: constraints.minW ?? defaults?.minW ?? item.minW,
          maxW: constraints.maxW ?? defaults?.maxW ?? item.maxW,
        };
      }
      return item;
    });

    if (hasOverlaps(normalized)) {
      const repaired = compactVertically(normalized);
      const withStacked = mergeDefaultStackedWidgets(repaired);
      persistLayout(withStacked);
      return withStacked;
    }

    const withStacked = mergeDefaultStackedWidgets(normalized);
    if (withStacked.length > normalized.length) {
      persistLayout(withStacked);
    } else if (normalized.some((item, i) => item !== valid[i])) {
      persistLayout(normalized);
    }

    return withStacked;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/* -------------------------------------------------------------------------- */
/* Positioning for newly added KPI cards                                       */
/* -------------------------------------------------------------------------- */

function nextKpiPosition(layout) {
  const kpiItems = layout.filter((item) => isKpiWidget(item.i));
  if (kpiItems.length === 0) return { x: 0, y: 0 };

  const maxY = Math.max(...kpiItems.map((item) => item.y + item.h));
  const bottomRow = kpiItems.filter((item) => item.y + item.h === maxY);
  const usedWidth = bottomRow.reduce((sum, item) => sum + item.w, 0);

  if (usedWidth + DEFAULT_KPI_LAYOUT_ITEM.w <= GRID_COLS) {
    return { x: usedWidth, y: bottomRow[0].y };
  }
  return { x: 0, y: maxY };
}

/** Same post-drop pipeline as onDragStop: swap with overlapped card, then compact. */
function placeNewItemInLayout(prev, newItem) {
  const origin = { x: newItem.x, y: newItem.y };
  const swapped = swapOnDrop([...prev, newItem], newItem.i, origin);
  return compactVertically(swapped);
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

export function useDashboardLayout() {
  const [layout, setLayout] = useState(loadLayout);
  const intendedLayoutRef = useRef(null);
  const resyncGenerationRef = useRef(0);
  const layoutChangeCorrectionRef = useRef(false);

  /**
   * react-grid-layout keeps an internal copy of the layout and only re-syncs
   * from props when the new layout deep-differs (lodash isEqual) from the one
   * it last synced. After a drag that nets no positional change, our compacted
   * result is geometrically identical to the pre-drag layout, so RGL keeps its
   * stale internal copy with the dragged card left at its overlapping drop
   * position — that's the residual overlap.
   *
   * RGL clones layout items through `cloneLayoutItem`, which strips any custom
   * fields but preserves the standard `moved` flag. With `allowOverlap` enabled
   * RGL never runs compaction, so `moved` is inert. Toggling `moved` on every
   * layout we hand back therefore guarantees the deep-equality check fails and
   * RGL re-syncs to our clean state, without affecting positioning.
   */
  const syncFlagRef = useRef(false);
  const stampSync = useCallback((next) => {
    syncFlagRef.current = !syncFlagRef.current;
    const moved = syncFlagRef.current;
    return next.map((item) => ({ ...item, moved }));
  }, []);

  const applyLayout = useCallback(
    (next) => {
      persistLayout(next);
      setLayout(stampSync(next));
    },
    [stampSync]
  );

  /**
   * RGL (v1.3.4) calls onDragStop/onResizeStop before clearing its internal
   * `activeDrag` flag, and getDerivedStateFromProps skips prop-sync while that
   * flag is set. Push our compacted layout immediately, then again after two
   * animation frames once RGL has finished its own setState — without remounting
   * the grid (which re-initializes every chart).
   */
  const commitLayoutAfterInteraction = useCallback(
    (next) => {
      intendedLayoutRef.current = next;
      layoutChangeCorrectionRef.current = false;
      applyLayout(next);

      const generation = resyncGenerationRef.current + 1;
      resyncGenerationRef.current = generation;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (resyncGenerationRef.current !== generation) return;
          applyLayout(next);
        });
      });
    },
    [applyLayout]
  );

  /**
   * RGL fires onLayoutChange synchronously at the end of drag/resize stop with
   * its own (possibly overlapping) layout. If positions still differ from what
   * we computed, push our compacted layout one more time.
   */
  const onLayoutChange = useCallback(
    (rglLayout) => {
      const intended = intendedLayoutRef.current;
      if (!intended) return;

      if (layoutPositionsEqual(rglLayout, intended)) {
        intendedLayoutRef.current = null;
        layoutChangeCorrectionRef.current = false;
        return;
      }

      if (layoutChangeCorrectionRef.current) return;
      layoutChangeCorrectionRef.current = true;
      applyLayout(intended);
    },
    [applyLayout]
  );

  /**
   * react-grid-layout's native onDragStop. `oldItem` holds the card's position
   * before the drag (its origin); `newItem` holds where it was dropped.
   * Post-drop processing: swap resolution -> compact vertically -> persist.
   */
  const onDragStop = useCallback(
    (rglLayout, oldItem, newItem) => {
      if (!newItem) return;
      const origin = { x: oldItem.x, y: oldItem.y };
      const swapped = swapOnDrop(rglLayout, newItem.i, origin);
      const next = compactVertically(swapped);
      commitLayoutAfterInteraction(next);
    },
    [commitLayoutAfterInteraction]
  );

  /**
   * react-grid-layout's native onResizeStop. The resized card grew/shrank in
   * place (allowOverlap keeps everything else frozen during the resize).
   * On release: compact vertically (push cards below down / pull them up) -> persist.
   */
  const onResizeStop = useCallback(
    (rglLayout) => {
      const clamped = rglLayout.map((item) => {
        if (!isHeightLockedChart(item.i)) return item;
        const defaults = DEFAULT_CHART_LAYOUT[item.i];
        return { ...item, h: defaults?.h ?? item.h };
      });
      const next = compactVertically(clamped);
      commitLayoutAfterInteraction(next);
    },
    [commitLayoutAfterInteraction]
  );

  const resetLayout = useCallback(() => {
    clearSavedLayout();
    persistLayout(DEFAULT_LAYOUT);
    setLayout(stampSync(DEFAULT_LAYOUT));
  }, [stampSync]);

  const removeWidgetFromLayout = useCallback(
    (widgetId) => {
      setLayout((prev) => {
        const next = compactVertically(prev.filter((item) => item.i !== widgetId));
        persistLayout(next);
        return stampSync(next);
      });
    },
    [stampSync]
  );

  const addKpiToLayout = useCallback(
    (widgetId, position) => {
      if (!isKpiWidget(widgetId)) return;
      setLayout((prev) => {
        if (prev.some((item) => item.i === widgetId)) return prev;

        const fallback = nextKpiPosition(prev);
        const newItem = normalizeKpiItem({
          i: widgetId,
          x: position?.x ?? fallback.x,
          y: position?.y ?? fallback.y,
        });

        const next = placeNewItemInLayout(prev, newItem);
        persistLayout(next);
        return stampSync(next);
      });
    },
    [stampSync]
  );

  const addWidgetToLayout = useCallback(
    (widgetId, position) => {
      if (!WIDGETS[widgetId]) return;

      if (isKpiWidget(widgetId)) {
        addKpiToLayout(widgetId, position);
        return;
      }

      setLayout((prev) => {
        if (prev.some((item) => item.i === widgetId)) return prev;

        const defaultItem = getDefaultChartItem(widgetId);
        if (!defaultItem) return prev;

        const newItem = normalizeChartItem({
          ...defaultItem,
          ...(position && { x: position.x, y: position.y }),
        });

        const next = placeNewItemInLayout(prev, newItem);
        persistLayout(next);
        return stampSync(next);
      });
    },
    [addKpiToLayout, stampSync]
  );

  const visibleLayoutIds = layout.map((item) => item.i);
  const visibleKpiIds = layout.filter((item) => isKpiWidget(item.i)).map((item) => item.i);

  return {
    layout,
    onDragStop,
    onResizeStop,
    onLayoutChange,
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    addWidgetToLayout,
    visibleLayoutIds,
    visibleKpiIds,
  };
}
