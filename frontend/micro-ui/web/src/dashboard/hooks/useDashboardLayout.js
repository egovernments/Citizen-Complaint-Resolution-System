import { useCallback, useState } from "react";
import { getLayoutStorageKey } from "../config/dashboardConfig";
import {
  DEFAULT_CHART_LAYOUT,
  DEFAULT_KPI_LAYOUT_ITEM,
  DEFAULT_LAYOUT,
  GRID_COLS,
  TOP_ROW_CHART_IDS,
  RANKED_LIST_WIDGET_ID,
  WIDGETS,
  isChartWidget,
  isKpiWidget,
  resolveRankedListGridHeight,
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

function clampChartBelowKpis(layout, chartId) {
  if (!isChartWidget(chartId)) return layout;

  const kpis = layout.filter((item) => isKpiWidget(item.i));
  if (!kpis.length) return layout;

  const kpiBottom = Math.max(...kpis.map((item) => item.y + item.h));
  const chart = layout.find((item) => item.i === chartId);
  if (!chart || chart.y >= kpiBottom) return layout;

  return layout.map((item) =>
    item.i === chartId ? { ...item, y: kpiBottom } : item
  );
}

/** Pack KPI cards into tight rows so they never stack on the same column. */
export function packKpiLayout(layout) {
  const kpis = layout
    .filter((item) => isKpiWidget(item.i))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const nonKpis = layout.filter((item) => !isKpiWidget(item.i));

  const packed = [];
  let x = 0;
  let y = 0;

  for (const item of kpis) {
    if (x + DEFAULT_KPI_LAYOUT_ITEM.w > GRID_COLS) {
      x = 0;
      y += DEFAULT_KPI_LAYOUT_ITEM.h;
    }
    packed.push({
      ...DEFAULT_KPI_LAYOUT_ITEM,
      ...item,
      x,
      y,
    });
    x += DEFAULT_KPI_LAYOUT_ITEM.w;
  }

  return [...packed, ...nonKpis];
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
  return {
    ...DEFAULT_KPI_LAYOUT_ITEM,
    ...item,
    minW: item.minW ?? DEFAULT_KPI_LAYOUT_ITEM.minW,
    minH: item.minH ?? DEFAULT_KPI_LAYOUT_ITEM.minH,
    maxH: item.maxH ?? DEFAULT_KPI_LAYOUT_ITEM.maxH,
  };
}

function normalizeChartItem(item) {
  const defaults = DEFAULT_CHART_LAYOUT[item.i];
  if (!defaults) return item;
  return {
    ...item,
    minW: defaults.minW,
    minH: defaults.minH,
    maxW: defaults.maxW ?? item.maxW,
    maxH: defaults.maxH ?? item.maxH,
  };
}

const LEGACY_LAYOUT_VERSIONS = ["v12", "v11", "v10", "v9"];

function readSavedLayoutRaw() {
  const currentKey = getLayoutStorageKey();
  const tenantPrefix = currentKey.replace(/-supervisor-dashboard-layout-v\d+$/, "");
  const keys = [
    currentKey,
    ...LEGACY_LAYOUT_VERSIONS.map((v) => `${tenantPrefix}-supervisor-dashboard-layout-${v}`),
  ];

  for (const key of keys) {
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

function loadLayout() {
  try {
    const stored = readSavedLayoutRaw();
    if (!stored) return DEFAULT_LAYOUT;

    const valid = parseStoredLayout(stored.saved);
    if (!valid) return DEFAULT_LAYOUT;

    if (stored.key !== getLayoutStorageKey()) {
      persistLayout(valid);
    }

    return valid;
  } catch {
    return DEFAULT_LAYOUT;
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

  /** During drag: pass through in memory only. Persist on drag/resize stop. */
  const onLayoutChange = useCallback((newLayout, pinnedId = null, options = {}) => {
    if (options.passThrough) {
      setLayout(newLayout);
      return;
    }

    if (options.mode === "resize" && pinnedId) {
      const fixed = pushAdjacentItems(newLayout, pinnedId);
      setLayout(fixed);
      persistLayout(fixed);
      return;
    }

    if (options.mode === "resize") {
      setLayout(newLayout);
    }
  }, []);

  const onLayoutStop = useCallback((newLayout, mode = "drag", activeId = null) => {
    const fixed =
      mode === "resize" && activeId
        ? pushAdjacentItems(newLayout, activeId)
        : newLayout;

    setLayout(fixed);
    persistLayout(fixed);
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT);
    localStorage.removeItem(getLayoutStorageKey());
  }, []);

  const removeWidgetFromLayout = useCallback((widgetId) => {
    setLayout((prev) => {
      const next = prev.filter((item) => item.i !== widgetId);
      persistLayout(next);
      return next;
    });
  }, []);

  const syncRankedListHeight = useCallback((itemCount) => {
    const targetH = resolveRankedListGridHeight(itemCount);
    setLayout((prev) => {
      const listItem = prev.find((item) => item.i === RANKED_LIST_WIDGET_ID);
      if (!listItem || listItem.h <= targetH) return prev;

      const next = prev.map((item) =>
        item.i === RANKED_LIST_WIDGET_ID
          ? { ...item, h: targetH, minH: DEFAULT_CHART_LAYOUT[RANKED_LIST_WIDGET_ID]?.minH ?? 2 }
          : item
      );
      persistLayout(next);
      return next;
    });
  }, []);

  const addKpiToLayout = useCallback((widgetId, position) => {
    if (!isKpiWidget(widgetId)) return;
    setLayout((prev) => {
      if (prev.some((item) => item.i === widgetId)) return prev;

      const fallback = nextKpiPosition(prev);
      const newItem = {
        i: widgetId,
        x: position?.x ?? fallback.x,
        y: position?.y ?? fallback.y,
        ...DEFAULT_KPI_LAYOUT_ITEM,
      };

      let next = [...prev, newItem];
      persistLayout(next);
      return next;
    });
  }, []);

  const visibleKpiIds = layout.filter((item) => isKpiWidget(item.i)).map((item) => item.i);

  return {
    layout,
    onLayoutChange,
    onLayoutStop,
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    syncRankedListHeight,
    visibleKpiIds,
  };
}
