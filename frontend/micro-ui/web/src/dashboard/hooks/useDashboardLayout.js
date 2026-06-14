import { useCallback, useRef, useState } from "react";
import { getLayoutStorageKey } from "../config/dashboardConfig";
import {
  DEFAULT_CHART_LAYOUT,
  DEFAULT_KPI_LAYOUT_ITEM,
  DEFAULT_LAYOUT,
  GRID_COLS,
  TOP_ROW_CHART_IDS,
  WIDGETS,
  getDefaultChartItem,
  getDefaultKpiLayoutItem,
  isChartWidget,
  isKpiWidget,
} from "../constants/layoutConfig";

function itemsOverlap(a, b) {
  if (a.i === b.i) return false;
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function hasOverlaps(layout) {
  for (let i = 0; i < layout.length; i += 1) {
    for (let j = i + 1; j < layout.length; j += 1) {
      if (itemsOverlap(layout[i], layout[j])) return true;
    }
  }
  return false;
}

/** True if `item` at (x, y) overlaps any item in `placed`. */
function collidesAt(item, x, y, placed, excludeId = null) {
  if (x < 0 || y < 0 || x + item.w > GRID_COLS) return true;
  const candidate = { ...item, x, y };
  return placed.some((other) => other.i !== excludeId && itemsOverlap(candidate, other));
}

/**
 * Move each widget up as far as possible (fixed column) to remove vertical gaps.
 * When `excludeId` is set (during drag), that item keeps its current position.
 */
export function compactLayoutVertically(layout, excludeId = null) {
  const sorted = [...layout]
    .map((item) => ({ ...item }))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const compacted = [];

  for (const item of sorted) {
    if (item.i === excludeId) {
      compacted.push({ ...item });
      continue;
    }

    let targetY = item.y;
    for (let y = 0; y <= item.y; y += 1) {
      if (!collidesAt(item, item.x, y, compacted, item.i)) {
        targetY = y;
        break;
      }
    }
    compacted.push({ ...item, y: targetY });
  }

  return compacted;
}

/** Pack widgets left within each shared row (same y). */
function packRowsHorizontal(layout, filter = () => true) {
  const targets = layout.filter(filter);
  const others = layout.filter((item) => !filter(item));

  const rows = new Map();
  for (const item of targets) {
    const row = rows.get(item.y) ?? [];
    row.push(item);
    rows.set(item.y, row);
  }

  const packed = [];
  for (const [y, row] of rows) {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    let x = 0;
    for (const item of sorted) {
      packed.push({ ...item, x, y });
      x += item.w;
    }
  }

  return [...others, ...packed];
}

/** Pack KPI cards into tight rows (left-aligned, wrap at 12 cols). Fills horizontal gaps. */
export function packKpiLayout(layout) {
  const kpis = layout
    .filter((item) => isKpiWidget(item.i))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const nonKpis = layout.filter((item) => !isKpiWidget(item.i));

  const packed = [];
  let x = 0;
  let y = 0;
  let rowMaxH = DEFAULT_KPI_LAYOUT_ITEM.h;

  for (const item of kpis) {
    const w = item.w ?? DEFAULT_KPI_LAYOUT_ITEM.w;
    const h = item.h ?? DEFAULT_KPI_LAYOUT_ITEM.h;

    if (x > 0 && x + w > GRID_COLS) {
      y += rowMaxH;
      x = 0;
      rowMaxH = h;
    }

    packed.push({ ...item, x, y, w, h });
    x += w;
    rowMaxH = Math.max(rowMaxH, h);
  }

  return [...packed, ...nonKpis];
}

function packNonKpiRows(layout) {
  return packRowsHorizontal(layout, (item) => !isKpiWidget(item.i));
}

function reflowAndPack(layout) {
  let result = packKpiLayout(layout);
  result = packNonKpiRows(result);
  return result;
}

/** After drag/resize/remove: fill gaps in KPI rows, pack widget rows, compact upward. */
export function optimizeLayoutAfterChange(layout) {
  let result = reflowAndPack(layout);
  result = compactLayoutVertically(result);
  // Vertical compact may free space in earlier KPI rows — repack once more.
  result = reflowAndPack(result);
  return result;
}

/**
 * Reorder widgets in a single grid row based on pointer X.
 * Uses drag-start snapshot midpoints so detection stays stable.
 */
export function repackRowHorizontal(layout, snapshot, activeId, pointerX) {
  if (!snapshot?.items?.length) return layout;

  const { rowY, items: snapshotItems } = snapshot;
  const activeSnap = snapshotItems.find((item) => item.i === activeId);
  if (!activeSnap) return layout;

  if (snapshotItems.length <= 1) {
    return layout.map((item) =>
      item.i === activeId ? { ...item, x: pointerX, y: rowY } : item
    );
  }

  let insertAt = 0;
  for (const item of snapshotItems) {
    if (item.i === activeId) continue;
    if (pointerX >= item.x + item.w / 2) insertAt += 1;
  }

  const without = snapshotItems.filter((item) => item.i !== activeId);
  const reordered = [
    ...without.slice(0, insertAt),
    activeSnap,
    ...without.slice(insertAt),
  ];

  const rowIds = new Set(snapshotItems.map((item) => item.i));
  const itemById = Object.fromEntries(
    layout.filter((item) => rowIds.has(item.i)).map((item) => [item.i, item])
  );

  let x = 0;
  const repackedRow = reordered.map((snap) => {
    const placed = { ...itemById[snap.i], x, y: rowY };
    x += snap.w;
    return placed;
  });

  const others = layout.filter((item) => !rowIds.has(item.i));
  return [...others, ...repackedRow];
}

/** Shift overlapping widgets vertically (x unchanged) to make room for the anchor. */
function resolveVerticalCollisions(layout, anchorId) {
  const items = layout.map((item) => ({ ...item }));
  const anchorIdx = items.findIndex((item) => item.i === anchorId);
  if (anchorIdx === -1) return items;

  let changed = true;
  let passes = 0;

  while (changed && passes < 50) {
    passes += 1;
    changed = false;
    const anchor = items[anchorIdx];

    for (let i = 0; i < items.length; i += 1) {
      if (i === anchorIdx || !itemsOverlap(items[i], anchor)) continue;

      const mover = items[i];
      const downY = anchor.y + anchor.h;
      const upY = Math.max(0, anchor.y - mover.h);

      const tryDown = { ...mover, y: downY };
      const tryUp = { ...mover, y: upY };
      const downBlocked = items.some(
        (other, j) => j !== i && j !== anchorIdx && itemsOverlap(tryDown, other)
      );
      const upBlocked = items.some(
        (other, j) => j !== i && j !== anchorIdx && itemsOverlap(tryUp, other)
      );

      let newY = mover.y;
      if (!downBlocked) newY = downY;
      else if (!upBlocked) newY = upY;

      if (mover.y !== newY) {
        items[i] = { ...mover, y: newY };
        changed = true;
      }
    }
  }

  return compactLayoutVertically(items, anchorId);
}

/** Vertical drag: lock X, move Y, shift others vertically only. */
function applyVerticalDrag(layout, activeId, pointerY, originX) {
  const withActive = layout.map((item) =>
    item.i === activeId
      ? { ...item, x: originX, y: Math.max(0, pointerY) }
      : { ...item }
  );
  return resolveVerticalCollisions(withActive, activeId);
}

const DRAG_AXIS_THRESHOLD = 1;

function detectDragAxis(session, pointer) {
  if (session.axis) return session.axis;
  const dx = Math.abs(pointer.x - session.origin.x);
  const dy = Math.abs(pointer.y - session.origin.y);
  if (dx + dy < DRAG_AXIS_THRESHOLD) return null;
  return dx >= dy ? "horizontal" : "vertical";
}

function applyDragFrame(layout, activeId, pointer, session) {
  const axis = detectDragAxis(session, pointer);
  if (!axis) return layout;

  if (axis === "horizontal") {
    const lockedPointer = { x: pointer.x, y: session.origin.y };
    if (session.rowSnapshot?.items?.length) {
      return repackRowHorizontal(layout, session.rowSnapshot, activeId, lockedPointer.x);
    }
    return layout.map((item) =>
      item.i === activeId
        ? { ...item, x: lockedPointer.x, y: session.origin.y }
        : item
    );
  }

  return applyVerticalDrag(layout, activeId, pointer.y, session.origin.x);
}

/** Compact after resize without pushing widgets into new rows below. */
export function optimizeLayoutAfterResize(layout) {
  return optimizeLayoutAfterChange(layout);
}

/** Push overlapping items right or down; pinned item (being resized) stays put. */
export function pushAdjacentItems(layout, pinnedId = null) {
  const items = layout.map((item) => ({ ...item }));

  let changed = true;
  let passes = 0;

  while (changed && passes < 50) {
    passes += 1;
    changed = false;

    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        if (!itemsOverlap(items[i], items[j])) continue;

        let anchorIdx = j;
        let moveIdx = i;

        if (items[i].i === pinnedId) {
          anchorIdx = i;
          moveIdx = j;
        } else if (items[j].i === pinnedId) {
          anchorIdx = j;
          moveIdx = i;
        } else if (
          items[i].x > items[j].x ||
          (items[i].x === items[j].x && items[i].y > items[j].y)
        ) {
          anchorIdx = i;
          moveIdx = j;
        }

        const anchor = items[anchorIdx];
        const mover = items[moveIdx];

        let newX = anchor.x + anchor.w;
        let newY = anchor.y;

        if (newX + mover.w > GRID_COLS) {
          newX = anchor.x;
          newY = anchor.y + anchor.h;
        }

        const candidate = { ...mover, x: newX, y: newY };
        if (itemsOverlap(candidate, anchor)) {
          newX = anchor.x;
          newY = anchor.y + anchor.h;
        }

        if (mover.x !== newX || mover.y !== newY) {
          items[moveIdx].x = newX;
          items[moveIdx].y = newY;
          changed = true;
        }
      }
    }
  }

  return items;
}

