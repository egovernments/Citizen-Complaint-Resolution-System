/**
 * Pure grid-geometry helpers for the dashboard layout (react-grid-layout items
 * shaped { i, x, y, w, h }). Relocated from the retired legacy useDashboardLayout
 * hook so the catalog-driven useCatalogLayout can reuse them without dragging in
 * the old dash-case widget machinery.
 */

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function overlapArea(a, b) {
  const xOverlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

function collidesAt(item, x, y, placed) {
  const candidate = { ...item, x, y };
  return placed.some((other) => rectsOverlap(candidate, other));
}

/**
 * Compact every item upward to the lowest free row (reading order: top-to-bottom,
 * left-to-right). Removes vertical gaps and resolves overlaps (e.g. after a swap
 * or an enlarged card) by stacking colliding items downward.
 */
export function compactVertically(layout) {
  const sorted = [...layout]
    .map((item) => ({ ...item }))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const placed = [];
  for (const item of sorted) {
    let y = 0;
    while (collidesAt(item, item.x, y, placed)) y += 1;
    placed.push({ ...item, y });
  }
  return placed;
}

/**
 * Swap the dragged item with the item it was dropped onto: the dragged item snaps
 * to the displaced item's slot, and the displaced item moves to the dragged item's
 * origin. Dropping on empty space is a no-op (the item keeps its new position).
 */
export function swapOnDrop(layout, activeId, origin) {
  const dragged = layout.find((item) => item.i === activeId);
  if (!dragged) return layout;

  let target = null;
  let bestArea = 0;
  for (const item of layout) {
    if (item.i === activeId) continue;
    const area = overlapArea(dragged, item);
    if (area > bestArea) {
      bestArea = area;
      target = item;
    }
  }

  if (!target) return layout;

  const targetPos = { x: target.x, y: target.y };
  return layout.map((item) => {
    if (item.i === activeId) return { ...item, x: targetPos.x, y: targetPos.y };
    if (item.i === target.i) return { ...item, x: origin.x, y: origin.y };
    return item;
  });
}
