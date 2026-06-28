import { useCallback, useRef, useState } from "react";
import { getLayoutStorageKey } from "../config/dashboardConfig";
import {
  DEFAULT_LAYOUT,
  WIDGETS,
  buildNewLayoutItem,
  findFirstOpenPosition,
  computeNextKpiPosition,
  getDefaultKpiLayoutItem,
  getChartTypeSizeConstraints,
  isHeightLockedChart,
  isKpiWidget,
  DEFAULT_CHART_LAYOUT,
  GRID_COLS,
  applyCatalogDimensions,
  reconcileInventoryWidgetDimensions,
} from "../constants/layoutConfig";
import { isSparklineKpi } from "../config/kpiSparkline";

const LEGACY_DEMO_STACKED_WIDGET_ID = "demo-viz-stacked-horizontal";
const LIVE_OFFICER_SLA_WIDGET_ID = "cl-chart-officer-sla";

const LEGACY_PIE_WIDGET_ID = "demo-viz-pie";
const LIVE_PIE_WIDGET_ID = "cl-chart-open-by-channel";
const LEGACY_SLA_RISK_WIDGET_ID = "demo-viz-sla-risk";
const LIVE_SLA_RISK_WIDGET_ID = "cl-table-complaints-at-risk";
const LEGACY_FLOW_RATIO_WIDGET_ID = "demo-viz-leaderboard";
const LIVE_FLOW_RATIO_WIDGET_ID = "cl-chart-department-flow-ratio";
const LEGACY_GEOGRAPHY_MAP_WIDGET_ID = "demo-viz-map";
const LIVE_GEOGRAPHY_MAP_WIDGET_ID = "cl-map-geography-choropleth";
const DEFAULT_REOPEN_RATE_KPI_ID = "cl-metric-reopen-rate";
const LEGACY_ZONE_REOPEN_RATE_KPI_ID = "ce-metric-reopen-rate";
const DEFAULT_CSAT_KPI_ID = "cl-metric-csat";
const LEGACY_ZONE_CSAT_KPI_ID = "ce-metric-csat";
const DEFAULT_RESOLUTION_RATE_KPI_ID = "cl-metric-resolution-rate";
const LEGACY_ON_TIME_SLA_KPI_ID = "rs-metric-sla-compliance";
const LEGACY_RESOLVED_ON_TIME_RATE_KPI_ID = "cl-metric-resolved-on-time-rate";

/** Swap the demo channel pie for the live open-complaints pie in saved layouts. */
function migratePieChannelWidget(layout) {
  const hasLivePie = layout.some((item) => item.i === LIVE_PIE_WIDGET_ID);

  return layout.reduce((next, item) => {
    if (item.i !== LEGACY_PIE_WIDGET_ID) {
      next.push(item);
      return next;
    }

    if (hasLivePie) return next;

    const defaults = DEFAULT_CHART_LAYOUT[LIVE_PIE_WIDGET_ID] ?? {};
    next.push(applyCatalogDimensions({ ...item, i: LIVE_PIE_WIDGET_ID }));
    return next;
  }, []);
}

/** Swap the demo SLA-at-risk table for the live complaints-at-risk table. */
function migrateSlaRiskWidget(layout) {
  const hasLive = layout.some((item) => item.i === LIVE_SLA_RISK_WIDGET_ID);

  return layout.reduce((next, item) => {
    if (item.i !== LEGACY_SLA_RISK_WIDGET_ID) {
      next.push(item);
      return next;
    }

    if (hasLive) return next;

    next.push(applyCatalogDimensions({ ...item, i: LIVE_SLA_RISK_WIDGET_ID }));
    return next;
  }, []);
}

/** Swap the demo flow-ratio leaderboard for the live department chart. */
function migrateFlowRatioWidget(layout) {
  const hasLive = layout.some((item) => item.i === LIVE_FLOW_RATIO_WIDGET_ID);

  return layout.reduce((next, item) => {
    if (item.i !== LEGACY_FLOW_RATIO_WIDGET_ID) {
      next.push(item);
      return next;
    }

    if (hasLive) return next;

    next.push(applyCatalogDimensions({ ...item, i: LIVE_FLOW_RATIO_WIDGET_ID }));
    return next;
  }, []);
}

