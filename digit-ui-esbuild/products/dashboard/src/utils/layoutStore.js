import {
  GRID_COLS,
  DROPPING_ITEM_ID,
  UNIFORM_CHART_SIZE_CONSTRAINTS,
  MAP_SIZE_CONSTRAINTS,
  FULL_WIDTH_TABLE_GRID,
  DEFAULT_CHART_GRID,
  findFirstOpenPosition,
} from "../constants/layoutConfig";
import { compactVertically, compactAroundPinned } from "./gridGeometry";

/**
 * layoutStore — the PURE half of useCatalogLayout (extracted so the
 * add/persist/rehydrate cycle is unit-testable under node --test without a
 * React harness). Everything here is deterministic: geometry/constraint
 * mapping, seed/saved reconciliation, and storage access with the Storage
 * object injected (the hook passes window.localStorage; tests pass a fake).
 *
 * Layout items are react-grid-layout shaped: { i: kpiId, x, y, w, h, min/max }.
 */

export const LEGACY_STORAGE_KEY = "ccrs.dashboard.catalog-layout.v1";

/**
 * Storage key for one user's layout on one tenant. The v1 key was a single
 * global slot, so two personas on the same browser (bug-bash GRO + supervisor,
 * shared counter machines) silently overwrote each other's arrangement: the
 * second login reconciled the first user's saved layout against its own
 * catalog and the next persist rewrote the shared slot with the reduced set —
 * KPIs added by the first user were gone when they came back (#1276). Without
 * a complete identity there is no safe persistence scope, so callers get no
 * key instead of falling back to the shared legacy slot.
 */
export function storageKeyFor(tenantId, userId) {
  if (!tenantId || !userId) return null;
  return `${LEGACY_STORAGE_KEY}.${tenantId}.${userId}`;
}

/**
 * The anonymous public page has no user identity, yet its visitor still
 * expects a rearranged page to survive a reload (#1797). Its slot is a fixed
 * per-tenant key in its own `.public` namespace — disjoint by construction
 * from every employee slot (those end in a user uuid), so a public visit on a
 * shared machine can never read or clobber an employee's saved layout.
 */
export function publicStorageKeyFor(tenantId) {
  if (!tenantId) return null;
  return `${LEGACY_STORAGE_KEY}.${tenantId}.public`;
}

const CARD_KINDS = new Set([
  "number-tile-delta",
  "number-tile",
  "scalar",
  "number-tile-sparkline",
  "sparkline-card",
]);

const KPI_CARD_CONSTRAINTS = { minW: 2, minH: 2, maxW: 6, maxH: 3 };
const LIST_CONSTRAINTS = { minW: 3, minH: 4, maxW: 12, maxH: 12 };

/** Map a tile's viz.kind to its grid size constraints (the single id-space seam). */
export function sizeConstraintsForKpi(kpiId, kpis) {
  const kind = kpis?.[kpiId]?.viz?.kind;
  if (CARD_KINDS.has(kind)) return KPI_CARD_CONSTRAINTS;
  switch (kind) {
    case "map":
    case "choropleth-map":
      return MAP_SIZE_CONSTRAINTS;
    case "sla-risk-table":
    case "table":
    case "data-table":
      return {
        minW: FULL_WIDTH_TABLE_GRID.minW,
        minH: FULL_WIDTH_TABLE_GRID.minH,
        maxW: FULL_WIDTH_TABLE_GRID.maxW,
        maxH: FULL_WIDTH_TABLE_GRID.maxH,
      };
    case "rankedList":
    case "dow":
      return LIST_CONSTRAINTS;
    default:
      return UNIFORM_CHART_SIZE_CONSTRAINTS; // bar / stacked-bar / horizontal-bar / line / pie
  }
}

