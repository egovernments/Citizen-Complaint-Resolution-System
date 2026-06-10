import { useCallback, useState } from "react";
import { getLayoutStorageKey } from "../config/dashboardConfig";
import {
  DEFAULT_CHART_LAYOUT,
  DEFAULT_KPI_LAYOUT_ITEM,
  DEFAULT_LAYOUT,
  GRID_COLS,
  TOP_ROW_CHART_IDS,
  WIDGETS,
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
      ...item,
      x,
      y,
      ...DEFAULT_KPI_LAYOUT_ITEM,
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

/** During drag/resize: enforce minimum Y without resetting horizontal placement. */
export function pushChartsBelowKpis(layout) {
  const kpis = layout.filter((item) => isKpiWidget(item.i));
  const charts = layout.filter((item) => isChartWidget(item.i));
  const other = layout.filter((item) => !isKpiWidget(item.i) && !isChartWidget(item.i));

  if (kpis.length === 0) return layout;

  const kpiBottom = Math.max(...kpis.map((item) => item.y + item.h));
  const topCharts = charts.filter((c) => TOP_ROW_CHART_IDS.includes(c.i));
  const bottomCharts = charts.filter((c) => !TOP_ROW_CHART_IDS.includes(c.i));

  const adjustedTop = topCharts.map((c) => ({
    ...c,
    y: Math.max(c.y, kpiBottom),
  }));

  const topRowBottom = adjustedTop.length
    ? Math.max(...adjustedTop.map((c) => c.y + c.h))
    : kpiBottom;

  const adjustedBottom = bottomCharts.map((c) => ({
    ...c,
    y: Math.max(c.y, topRowBottom),
  }));

  return [...kpis, ...adjustedTop, ...adjustedBottom, ...other];
}

export function normalizeLayout(layout) {
  return reflowCharts(packKpiLayout(layout));
}

function normalizeKpiItem(item) {
  return {
    ...item,
    w: DEFAULT_KPI_LAYOUT_ITEM.w,
    h: DEFAULT_KPI_LAYOUT_ITEM.h,
    minW: DEFAULT_KPI_LAYOUT_ITEM.minW,
    minH: DEFAULT_KPI_LAYOUT_ITEM.minH,
    maxH: DEFAULT_KPI_LAYOUT_ITEM.maxH,
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
  };
}

function loadLayout() {
  try {
    const saved = localStorage.getItem(getLayoutStorageKey());
    if (!saved) return DEFAULT_LAYOUT;

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_LAYOUT;

    const valid = parsed
      .filter((item) => WIDGETS[item.i])
      .map((item) => {
        if (isKpiWidget(item.i)) return normalizeKpiItem(item);
        if (isChartWidget(item.i)) return normalizeChartItem(item);
        return item;
      });

    if (valid.length === 0) return DEFAULT_LAYOUT;

    const fixed = normalizeLayout(valid);
    return hasOverlaps(fixed) ? DEFAULT_LAYOUT : fixed;
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

  const onLayoutChange = useCallback((newLayout) => {
    const fixed = pushChartsBelowKpis(newLayout);
    setLayout(fixed);
    persistLayout(fixed);
  }, []);

  const onLayoutStop = useCallback((newLayout) => {
    const fixed = normalizeLayout(newLayout);
    setLayout(fixed);
    persistLayout(fixed);
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT);
    localStorage.removeItem(getLayoutStorageKey());
  }, []);

  const removeWidgetFromLayout = useCallback((widgetId) => {
    setLayout((prev) => {
      const next = normalizeLayout(prev.filter((item) => item.i !== widgetId));
      persistLayout(next);
      return next;
    });
  }, []);

  const addKpiToLayout = useCallback((widgetId) => {
    if (!isKpiWidget(widgetId)) return;
    setLayout((prev) => {
      if (prev.some((item) => item.i === widgetId)) return prev;
      const { x, y } = nextKpiPosition(prev);
      const next = normalizeLayout([
        ...prev,
        {
          i: widgetId,
          x,
          y,
          ...DEFAULT_KPI_LAYOUT_ITEM,
        },
      ]);
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
    visibleKpiIds,
  };
}
