import { useCallback, useState } from "react";
import {
  DEFAULT_LAYOUT,
  DEFAULT_KPI_LAYOUT_ITEM,
  LAYOUT_STORAGE_KEY,
  isKpiWidget,
} from "../constants/layoutConfig";

function loadLayout() {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!saved) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_LAYOUT;
    return parsed;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function persistLayout(layout) {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

function nextKpiPosition(layout) {
  const kpiItems = layout.filter((item) => isKpiWidget(item.i));
  if (kpiItems.length === 0) {
    return { x: 0, y: 0 };
  }
  const maxY = Math.max(...kpiItems.map((item) => item.y + item.h));
  const rowItems = kpiItems.filter((item) => item.y < maxY);
  const usedWidth = rowItems.reduce((sum, item) => sum + item.w, 0);
  if (usedWidth + DEFAULT_KPI_LAYOUT_ITEM.w <= 12) {
    return { x: usedWidth, y: Math.min(...kpiItems.map((item) => item.y)) };
  }
  return { x: 0, y: maxY };
}

export function useDashboardLayout() {
  const [layout, setLayout] = useState(loadLayout);

  const onLayoutChange = useCallback((newLayout) => {
    setLayout(newLayout);
    persistLayout(newLayout);
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT);
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
  }, []);

  const removeKpiFromLayout = useCallback((widgetId) => {
    if (!isKpiWidget(widgetId)) return;
    setLayout((prev) => {
      const next = prev.filter((item) => item.i !== widgetId);
      persistLayout(next);
      return next;
    });
  }, []);

  const addKpiToLayout = useCallback((widgetId, position) => {
    if (!isKpiWidget(widgetId)) return;
    setLayout((prev) => {
      if (prev.some((item) => item.i === widgetId)) return prev;
      const { x, y } = position || nextKpiPosition(prev);
      const next = [
        ...prev,
        {
          i: widgetId,
          x,
          y,
          ...DEFAULT_KPI_LAYOUT_ITEM,
        },
      ];
      persistLayout(next);
      return next;
    });
  }, []);

  const visibleKpiIds = layout.filter((item) => isKpiWidget(item.i)).map((item) => item.i);

  return {
    layout,
    onLayoutChange,
    resetLayout,
    removeKpiFromLayout,
    addKpiToLayout,
    visibleKpiIds,
  };
}
