/**
 * Drag/layout geometry ported from useDashboardLayout.js @ 482143e34.
 * `isCard` maps the old isKpiWidget checks onto catalog viz.kind card tiles.
 */
import { GRID_COLS, findFirstOpenPosition } from "../constants/layoutConfig";

export const CATALOG_CARD_KINDS = new Set([
  "number-tile-delta",
  "number-tile",
  "scalar",
  "number-tile-sparkline",
  "sparkline-card",
]);

export function isCatalogCard(kpiId, kpis) {
  return CATALOG_CARD_KINDS.has(kpis?.[kpiId]?.viz?.kind);
}

export function createCatalogDragGeometry(kpis) {
  const isCard = (id) => isCatalogCard(id, kpis);

  function collidesWithAny(item, layout) {
    return layout.some((other) => rectsOverlap(item, other));
  }

  function computeNextCardPosition(layout, w, h) {
    const cards = layout.filter((item) => isCard(item.i));
    if (!cards.length) return findFirstOpenPosition(layout, w, h, GRID_COLS);
    const sorted = [...cards].sort((a, b) => a.y - b.y || a.x - b.x);
    const lastRowY = sorted[sorted.length - 1].y;
    const sameRow = cards.filter((item) => item.y === lastRowY);
    const nextX = sameRow.reduce((max, item) => Math.max(max, item.x + item.w), 0);
    if (nextX + w <= GRID_COLS) {
      const candidate = { x: nextX, y: lastRowY, w, h };
      if (!collidesWithAny(candidate, layout)) return { x: nextX, y: lastRowY };
    }
    return findFirstOpenPosition(layout, w, h, GRID_COLS);
  }

  function stripLayoutPositions(layout) {
    return layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
  }

  function nudgeLayoutForReflow(layout, itemIds) {
    if (!itemIds?.length) return layout;
    const idSet = new Set(itemIds);
    return layout.map((item) => {
      if (!idSet.has(item.i)) return { ...item };
      const h = item.h ?? 2;
      const w = item.w ?? 2;
      const maxH = item.maxH ?? 24;
      const maxW = item.maxW ?? 12;
      if (h < maxH) return { ...item, h: h + 1 };
      if (w < maxW) return { ...item, w: w + 1 };
      return { ...item };
    });
  }

  function placeNewItemInLayout(prev, newItem) {
    if (!collidesWithAny(newItem, prev)) {
      return [...prev, newItem];
    }
    if (isCard(newItem.i)) {
      const slot = computeNextCardPosition(prev, newItem.w, newItem.h);
      return [...prev, { ...newItem, x: slot.x, y: slot.y }];
    }
    const slot = findFirstOpenPosition(prev, newItem.w, newItem.h, GRID_COLS);
    return [...prev, { ...newItem, x: slot.x, y: slot.y }];
  }

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                            */
/* -------------------------------------------------------------------------- */

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function overlapArea(a, b) {
  const xOverlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

/** True when two grid items share an edge (touching, not overlapping). */
function gridCellsTouch(a, b) {
  const xOverlap = a.x < b.x + b.w && a.x + a.w > b.x;
  const yOverlap = a.y < b.y + b.h && a.y + a.h > b.y;
  if (!xOverlap && !yOverlap) return false;
  if (overlapArea(a, b) > 0) return false;
  return xOverlap || yOverlap;
}

function findSwapTarget(layout, dragged) {
  let target = null;
  let bestArea = 0;
  for (const item of layout) {
    if (item.i === dragged.i) continue;
    const area = overlapArea(dragged, item);
    if (area > bestArea) {
      bestArea = area;
      target = item;
    }
  }
  if (target) return target;

  const touching = layout.filter(
    (item) => item.i !== dragged.i && gridCellsTouch(dragged, item)
  );
  if (touching.length === 1) return touching[0];
  return null;
}

/** Swap target while dragging — overlap area, else center-of-drag inside another card. */
function findDragSwapTarget(layout, dropItem, excludeId) {
  const dropRect = { x: dropItem.x, y: dropItem.y, w: dropItem.w, h: dropItem.h };
  let best = null;
  let bestArea = 0;
  for (const item of layout) {
    if (item.i === excludeId) continue;
    const area = overlapArea(dropRect, item);
    if (area > bestArea) {
      bestArea = area;
      best = item;
    }
  }
  if (best) return best;

  const cx = dropRect.x + dropRect.w / 2;
  const cy = dropRect.y + dropRect.h / 2;
  return (
    layout.find(
      (item) =>
        item.i !== excludeId &&
        cx >= item.x &&
        cx < item.x + item.w &&
        cy >= item.y &&
        cy < item.y + item.h
    ) ?? null
  );
}

const KPI_ROW_MAX_Y = 2;
const KPI_GRID_H = 2;

function isTopBandItem(item) {
  return item.y < KPI_GRID_H;
}

function snapKpiRowY(y) {
  if (y < 0) return 0;
  return Math.floor(y / KPI_GRID_H) * KPI_GRID_H;
}

function compactAffectedColumns(layout, items, pinIds = []) {
  const pins = [...new Set([...pinIds, ...getPinnedKpiIds(layout)])];
  let result = layout;
  const seen = new Set();

  for (const item of items) {
    if (!item) continue;
    const key = `${item.x}:${item.x + item.w}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (let pass = 0; pass < 10; pass += 1) {
      const next = compactColumnSpanUpward(
        result,
        item.x,
        item.x + item.w,
        pins
      );
      if (layoutPositionsEqual(result, next)) break;
      result = next;
    }
  }
  return result;
}

/** Pack top-band KPIs left (or insert pinned), then fill gaps in affected columns. */
function finalizeLocalCompaction(
  layout,
  affected,
  pinIds = [],
  { packTopBand = false } = {}
) {
  const pins = [...new Set([...pinIds, ...getPinnedKpiIds(layout)])];
  let result = compactAffectedColumns(layout, affected, pins);
  if (packTopBand) {
    result = reflowKpiBand(result);
    const pinsAfter = [...new Set([...pins, ...getPinnedKpiIds(result)])];
    result = compactAffectedColumns(result, affected, pinsAfter);
  }
  return result;
}

/** KPI swap when drop center lands inside another KPI tile. */
function findKpiRowSwapTarget(layout, dropItem, activeId) {
  if (!isCard(activeId)) return null;
  const cx = dropItem.x + dropItem.w / 2;
  const cy = dropItem.y + dropItem.h / 2;
  for (const item of layout) {
    if (item.i === activeId || !isCard(item.i)) continue;
    if (
      cx >= item.x &&
      cx < item.x + item.w &&
      cy >= item.y &&
      cy < item.y + item.h
    ) {
      return item;
    }
  }
  return null;
}

/** Column-aligned KPI swap across rows (allowOverlap=false blocks center-in-rect during drag). */
function findKpiColumnSwapTarget(layout, dropItem, activeId, originItem = null) {
  if (!isCard(activeId)) return null;
  const dropLeft = dropItem.x;
  const dropRight = dropItem.x + dropItem.w;
  const dropRowY = snapKpiRowY(dropItem.y);
  const rowCandidates = new Set([dropRowY]);
  // Origin-row fallbacks only apply to nearby drops; a far-below drop must not
  // swap with a horizontally aligned KPI left behind on the origin row.
  if (originItem && Math.abs(dropRowY - snapKpiRowY(originItem.y)) <= KPI_GRID_H) {
    rowCandidates.add(snapKpiRowY(originItem.y));
    rowCandidates.add(snapKpiRowY(originItem.y + KPI_GRID_H));
    rowCandidates.add(Math.max(0, snapKpiRowY(originItem.y) - KPI_GRID_H));
  }
  for (const rowY of rowCandidates) {
    for (const item of layout) {
      if (item.i === activeId || !isCard(item.i)) continue;
      if (snapKpiRowY(item.y) !== rowY) continue;
      if (dropLeft < item.x + item.w && dropRight > item.x) {
        return item;
      }
    }
  }
  return null;
}

function resolveSwapTarget(layout, dropItem, activeId, hoverTargetId, originItem = null) {
  let target = null;
  if (hoverTargetId) {
    target =
      layout.find((item) => item.i === hoverTargetId && item.i !== activeId) ?? null;
  }
  if (!target) {
    target =
      findDragSwapTarget(layout, dropItem, activeId) ??
      findKpiRowSwapTarget(layout, dropItem, activeId) ??
      findKpiColumnSwapTarget(layout, dropItem, activeId, originItem);
  }
  if (target && isCard(activeId) && !isCard(target.i)) {
    return null;
  }
  if (target && !isCard(activeId) && isCard(target.i)) {
    return null;
  }
  return target;
}

/** Combined hover target for onDrag — exported for AdminDashboard. */
function findDragHoverTarget(layout, dropItem, excludeId, originItem = null) {
  return resolveSwapTarget(layout, dropItem, excludeId, null, originItem);
}

/** Item whose grid cell contains the pointer (used when allowOverlap blocks overlap at drop). */
function itemAtGridPoint(layout, gridX, gridY, excludeId) {
  return (
    layout.find(
      (item) =>
        item.i !== excludeId &&
        gridX >= item.x &&
        gridX < item.x + item.w &&
        gridY >= item.y &&
        gridY < item.y + item.h
    ) ?? null
  );
}

function collidesAt(item, x, y, placed) {
  const candidate = { ...item, x, y };
  return placed.some((other) => rectsOverlap(candidate, other));
}

function snapGridX(x, w) {
  return Math.max(0, Math.min(GRID_COLS - w, Math.round(x)));
}

function packKpiRowLeft(kpis) {
  let cursorX = 0;
  let cursorY = 0;
  return [...kpis]
    .sort((a, b) => a.x - b.x)
    .map((kpi) => {
      if (cursorX + kpi.w > GRID_COLS && cursorX > 0) {
        cursorX = 0;
        cursorY += KPI_GRID_H;
      }
      const item = { ...kpi, x: cursorX, y: cursorY };
      cursorX += kpi.w;
      return item;
    });
}

function insertKpiInRow(otherKpis, pinned) {
  return insertKpiInRowAtY(otherKpis, pinned, 0);
}

function insertKpiInRowAtY(otherKpis, pinned, rowY) {
  const pinX = snapGridX(pinned.x, pinned.w);
  const sorted = [...otherKpis].sort((a, b) => a.x - b.x);
  let insertIdx = sorted.findIndex((kpi) => kpi.x >= pinX);
  if (insertIdx < 0) insertIdx = sorted.length;
  const ordered = [
    ...sorted.slice(0, insertIdx),
    { ...pinned, x: pinX, y: rowY },
    ...sorted.slice(insertIdx),
  ];

  const placed = [];
  const fitInRow = (startX, w, y) => {
    let x = startX;
    for (const prev of placed) {
      if (prev.y === y && x < prev.x + prev.w && x + w > prev.x) {
        x = prev.x + prev.w;
      }
    }
    return x;
  };
  for (const item of ordered) {
    let y = rowY;
    let x = fitInRow(item.i === pinned.i ? pinX : item.x, item.w, y);
    // Wrap onto the next KPI row instead of overflowing past the grid edge
    // (normalizeItem would clamp x back and create a locked card overlap).
    while (x + item.w > GRID_COLS) {
      y += KPI_GRID_H;
      x = fitInRow(0, item.w, y);
    }
    placed.push({ ...item, x, y });
  }
  return placed;
}

/** Pack KPIs on row 0 left; below-band tiles stay anchored. */
function reflowKpiBand(layout, pinItemId = null) {
  const kpis = layout.filter((item) => isCard(item.i));
  const others = layout.filter((item) => !isCard(item.i));
  const pinned = pinItemId ? kpis.find((item) => item.i === pinItemId) : null;

  const belowBand = kpis.filter((item) => {
    if (pinned && item.i === pinItemId) return !isTopBandItem(pinned);
    return !isTopBandItem(item);
  });

  const topBandItems = kpis.filter((item) => isTopBandItem(item));
  let rowKpis;
  if (pinned && isTopBandItem(pinned)) {
    const merged = [
      ...topBandItems.filter((item) => item.i !== pinItemId),
      pinned,
    ];
    rowKpis = packKpiRowLeft(merged.map((item) => ({ ...item, y: 0 })));
  } else {
    rowKpis = packKpiRowLeft(topBandItems.map((item) => ({ ...item, y: 0 })));
  }

  const belowWithoutPin = belowBand.filter(
    (item) => !(pinned && item.i === pinItemId)
  );
  const pinnedBelow =
    pinned && !isTopBandItem(pinned)
      ? [{ ...pinned, x: snapGridX(pinned.x, pinned.w), y: pinned.y }]
      : [];

  return [...rowKpis, ...belowWithoutPin, ...pinnedBelow, ...others];
}

/** Pack every KPI into wrapped rows (left-to-right, top-to-bottom) before compacting. */
function reflowAllKpiRows(layout) {
  const anchored = new Set(getPinnedKpiIds(layout));
  const kpis = layout.filter((item) => isCard(item.i) && !anchored.has(item.i));
  const others = layout.filter((item) => !isCard(item.i) || anchored.has(item.i));
  const sorted = [...kpis].sort((a, b) => a.y - b.y || a.x - b.x);

  const rows = [];
  let currentRow = [];
  let currentWidth = 0;

  for (const kpi of sorted) {
    if (currentWidth + kpi.w > GRID_COLS && currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = [];
      currentWidth = 0;
    }
    currentRow.push(kpi);
    currentWidth += kpi.w;
  }
  if (currentRow.length > 0) rows.push(currentRow);

  let y = 0;
  const placed = [];
  for (const row of rows) {
    let x = 0;
    let rowH = 0;
    for (const kpi of row) {
      placed.push({ ...kpi, x, y });
      x += kpi.w;
      rowH = Math.max(rowH, kpi.h);
    }
    y += rowH;
  }

  return [...placed, ...others];
}

function getKpiBandBottom(layout) {
  const kpis = layout.filter((item) => isCard(item.i));
  if (!kpis.length) return 0;
  return Math.max(...kpis.map((item) => item.y + item.h));
}

function getCompactFloorY(layout) {
  return getKpiBandBottom(layout);
}

/** Chart band floor from KPI tiles that span a column range. */
function getColumnFloorY(layout, colStart, colEnd) {
  const kpis = layout.filter(
    (item) => isCard(item.i) && itemSpansColumn(item, colStart, colEnd)
  );
  if (!kpis.length) return 0;
  return Math.max(...kpis.map((item) => item.y + item.h));
}

/** Chart floor from top-band KPIs only — below-band tiles must not block pull-up. */
function getChartBandFloorY(layout) {
  const topKpis = layout.filter((item) => isCard(item.i) && isTopBandItem(item));
  if (!topKpis.length) return 0;
  return Math.max(...topKpis.map((item) => item.y + item.h));
}

/** True when the drop is below the top KPI strip (free placement like a chart). */
function isDropBelowKpiBand(layout, dropItem, activeId, origin = null) {
  if (!dropItem) return false;
  if (dropItem.y < KPI_GRID_H) return false;
  if (origin && dropItem.y > origin.y) return true;
  const others = layout.filter((item) => item.i !== activeId);
  const topBandKpis = others.filter((item) => isCard(item.i) && item.y < KPI_GRID_H);
  const topBandBottom = topBandKpis.length
    ? Math.max(...topBandKpis.map((item) => item.y + item.h))
    : KPI_GRID_H;
  return dropItem.y >= topBandBottom;
}

function vacatedTopBandSlot(origin) {
  return origin && origin.y < KPI_GRID_H;
}

/** Lowest y a below-band KPI drop may use (clears the top KPI strip). */
function getTopBandBottom(layout, excludeId = null) {
  const topKpis = layout.filter(
    (item) =>
      isCard(item.i) &&
      item.i !== excludeId &&
      item.y < KPI_GRID_H
  );
  return topKpis.length
    ? Math.max(...topKpis.map((item) => item.y + item.h))
    : KPI_GRID_H;
}

function clampBelowBandDropY(layout, activeId, y, origin = null) {
  if (!origin || origin.y < KPI_GRID_H) {
    return Math.max(getTopBandBottom(layout, activeId), y);
  }
  return y;
}

/** KPI tiles placed below the top band stay anchored during unrelated moves. */
function getPinnedKpiIds(layout) {
  return layout
    .filter((item) => isCard(item.i) && isDropBelowKpiBand(layout, item, item.i))
    .map((item) => item.i);
}

/** Column regions that may compact after a move (moved tile + swap partner + origin gap). */
function buildCompactionAffected(movedItem, origin, oldItem, swapTarget, didSwap) {
  const affected = [movedItem];
  if (didSwap && swapTarget) affected.push(swapTarget);
  if (
    origin.x !== movedItem.x ||
    origin.y !== movedItem.y
  ) {
    affected.push({
      x: origin.x,
      y: origin.y,
      w: oldItem.w,
      h: oldItem.h,
    });
  }
  return affected;
}

/** Push charts overlapping the top KPI strip downward. */
function pushChartsBelowTopKpiBand(layout) {
  const band = { x: 0, y: 0, w: GRID_COLS, h: KPI_GRID_H, i: "__kpi_band__" };
  const immovable = new Set(layout.filter((item) => isCard(item.i)).map((item) => item.i));
  let result = pushOverlappingChartsBelow(layout, band, immovable);
  return resolveRemainingOverlaps(result, Array.from(immovable));
}

/** Pull charts up to the KPI band floor; optionally repack the top KPI row. */
function compactGapsUpward(
  layout,
  pinIds = [],
  { packKpis = false, packKpiPin = null, colStart, colEnd } = {}
) {
  const pins = [...new Set([...pinIds, ...getPinnedKpiIds(layout)])];
  let source = layout;
  if (packKpis) {
    source = reflowKpiBand(layout, packKpiPin ?? undefined);
    source = pushChartsBelowTopKpiBand(source);
  }
  const start = colStart ?? 0;
  const end = colEnd ?? GRID_COLS;
  const floor = getChartBandFloorY(source);
  let result = source;
  for (let pass = 0; pass < 10; pass += 1) {
    const next = compactColumnSpanUpward(result, start, end, pins, floor);
    if (layoutPositionsEqual(result, next)) break;
    result = next;
  }
  return result;
}

function findOpenPositionBelow(layout, w, h, minY = 0) {
  const placed = layout.map((item) => ({ ...item }));
  const maxY = placed.length
    ? Math.max(minY, ...placed.map((item) => item.y + item.h))
    : minY;
  const yLimit = maxY + h + 12;

  for (let y = minY; y <= yLimit; y += 1) {
    for (let x = 0; x <= GRID_COLS - w; x += 1) {
      const candidate = { x, y, w, h };
      if (!placed.some((other) => rectsOverlap(candidate, other))) {
        return { x, y };
      }
    }
  }
  return { x: 0, y: maxY };
}

function itemSpansColumn(item, colStart, colEnd) {
  return item.x < colEnd && item.x + item.w > colStart;
}

/**
 * Push only charts overlapping obstacle; cascade blockers downward.
 * KPIs and immovable ids are never moved.
 */
function pushOverlappingChartsBelow(layout, obstacle, immovableIds = new Set()) {
  let result = layout.map((item) => ({ ...item }));
  const immovable = new Set([
    ...immovableIds,
    ...result.filter((i) => isCard(i.i)).map((i) => i.i),
  ]);
  const obstacleBottom = obstacle.y + obstacle.h;
  const moves = [];

  for (let iter = 0; iter < 60; iter += 1) {
    let moved = false;
    const overlapping = result
      .filter((item) => !immovable.has(item.i) && rectsOverlap(item, obstacle))
      .sort((a, b) => a.y - b.y);

    if (overlapping.length === 0) break;

    for (const item of overlapping) {
      const idx = result.findIndex((i) => i.i === item.i);
      let y = Math.max(result[idx].y, obstacleBottom);

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const candidate = { ...result[idx], y };
        const blockers = result.filter(
          (other, oi) =>
            oi !== idx &&
            !immovable.has(other.i) &&
            rectsOverlap(candidate, other)
        );
        if (blockers.length === 0) {
          if (y !== result[idx].y) {
            moves.push({
              id: result[idx].i,
              from: { x: result[idx].x, y: result[idx].y },
              to: { x: result[idx].x, y },
            });
            result[idx] = { ...result[idx], y };
            moved = true;
          }
          break;
        }
        const blocker = blockers.sort((a, b) => a.y - b.y)[0];
        const blockerIdx = result.findIndex((i) => i.i === blocker.i);
        const pushY = candidate.y + candidate.h;
        if (result[blockerIdx].y < pushY) {
          moves.push({
            id: blocker.i,
            from: { x: blocker.x, y: blocker.y },
            to: { x: blocker.x, y: pushY },
          });
          result[blockerIdx] = { ...result[blockerIdx], y: pushY };
          moved = true;
        } else {
          y += 1;
        }
      }
    }
    if (!moved) break;
  }


  return result;
}

/** Pull charts up within a column span only (e.g. after widget removal). */
function compactColumnSpanUpward(layout, colStart, colEnd, pinIds = [], floorY = null) {
  const resolvedFloor =
    floorY ?? getColumnFloorY(layout, colStart, colEnd);
  const pinSet = new Set(pinIds.filter(Boolean));
  const fixed = layout.filter(
    (item) =>
      isCard(item.i) ||
      pinSet.has(item.i) ||
      !itemSpansColumn(item, colStart, colEnd)
  );
  const movable = layout
    .filter(
      (item) =>
        !isCard(item.i) &&
        !pinSet.has(item.i) &&
        itemSpansColumn(item, colStart, colEnd)
    )
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const placed = fixed.map((item) => ({ ...item }));
  const moves = [];
  for (const chart of movable) {
    let y = resolvedFloor;
    while (collidesAt(chart, chart.x, y, placed)) y += 1;
    const newY = Math.min(chart.y, y);
    const placedItem = { ...chart, y: newY };
    if (placedItem.y !== chart.y) {
      moves.push({
        id: chart.i,
        from: { x: chart.x, y: chart.y },
        to: { x: placedItem.x, y: placedItem.y },
      });
    }
    placed.push(placedItem);
  }


  return placed;
}

function compactAfterRemove(layout, _removed) {
  return compactGapsUpward(layout, []);
}

/** Relocate any remaining overlaps (non-KPI, non-pinned items move). */
function resolveRemainingOverlaps(layout, pinItemIds = []) {
  const pinSet = new Set(pinItemIds.filter(Boolean));
  let result = layout.map((item) => ({ ...item }));
  let guard = 0;

  while (hasOverlaps(result) && guard < 40) {
    guard += 1;
    let changed = false;

    for (let i = 0; i < result.length; i += 1) {
      for (let j = i + 1; j < result.length; j += 1) {
        if (!rectsOverlap(result[i], result[j])) continue;

        const iCard = isCard(result[i].i);
        const jCard = isCard(result[j].i);
        const iLocked = pinSet.has(result[i].i) || iCard;
        const jLocked = pinSet.has(result[j].i) || jCard;
        let moveIdx = -1;
        if (!iLocked && jLocked) moveIdx = i;
        else if (iLocked && !jLocked) moveIdx = j;
        else if (!iLocked && !jLocked) moveIdx = j;
        else if (iCard && jCard) {
          // Card/card collisions need a deterministic repair path too:
          // relocate a non-pinned card to the next open card slot.
          if (!pinSet.has(result[j].i)) moveIdx = j;
          else if (!pinSet.has(result[i].i)) moveIdx = i;
        }
        if (moveIdx < 0) continue;

        const moving = result[moveIdx];
        const without = result.filter((_, idx) => idx !== moveIdx);
        const slot = isCard(moving.i)
          ? computeNextCardPosition(without, moving.w, moving.h)
          : findOpenPositionBelow(
              without,
              moving.w,
              moving.h,
              getCompactFloorY(without)
            );
        const relocated = {
          ...moving,
          x: slot.x,
          y: slot.y,
        };
        if (relocated.x !== moving.x || relocated.y !== moving.y) {
          result[moveIdx] = relocated;
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  return result;
}

/** Keep dropped chart at placeholder; push only overlapping charts down. */
function pushAsideOverlapped(layout, pinnedId) {
  const pinned = layout.find((item) => item.i === pinnedId);
  if (!pinned) return layout;

  const immovable = new Set([pinnedId]);
  let result = pushOverlappingChartsBelow(layout, pinned, immovable);
  result = resolveRemainingOverlaps(result, [pinnedId]);


  return result;
}

/**
 * Compact charts in the resized item's column span only.
 */
function compactVertically(layout, pinItemId = null) {
  if (!pinItemId) return layout;
  const pinned = layout.find((item) => item.i === pinItemId);
  if (!pinned) return layout;
  return compactColumnSpanUpward(
    layout,
    pinned.x,
    pinned.x + pinned.w,
    [pinItemId, ...getPinnedKpiIds(layout)]
  );
}

/** Post-drag: KPI gap-insert when not swapping, chart push-aside only (no global compact). */
function finalizeAfterDrag(resolved, activeId, didSwap, origin = null, swapTarget = null) {
  const dragged = resolved.find((item) => item.i === activeId);
  if (!dragged) return resolved;

  const pinIds = [activeId];

  if (didSwap) {
    if (isCard(activeId)) {
      const affected = [dragged, swapTarget].filter(Boolean);
      if (origin) {
        affected.push({
          x: origin.x,
          y: origin.y,
          w: dragged.w,
          h: dragged.h,
        });
      }
      return compactAffectedColumns(resolved, affected, [
        ...pinIds,
        ...getPinnedKpiIds(resolved),
      ]);
    }
    let next = pushAsideOverlapped(resolved, activeId);
    const affected = [dragged];
    if (swapTarget) {
      affected.push(swapTarget);
      if (origin) {
        affected.push({
          x: origin.x,
          y: origin.y,
          w: swapTarget.w,
          h: swapTarget.h,
        });
      }
    }
    return compactAffectedColumns(next, affected, pinIds);
  }

  if (isCard(activeId)) {
    const dropBelow = isDropBelowKpiBand(resolved, dragged, activeId, origin);
    let dropY = dropBelow
      ? clampBelowBandDropY(resolved, activeId, Math.max(0, dragged.y), origin)
      : snapKpiRowY(dragged.y);
    const snapped = {
      ...dragged,
      x: snapGridX(dragged.x, dragged.w),
      y: dropY,
    };
    const withSnap = resolved.map((item) =>
      item.i === activeId ? snapped : item
    );
    if (dropBelow) {
      const alreadyBelow = origin && origin.y >= KPI_GRID_H;
      if (alreadyBelow) {
        return hasOverlaps(withSnap)
          ? resolveRemainingOverlaps(withSnap, [
              activeId,
              ...getPinnedKpiIds(withSnap),
            ])
          : withSnap;
      }
      if (hasOverlaps(withSnap)) {
        return pushAsideOverlapped(withSnap, activeId);
      }
      return withSnap;
    }
    return withSnap;
  }

  const kpiBottom = getCompactFloorY(resolved);
  const adjusted =
    dragged.y < kpiBottom
      ? resolved.map((item) =>
          item.i === activeId ? { ...item, y: kpiBottom } : item
        )
      : resolved;
  if (hasOverlaps(adjusted)) {
    return pushAsideOverlapped(adjusted, activeId);
  }
  return adjusted;
}

function finalizeAfterAdd(layout) {
  const next = hasOverlaps(layout)
    ? resolveRemainingOverlaps(layout, [])
    : layout;
  return next;
}

/** Insert KPI at drop row/column; only adjacent charts in the row band move. */
function applyKpiInsertDrop(layout, newItem) {
  const rowY = snapKpiRowY(newItem.y);
  const snapped = {
    ...newItem,
    x: snapGridX(newItem.x, newItem.w),
    y: rowY,
  };

  const rowKpis = layout.filter(
    (item) =>
      isCard(item.i) &&
      item.i !== snapped.i &&
      item.y >= rowY &&
      item.y < rowY + KPI_GRID_H
  );
  const otherKpis = layout.filter(
    (item) =>
      isCard(item.i) &&
      item.i !== snapped.i &&
      !(item.y >= rowY && item.y < rowY + KPI_GRID_H)
  );
  const charts = layout.filter((item) => !isCard(item.i));
  const rowInserted = insertKpiInRowAtY(rowKpis, snapped, rowY);
  const merged = [...otherKpis, ...rowInserted, ...charts];

  const band = { x: 0, y: rowY, w: GRID_COLS, h: KPI_GRID_H, i: "__kpi_band__" };
  const immovable = new Set([
    snapped.i,
    ...rowInserted.map((k) => k.i),
    ...otherKpis.map((k) => k.i),
  ]);
  let result = pushOverlappingChartsBelow(merged, band, immovable);
  result = resolveRemainingOverlaps(result, Array.from(immovable));
  result = compactGapsUpward(result, [], { packKpis: false });

  return result;
}

/** Inventory / explicit drop — KPI row insert or chart push-aside. */
function applyExplicitDrop(prev, newItem) {
  if (isCard(newItem.i)) {
    if (isDropBelowKpiBand(prev, newItem, newItem.i)) {
      const placed = {
        ...newItem,
        x: snapGridX(newItem.x, newItem.w),
        y: Math.max(0, newItem.y),
      };
      let result = pushAsideOverlapped([...prev, placed], newItem.i);
      result = compactGapsUpward(result, [newItem.i], { packKpis: false });
      return result;
    }
    return applyKpiInsertDrop([...prev, newItem], newItem);
  }
  let result = pushAsideOverlapped([...prev, newItem], newItem.i);
  result = compactAffectedColumns(result, [newItem], [
    newItem.i,
    ...getPinnedKpiIds(result),
  ]);
  return result;
}

/** Compact upward within each item's column — preserves horizontal positions. */
function compactInColumn(layout, pinItemId = null) {
  const sorted = [...layout]
    .map((item) => ({ ...item }))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const placed = [];
  const moves = [];
  for (const item of sorted) {
    if (pinItemId && item.i === pinItemId) {
      placed.push({ ...item });
      continue;
    }
    let y = 0;
    while (collidesAt(item, item.x, y, placed)) y += 1;
    const placedItem = { ...item, y };
    if (placedItem.x !== item.x || placedItem.y !== item.y) {
      moves.push({
        id: item.i,
        from: { x: item.x, y: item.y },
        to: { x: placedItem.x, y: placedItem.y },
        xChanged: placedItem.x !== item.x,
      });
    }
    placed.push(placedItem);
  }


  return placed;
}

function hasOverlaps(layout) {
  for (let i = 0; i < layout.length; i += 1) {
    for (let j = i + 1; j < layout.length; j += 1) {
      if (rectsOverlap(layout[i], layout[j])) return true;
    }
  }
  return false;
}

function layoutPositionsEqual(a, b) {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((item) => [item.i, item]));
  return a.every((item) => {
    const other = byId.get(item.i);
    return (
      other &&
      item.x === other.x &&
      item.y === other.y &&
      item.w === other.w &&
      item.h === other.h
    );
  });
}

/**
 * Swap the dragged card with the card it was dropped onto.
 * The dragged card snaps to the displaced card's position, and the displaced
 * card moves to where the dragged card started. If the card was dropped on
 * empty space, nothing is swapped and the dragged card keeps its new position.
 */
function swapOnDrop(layout, activeId, origin, hoverTargetId = null) {
  const dragged = layout.find((item) => item.i === activeId);
  if (!dragged) return layout;

  let target = null;
  if (hoverTargetId) {
    target = layout.find((item) => item.i === hoverTargetId && item.i !== activeId) ?? null;
  }
  if (!target) {
    target = findSwapTarget(layout, dragged);
  }
  if (!target) return layout;
  if (isCard(activeId) && !isCard(target.i)) return layout;

  const targetPos = { x: target.x, y: target.y };
  return layout.map((item) => {
    if (item.i === activeId) return { ...item, x: targetPos.x, y: targetPos.y };
    if (item.i === target.i) return { ...item, x: origin.x, y: origin.y };
    return item;
  });
}

/**
 * Resolve drag stop: swap when dropped onto another card, otherwise keep the
 * dropped x/y (free placement anywhere on the grid).
 */
function applyDragResult(
  layout,
  activeId,
  origin,
  dropItem,
  hoverTargetId = null,
  originLayout = null
) {
  const dragged = layout.find((item) => item.i === activeId);
  if (!dragged) return layout;

  const staticLayout = originLayout ?? layout;
  const originItem = originLayout?.find((item) => item.i === activeId) ?? null;
  let target = resolveSwapTarget(
    staticLayout,
    dropItem,
    activeId,
    hoverTargetId,
    originItem
  );

  if (target) {
    const targetPos = { x: target.x, y: target.y };
    return layout.map((item) => {
      if (item.i === activeId) return { ...item, x: targetPos.x, y: targetPos.y };
      if (item.i === target.i) return { ...item, x: origin.x, y: origin.y };
      return item;
    });
  }

  const dropX = snapGridX(dropItem.x, dragged.w);
  const dropBelow =
    isCard(activeId) && isDropBelowKpiBand(layout, dropItem, activeId, origin);
  let dropY = dropBelow
    ? Math.max(0, dropItem.y)
    : isCard(activeId)
      ? snapKpiRowY(dropItem.y)
      : dropItem.y;
  if (dropBelow && vacatedTopBandSlot(origin)) {
    dropY = clampBelowBandDropY(layout, activeId, dropY, origin);
  }

  return layout.map((item) =>
    item.i === activeId ? { ...item, x: dropX, y: dropY } : item
  );
}

  return {
    findDragHoverTarget,
    findDragSwapTarget,
    applyDragResult,
    resolveSwapTarget,
    finalizeAfterDrag,
    finalizeAfterAdd,
    applyExplicitDrop,
    placeNewItemInLayout,
    compactVertically,
    compactGapsUpward,
    resolveRemainingOverlaps,
    hasOverlaps,
    layoutPositionsEqual,
    stripLayoutPositions,
    nudgeLayoutForReflow,
    compactAfterRemove,
    reflowAllKpiRows,
    reflowKpiBand,
    snapKpiRowY,
    isDropBelowKpiBand,
    getPinnedKpiIds,
    buildCompactionAffected,
    compactAffectedColumns,
    finalizeLocalCompaction,
    vacatedTopBandSlot,
  };
}