/** Swap the demo team SLA stacked bar for the live officer SLA chart. */
function migrateDemoStackedToOfficerSla(layout) {
  const hasLive = layout.some((item) => item.i === LIVE_OFFICER_SLA_WIDGET_ID);

  return layout.reduce((next, item) => {
    if (item.i !== LEGACY_DEMO_STACKED_WIDGET_ID) {
      next.push(item);
      return next;
    }

    if (hasLive) return next;

    next.push(applyCatalogDimensions({ ...item, i: LIVE_OFFICER_SLA_WIDGET_ID }));
    return next;
  }, []);
}

/** Swap the demo pin map for the live geography choropleth. */
function migrateGeographyMapWidget(layout) {
  const hasLive = layout.some((item) => item.i === LIVE_GEOGRAPHY_MAP_WIDGET_ID);

  return layout.reduce((next, item) => {
    if (item.i !== LEGACY_GEOGRAPHY_MAP_WIDGET_ID) {
      next.push(item);
      return next;
    }

    if (hasLive) return next;

    next.push(applyCatalogDimensions({ ...item, i: LIVE_GEOGRAPHY_MAP_WIDGET_ID }));
    return next;
  }, []);
}

/** Use complaint-landscape CSAT tile in place of the zone sparkline CSAT KPI. */
function migrateDefaultCsatKpi(layout) {
  const hasLive = layout.some((item) => item.i === DEFAULT_CSAT_KPI_ID);

  return layout.reduce((next, item) => {
    if (item.i !== LEGACY_ZONE_CSAT_KPI_ID) {
      next.push(item);
      return next;
    }

    if (hasLive) return next;

    next.push({ ...item, i: DEFAULT_CSAT_KPI_ID });
    return next;
  }, []);
}

/** Use complaint-landscape reopen tile (delta) in place of the zone sparkline reopen KPI. */
function migrateDefaultReopenRateKpi(layout) {
  const hasLive = layout.some((item) => item.i === DEFAULT_REOPEN_RATE_KPI_ID);

  return layout.reduce((next, item) => {
    if (item.i !== LEGACY_ZONE_REOPEN_RATE_KPI_ID) {
      next.push(item);
      return next;
    }

    if (hasLive) return next;

    next.push({ ...item, i: DEFAULT_REOPEN_RATE_KPI_ID });
    return next;
  }, []);
}

const LEGACY_REMOVED_KPI_IDS = new Set([
  "rs-metric-sla-compliance",
  "ce-metric-reopen-rate",
  "ce-metric-csat",
]);

function purgeRemovedKpis(layout) {
  return layout.filter((item) => !LEGACY_REMOVED_KPI_IDS.has(item.i));
}

function migrateDefaultResolutionRateKpi(layout) {
  const hasLive = layout.some((item) => item.i === DEFAULT_RESOLUTION_RATE_KPI_ID);

  if (hasLive) {
    return layout.filter(
      (item) =>
        item.i !== LEGACY_ON_TIME_SLA_KPI_ID &&
        item.i !== LEGACY_RESOLVED_ON_TIME_RATE_KPI_ID
    );
  }

  let migrated = false;
  return layout.reduce((next, item) => {
    if (
      item.i === LEGACY_ON_TIME_SLA_KPI_ID ||
      item.i === LEGACY_RESOLVED_ON_TIME_RATE_KPI_ID
    ) {
      if (migrated) return next;
      migrated = true;
      next.push({ ...item, i: DEFAULT_RESOLUTION_RATE_KPI_ID });
      return next;
    }

    next.push(item);
    return next;
  }, []);
}

function migrateSavedLayoutWidgets(layout) {
  return purgeRemovedKpis(
    migrateDefaultResolutionRateKpi(
      migrateDefaultCsatKpi(
      migrateDefaultReopenRateKpi(
        migrateGeographyMapWidget(
          migrateFlowRatioWidget(
            migrateSlaRiskWidget(
              migratePieChannelWidget(migrateDemoStackedToOfficerSla(layout))
            )
          )
        )
      )
      )
    )
  );
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
export function findDragSwapTarget(layout, dropItem, excludeId) {
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

function snapKpiRowY(y) {
  // Row 0 spans y∈[0,2); row 1 spans y∈[2,4). y=1 is still row 0, not row 2.
  if (y < KPI_GRID_H) return 0;
  return KPI_GRID_H;
}

function compactAffectedColumns(layout, items, pinIds = []) {
  const floor = getCompactFloorY(layout);
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
        floor,
        pinIds
      );
      if (layoutPositionsEqual(result, next)) break;
      result = next;
    }
  }
  return result;
}