/** Only move cards that overlap the active card; active card position is kept. */
export function resolveOverlapsForItem(layout, activeId) {
  if (!activeId) return layout;

  const items = layout.map((item) => ({ ...item }));
  const activeIdx = items.findIndex((item) => item.i === activeId);
  if (activeIdx === -1) return layout;

  let changed = true;
  let passes = 0;

  while (changed && passes < 50) {
    passes += 1;
    changed = false;
    const active = items[activeIdx];

    for (let i = 0; i < items.length; i += 1) {
      if (i === activeIdx || !itemsOverlap(items[i], active)) continue;

      const mover = items[i];
      let newX = active.x + active.w;
      let newY = active.y;

      if (newX + mover.w > GRID_COLS) {
        newX = active.x;
        newY = active.y + active.h;
      }

      const candidate = { ...mover, x: newX, y: newY };
      if (itemsOverlap(candidate, active)) {
        newX = active.x;
        newY = active.y + active.h;
      }

      if (mover.x !== newX || mover.y !== newY) {
        items[i].x = newX;
        items[i].y = newY;
        changed = true;
      }
    }
  }

  return items;
}

/** Snap chart rows below KPI band and keep the day-of-week chart below the top row. */
export function reflowCharts(layout) {
  const kpis = layout.filter((item) => isKpiWidget(item.i));
  const charts = layout.filter((item) => isChartWidget(item.i));
  const other = layout.filter((item) => !isKpiWidget(item.i) && !isChartWidget(item.i));

  const kpiBottom = kpis.length ? Math.max(...kpis.map((item) => item.y + item.h)) : 0;

  const topCharts = charts.filter((c) => TOP_ROW_CHART_IDS.includes(c.i));
  const bottomCharts = charts.filter((c) => !TOP_ROW_CHART_IDS.includes(c.i));

  const topRowY = kpiBottom;
  const reflowedTop = topCharts.map((c) => {
    const defaults = DEFAULT_CHART_LAYOUT[c.i] || {};
    return {
      ...defaults,
      ...c,
      y: topRowY,
    };
  });

  const topRowBottom = reflowedTop.length
    ? Math.max(...reflowedTop.map((c) => c.y + c.h))
    : kpiBottom;

  const reflowedBottom = bottomCharts.map((c) => {
    const defaults = DEFAULT_CHART_LAYOUT[c.i] || {};
    return {
      ...defaults,
      ...c,
      y: topRowBottom,
    };
  });

  return [...kpis, ...reflowedTop, ...reflowedBottom, ...other];
}

