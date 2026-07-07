import {
  DEFAULT_CHART_LAYOUT,
  GRID_COLS,
  GRID_MARGIN_Y,
  KPI_ROW_HEIGHT,
} from "../constants/layoutConfig";
import { resolveMinHorizontalBarRowHeight } from "./chartLabelWrap";

const STORAGE_PREFIX = "dashboard-chart-baseline:v2:";
const GRID_MARGIN_X = 16;
const WIDGET_CHROME_HEIGHT_PX = 78;
const WIDGET_BODY_PADDING_X_PX = 16;

/** Bars visible in the viewport before horizontal scroll is required. */
export const BAR_CHART_VISIBLE_SLOTS_WITHOUT_SCROLL = 5;
/** Horizontal bar charts use taller rows so category labels do not run together. */
export const HORIZONTAL_BAR_VISIBLE_SLOTS_WITHOUT_SCROLL = 4;

export function chartScrollStorageKey(scrollKey) {
  return scrollKey ? `${STORAGE_PREFIX}${scrollKey}` : null;
}

export function loadChartScrollBaseline(scrollKey) {
  const key = chartScrollStorageKey(scrollKey);
  if (!key) return null;

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Number.isFinite(parsed.width) &&
      Number.isFinite(parsed.height) &&
      parsed.width > 0 &&
      parsed.height > 0
    ) {
      return {
        width: Math.floor(parsed.width),
        height: Math.floor(parsed.height),
      };
    }
  } catch {
    // ignore corrupt storage
  }
  return null;
}

export function saveChartScrollBaseline(scrollKey, size) {
  const key = chartScrollStorageKey(scrollKey);
  if (!key || !size?.width || !size?.height) return;

  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        width: Math.floor(size.width),
        height: Math.floor(size.height),
      })
    );
  } catch {
    // ignore quota / private mode
  }
}

/** Estimate chart plot area from layout defaults (survives refresh at shrunk grid size). */
export function resolveDefaultChartAreaPx(scrollKey, layoutElement) {
  const defaults = DEFAULT_CHART_LAYOUT[scrollKey];
  if (!defaults?.w || !defaults?.h) return null;

  const layoutWidth = layoutElement?.clientWidth;
  if (!layoutWidth) return null;

  const colWidth = (layoutWidth - GRID_MARGIN_X * (GRID_COLS + 1)) / GRID_COLS;
  const itemWidth = defaults.w * colWidth + Math.max(0, defaults.w - 1) * GRID_MARGIN_X;
  const itemHeight =
    defaults.h * KPI_ROW_HEIGHT + Math.max(0, defaults.h - 1) * GRID_MARGIN_Y;

  return {
    width: Math.max(160, Math.floor(itemWidth - WIDGET_BODY_PADDING_X_PX)),
    height: Math.max(120, Math.floor(itemHeight - WIDGET_CHROME_HEIGHT_PX)),
  };
}

/** Chart body width at the widget's minimum grid width — anchors bar slot size (5 bars at minW). */
export function resolveMinChartAreaPx(scrollKey, layoutElement) {
  const defaults = DEFAULT_CHART_LAYOUT[scrollKey];
  if (!defaults?.minW) return null;

  const layoutWidth = layoutElement?.clientWidth;
  if (!layoutWidth) return null;

  const colWidth = (layoutWidth - GRID_MARGIN_X * (GRID_COLS + 1)) / GRID_COLS;
  const itemWidth =
    defaults.minW * colWidth + Math.max(0, defaults.minW - 1) * GRID_MARGIN_X;

  return Math.max(160, Math.floor(itemWidth - WIDGET_BODY_PADDING_X_PX));
}

/** Chart body height at the widget's minimum grid height — anchors row size (5 bars at minH). */
export function resolveMinChartAreaHeightPx(scrollKey) {
  const defaults = DEFAULT_CHART_LAYOUT[scrollKey];
  if (!defaults?.minH) return null;

  const itemHeight =
    defaults.minH * KPI_ROW_HEIGHT + Math.max(0, defaults.minH - 1) * GRID_MARGIN_Y;

  return Math.max(120, Math.floor(itemHeight - WIDGET_CHROME_HEIGHT_PX));
}

