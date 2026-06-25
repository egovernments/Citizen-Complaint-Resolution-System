/**
 * Shared Apex axis label options — wrap long labels instead of truncating.
 */

import {
  CHART_AXIS_LABEL_FONT_SIZE_PX,
  CHART_LABEL_CHAR_WIDTH_PX,
  estimateMaxWrappedLabelHeight,
  formatWrappedChartLabel,
  wrapChartLabelToLines,
} from "../utils/chartLabelWrap";

const VERTICAL_LABEL_STYLE = { fontSize: `${CHART_AXIS_LABEL_FONT_SIZE_PX}px` };

export function resolveVerticalCategorySlotWidth(categoryCount, containerWidth, gutterPx = 8) {
  if (!categoryCount || !containerWidth) return 0;
  return Math.max(0, containerWidth - gutterPx) / categoryCount;
}

/**
 * Horizontal bar category labels — wrap width grows with the widget so labels
 * unwrap to a single line when enlarged. Do not pass maxWidth to Apex; it
 * ellipsis-truncates strings and fights the formatter.
 */
export function resolveHorizontalCategoryLabelLayout(
  categories = [],
  containerWidth = 0,
  { min = 44, maxCap = 180, ratio = 0.36, maxLines = 4 } = {}
) {
  const wrapWidthPx = containerWidth
    ? Math.min(maxCap, Math.max(min, Math.floor(containerWidth * ratio)))
    : maxCap;

  if (!categories.length) {
    return { wrapWidthPx, minWidth: min };
  }

  let minWidth = min;
  for (const label of categories) {
    const lines = wrapChartLabelToLines(label, wrapWidthPx, { maxLines });
    for (const line of lines) {
      minWidth = Math.max(minWidth, Math.ceil(line.length * CHART_LABEL_CHAR_WIDTH_PX));
    }
  }

  return { wrapWidthPx, minWidth: Math.ceil(minWidth) };
}

export function buildWrappedVerticalXAxisLabels(
  slotWidthPx,
  { maxLines = 4 } = {}
) {
  return {
    show: true,
    rotate: 0,
    rotateAlways: false,
    trim: false,
    hideOverlappingLabels: false,
    offsetY: 0,
    style: VERTICAL_LABEL_STYLE,
    formatter: (value) => formatWrappedChartLabel(value, slotWidthPx, { maxLines }),
  };
}

export function resolveVerticalXAxisLabelHeight(
  categories,
  slotWidthPx,
  { minHeightPx = 22, maxHeightPx = 72, maxLines = 4 } = {}
) {
  const estimated = estimateMaxWrappedLabelHeight(categories, slotWidthPx, { maxLines });
  return Math.max(minHeightPx, Math.min(maxHeightPx, estimated));
}

export function buildWrappedHorizontalCategoryLabels(
  wrapWidthPx,
  { minWidth, offsetX = 0 } = {}
) {
  return {
    show: true,
    offsetX,
    trim: false,
    hideOverlappingLabels: false,
    minWidth,
    style: VERTICAL_LABEL_STYLE,
    formatter: (value) => formatWrappedChartLabel(value, wrapWidthPx),
  };
}

export function buildHorizontalBarYAxisItem(categories, containerWidth, extra = {}) {
  const {
    labels: extraLabels,
    labelLayout,
    labelBarGapPx = 0,
    labelLeftMarginPx = 0,
    ...restExtra
  } = extra;
  const { wrapWidthPx, minWidth: labelMinWidth } = resolveHorizontalCategoryLabelLayout(
    categories,
    containerWidth,
    labelLayout
  );
  // Total column = left margin + estimated text width + gap-to-bar.
  // offsetX shifts ApexCharts' default right-edge x to (x = labelLeftMarginPx),
  // and CSS text-anchor:start makes all labels begin at that same left position.
  const gapPx = Math.max(0, labelBarGapPx);
  const marginPx = Math.max(0, labelLeftMarginPx);
  const axisLabelWidth = Math.ceil(marginPx + labelMinWidth + gapPx);
  const offsetX = -(Math.ceil(labelMinWidth + gapPx));

  return {
    labels: {
      ...buildWrappedHorizontalCategoryLabels(wrapWidthPx, {
        minWidth: axisLabelWidth,
        offsetX,
      }),
      ...(extraLabels ?? {}),
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
    ...restExtra,
  };
}