/** Default size for a freshly-added tile, by kind. */
export function defaultSizeForKpi(kpiId, kpis) {
  const kind = kpis?.[kpiId]?.viz?.kind;
  if (CARD_KINDS.has(kind)) return { w: 2, h: 2 };
  if (kind === "map" || kind === "choropleth-map") return { w: 8, h: 6 };
  if (kind === "sla-risk-table" || kind === "table" || kind === "data-table")
    return { w: FULL_WIDTH_TABLE_GRID.w, h: FULL_WIDTH_TABLE_GRID.h };
  if (kind === "rankedList" || kind === "dow") return { w: 6, h: 6 };
  return { ...DEFAULT_CHART_GRID };
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  // Grid coordinates are integral cells; a fractional value (sub-pixel drop
  // math, hand-edited storage) would make RGL compute fractional pixel
  // transforms downstream. Round before clamping.
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Normalise a layout item to finite, in-bounds geometry. A malformed MDMS pack
 * or stale localStorage entry can carry NaN / out-of-range w/h/x/y; RGL throws or
 * produces impossible resize bounds on those, so clamp every field to the tile's
 * viz.kind constraints and the grid width. Item must already carry `i` (kpiId).
 */
export function normalizeItem(item, kpis) {
  const c = sizeConstraintsForKpi(item.i, kpis);
  const w = clampNum(item.w, c.minW, c.maxW, c.minW);
  const h = clampNum(item.h, c.minH, c.maxH, c.minH);
  const x = Math.min(clampNum(item.x, 0, GRID_COLS - 1, 0), GRID_COLS - w);
  const y = clampNum(item.y, 0, Number.MAX_SAFE_INTEGER, 0);
  return { i: item.i, x, y, w, h, ...c };
}

/** Seed layout from the pack, normalised, kpiId-keyed. */
export function buildSeedLayout(packLayout, kpis) {
  return (packLayout || [])
    .filter((item) => kpis[item.kpiId])
    .map((item) =>
      normalizeItem({ i: item.kpiId, x: item.x, y: item.y, w: item.w, h: item.h }, kpis)
    );
}

/** Drop tiles the role can no longer see and re-normalise geometry. */
export function reconcileLayout(source, kpis) {
  return (source || [])
    .filter((item) => kpis[item.i])
    .map((item) => normalizeItem(item, kpis));
}

/**
 * Pick the layout to hydrate from: the SAVED layout (the user's arrangement,
 * including an intentional empty one) wins over the pack seed; the seed applies
 * only when nothing was ever saved (saved === null). Either way the result is
 * reconciled against the role-visible catalog.
 */
export function resolveInitialLayout(saved, seed, kpis) {
  return reconcileLayout(saved !== null ? saved : seed, kpis);
}

/**
 * Add a tile to the layout. Returns the SAME array reference when the add is a
 * no-op (unknown kpiId or already placed) so callers can cheaply detect it.
 * Geometry is normalised (clamped to the tile's constraints and the grid
 * width — clamp, never relocate) on both paths:
 *
 * - No `position` (picker CLICK): the tile lands at the first open slot in
 *   reading order and the whole layout is compacted — plain append.
 * - With `position` (drag-DROP, grid coords from RGL's onDrop placeholder):
 *   the tile lands AT that cell and existing tiles are pushed/reflowed around
 *   it (compactAroundPinned). Plain compactVertically would give the existing
 *   occupant reading-order priority and bounce the new tile below the cell the
 *   hover preview promised — the legacy dashboard's swap-then-compact pipeline
 *   resolved this in the dropped tile's favour, and so does this.
 */
export function addItemToLayout(layout, kpiId, kpis, position) {
  if (!kpis?.[kpiId]) return layout;
  if (layout.some((item) => item.i === kpiId)) return layout; // no duplicates
  const { w, h } = defaultSizeForKpi(kpiId, kpis);
  if (!position) {
    const pos = findFirstOpenPosition(layout, w, h, GRID_COLS);
    const item = normalizeItem({ i: kpiId, x: pos.x, y: pos.y, w, h }, kpis);
    return compactVertically([...layout, item]);
  }
  const item = normalizeItem(
    { i: kpiId, x: position.x, y: position.y, w, h },
    kpis
  );
  return compactAroundPinned(layout, item);
}

/**
 * Merge a layout emitted by react-grid-layout's onLayoutChange into the
 * current state: accept RGL's flowed geometry verbatim but re-attach the
 * per-item min/max constraints RGL strips, and drop RGL's synthetic external-
 * drop placeholder (__dropping-elem__) — it must never enter state or storage
 * (the real tile arrives via addItemToLayout on drop).
 */
export function mergeEmittedLayout(prev, next) {
  return next
    .filter((item) => item.i !== DROPPING_ITEM_ID)
    .map((item) => {
      const existing = prev.find((p) => p.i === item.i);
      return existing
        ? { ...existing, x: item.x, y: item.y, w: item.w, h: item.h }
        : item;
    });
}

/**
 * Read a saved layout from `storage`. Returns `null` ONLY when there is no
 * stored layout (key absent / unparseable); an intentionally-empty array (user
 * cleared every tile) is returned as `[]` so the seed does not re-add the
 * removed tiles on reload.
 *
 * The former shared v1 slot is deliberately not consulted: assigning that
 * layout to whichever identity happens to log in first would leak one user's
 * preferences into another user's dashboard.
 */
export function readSavedLayout(storage, key) {
  if (!key) return null;
  const readKey = (k) => {
    try {
      const raw = storage?.getItem(k);
      if (raw == null) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  return readKey(key);
}

export function persistLayout(storage, key, layout) {
  if (!key) return;
  try {
    storage?.setItem(key, JSON.stringify(layout));
  } catch {
    /* ignore quota/serialisation errors — layout is non-critical state */
  }
}