export function resolveVerticalBarSlotWidth(minChartWidth = 0, viewportWidth = 0) {
  const referenceWidth = Math.max(
    160,
    Number(minChartWidth) || Number(viewportWidth) || 0
  );
  return referenceWidth / BAR_CHART_VISIBLE_SLOTS_WITHOUT_SCROLL;
}

export function resolveVerticalBarVisibleSlots(viewportWidth = 0, slotWidth = 0) {
  const viewport = Math.max(0, Number(viewportWidth) || 0);
  const slot = Math.max(0, Number(slotWidth) || 0);
  if (viewport <= 0 || slot <= 0) return BAR_CHART_VISIBLE_SLOTS_WITHOUT_SCROLL;
  return Math.max(1, Math.floor(viewport / slot));
}

export function resolveVerticalBarChartWidth(
  categoryCount = 0,
  viewportWidth = 0,
  minChartWidth = 0
) {
  const viewport = Math.max(0, Number(viewportWidth) || 0);
  if (viewport <= 0) return 0;

  const count = Math.max(0, Number(categoryCount) || 0);
  if (count === 0) return viewport;

  const slotWidth = resolveVerticalBarSlotWidth(minChartWidth, viewport);
  const visibleSlots = resolveVerticalBarVisibleSlots(viewport, slotWidth);

  if (count <= visibleSlots) {
    return viewport;
  }

  return Math.ceil(count * slotWidth);
}

/** @deprecated Use resolveVerticalBarChartWidth — kept for callers that need min width hints. */
export function resolveVerticalBarMinContentWidth(
  categoryCount = 0,
  viewportWidth = 0,
  minChartWidth = 0
) {
  const viewport = Math.max(0, Number(viewportWidth) || 0);
  const width = resolveVerticalBarChartWidth(
    categoryCount,
    viewport,
    minChartWidth
  );
  if (!viewport || width <= viewport) return 0;
  return width;
}

export function resolveHorizontalBarRowHeight(
  minChartHeight = 0,
  viewportHeight = 0
) {
  const referenceHeight = Math.max(
    120,
    Number(minChartHeight) || Number(viewportHeight) || 0
  );
  const slotFromViewport =
    referenceHeight / HORIZONTAL_BAR_VISIBLE_SLOTS_WITHOUT_SCROLL;
  return Math.max(slotFromViewport, resolveMinHorizontalBarRowHeight());
}

export function resolveHorizontalBarVisibleSlots(
  viewportHeight = 0,
  rowHeight = 0
) {
  const viewport = Math.max(0, Number(viewportHeight) || 0);
  const row = Math.max(0, Number(rowHeight) || 0);
  if (viewport <= 0 || row <= 0) return HORIZONTAL_BAR_VISIBLE_SLOTS_WITHOUT_SCROLL;
  return Math.max(1, Math.floor(viewport / row));
}

export function resolveHorizontalBarChartHeight(
  categoryCount = 0,
  viewportHeight = 0,
  minChartHeight = 0
) {
  const viewport = Math.max(0, Number(viewportHeight) || 0);
  if (viewport <= 0) return 0;

  const count = Math.max(0, Number(categoryCount) || 0);
  if (count === 0) return viewport;

  const rowHeight = resolveHorizontalBarRowHeight(minChartHeight, viewport);
  const visibleSlots = resolveHorizontalBarVisibleSlots(viewport, rowHeight);

  if (count <= visibleSlots) {
    return viewport;
  }

  return Math.ceil(count * rowHeight);
}

/** @deprecated Use resolveHorizontalBarChartHeight. */
export function resolveHorizontalBarMinHeight(
  categoryCount = 0,
  viewportHeight = 0,
  minChartHeight = 0
) {
  const viewport = Math.max(0, Number(viewportHeight) || 0);
  const height = resolveHorizontalBarChartHeight(
    categoryCount,
    viewport,
    minChartHeight
  );
  if (!viewport || height <= viewport) return 0;
  return height;
}

export function resolveHorizontalBarMinWidth(categoryCount = 0) {
  if (!categoryCount) return 0;
  return Math.max(280, 120 + categoryCount * 8);
}
