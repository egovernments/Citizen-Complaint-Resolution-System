import {
  GRID_COLS,
  UNIFORM_CHART_SIZE_CONSTRAINTS,
  MAP_SIZE_CONSTRAINTS,
  FULL_WIDTH_TABLE_GRID,
  findFirstOpenPosition,
} from "../constants/layoutConfig";
import { compactVertically } from "./gridGeometry";

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
 * KPIs added by the first user were gone when they came back (#1276). Falls
 * back to the legacy key when identity is unavailable.
 */
export function storageKeyFor(tenantId, userId) {
  if (!tenantId || !userId) return LEGACY_STORAGE_KEY;
  return `${LEGACY_STORAGE_KEY}.${tenantId}.${userId}`;
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
  const c = sizeConstraintsForKpi(kpiId, kpis);
  const kind = kpis?.[kpiId]?.viz?.kind;
  if (CARD_KINDS.has(kind)) return { w: 2, h: 2 };
  if (kind === "map" || kind === "choropleth-map") return { w: 8, h: 6 };
  if (kind === "sla-risk-table" || kind === "table" || kind === "data-table")
    return { w: 12, h: 5 };
  return { w: Math.max(c.minW, 6), h: Math.max(c.minH, 6) };
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
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
 * `position` (grid coords, e.g. from a drag-drop) is optional — omitted, the
 * tile lands at the first open slot in reading order. Geometry is normalised
 * (clamped to the tile's constraints and the grid width) either way.
 */
export function addItemToLayout(layout, kpiId, kpis, position) {
  if (!kpis?.[kpiId]) return layout;
  if (layout.some((item) => item.i === kpiId)) return layout; // no duplicates
  const { w, h } = defaultSizeForKpi(kpiId, kpis);
  const pos = position || findFirstOpenPosition(layout, w, h, GRID_COLS);
  const item = normalizeItem({ i: kpiId, x: pos.x, y: pos.y, w, h }, kpis);
  return compactVertically([...layout, item]);
}

/**
 * Read a saved layout from `storage`. Returns `null` ONLY when there is no
 * stored layout (key absent / unparseable); an intentionally-empty array (user
 * cleared every tile) is returned as `[]` so the seed does not re-add the
 * removed tiles on reload.
 *
 * `legacyKey` (optional) is consulted when `key` holds nothing — a one-time,
 * read-only migration path so layouts saved under the global v1 key survive
 * the move to per-user keys. Persisting always writes the scoped key, so the
 * legacy slot is never mutated and stops mattering after the first save.
 */
export function readSavedLayout(storage, key, legacyKey) {
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
  const saved = readKey(key);
  if (saved !== null) return saved;
  return legacyKey && legacyKey !== key ? readKey(legacyKey) : null;
}

export function persistLayout(storage, key, layout) {
  try {
    storage?.setItem(key, JSON.stringify(layout));
  } catch {
    /* ignore quota/serialisation errors — layout is non-critical state */
  }
}