export function normalizeLayout(layout) {
  return reflowCharts(packKpiLayout(layout));
}

function normalizeKpiItem(item) {
  const defaults = getDefaultKpiLayoutItem(item.i);
  return {
    ...defaults,
    ...item,
    minW: item.minW ?? defaults.minW,
    minH: Math.max(item.minH ?? defaults.minH, defaults.minH),
    maxH: defaults.maxH ?? DEFAULT_KPI_LAYOUT_ITEM.maxH,
  };
}

function normalizeChartItem(item) {
  const defaults = DEFAULT_CHART_LAYOUT[item.i];
  if (!defaults) return item;
  return {
    ...defaults,
    ...item,
    minW: item.minW ?? defaults.minW,
    minH: item.minH ?? defaults.minH,
    maxW: defaults.maxW ?? item.maxW,
    maxH: defaults.maxH ?? item.maxH,
  };
}

const LEGACY_LAYOUT_VERSIONS = ["v19", "v18", "v17", "v16", "v15", "v14", "v13", "v12", "v11", "v10", "v9"];

function mergeMissingDefaultWidgets(layout) {
  const ids = new Set(layout.map((item) => item.i));
  const missing = DEFAULT_LAYOUT.filter((item) => !ids.has(item.i));
  return missing.length ? [...layout, ...missing] : layout;
}

