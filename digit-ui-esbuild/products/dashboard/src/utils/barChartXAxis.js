import { BAR_CHART_GRID_GUTTER_PX, resolveBarCategorySlotWidth } from "../config/barChartPresentation";

export const Y_AXIS_GUTTER_PX = BAR_CHART_GRID_GUTTER_PX;

export function resolveLabelSlotWidth(categoryCount, containerWidth) {
  return resolveBarCategorySlotWidth(categoryCount, containerWidth);
}
