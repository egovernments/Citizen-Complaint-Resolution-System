import {
  DEFAULT_CHART_LAYOUT,
  GRID_COLS,
  GRID_MARGIN_Y,
  KPI_ROW_HEIGHT,
} from "../constants/layoutConfig";

const STORAGE_PREFIX = "dashboard-chart-baseline:v2:";
const GRID_MARGIN_X = 16;
const WIDGET_CHROME_HEIGHT_PX = 78;
const WIDGET_BODY_PADDING_X_PX = 16;
const HORIZONTAL_BAR_ROW_PX = 38;
const HORIZONTAL_BAR_CHROME_PX = 72;

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

export function resolveHorizontalBarMinHeight(categoryCount = 0) {
  if (!categoryCount) return 0;
  return categoryCount * HORIZONTAL_BAR_ROW_PX + HORIZONTAL_BAR_CHROME_PX;
}

export function resolveHorizontalBarMinWidth(categoryCount = 0) {
  if (!categoryCount) return 0;
  return Math.max(280, 120 + categoryCount * 8);
}