function getAllLayoutStorageKeys() {
  const currentKey = getLayoutStorageKey();
  const tenantPrefix = currentKey.replace(/-supervisor-dashboard-layout-v\d+$/, "");
  return [
    currentKey,
    ...LEGACY_LAYOUT_VERSIONS.map((v) => `${tenantPrefix}-supervisor-dashboard-layout-${v}`),
  ];
}

function clearSavedLayout() {
  for (const key of getAllLayoutStorageKeys()) {
    localStorage.removeItem(key);
  }
}

function readSavedLayoutRaw() {
  for (const key of getAllLayoutStorageKeys()) {
    const saved = localStorage.getItem(key);
    if (saved) return { key, saved };
  }

  return null;
}

function parseStoredLayout(saved) {
  const parsed = JSON.parse(saved);
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const valid = parsed
    .filter((item) => WIDGETS[item.i])
    .map((item) => {
      if (isKpiWidget(item.i)) return normalizeKpiItem(item);
      if (isChartWidget(item.i)) return normalizeChartItem(item);
      return item;
    });

  if (valid.length === 0 || hasOverlaps(valid)) return null;
  return valid;
}

/** Never drop widgets when react-grid-layout sends a partial layout update. */
function mergeLayoutUpdate(prev, next) {
  if (!Array.isArray(next) || next.length === 0) return prev;
  if (!Array.isArray(prev) || prev.length === 0) return next;

  const nextIds = new Set(next.map((item) => item.i));
  const missing = prev.filter((item) => !nextIds.has(item.i));
  return missing.length ? [...next, ...missing] : next;
}

function ensureNonEmptyLayout(layout) {
  if (!Array.isArray(layout) || layout.length === 0) {
    return compactLayoutVertically(DEFAULT_LAYOUT);
  }
  return layout;
}

function loadLayout() {
  try {
    const stored = readSavedLayoutRaw();
    if (!stored) return DEFAULT_LAYOUT;

    const valid = parseStoredLayout(stored.saved);
    if (!valid) return DEFAULT_LAYOUT;

    const merged =
      stored.key !== getLayoutStorageKey()
        ? mergeMissingDefaultWidgets(valid)
        : valid;

    if (stored.key !== getLayoutStorageKey() || merged !== valid) {
      persistLayout(merged);
    }

    return ensureNonEmptyLayout(optimizeLayoutAfterChange(merged));
  } catch {
    return ensureNonEmptyLayout(optimizeLayoutAfterChange(DEFAULT_LAYOUT));
  }
}

function persistLayout(layout) {
  localStorage.setItem(getLayoutStorageKey(), JSON.stringify(layout));
}

function nextKpiPosition(layout) {
  const kpiItems = layout.filter((item) => isKpiWidget(item.i));
  if (kpiItems.length === 0) {
    return { x: 0, y: 0 };
  }

  const maxY = Math.max(...kpiItems.map((item) => item.y + item.h));
  const bottomRow = kpiItems.filter((item) => item.y + item.h === maxY);
  const usedWidth = bottomRow.reduce((sum, item) => sum + item.w, 0);

  if (usedWidth + DEFAULT_KPI_LAYOUT_ITEM.w <= GRID_COLS) {
    return { x: usedWidth, y: bottomRow[0].y };
  }

  return { x: 0, y: maxY };
}

