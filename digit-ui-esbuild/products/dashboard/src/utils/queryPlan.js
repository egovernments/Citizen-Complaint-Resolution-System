import { appliedHierLevel } from "./hierLevelGrouping";
import { complaintTypeParams } from "./complaintTypeTree";

/**
 * Query-plan helpers for the catalog dashboard (extracted from
 * AdminDashboard.jsx so the ref-building logic is pure and unit-testable).
 *
 * The tileKey convention for runKpiBatch refs:
 *   <kpiId>           base query (global params applied)
 *   <kpiId>__prior    delta cards/comparison tables: same params + compare:'prior'
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

/**
 * The per-layer pin source. The legacy def hard-filters `is_open`, so its pins
 * can only ever mean "still open" — the Resolved layer shaded "0 resolved"
 * underneath open-complaint pins. Worse, `filters.is_open` with no
 * `window.timeRole` trips the backend's live-open-snapshot exemption
 * (KpiQueryComposer.isLiveOpenSnapshot), which skips BOTH the base window and
 * the global dateFrom/dateTo — so the legacy pins were "all open complaints,
 * all time" against a last_7d choropleth, wrong on every layer.
 *
 * The replacement def drops `is_open` from filters (no exemption -> pins obey
 * the same window/range as the wards) and projects is_open/is_resolved as
 * dimensions so the FE can partition pins per layer.
 */
export const PIN_KPI_ID_ALL = "cl_map_complaint_pins_all";

/**
 * Server-side row cap. AnalyticsPlanner clamps every query at MAX_LIMIT = 1000
 * regardless of the def's `limit`, so a full result set is indistinguishable
 * from a truncated one at exactly this size — the UI says "most recent 1,000".
 */
export const PIN_ROW_CAP = 1000;

/**
 * Prefer the per-layer pin def, fall back to the legacy one. A tenant whose
 * catalog predates the new record keeps working (pins stay open-only, and the
 * UI says so) instead of losing its pin layer entirely.
 */
export function resolvePinKpiId(kpis) {
  return kpis && kpis[PIN_KPI_ID_ALL] ? PIN_KPI_ID_ALL : PIN_KPI_ID;
}

export function isCardKind(kind) {
  return CARD_KINDS.has(kind);
}
export function isSparklineKind(kind) {
  return SPARKLINE_KINDS.has(kind);
}
export function isMapKind(kind) {
  return MAP_KINDS.has(kind);
}
export function needsPriorComparison(def) {
  return def?.viz?.comparison?.period === "prior";
}

/**
 * Map the dashboard filter bar -> the KpiQueryComposer param names.
 * Mirrors config/kpiQueries.js buildGlobalApiFilters: an active date range maps
 * to dateFrom/dateTo (yyyy-MM-dd, which the composer turns into a gte/lt on the
 * grain's time column and which drops the def's base window); a non-"all"
 * geography narrows via ward. The complaint-type node selection narrows via
 * serviceCode (leaf — unchanged wire shape) or complaintPath (interior node —
 * subtree prefix on complaint_node_path, #1282; pre-#1282 backends ignore the
 * unknown param, so the dashboard degrades to leaf-only filtering, never an
 * error). No global `window` is emitted, so each def keeps its own baked
 * window when no range is active — exactly the reference path's behaviour.
 */
export function globalParams(filters) {
  const params = {};
  if (filters?.geography && filters.geography !== "all") {
    params.ward = filters.geography;
  }
  Object.assign(
    params,
    complaintTypeParams({
      code: filters?.complaintType,
      path: filters?.complaintTypePath,
      leaf: filters?.complaintTypeLeaf,
    })
  );
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
 * Series refs are gated on viz.kind (the only series signal exposed by the
 * catalog tile — supportsSeries is not serialised). Prior refs are requested
 * for scalar cards and for tables that explicitly declare viz.comparison.
 */
export function buildRefs(tiles, kpis, filters, hierOverrides) {
  const refs = {};
  const pinKpiId = resolvePinKpiId(kpis);
  for (const tile of tiles) {
    const kpiId = tile.kpiId;
    const def = kpis[kpiId];
    if (!def) continue;
    const kind = def.viz?.kind;
    const base = tileParams(def, filters, hierOverrides);

    refs[kpiId] = { kpiId, params: { ...base } };

    if (isCardKind(kind) || needsPriorComparison(def)) {
      refs[`${kpiId}__prior`] = { kpiId, params: { ...base, compare: "prior" } };
    }
    if (isSparklineKind(kind)) {
      refs[`${kpiId}__series`] = { kpiId, params: { ...base, series: "daily" } };
    }
    if (isMapKind(kind)) {
      // Per-complaint pins (same filters/scope) overlaid on the ward choropleth.
      // The ref KEY stays `${kpiId}__pins` whichever source resolves, so nothing
      // downstream (assembleResult, countErrorWidgets) has to know.
      refs[`${kpiId}__pins`] = { kpiId: pinKpiId, params: { ...base } };
    }
  }
  return refs;
}

/**
 * Public requests are narrower than the employee query plan. Membership,
 * layout, windows and disclosure policy belong to the PUBLIC catalog/backend
 * endpoints. The browser sends one reference per laid-out tile carrying ONLY
 * the global filter-bar params (globalParams — the backend's public allow-list,
 * #1797): no hierarchy overrides, comparison/series fan-out or per-complaint
 * map pin source. `params` is omitted when no filter narrows anything so the
 * bare-ref wire shape stays valid against older backends.
 */
export function buildPublicRefs(tiles, kpis, filters) {
  const refs = {};
  const params = globalParams(filters);
  const hasParams = Object.keys(params).length > 0;
  for (const tile of tiles || []) {
    const kpiId = tile?.kpiId;
    if (!kpiId || !kpis?.[kpiId]) continue;
    refs[kpiId] = hasParams ? { kpiId, params: { ...params } } : { kpiId };
  }
  return refs;
}

export function buildPublicRefsKey(tiles, kpis, filters) {
  return JSON.stringify({
    public: true,
    ids: (tiles || []).map((tile) => tile?.kpiId).filter((id) => id && kpis?.[id]),
    versions: (tiles || []).map((tile) => kpis?.[tile?.kpiId]?.version ?? null),
    gp: globalParams(filters),
  });
}

/**
 * Serialisable fingerprint of everything buildRefs reads, used as the batch
 * effect's dependency key. Includes each tile's viz.kind (a def flipping
 * card<->chart must re-trigger even when ids/params are unchanged) AND each
 * tile's comparison contract and applied hierLevel override — without those the batch effect
 * would never refire on a "Group by" change (R7c).
 */
export function buildRefsKey(tiles, kpis, filters, hierOverrides) {
  return JSON.stringify({
    ids: tiles.map((t) => t.kpiId),
    kinds: tiles.map((t) => kpis[t.kpiId]?.viz?.kind),
    comparisons: tiles.map((t) => kpis[t.kpiId]?.viz?.comparison ?? null),
    gp: globalParams(filters),
    hier: tiles.map((t) => appliedHierLevel(kpis[t.kpiId], hierOverrides)),
    // A tenant whose catalog gains the per-layer pin def must refire the batch:
    // the ref key is unchanged, so this is the only signal that the __pins ref
    // now points at a different source.
    pin: resolvePinKpiId(kpis),
  });
}
