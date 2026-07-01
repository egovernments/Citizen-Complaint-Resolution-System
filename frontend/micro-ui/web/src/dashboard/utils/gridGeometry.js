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

export function hasOverlaps(layout) {
  for (let i = 0; i < layout.length; i += 1) {
    for (let j = i + 1; j < layout.length; j += 1) {
      if (rectsOverlap(layout[i], layout[j])) return true;
    }
  }
  return false;
}

function collidesWithAny(item, placed) {
  return placed.some((other) => rectsOverlap(item, other));
}

/**
 * Compact vertically, then if any rectangles still overlap re-place colliding
 * items into the first open grid slot (guarantees zero overlap).
 */
export function resolveLayoutCollisions(layout, findOpen, cols = 12) {
  let result = compactVertically(layout);
  if (!hasOverlaps(result)) return result;

  const sorted = [...result].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [];
  for (const item of sorted) {
    if (!collidesWithAny(item, placed)) {
      placed.push({ ...item });
      continue;
    }
    const slot = findOpen(placed, item.w, item.h, cols);
    placed.push({ ...item, x: slot.x, y: slot.y });
  }
  return placed;
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
 *
 * When allowOverlap/preventCollision is off during drag, pass dropItem (newItem from
 * onDragStop) so overlap is evaluated at the drop footprint, not RGL's snapped position.
 */
export function swapOnDrop(layout, activeId, origin, dropItem) {
  const dragged = layout.find((item) => item.i === activeId);
  if (!dragged) return layout;

  const probe = dropItem
    ? { ...dragged, x: dropItem.x, y: dropItem.y, w: dropItem.w, h: dropItem.h }
    : dragged;

  let target = null;
  let bestArea = 0;
  for (const item of layout) {
    if (item.i === activeId) continue;
    const area = overlapArea(probe, item);
    if (area > bestArea) {
      bestArea = area;
      target = item;
    }
  }

  if (!target && dropItem) {
    const cx = dropItem.x + dropItem.w / 2;
    const cy = dropItem.y + dropItem.h / 2;
    for (const item of layout) {
      if (item.i === activeId) continue;
      if (
        cx >= item.x &&
        cx < item.x + item.w &&
        cy >= item.y &&
        cy < item.y + item.h
      ) {
        target = item;
        break;
      }
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
