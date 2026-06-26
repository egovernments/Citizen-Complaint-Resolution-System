import { GRID_COLS, isKpiWidget } from "../constants/layoutConfig";
import { isKpiListMetric } from "../config/kpiDisplay";

function sortByPosition(items) {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

function resolveDisplayHeight(item, breakpoint) {
  const base = item.h;
  if (breakpoint === "lg") return base;

  if (isKpiWidget(item.i)) {
    if (isKpiListMetric(item.i)) return base;
    if (breakpoint === "sm") return Math.max(base, 3);
    return Math.max(base, 2);
  }

  if (breakpoint === "sm") return Math.max(base, 7);
  return Math.max(base, 6);
}

/**
 * Re-flows the grid for narrow viewports without mutating the saved desktop layout.
 * KPIs tile in 2 columns (sm) or 3 columns (md); charts and tables stack full width.
 * Heights are bumped so card content is not clipped on smaller screens.
 */
export function adaptLayoutForBreakpoint(layout, breakpoint) {
  if (breakpoint === "lg" || !layout?.length) return layout;

  const kpis = sortByPosition(layout.filter((item) => isKpiWidget(item.i)));
  const charts = sortByPosition(layout.filter((item) => !isKpiWidget(item.i)));
  const kpiWidth = breakpoint === "sm" ? 6 : 4;
  const adapted = [];

  let rowY = 0;
  let rowX = 0;
  let rowMaxH = 0;

  kpis.forEach((item) => {
    const h = resolveDisplayHeight(item, breakpoint);
    if (rowX + kpiWidth > GRID_COLS) {
      rowY += rowMaxH;
      rowX = 0;
      rowMaxH = 0;
    }
    adapted.push({ ...item, x: rowX, y: rowY, w: kpiWidth, h });
    rowX += kpiWidth;
    rowMaxH = Math.max(rowMaxH, h);
  });

  let currentY = kpis.length ? rowY + rowMaxH : 0;

  charts.forEach((item) => {
    const h = resolveDisplayHeight(item, breakpoint);
    adapted.push({ ...item, x: 0, y: currentY, w: GRID_COLS, h });
    currentY += h;
  });

  return adapted;
}
