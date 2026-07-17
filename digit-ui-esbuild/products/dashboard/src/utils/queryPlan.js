import { appliedHierLevel } from "./hierLevelGrouping";

/**
 * Query-plan helpers for the catalog dashboard (extracted from
 * AdminDashboard.jsx so the ref-building logic is pure and unit-testable).
 *
 * The tileKey convention for runKpiBatch refs:
 *   <kpiId>           base query (global params applied)
 *   <kpiId>__prior    delta cards: same params + compare:'prior'
 *   <kpiId>__series   sparkline cards: same params + series:'daily'
 *   <kpiId>__pins     map tiles: the per-complaint pin companion source
 */

export const CARD_KINDS = new Set([
  "number-tile-delta",
  "number-tile",
  "scalar",
  "number-tile-sparkline",
  "sparkline-card",
]);
export const SPARKLINE_KINDS = new Set(["number-tile-sparkline", "sparkline-card"]);
export const MAP_KINDS = new Set(["map", "choropleth-map"]);

// The internal pin source: map tiles fetch this alongside their ward aggregates
// to overlay per-complaint pins (the FE map widget has the pin layer; this feeds it).
export const PIN_KPI_ID = "cl_map_complaint_pins";

export function isCardKind(kind) {
  return CARD_KINDS.has(kind);
}
export function isSparklineKind(kind) {
  return SPARKLINE_KINDS.has(kind);
}
export function isMapKind(kind) {
  return MAP_KINDS.has(kind);
}

/**
 * Map the dashboard filter bar -> the KpiQueryComposer param names.
 * Mirrors config/kpiQueries.js buildGlobalApiFilters: an active date range maps
 * to dateFrom/dateTo (yyyy-MM-dd, which the composer turns into a gte/lt on the
 * grain's time column and which drops the def's base window); a non-"all"
 * geography/complaintType narrows via ward/serviceCode. No global `window` is
 * emitted, so each def keeps its own baked window when no range is active —
 * exactly the reference path's behaviour.
 */
export function globalParams(filters) {
  const params = {};
  if (filters?.geography && filters.geography !== "all") {
    params.ward = filters.geography;
  }
  if (filters?.complaintType && filters.complaintType !== "all") {
    params.serviceCode = filters.complaintType;
  }
  if (filters?.dateRangeActive && filters?.dateFrom && filters?.dateTo) {
    params.dateFrom = filters.dateFrom; // yyyy-MM-dd
    params.dateTo = filters.dateTo; // yyyy-MM-dd
  }
  return params;
}

/**
 * Per-tile base params: the global filter params plus — for tiles whose def
 * declares the hierLevel param — the user's per-widget "Group by" override
 * (#1111 PR2). The override merges HERE, before the companion-ref spreads in
 * buildRefs, so __prior/__series/__pins inherit it automatically. When there
 * is no (valid) override nothing is sent and the backend applies the def's
 * declared default itself.
 */
export function tileParams(def, filters, hierOverrides) {
  const gp = globalParams(filters);
  const hierLevel = appliedHierLevel(def, hierOverrides);
  return hierLevel ? { ...gp, hierLevel } : gp;
}

/**
 * Build the per-tile refs map for runKpiBatch.
 *
 * The prior/series refs are gated on viz.kind (the only series signal exposed by
 * the catalog tile — supportsSeries is not serialised), so non-card tiles only
 * issue the single base query.
 */
export function buildRefs(tiles, kpis, filters, hierOverrides) {
  const refs = {};
  for (const tile of tiles) {
    const kpiId = tile.kpiId;
    const def = kpis[kpiId];
    if (!def) continue;
    const kind = def.viz?.kind;
    const base = tileParams(def, filters, hierOverrides);

    refs[kpiId] = { kpiId, params: { ...base } };

    if (isCardKind(kind)) {
      refs[`${kpiId}__prior`] = { kpiId, params: { ...base, compare: "prior" } };
    }
    if (isSparklineKind(kind)) {
      refs[`${kpiId}__series`] = { kpiId, params: { ...base, series: "daily" } };
    }
    if (isMapKind(kind)) {
      // Per-complaint pins (same filters/scope) overlaid on the ward choropleth.
      refs[`${kpiId}__pins`] = { kpiId: PIN_KPI_ID, params: { ...base } };
    }
  }
  return refs;
}

/**
 * Serialisable fingerprint of everything buildRefs reads, used as the batch
 * effect's dependency key. Includes each tile's viz.kind (a def flipping
 * card<->chart must re-trigger even when ids/params are unchanged) AND each
 * tile's applied hierLevel override — without the latter the batch effect
 * would never refire on a "Group by" change (R7c).
 */
export function buildRefsKey(tiles, kpis, filters, hierOverrides) {
  return JSON.stringify({
    ids: tiles.map((t) => t.kpiId),
    kinds: tiles.map((t) => kpis[t.kpiId]?.viz?.kind),
    gp: globalParams(filters),
    hier: tiles.map((t) => appliedHierLevel(kpis[t.kpiId], hierOverrides)),
  });
}