export function useDashboardLayout() {
  const [layout, setLayout] = useState(loadLayout);
  const dragSessionRef = useRef(null);

  const onDragBegin = useCallback((dragOrigin, layoutAtStart) => {
    if (!dragOrigin || !layoutAtStart) {
      dragSessionRef.current = null;
      return;
    }

    const rowY = dragOrigin.y;
    dragSessionRef.current = {
      origin: { x: dragOrigin.x, y: dragOrigin.y },
      axis: null,
      rowSnapshot: {
        rowY,
        items: layoutAtStart
          .filter((item) => item.y === rowY)
          .sort((a, b) => a.x - b.x)
          .map((item) => ({
            i: item.i,
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
          })),
      },
    };
  }, []);

  /** During drag/resize: preview in memory only. Persist on drag/resize stop. */
  const onLayoutChange = useCallback((newLayout, pinnedId = null, options = {}) => {
    setLayout((prev) => {
      if (options.passThrough && pinnedId && dragSessionRef.current) {
        const pointerPos =
          options.pointerPos ??
          (() => {
            const fromRgl = newLayout.find((item) => item.i === pinnedId);
            return fromRgl ? { x: fromRgl.x, y: fromRgl.y } : null;
          })();
        if (!pointerPos) return prev;

        const session = dragSessionRef.current;
        const axis = detectDragAxis(session, pointerPos);
        if (axis) session.axis = axis;

        return applyDragFrame(prev, pinnedId, pointerPos, session);
      }

      const merged = mergeLayoutUpdate(prev, newLayout);

      if (options.mode === "resize") {
        return optimizeLayoutAfterResize(merged);
      }

      return prev;
    });
  }, []);

  const onLayoutStop = useCallback((newLayout, mode = "drag", activeId = null) => {
    setLayout((prev) => {
      let merged = prev;
      if (mode === "resize") {
        merged = mergeLayoutUpdate(prev, newLayout);
      }

      let fixed = merged;
      if (mode === "drag" || mode === "resize") {
        fixed = optimizeLayoutAfterChange(merged);
      } else {
        fixed = compactLayoutVertically(merged);
      }

      dragSessionRef.current = null;

      const safe = ensureNonEmptyLayout(fixed);
      persistLayout(safe);
      return safe;
    });
  }, []);

  const resetLayout = useCallback(() => {
    clearSavedLayout();
    const compacted = ensureNonEmptyLayout(optimizeLayoutAfterChange(DEFAULT_LAYOUT));
    setLayout(compacted);
    persistLayout(compacted);
  }, []);

  const removeWidgetFromLayout = useCallback((widgetId) => {
    setLayout((prev) => {
      const next = optimizeLayoutAfterChange(prev.filter((item) => item.i !== widgetId));
      persistLayout(next);
      return next;
    });
  }, []);

  const addKpiToLayout = useCallback((widgetId, position) => {
    if (!isKpiWidget(widgetId)) return;
    setLayout((prev) => {
      if (prev.some((item) => item.i === widgetId)) return prev;

      const fallback = nextKpiPosition(prev);
      const newItem = normalizeKpiItem({
        i: widgetId,
        x: position?.x ?? fallback.x,
        y: position?.y ?? fallback.y,
      });

      const next = ensureNonEmptyLayout(optimizeLayoutAfterChange([...prev, newItem]));
      persistLayout(next);
      return next;
    });
  }, []);

  const addWidgetToLayout = useCallback((widgetId, position) => {
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

      const next = ensureNonEmptyLayout(optimizeLayoutAfterChange([...prev, newItem]));
      persistLayout(next);
      return next;
    });
  }, [addKpiToLayout]);

  const visibleLayoutIds = layout.map((item) => item.i);
  const visibleKpiIds = layout.filter((item) => isKpiWidget(item.i)).map((item) => item.i);

  return {
    layout,
    onLayoutChange,
    onLayoutStop,
    onDragBegin,
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    addWidgetToLayout,
    visibleLayoutIds,
    visibleKpiIds,
  };
}
