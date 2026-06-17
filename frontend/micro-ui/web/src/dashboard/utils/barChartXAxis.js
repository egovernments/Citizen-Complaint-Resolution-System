export const Y_AXIS_GUTTER_PX = 40;
export const MIN_SLOT_WIDTH_FOR_X_LABELS_PX = 36;
export const LABEL_CHAR_WIDTH_PX = 6;

export function truncateCategoryLabel(label, slotWidthPx) {
  const text = String(label ?? "").trim() || "—";
  if (!slotWidthPx) return text;
  const maxChars = Math.max(3, Math.floor((slotWidthPx - 8) / LABEL_CHAR_WIDTH_PX));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(maxChars - 1, 2))}…`;
}

/** Width available to each category label after reserving the y-axis gutter. */
export function resolveLabelSlotWidth(categoryCount, containerWidth) {
  if (!categoryCount || !containerWidth) return 0;
  const plotWidth = Math.max(0, containerWidth - Y_AXIS_GUTTER_PX);
  return plotWidth / categoryCount;
}

/** Hide all x-axis labels when any would truncate or slots are too narrow. */
export function shouldShowXAxisLabels(categories, slotWidthPx) {
  if (!slotWidthPx || slotWidthPx < MIN_SLOT_WIDTH_FOR_X_LABELS_PX) return false;

  return categories.every((label) => {
    const text = String(label ?? "").trim() || "—";
    return truncateCategoryLabel(text, slotWidthPx) === text;
  });
}

export function buildXAxisLabelOptions(categories, containerWidth, { maxHeight = 48 } = {}) {
  const slotWidth = resolveLabelSlotWidth(categories.length, containerWidth);
  const show = shouldShowXAxisLabels(categories, slotWidth);

  return {
    show,
    rotate: 0,
    rotateAlways: false,
    trim: false,
    hideOverlappingLabels: true,
    maxHeight: show ? maxHeight : 4,
    offsetY: 2,
    style: { fontSize: "10px" },
    formatter: (value) => (show ? truncateCategoryLabel(value, slotWidth) : ""),
  };
}