/** KPI-row swap only when drop center lands inside another KPI (gap drops insert instead). */
function findKpiRowSwapTarget(layout, dropItem, activeId) {
  if (!isKpiWidget(activeId)) return null;
  const cx = dropItem.x + dropItem.w / 2;
  const cy = dropItem.y + dropItem.h / 2;
  for (const item of layout) {
    if (item.i === activeId || !isKpiWidget(item.i)) continue;
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

function resolveSwapTarget(layout, dropItem, activeId, hoverTargetId) {
  let target = null;
  if (hoverTargetId) {
    target =
      layout.find((item) => item.i === hoverTargetId && item.i !== activeId) ?? null;
  }
  if (!target) {
    target =
      findDragSwapTarget(layout, dropItem, activeId) ??
      findKpiRowSwapTarget(layout, dropItem, activeId);
  }
  if (target && isKpiWidget(activeId) && !isKpiWidget(target.i)) {
    return null;
  }
  if (target && !isKpiWidget(activeId) && isKpiWidget(target.i)) {
    return null;
  }
  return target;
}

/** Combined hover target for onDrag — exported for DashboardGrid. */
export function findDragHoverTarget(layout, dropItem, excludeId) {
  return resolveSwapTarget(layout, dropItem, excludeId, null);
}

/** Item whose grid cell contains the pointer (used when allowOverlap blocks overlap at drop). */
export function itemAtGridPoint(layout, gridX, gridY, excludeId) {
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
  let cursor = 0;
  return [...kpis]
    .sort((a, b) => a.x - b.x)
    .map((kpi) => {
      const item = { ...kpi, x: cursor, y: 0 };
      cursor += kpi.w;
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
  for (const item of ordered) {
    let x = item.i === pinned.i ? pinX : item.x;
    for (const prev of placed) {
      if (x < prev.x + prev.w && x + item.w > prev.x) {
        x = prev.x + prev.w;
      }
    }
    placed.push({ ...item, x, y: rowY });
  }
  return placed;
}

/** Pack KPIs on row 0; insert pinned KPI at drop column when in the top band. */
function reflowKpiBand(layout, pinItemId = null) {
  const kpis = layout.filter((item) => isKpiWidget(item.i));
  const others = layout.filter((item) => !isKpiWidget(item.i));
  const pinned = pinItemId ? kpis.find((item) => item.i === pinItemId) : null;

  const belowBand = kpis.filter((item) => {
    if (pinItemId && item.i === pinItemId && pinned) {
      return pinned.y > KPI_ROW_MAX_Y;
    }
    return item.y > KPI_ROW_MAX_Y;
  });

  const rowCandidates = kpis.filter((item) => {
    if (pinItemId && item.i === pinItemId) return false;
    return item.y <= KPI_ROW_MAX_Y;
  });

  let rowKpis;
  if (pinned && pinned.y <= KPI_ROW_MAX_Y) {
    rowKpis = insertKpiInRow(rowCandidates, pinned);
  } else {
    rowKpis = packKpiRowLeft(rowCandidates.map((item) => ({ ...item, y: 0 })));
  }

  const pinnedBelow =
    pinned && pinned.y > KPI_ROW_MAX_Y
      ? [{ ...pinned, x: snapGridX(pinned.x, pinned.w), y: pinned.y }]
      : [];
  const belowWithoutPin = belowBand.filter(
    (item) => !(pinned && item.i === pinItemId)
  );

  return [...rowKpis, ...belowWithoutPin, ...pinnedBelow, ...others];
}

/** Pack every KPI into wrapped rows (left-to-right, top-to-bottom) before compacting. */
function reflowAllKpiRows(layout) {
  const kpis = layout.filter((item) => isKpiWidget(item.i));
  const others = layout.filter((item) => !isKpiWidget(item.i));
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
  const kpis = layout.filter((item) => isKpiWidget(item.i));
  if (!kpis.length) return 0;
  return Math.max(...kpis.map((item) => item.y + item.h));
}

/** Chart band floor from actual KPI positions (never repack for floor math). */
function getCompactFloorY(layout) {
  const kpis = layout.filter((item) => isKpiWidget(item.i));
  if (!kpis.length) return 0;
  return Math.max(...kpis.map((item) => item.y + item.h));
}

/** Pull charts up within column span to fill gaps (never push down). */
function compactGapsUpward(layout, pinIds = [], { packKpis = true } = {}) {
  const source = packKpis ? reflowAllKpiRows(layout) : layout;
  const floor = getCompactFloorY(source);
  let result = source;
  for (let pass = 0; pass < 10; pass += 1) {
    const next = compactColumnSpanUpward(result, 0, GRID_COLS, floor, pinIds);
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
    ...result.filter((i) => isKpiWidget(i.i)).map((i) => i.i),
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

/** Pull charts upward within a column span only (e.g. after widget removal). */
function compactColumnSpanUpward(layout, colStart, colEnd, floorY, pinIds = []) {
  const pinSet = new Set(pinIds.filter(Boolean));
  const fixed = layout.filter(
    (item) =>
      isKpiWidget(item.i) ||
      pinSet.has(item.i) ||
      !itemSpansColumn(item, colStart, colEnd)
  );
  const movable = layout
    .filter(
      (item) =>
        !isKpiWidget(item.i) &&
        !pinSet.has(item.i) &&
        itemSpansColumn(item, colStart, colEnd)
    )
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const placed = fixed.map((item) => ({ ...item }));
  const moves = [];
  for (const chart of movable) {
    let y = floorY;
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

        const iLocked = pinSet.has(result[i].i) || isKpiWidget(result[i].i);
        const jLocked = pinSet.has(result[j].i) || isKpiWidget(result[j].i);
        let moveIdx = -1;
        if (!iLocked && jLocked) moveIdx = i;
        else if (iLocked && !jLocked) moveIdx = j;
        else if (!iLocked && !jLocked) moveIdx = j;
        if (moveIdx < 0) continue;

        const moving = result[moveIdx];
        const without = result.filter((_, idx) => idx !== moveIdx);
        const floorY = getCompactFloorY(without);
        const slot = findOpenPositionBelow(without, moving.w, moving.h, floorY);
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
export function compactVertically(layout, pinItemId = null) {
  if (!pinItemId) return layout;
  const pinned = layout.find((item) => item.i === pinItemId);
  if (!pinned) return layout;
  const packed = reflowAllKpiRows(layout);
  const floor = getCompactFloorY(packed);
  return compactColumnSpanUpward(
    packed,
    pinned.x,
    pinned.x + pinned.w,
    floor,
    [pinItemId]
  );
}

/** Post-drag: KPI gap-insert when not swapping, chart push-aside only (no global compact). */
function finalizeAfterDrag(resolved, activeId, didSwap, origin = null, swapTarget = null) {
  const dragged = resolved.find((item) => item.i === activeId);
  if (!dragged) return resolved;

  const pinIds = [activeId];

  if (didSwap) {
    if (isKpiWidget(activeId)) {
      const reflowed = reflowAllKpiRows(resolved);
      return compactGapsUpward(reflowed, pinIds);
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

  if (isKpiWidget(activeId)) {
    const snapped = {
      ...dragged,
      x: snapGridX(dragged.x, dragged.w),
      y: snapKpiRowY(dragged.y),
    };
    const withSnap = resolved.map((item) =>
      item.i === activeId ? snapped : item
    );
    return applyKpiInsertDrop(withSnap, snapped);
  }

  const packed = reflowAllKpiRows(resolved);
  const kpiBottom = getCompactFloorY(packed);
  const adjusted =
    dragged.y < kpiBottom
      ? packed.map((item) =>
          item.i === activeId ? { ...item, y: kpiBottom } : item
        )
      : packed;
  const next = pushAsideOverlapped(adjusted, activeId);
  return compactAffectedColumns(next, [dragged], pinIds);
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
      isKpiWidget(item.i) &&
      item.i !== snapped.i &&
      item.y >= rowY &&
      item.y < rowY + KPI_GRID_H
  );
  const otherKpis = layout.filter(
    (item) =>
      isKpiWidget(item.i) &&
      item.i !== snapped.i &&
      !(item.y >= rowY && item.y < rowY + KPI_GRID_H)
  );
  const charts = layout.filter((item) => !isKpiWidget(item.i));
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
  // Repack KPI rows then pull charts up to the true band bottom.
  result = compactGapsUpward(result, [], { packKpis: true });


  return result;
}

/** Inventory / explicit drop — KPI row insert or chart push-aside. */
function applyExplicitDrop(prev, newItem) {
  if (isKpiWidget(newItem.i)) {
    return applyKpiInsertDrop([...prev, newItem], newItem);
  }
  let result = pushAsideOverlapped([...prev, newItem], newItem.i);
  result = compactGapsUpward(result, [newItem.i]);
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

export function hasOverlaps(layout) {
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
export function swapOnDrop(layout, activeId, origin, hoverTargetId = null) {
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
  if (isKpiWidget(activeId) && !isKpiWidget(target.i)) return layout;

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
export function applyDragResult(
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
  let target = resolveSwapTarget(staticLayout, dropItem, activeId, hoverTargetId);

  if (target) {
    const targetPos = { x: target.x, y: target.y };
    return layout.map((item) => {
      if (item.i === activeId) return { ...item, x: targetPos.x, y: targetPos.y };
      if (item.i === target.i) return { ...item, x: origin.x, y: origin.y };
      return item;
    });
  }

  const dropX = snapGridX(dropItem.x, dragged.w);
  const dropY = isKpiWidget(activeId) ? snapKpiRowY(dropItem.y) : dropItem.y;

  return layout.map((item) =>
    item.i === activeId ? { ...item, x: dropX, y: dropY } : item
  );
}

/* -------------------------------------------------------------------------- */
/* localStorage persistence                                                    */
/* -------------------------------------------------------------------------- */

const LEGACY_LAYOUT_VERSIONS = [
  "v30", "v29", "v28", "v27", "v20", "v19", "v18", "v17", "v16", "v15", "v14", "v13", "v12", "v11", "v10", "v9",
];

function getAllLayoutStorageKeys() {
  const currentKey = getLayoutStorageKey();
  const tenantPrefix = currentKey.replace(/-supervisor-dashboard-layout-v\d+$/, "");
  return [
    currentKey,
    ...LEGACY_LAYOUT_VERSIONS.map((v) => `${tenantPrefix}-supervisor-dashboard-layout-${v}`),
  ];
}

function readSavedLayoutRaw() {
  for (const key of getAllLayoutStorageKeys()) {
    const saved = localStorage.getItem(key);
    if (saved) return saved;
  }
  return null;
}

function persistLayout(layout) {
  localStorage.setItem(getLayoutStorageKey(), JSON.stringify(layout));
}

function clearSavedLayout() {
  for (const key of getAllLayoutStorageKeys()) {
    localStorage.removeItem(key);
  }
}

/** Re-add the default team SLA chart when missing from a persisted layout. */
function mergeDefaultTeamSlaWidget(layout) {
  const existing = new Set(layout.map((item) => item.i));
  if (existing.has(LIVE_OFFICER_SLA_WIDGET_ID)) return layout;
  const defaultItem = DEFAULT_LAYOUT.find((item) => item.i === LIVE_OFFICER_SLA_WIDGET_ID);
  if (!defaultItem) return layout;
  return pushAsideOverlapped([...layout, defaultItem], LIVE_OFFICER_SLA_WIDGET_ID);
}

/**
 * Load the saved layout exactly as it was persisted. No reflow, no repack, no
 * compaction, no merging of default widgets. The only processing is dropping
 * entries for widgets that no longer exist (so rendering can't crash) and, as a
 * safety net, repairing data that was saved with real overlaps (e.g. corrupt
 * layouts left by an older implementation). A clean saved layout is returned
 * untouched so the user's exact arrangement is preserved on refresh.
 */
function loadLayout() {
  try {
    const saved = readSavedLayoutRaw();
    if (!saved) {
      persistLayout(DEFAULT_LAYOUT);
      return DEFAULT_LAYOUT;
    }

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_LAYOUT;

    const valid = parsed.filter((item) => item && WIDGETS[item.i]);
    if (valid.length === 0) return DEFAULT_LAYOUT;

    const migrated = migrateSavedLayoutWidgets(valid);
    const normalized = migrated.map((item) => {
      if (isSparklineKpi(item.i)) {
        const defaults = getDefaultKpiLayoutItem(item.i);
        return {
          ...item,
          minH: defaults.minH,
          maxH: defaults.maxH,
        };
      }
      if (isHeightLockedChart(item.i)) {
        const defaults = DEFAULT_CHART_LAYOUT[item.i];
        const constraints = getChartTypeSizeConstraints(WIDGETS[item.i]?.type);
        return {
          ...item,
          h: defaults?.h ?? item.h,
          minH: constraints.minH ?? defaults?.minH ?? item.minH,
          maxH: constraints.maxH ?? defaults?.maxH ?? item.maxH,
          minW: constraints.minW ?? defaults?.minW ?? item.minW,
          maxW: constraints.maxW ?? defaults?.maxW ?? item.maxW,
        };
      }
      return reconcileInventoryWidgetDimensions(item);
    });

    if (hasOverlaps(normalized)) {
      const repaired = resolveRemainingOverlaps(normalized, []);
      const withTeamSla = mergeDefaultTeamSlaWidget(repaired);
      persistLayout(withTeamSla);
      return withTeamSla;
    }

    const withTeamSla = mergeDefaultTeamSlaWidget(normalized);
    const dimensionsRepaired = normalized.some((item, i) => item !== migrated[i]);
    const layoutChanged =
      withTeamSla.length > normalized.length ||
      migrated.some((item, i) => item.i !== valid[i]?.i);

    if (layoutChanged || dimensionsRepaired) {
      persistLayout(withTeamSla);
    } else if (normalized.some((item, i) => item !== valid[i])) {
      persistLayout(normalized);
    }

    return withTeamSla;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function collidesWithAny(item, layout) {
  return layout.some(
    (other) =>
      item.x < other.x + other.w &&
      item.x + item.w > other.x &&
      item.y < other.y + other.h &&
      item.y + item.h > other.y
  );
}

/**
 * Insert a newly-added widget WITHOUT relocating any existing card.
 *
 * Existing cards stay exactly where react-grid-layout already renders them, so
 * there is nothing for RGL to "fail to re-sync" — a render overlap is therefore
 * impossible. If the requested drop position collides with anything, the new
 * card is moved to the first grid slot that fits it; every other card is left
 * untouched. (Drag/resize of existing cards still uses swap + compaction.)
 */
function layoutSummary(layout) {
  return layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
}

function stripLayoutPositions(layout) {
  return layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
}

/** Briefly bump one dimension so RGL recalculates item positions, then restore. */
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
  if (isKpiWidget(newItem.i)) {
    const slot = computeNextKpiPosition(prev, newItem.i);
    return [...prev, { ...newItem, x: slot.x, y: slot.y }];
  }
  const slot = findFirstOpenPosition(prev, newItem.w, newItem.h);
  return [...prev, { ...newItem, x: slot.x, y: slot.y }];
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

export function useDashboardLayout() {
  const [layout, setLayout] = useState(loadLayout);
  const [gridSyncKey, setGridSyncKey] = useState(0);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const intendedLayoutRef = useRef(null);
  const resyncGenerationRef = useRef(0);
  const layoutChangeCorrectionRef = useRef(false);
  const desyncCorrectionRef = useRef(false);

  /**
   * react-grid-layout keeps an internal copy of the layout and only re-syncs
   * from props when the new layout deep-differs (lodash isEqual) from the one
   * it last synced. After a drag that nets no positional change, our compacted
   * result is geometrically identical to the pre-drag layout, so RGL keeps its
   * stale internal copy with the dragged card left at its overlapping drop
   * position — that's the residual overlap.
   *
   * RGL clones layout items through `cloneLayoutItem`, which strips any custom
   * fields but preserves the standard `moved` flag. With `allowOverlap` enabled
   * RGL never runs compaction, so `moved` is inert. Toggling `moved` on every
   * layout we hand back therefore guarantees the deep-equality check fails and
   * RGL re-syncs to our clean state, without affecting positioning.
   */
  const syncFlagRef = useRef(false);
  const stampSync = useCallback((next) => {
    syncFlagRef.current = !syncFlagRef.current;
    const moved = syncFlagRef.current;
    return next.map((item) => ({ ...item, moved }));
  }, []);

  const applyLayout = useCallback(
    (next) => {
      persistLayout(next);
      setLayout(stampSync(next));
    },
    [stampSync]
  );

  const commitLayoutWithReflow = useCallback(
    (next, reflowItemIds = null) => {
      const canonical = stripLayoutPositions(next);
      intendedLayoutRef.current = canonical;
      layoutChangeCorrectionRef.current = false;
      persistLayout(canonical);

      const nudged = nudgeLayoutForReflow(canonical, reflowItemIds);
      const didNudge = !layoutPositionsEqual(nudged, canonical);

      applyLayout(didNudge ? nudged : canonical);

      const generation = resyncGenerationRef.current + 1;
      resyncGenerationRef.current = generation;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (resyncGenerationRef.current !== generation) return;
          applyLayout(canonical);
          layoutChangeCorrectionRef.current = false;
          if (!layoutPositionsEqual(layoutRef.current, canonical)) {
            setGridSyncKey((key) => key + 1);
          }
        });
      });
    },
    [applyLayout]
  );

  /**
   * RGL (v1.3.4) calls onDragStop/onResizeStop before clearing its internal
   * `activeDrag` flag, and getDerivedStateFromProps skips prop-sync while that
   * flag is set. Push our compacted layout immediately, then again after two
   * animation frames once RGL has finished its own setState — without remounting
   * the grid (which re-initializes every chart).
   */
  const commitLayoutAfterInteraction = useCallback(
    (next, reflowItemIds = null) => {
      if (reflowItemIds?.length) {
        commitLayoutWithReflow(next, reflowItemIds);
        return;
      }
      intendedLayoutRef.current = stripLayoutPositions(next);
      layoutChangeCorrectionRef.current = false;
      let canonical = intendedLayoutRef.current;
      if (hasOverlaps(canonical)) {
        canonical = stripLayoutPositions(resolveRemainingOverlaps(canonical, []));
        intendedLayoutRef.current = canonical;
      }
      applyLayout(canonical);

      const generation = resyncGenerationRef.current + 1;
      resyncGenerationRef.current = generation;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (resyncGenerationRef.current !== generation) return;
          applyLayout(canonical);
          layoutChangeCorrectionRef.current = false;
        });
      });
    },
    [applyLayout, commitLayoutWithReflow]
  );

  /** Commit an inventory drop at the placeholder — sync layout without remounting the grid. */
  const commitInventoryDrop = useCallback(
    (next) => {
      const canonical = stripLayoutPositions(next);
      intendedLayoutRef.current = canonical;
      layoutChangeCorrectionRef.current = false;
      persistLayout(canonical);
      applyLayout(canonical);

      const generation = resyncGenerationRef.current + 1;
      resyncGenerationRef.current = generation;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (resyncGenerationRef.current !== generation) return;
          applyLayout(canonical);
          layoutChangeCorrectionRef.current = false;
        });
      });

    },
    [applyLayout]
  );

  /**
   * RGL fires onLayoutChange synchronously at the end of drag/resize stop with
   * its own (possibly overlapping) layout. If positions still differ from what
   * we computed, push our compacted layout one more time.
   */
  const onLayoutChange = useCallback(
    (rglLayout) => {
      const intended = intendedLayoutRef.current;
      const canonical = stripLayoutPositions(layoutRef.current);

      if (intended) {
        if (layoutPositionsEqual(rglLayout, intended)) {
          intendedLayoutRef.current = null;
          layoutChangeCorrectionRef.current = false;
          return;
        }

        if (layoutChangeCorrectionRef.current) return;
        layoutChangeCorrectionRef.current = true;
        applyLayout(intended);
        return;
      }

      if (
        hasOverlaps(rglLayout) &&
        !hasOverlaps(canonical) &&
        !layoutPositionsEqual(rglLayout, canonical) &&
        !desyncCorrectionRef.current
      ) {
        desyncCorrectionRef.current = true;
        intendedLayoutRef.current = canonical;
        applyLayout(canonical);
        requestAnimationFrame(() => {
          desyncCorrectionRef.current = false;
        });
      }
    },
    [applyLayout]
  );

  /**
   * react-grid-layout's native onDragStop. `oldItem` holds the card's position
   * before the drag (its origin); `newItem` holds where it was dropped.
   * Post-drop processing: swap resolution -> compact vertically -> persist.
   */
  const onDragStop = useCallback(
    (rglLayout, oldItem, newItem, hoverTargetId = null, originLayout = null) => {
      if (!newItem) return;
      const origin = { x: oldItem.x, y: oldItem.y };
      const swappedTarget = resolveSwapTarget(
        originLayout ?? rglLayout,
        newItem,
        newItem.i,
        hoverTargetId
      );
      const didSwap = Boolean(swappedTarget);
      const resolved = applyDragResult(
        rglLayout,
        newItem.i,
        origin,
        newItem,
        hoverTargetId,
        originLayout
      );
      const next = finalizeAfterDrag(
        resolved,
        newItem.i,
        didSwap,
        origin,
        swappedTarget
      );
      const repaired = hasOverlaps(next)
        ? resolveRemainingOverlaps(next, [newItem.i])
        : next;
      // Charts may pull up into column gaps; only pin KPIs at their snapped row.
      const gapFillPins = isKpiWidget(newItem.i) ? [newItem.i] : [];
      const filled = compactGapsUpward(repaired, gapFillPins);
      commitLayoutAfterInteraction(filled);
    },
    [commitLayoutAfterInteraction]
  );

  /**
   * react-grid-layout's native onResizeStop. The resized card grew/shrank in
   * place. On release: compact vertically -> persist.
   */
  const onResizeStop = useCallback(
    (rglLayout, _oldItem, newItem) => {
      const clamped = rglLayout.map((item) => {
        if (!isHeightLockedChart(item.i)) return item;
        const defaults = DEFAULT_CHART_LAYOUT[item.i];
        return { ...item, h: defaults?.h ?? item.h };
      });
      let next = newItem
        ? compactVertically(clamped, newItem.i)
        : clamped;
      if (newItem) {
        // Width/x changes free adjacent columns — compact the full grid.
        next = compactGapsUpward(next, [newItem.i]);
      }
      commitLayoutAfterInteraction(next, newItem ? [newItem.i] : null);
    },
    [commitLayoutAfterInteraction]
  );

  const resetLayout = useCallback(() => {
    clearSavedLayout();
    const next = stripLayoutPositions(DEFAULT_LAYOUT);
    persistLayout(next);
    intendedLayoutRef.current = null;
    layoutChangeCorrectionRef.current = false;
    desyncCorrectionRef.current = false;
    setLayout(stampSync(next));
    setGridSyncKey((key) => key + 1);
  }, [stampSync]);

  const removeWidgetFromLayout = useCallback(
    (widgetId) => {
      setLayout((prev) => {
        const removed = prev.find((item) => item.i === widgetId);
        let without = prev.filter((item) => item.i !== widgetId);
        let next = without;
        if (removed) {
          without = reflowAllKpiRows(without);
          next = compactAfterRemove(without, removed);
        }
        persistLayout(next);
        return stampSync(next);
      });
    },
    [stampSync]
  );

  const addWidgetToLayout = useCallback(
    (widgetId, position) => {
      if (!WIDGETS[widgetId]) return;

      const prev = layoutRef.current;
      if (prev.some((item) => item.i === widgetId)) return;

      const dropPosition =
        position != null && (position.x != null || position.y != null)
          ? { x: position.x, y: position.y }
          : undefined;

      const newItem = buildNewLayoutItem(widgetId, dropPosition, prev);
      if (!newItem) return;

      const hasExplicitDrop =
        dropPosition != null &&
        dropPosition.x != null &&
        dropPosition.y != null;

      let next;
      if (hasExplicitDrop) {
        next = applyExplicitDrop(prev, newItem);
      } else {
        next = finalizeAfterAdd(placeNewItemInLayout(prev, newItem));
      }
      if (hasOverlaps(next)) {
        next = resolveRemainingOverlaps(next, [widgetId]);
      }
      const relocated =
        newItem.x !== next.find((item) => item.i === widgetId)?.x ||
        newItem.y !== next.find((item) => item.i === widgetId)?.y;
      commitInventoryDrop(next);
    },
    [commitInventoryDrop]
  );

  const addKpiToLayout = useCallback(
    (widgetId, position) => {
      if (!isKpiWidget(widgetId)) return;
      addWidgetToLayout(widgetId, position);
    },
    [addWidgetToLayout]
  );

  const visibleLayoutIds = layout.map((item) => item.i);
  const visibleKpiIds = layout.filter((item) => isKpiWidget(item.i)).map((item) => item.i);

  return {
    layout,
    gridSyncKey,
    onDragStop,
    onResizeStop,
    onLayoutChange,
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    addWidgetToLayout,
    visibleLayoutIds,
    visibleKpiIds,
  };
}
