import { appliedHierLevel } from "./hierLevelGrouping";
import { complaintTypeParams } from "./complaintTypeTree";
import { geographyParams } from "./boundaryTree";
import { normalizeStringList, selectedCodes } from "./multiSelectFilters";

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
export const SPARKLINE_KINDS = new Set([
  "number-tile-sparkline",
  "sparkline-card",
]);
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
  if (Array.isArray(filters?.geographies)) {
    const wards = selectedCodes(filters.geographies);
    if (wards.length === 1) params.ward = wards[0];
    else if (wards.length > 1) params.wards = wards;
  } else {
    // One-release persisted-state compatibility for the v4 scalar selection.
    Object.assign(
      params,
      geographyParams({
        code: filters?.geography,
        path: filters?.geographyPath,
        leaf: filters?.geographyLeaf,
      })
    );
  }

  if (Array.isArray(filters?.complaintTypes)) {
    const serviceCodes = selectedCodes(filters.complaintTypes);
    if (serviceCodes.length === 1) params.serviceCode = serviceCodes[0];
    else if (serviceCodes.length > 1) params.serviceCodes = serviceCodes;
  } else {
    Object.assign(
      params,
      complaintTypeParams({
        code: filters?.complaintType,
        path: filters?.complaintTypePath,
        leaf: filters?.complaintTypeLeaf,
      })
    );
  }

  const departments = normalizeStringList(filters?.departments);
  if (departments.length) params.departments = departments;
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
  const pinKpiId = resolvePinKpiId(kpis);
  for (const tile of tiles) {
    const kpiId = tile.kpiId;
    const def = kpis[kpiId];
    if (!def) continue;
    const kind = def.viz?.kind;
    const base = tileParams(def, filters, hierOverrides);

    refs[kpiId] = { kpiId, params: { ...base } };

    if (isCardKind(kind)) {
      refs[`${kpiId}__prior`] = {
        kpiId,
        params: { ...base, compare: "prior" },
      };
    }
    if (isSparklineKind(kind)) {
      refs[`${kpiId}__series`] = {
        kpiId,
        params: { ...base, series: "daily" },
      };
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
 * Public requests are intentionally narrower than the employee query plan.
 * Membership, layout, windows and disclosure policy belong to the curated
 * public pack/backend endpoint. The browser sends one bare kpiId reference per
 * laid-out tile: no user filters, hierarchy overrides, comparison/series fanout
 * or per-complaint map pin source.
 */
export function buildPublicRefs(tiles, kpis) {
  const refs = {};
  for (const tile of tiles || []) {
    const kpiId = tile?.kpiId;
    if (!kpiId || !kpis?.[kpiId]) continue;
    refs[kpiId] = { kpiId };
  }
  return refs;
}

export function buildPublicRefsKey(tiles, kpis) {
  return JSON.stringify({
    public: true,
    ids: (tiles || [])
      .map((tile) => tile?.kpiId)
      .filter((id) => id && kpis?.[id]),
    versions: (tiles || []).map((tile) => kpis?.[tile?.kpiId]?.version ?? null),
  });
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
    // A tenant whose catalog gains the per-layer pin def must refire the batch:
    // the ref key is unchanged, so this is the only signal that the __pins ref
    // now points at a different source.
    pin: resolvePinKpiId(kpis),
  });
}
