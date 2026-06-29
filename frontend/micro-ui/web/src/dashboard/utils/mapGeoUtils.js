import L from "leaflet";
import { formatDimensionLabel } from "../config/labelFormat";
import { getWowChangeFillStyle } from "../config/geographyMapPresentation";

const TEAL_SCALE = ["#ccfbf1", "#5eead4", "#14b8a6", "#0d9488", "#115e59"];

export function getMapCenter() {
  const configured = window?.globalConfigs?.getConfig("MAP_CENTER_LAT_LNG");
  if (configured?.lat != null && configured?.lng != null) {
    return [Number(configured.lat), Number(configured.lng)];
  }
  return [-0.78, 35.34];
}

export function geometryCentroid(geometry) {
  if (!geometry?.type) return null;

  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates;
    return { lat, lng };
  }

  if (geometry.type === "Polygon") {
    return polygonCentroid(geometry.coordinates[0]);
  }

  if (geometry.type === "MultiPolygon") {
    const firstRing = geometry.coordinates?.[0]?.[0];
    return firstRing ? polygonCentroid(firstRing) : null;
  }

  return null;
}

function polygonCentroid(ring) {
  if (!ring?.length) return null;
  let latSum = 0;
  let lngSum = 0;
  let count = 0;
  for (const coord of ring) {
    if (!Array.isArray(coord) || coord.length < 2) continue;
    lngSum += coord[0];
    latSum += coord[1];
    count += 1;
  }
  if (!count) return null;
  return { lat: latSum / count, lng: lngSum / count };
}

export function countToColor(count, maxCount) {
  if (!maxCount || count <= 0) return TEAL_SCALE[0];
  const ratio = Math.min(count / maxCount, 1);
  const index = Math.min(TEAL_SCALE.length - 1, Math.floor(ratio * (TEAL_SCALE.length - 1)));
  return TEAL_SCALE[index];
}

export function countToFillStyle(count, maxCount) {
  if (!maxCount || count <= 0) {
    return { fillColor: "#ffffff", strokeColor: "#d1d5db", fillOpacity: 0.95 };
  }
  const fillColor = countToColor(count, maxCount);
  return { fillColor, strokeColor: fillColor, fillOpacity: 0.74 };
}

export function computeWowPct(current, prior) {
  const cur = Number(current) || 0;
  const prev = Number(prior) || 0;
  if (prev <= 0) {
    if (cur > 0) return Number.POSITIVE_INFINITY;
    return 0;
  }
  return ((cur - prev) / prev) * 100;
}

export function wowPctToFillStyle(wowPct) {
  return getWowChangeFillStyle(wowPct);
}

export function breachShareToFillStyle(sharePct) {
  const pct = Number(sharePct) || 0;
  if (pct <= 0) {
    return { fillColor: "#ffffff", strokeColor: "#d1d5db", fillOpacity: 0.92 };
  }
  if (pct <= 10) {
    return { fillColor: "#fee2e2", strokeColor: "#fecaca", fillOpacity: 0.72 };
  }
  if (pct <= 25) {
    return { fillColor: "#fecaca", strokeColor: "#fca5a5", fillOpacity: 0.74 };
  }
  if (pct <= 50) {
    return { fillColor: "#f87171", strokeColor: "#ef4444", fillOpacity: 0.76 };
  }
  if (pct <= 75) {
    return { fillColor: "#dc2626", strokeColor: "#b91c1c", fillOpacity: 0.78 };
  }
  return { fillColor: "#7f1d1d", strokeColor: "#450a0a", fillOpacity: 0.8 };
}

/** @deprecated Use breachShareToFillStyle */
export function breachCountToFillStyle(count) {
  return breachShareToFillStyle(count > 0 ? 50 : 0);
}

export function getMapCityLabel() {
  return (
    window?.globalConfigs?.getConfig("DASHBOARD_MAP_CITY_LABEL") ||
    window?.globalConfigs?.getConfig("DASHBOARD_STATE_LABEL") ||
    window?.globalConfigs?.getConfig("STATE_NAME") ||
    "City"
  );
}

export function countToRadius(count, maxCount) {
  const minR = 8;
  const maxR = 28;
  if (!maxCount || count <= 0) return minR;
  return minR + (count / maxCount) * (maxR - minR);
}

/**
 * Join analytics ward counts with boundary geometry.
 * @returns {{ markers: object[], geoFeatures: object[], maxCount: number, geometrySummary: object }}
 */
export function joinWardMapData(wardCounts = [], boundaries = []) {
  const boundaryByCode = Object.fromEntries(
    boundaries.map((b) => [String(b.code), b])
  );

  const markers = [];
  const geoFeatures = [];
  let maxCount = 0;

  const geometrySummary = { point: 0, polygon: 0, other: 0, missing: 0 };

  for (const ward of wardCounts) {
    const code = String(ward.wardCode ?? ward.label ?? "");
    const count = Number(ward.count) || 0;
    maxCount = Math.max(maxCount, count);

    const boundary = boundaryByCode[code];
    const geometry = boundary?.geometry;
    const label = ward.label || formatDimensionLabel(code);
    const type = geometry?.type;

    if (!type) {
      geometrySummary.missing += 1;
      continue;
    }

    if (type === "Point") {
      geometrySummary.point += 1;
      const [lng, lat] = geometry.coordinates;
      markers.push({ code, label, count, lat, lng, geometry, ...ward });
    } else if (type === "Polygon" || type === "MultiPolygon") {
      geometrySummary.polygon += 1;
      geoFeatures.push({
        type: "Feature",
        properties: { code, label, count, ...ward },
        geometry,
      });
    } else {
      geometrySummary.other += 1;
    }
  }

  return {
    markers,
    geoFeatures: { type: "FeatureCollection", features: geoFeatures },
    maxCount,
    geometrySummary,
  };
}

/** Fit the map so every polygon / marker is visible with comfortable padding. */
export function resolveJoinedMapBounds(joined) {
  const { geoFeatures, markers } = joined ?? {};
  let bounds = null;

  if (geoFeatures?.features?.length) {
    const group = L.featureGroup();
    L.geoJSON(geoFeatures, {
      onEachFeature: (_feature, layer) => {
        group.addLayer(layer);
      },
    });
    const layerBounds = group.getBounds();
    if (layerBounds?.isValid()) {
      bounds = layerBounds;
    }
  }

  if (markers?.length) {
    const markerBounds = L.latLngBounds(markers.map((marker) => [marker.lat, marker.lng]));
    if (markerBounds.isValid()) {
      bounds = bounds ? bounds.extend(markerBounds) : markerBounds;
    }
  }

  return bounds?.isValid() ? bounds : null;
}

/** Four click-drill levels — UI labels match the complaint map reference. */
export const MAP_DRILL_TIERS = [
  { id: "state", label: "District", index: 0 },
  { id: "city", label: "Subdistrict", index: 1 },
  { id: "district", label: "Sub-subdistrict", index: 2 },
  { id: "ward", label: "Complaints", index: 3 },
];

export const MAP_ZOOM_LEVEL_LABELS = [
  "District",
  "Subdistrict",
  "Sub-subdistrict",
  "Complaints",
];

export const MAP_DRILL_MAX_LEVEL = MAP_DRILL_TIERS.length - 1;
export const MAP_COMPLAINT_PIN_MAX_ZOOM = 17;
export const MAP_WARD_MIN_ZOOM = 14;

/** @deprecated Use MAP_WARD_MIN_ZOOM */
export const MAP_WARD_UNCLUSTER_ZOOM = MAP_WARD_MIN_ZOOM;

/** @deprecated Drill level is click-driven; kept for legacy imports. */
export const MAP_COMPLAINT_PIN_MIN_ZOOM = MAP_WARD_MIN_ZOOM;

export function getDrillTier(level) {
  const idx = Math.min(Math.max(Number(level) || 0, 0), MAP_DRILL_MAX_LEVEL);
  return MAP_DRILL_TIERS[idx];
}

export function getDrillTierLabel(level) {
  return getDrillTier(level).label;
}

export function isWardDrillLevel(level) {
  return getDrillTier(level).id === "ward";
}

/** Zoom-badge / tooltip area label for the current drill depth. */
export function getMapZoomLevelLabel({ drillTrailLength = 0, focusedCode = null, drillLevel = 0 } = {}) {
  if (focusedCode || drillLevel >= MAP_DRILL_MAX_LEVEL) {
    return MAP_ZOOM_LEVEL_LABELS[MAP_ZOOM_LEVEL_LABELS.length - 1];
  }
  const idx = Math.min(Math.max(drillTrailLength, 0), MAP_ZOOM_LEVEL_LABELS.length - 1);
  return MAP_ZOOM_LEVEL_LABELS[idx];
}

const GENERIC_MAP_ROOT_LABELS = new Set(["state", "city", "district", "region", "country", "area"]);

/** Root breadcrumb name — prefer configured city label, else boundary / hierarchy names. */
export function resolveMapRootLabel(cityLabel, hierarchyIndex = {}, wardCodes = [], boundaries = []) {
  const configured = String(cityLabel ?? "").trim();
  if (configured && !GENERIC_MAP_ROOT_LABELS.has(configured.toLowerCase())) {
    return configured;
  }

  for (const boundary of boundaries) {
    const code = String(boundary?.code ?? "").trim();
    const name = boundary?.localname || boundary?.name || boundary?.label;
    if (name) return String(name);
    if (code) return formatDimensionLabel(code);
  }

  const ancestorCounts = new Map();
  const rootCounts = new Map();
  for (const wardCode of wardCodes) {
    const entry = hierarchyIndex?.[wardCode];
    const ancestors = entry?.ancestors ?? [];
    if (ancestors[0]) {
      const rootLabel = formatDimensionLabel(ancestors[0]);
      if (rootLabel) rootCounts.set(rootLabel, (rootCounts.get(rootLabel) ?? 0) + 1);
    }
    for (const ancestor of ancestors) {
      const label = formatDimensionLabel(ancestor);
      if (!label) continue;
      ancestorCounts.set(label, (ancestorCounts.get(label) ?? 0) + 1);
    }
  }

  let bestRoot = null;
  let bestRootCount = 0;
  for (const [label, count] of rootCounts) {
    if (count > bestRootCount) {
      bestRoot = label;
      bestRootCount = count;
    }
  }
  if (bestRoot) return bestRoot;

  let bestLabel = null;
  let bestCount = 0;
  for (const [label, count] of ancestorCounts) {
    if (count > bestCount) {
      bestLabel = label;
      bestCount = count;
    }
  }
  if (bestLabel) return bestLabel;

  return configured || "Region";
}

export function buildBoundaryLabelIndex(boundaries = []) {
  const index = {};
  for (const boundary of boundaries) {
    const code = String(boundary?.code ?? "").trim();
    if (!code) continue;
    const name = boundary?.localname || boundary?.name || boundary?.label;
    index[code] = name ? String(name) : formatDimensionLabel(code);
  }
  return index;
}

export function formatHierarchyGroupLabel(groupKey, boundaryLabelIndex = {}) {
  const code = String(groupKey ?? "").trim();
  if (!code) return "Area";
  if (code.startsWith("geo@")) return formatSpatialGroupLabel(code);
  if (boundaryLabelIndex[code]) return boundaryLabelIndex[code];
  return formatDimensionLabel(code);
}

function levelsUpFromLeafForTier(tier) {
  return { state: 3, city: 2, district: 1, ward: 0 }[tier] ?? 0;
}

/** Cumulative underscore prefixes from a ward code (e.g. BOMET_BOMET_CENTRAL → [BOMET, BOMET_BOMET]). */
function deriveAncestorsFromCode(wardCode) {
  const code = String(wardCode ?? "").trim();
  if (!code) return [];

  const parts = code.split("_").filter(Boolean);
  if (parts.length <= 1) return [];

  const ancestors = [];
  for (let i = 1; i < parts.length; i += 1) {
    ancestors.push(parts.slice(0, i).join("_"));
  }
  return ancestors;
}

function mergeAncestorChains(apiAncestors = [], codeAncestors = []) {
  const api = apiAncestors.filter(Boolean);
  const code = codeAncestors.filter(Boolean);
  if (api.length >= code.length && api.length > 0) return api;
  if (code.length > 0) return code;
  return api;
}

function pickSpatialDivisors(wardCount) {
  const base = Math.max(2, Math.min(8, Math.ceil(Math.sqrt(Math.max(wardCount, 4)))));
  return {
    state: Math.max(2, Math.floor(base / 2)),
    city: base,
    district: Math.min(12, base * 2),
  };
}

/** Per-ward synthetic region keys from polygon centroids when code/API ancestry is shallow. */
function computeSpatialDrillKeys(features = []) {
  const centroids = [];
  for (const feature of features) {
    const code = String(feature?.properties?.code ?? "").trim();
    const point = geometryCentroid(feature?.geometry);
    if (code && point) centroids.push({ code, ...point });
  }

  if (centroids.length <= 1) return {};

  const lngs = centroids.map((row) => row.lng);
  const lats = centroids.map((row) => row.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngSpan = Math.max(maxLng - minLng, 0.0005);
  const latSpan = Math.max(maxLat - minLat, 0.0005);
  const divisors = pickSpatialDivisors(centroids.length);

  const result = {};
  for (const { code, lng, lat } of centroids) {
    const nx = (lng - minLng) / lngSpan;
    const ny = (lat - minLat) / latSpan;
    result[code] = {
      state: `geo@${divisors.state}:${Math.floor(nx * divisors.state)}x${Math.floor(ny * divisors.state)}`,
      city: `geo@${divisors.city}:${Math.floor(nx * divisors.city)}x${Math.floor(ny * divisors.city)}`,
      district: `geo@${divisors.district}:${Math.floor(nx * divisors.district)}x${Math.floor(ny * divisors.district)}`,
    };
  }
  return result;
}

/**
 * Merge boundary-relationship ancestry, ward-code prefixes, and spatial grid tiers
 * so every drill step has a meaningful grouping key.
 */
export function buildMapDrillHierarchy({
  apiIndex = {},
  wardCodes = [],
  features = [],
} = {}) {
  const index = {};
  const codes = [...new Set(wardCodes.map((code) => String(code ?? "").trim()).filter(Boolean))];

  for (const wardCode of codes) {
    const apiEntry = apiIndex?.[wardCode];
    const apiAncestors = apiEntry?.ancestors ?? [];
    const codeAncestors = deriveAncestorsFromCode(wardCode);
    const ancestors = mergeAncestorChains(apiAncestors, codeAncestors);

    index[wardCode] = {
      ...(apiEntry ?? {}),
      code: wardCode,
      ancestors,
    };
  }

  const spatial = computeSpatialDrillKeys(features);
  for (const [wardCode, spatialTiers] of Object.entries(spatial)) {
    if (!index[wardCode]) {
      index[wardCode] = { code: wardCode, ancestors: deriveAncestorsFromCode(wardCode) };
    }
    index[wardCode].spatialTiers = spatialTiers;
  }

  return index;
}

function formatSpatialGroupLabel(groupKey) {
  const match = String(groupKey ?? "").match(/^geo@(\d+):(\d+)x(\d+)$/);
  if (!match) return "Area";
  const [, , x, y] = match;
  return `Zone ${Number(x) + 1}-${Number(y) + 1}`;
}

function ancestorGroupKey(entry, wardCode, levelsUp) {
  if (!entry || levelsUp <= 0) return null;

  const chain = [...(entry.ancestors ?? []), wardCode];
  const idx = Math.max(0, chain.length - 1 - levelsUp);
  if (idx >= chain.length - 1) return null;
  return chain[idx] || null;
}

/** Wards visible at the current drill depth (parent groups from the breadcrumb trail). */
export function getFeaturesInDrillScope(features = [], hierarchyIndex = {}, drillSteps = []) {
  if (!drillSteps?.length) return features ?? [];

  let scoped = features ?? [];
  for (const step of drillSteps) {
    const groupKey = String(step?.groupKey ?? "").trim();
    const tierId = step?.tierId;
    if (!groupKey || !tierId) continue;

    const narrowed = scoped.filter(
      (feature) =>
        getHierarchyGroupKey(feature?.properties?.code, hierarchyIndex, tierId) === groupKey
    );
    if (narrowed.length) scoped = narrowed;
  }

  return scoped.length ? scoped : (features ?? []);
}

/** Group key from boundary ancestry — coarser tiers merge more wards. */
export function getHierarchyGroupKey(code, hierarchyIndex, tier) {
  const wardCode = String(code ?? "").trim();
  if (!wardCode || tier === "ward") return wardCode;

  const entry = hierarchyIndex?.[wardCode];
  const levelsUp = levelsUpFromLeafForTier(tier);
  const ancestors = entry?.ancestors ?? [];

  if (ancestors.length >= levelsUp && levelsUp > 0) {
    const ancestorKey = ancestorGroupKey(entry, wardCode, levelsUp);
    if (ancestorKey) return ancestorKey;
  }

  const spatialKey = entry?.spatialTiers?.[tier];
  if (spatialKey) return spatialKey;

  return wardCode;
}

/** Grid cell size (degrees) when hierarchy metadata is unavailable. */
function getClusterCellSizeForTier(tierId) {
  if (tierId === "ward") return null;
  if (tierId === "district") return 0.016;
  if (tierId === "city") return 0.048;
  return 0.14;
}

function filterFeaturesToScope(features, scopeCodes) {
  if (!scopeCodes?.length) return features;
  const scopeSet = new Set(scopeCodes);
  return features.filter((feature) => scopeSet.has(feature?.properties?.code));
}

export function filterPinsInBounds(pins, bounds, { padRatio = 0.12 } = {}) {
  if (!bounds?.isValid?.()) return pins;
  const padded = padRatio > 0 ? bounds.pad(padRatio) : bounds;
  return pins.filter((pin) => padded.contains([pin.lat, pin.lng]));
}

function hashSeed(value) {
  const str = String(value ?? "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function jitterAroundCentroid(centroid, seed, slot) {
  const angle = ((hashSeed(seed) + slot * 47) % 360) * (Math.PI / 180);
  const dist = 0.0008 + (hashSeed(`${seed}-${slot}`) % 5) * 0.00025;
  return {
    lat: centroid.lat + Math.sin(angle) * dist,
    lng: centroid.lng + Math.cos(angle) * dist,
  };
}

/** A pin has its own usable coordinates if both are finite and not the (0,0) null-island. */
function hasUsableGeoPin(pin) {
  const lat = Number(pin?.lat);
  const lng = Number(pin?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return true;
}

/** Ward/locality centroids keyed by boundary code (trimmed). */
export function buildWardCentroidIndex(joined) {
  const index = {};
  const { geoFeatures, markers } = joined ?? {};

  for (const feature of geoFeatures?.features ?? []) {
    const code = String(feature?.properties?.code ?? "").trim();
    const centroid = geometryCentroid(feature.geometry);
    if (code && centroid) index[code] = centroid;
  }

  for (const marker of markers ?? []) {
    const code = String(marker.code ?? "").trim();
    if (code && marker.lat != null && marker.lng != null) {
      index[code] = { lat: marker.lat, lng: marker.lng };
    }
  }

  return index;
}

/** Ward codes that have a visible polygon or point on the choropleth. */
export function getMappedWardCodes(joined) {
  const codes = new Set();
  for (const feature of joined?.geoFeatures?.features ?? []) {
    const code = String(feature?.properties?.code ?? "").trim();
    if (code) codes.add(code);
  }
  for (const marker of joined?.markers ?? []) {
    const code = String(marker.code ?? "").trim();
    if (code) codes.add(code);
  }
  return codes;
}

function buildWardGeometryIndex(joined) {
  const index = {};
  for (const feature of joined?.geoFeatures?.features ?? []) {
    const code = String(feature?.properties?.code ?? "").trim();
    if (code && feature.geometry) index[code] = feature.geometry;
  }
  return index;
}

function pointInRing(lng, lat, ring) {
  if (!ring?.length) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lng, lat, geometry) {
  if (!geometry?.type) return false;
  if (geometry.type === "Polygon") {
    return pointInRing(lng, lat, geometry.coordinates?.[0]);
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates ?? []).some((polygon) => pointInRing(lng, lat, polygon?.[0]));
  }
  return false;
}

/**
 * Place each complaint on the map:
 *   1. Only wards that have a visible choropleth polygon.
 *   2. Use lat/lng when it falls inside the ward boundary.
 *   3. Otherwise snap to the ward centroid (with jitter for stacks).
 */
export function resolveComplaintPinPositions(pins = [], joined) {
  const wardCentroids = buildWardCentroidIndex(joined);
  const wardGeometries = buildWardGeometryIndex(joined);
  const mappedWards = getMappedWardCodes(joined);
  const wardSlot = new Map();

  return pins
    .map((pin, index) => {
      const wardCode = String(pin.wardCode ?? "").trim();
      if (!wardCode || !mappedWards.has(wardCode)) return null;

      const geometry = wardGeometries[wardCode];
      const lat = Number(pin.lat);
      const lng = Number(pin.lng);

      if (
        hasUsableGeoPin(pin) &&
        geometry &&
        pointInGeometry(lng, lat, geometry)
      ) {
        return { ...pin, lat, lng, approximate: false };
      }

      const centroid = wardCentroids[wardCode];
      if (!centroid) return null;

      const slot = wardSlot.get(wardCode) ?? 0;
      wardSlot.set(wardCode, slot + 1);
      const jittered = jitterAroundCentroid(
        centroid,
        pin.id || pin.serviceRequestId || String(index),
        slot
      );

      return {
        ...pin,
        lat: jittered.lat,
        lng: jittered.lng,
        approximate: true,
      };
    })
    .filter(Boolean);
}

function crossProduct(origin, a, b) {
  return (a.lng - origin.lng) * (b.lat - origin.lat) - (a.lat - origin.lat) * (b.lng - origin.lng);
}

function convexHullLngLat(points) {
  if (!points.length) return [];
  if (points.length === 1) {
    const p = points[0];
    const pad = 0.004;
    return [
      { lng: p.lng - pad, lat: p.lat - pad },
      { lng: p.lng + pad, lat: p.lat - pad },
      { lng: p.lng + pad, lat: p.lat + pad },
      { lng: p.lng - pad, lat: p.lat + pad },
    ];
  }

  const sorted = [...points].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  const lower = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      crossProduct(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (
      upper.length >= 2 &&
      crossProduct(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function collectGeometryVertices(geometry, out) {
  if (!geometry?.type) return;

  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates;
    out.push({ lng, lat });
    return;
  }

  if (geometry.type === "Polygon") {
    for (const coord of geometry.coordinates[0] ?? []) {
      out.push({ lng: coord[0], lat: coord[1] });
    }
    return;
  }

  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates ?? []) {
      for (const coord of polygon[0] ?? []) {
        out.push({ lng: coord[0], lat: coord[1] });
      }
    }
  }
}

function aggregateClusterProperties(members) {
  let current = 0;
  let prior = 0;
  let open = 0;
  let breached = 0;
  let slaWithin = 0;
  let slaApproaching = 0;
  let slaBreached = 0;
  const clusterCodes = members.map((feature) => feature.properties?.code).filter(Boolean);

  for (const feature of members) {
    const props = feature.properties ?? {};
    current += Number(props.current ?? props.count) || 0;
    prior += Number(props.prior) || 0;
    open += Number(props.open) || 0;
    breached += Number(props.breached) || 0;
    slaWithin += Number(props.slaWithin) || 0;
    slaApproaching += Number(props.slaApproaching) || 0;
    slaBreached += Number(props.slaBreached) || 0;
  }

  const wowPct =
    prior <= 0 && current > 0
      ? Number.POSITIVE_INFINITY
      : prior <= 0
        ? 0
        : ((current - prior) / prior) * 100;

  const label =
    members.length > 1
      ? `${members.length} areas`
      : members[0]?.properties?.label ?? "Area";

  return {
    code: clusterCodes.join("+"),
    clusterCodes,
    isCluster: members.length > 1,
    label,
    count: current,
    current,
    prior,
    wowPct,
    open,
    breached,
    breachSharePct: open > 0 ? (breached / open) * 100 : 0,
    slaWithin,
    slaApproaching,
    slaBreached,
    total: current,
  };
}

function clusterGeometryForMembers(members) {
  if (members.length === 1) {
    return members[0].geometry;
  }

  const vertices = [];
  for (const feature of members) {
    collectGeometryVertices(feature.geometry, vertices);
  }

  const hull = convexHullLngLat(vertices);
  if (hull.length < 3) {
    return members[0].geometry;
  }

  const ring = [...hull.map((point) => [point.lng, point.lat]), [hull[0].lng, hull[0].lat]];
  return { type: "Polygon", coordinates: [ring] };
}

function hasUsefulHierarchy(hierarchyIndex = {}) {
  return Object.values(hierarchyIndex).some(
    (entry) => (entry?.ancestors ?? []).length > 0 || entry?.spatialTiers
  );
}

function clusterGeoFeatures(features, tierId, hierarchyIndex = {}) {
  if (tierId === "ward" || features.length <= 1) {
    return features;
  }

  const hasHierarchy = hasUsefulHierarchy(hierarchyIndex);
  if (hasHierarchy) {
    const buckets = new Map();
    for (const feature of features) {
      const code = feature?.properties?.code;
      const key = getHierarchyGroupKey(code, hierarchyIndex, tierId);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(feature);
    }

    return [...buckets.values()].map((members) => ({
      type: "Feature",
      properties: aggregateClusterProperties(members),
      geometry: clusterGeometryForMembers(members),
      memberFeatures: members,
    }));
  }

  const cellSize = getClusterCellSizeForTier(tierId);
  if (!cellSize) {
    return features;
  }

  const buckets = new Map();
  for (const feature of features) {
    const centroid = geometryCentroid(feature.geometry);
    if (!centroid) continue;
    const cellX = Math.floor(centroid.lng / cellSize);
    const cellY = Math.floor(centroid.lat / cellSize);
    const key = `${cellX}:${cellY}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(feature);
  }

  return [...buckets.values()].map((members) => ({
    type: "Feature",
    properties: aggregateClusterProperties(members),
    geometry: clusterGeometryForMembers(members),
    memberFeatures: members,
  }));
}

/** Wards in the same spatial grid cell within the current scope. */
function getSpatialClusterMembers(allFeatures, clickedFeature, tierId) {
  const all = allFeatures ?? [];
  if (!clickedFeature?.geometry || all.length <= 1) return [];

  const centroids = [];
  for (const feature of all) {
    const point = geometryCentroid(feature?.geometry);
    if (point) centroids.push({ feature, ...point });
  }

  const clicked = geometryCentroid(clickedFeature.geometry);
  if (!centroids.length || !clicked) return [];

  const lngs = centroids.map((row) => row.lng);
  const lats = centroids.map((row) => row.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngSpan = Math.max(maxLng - minLng, 0.0005);
  const latSpan = Math.max(maxLat - minLat, 0.0005);
  const divisors = pickSpatialDivisors(centroids.length);
  const divisor = divisors[tierId] ?? divisors.district;

  const cellX = Math.floor(((clicked.lng - minLng) / lngSpan) * divisor);
  const cellY = Math.floor(((clicked.lat - minLat) / latSpan) * divisor);

  return centroids
    .filter(
      ({ lng, lat }) =>
        Math.floor(((lng - minLng) / lngSpan) * divisor) === cellX &&
        Math.floor(((lat - minLat) / latSpan) * divisor) === cellY
    )
    .map(({ feature }) => feature);
}

/**
 * Pick polygons to fit on drill-click.
 * Prefers the hierarchy group; falls back to clicked ward or a spatial cluster
 * so every click produces a meaningful zoom even without backend ancestry.
 */
export function resolveDrillZoomFeatures({
  memberFeatures = [],
  clickedFeature = null,
  allFeatures = [],
  scopedFeatures = [],
  hierarchyIndex = {},
  tierId = "ward",
}) {
  const scope = scopedFeatures?.length ? scopedFeatures : (allFeatures ?? []);
  const all = allFeatures ?? [];
  const members = memberFeatures?.length
    ? memberFeatures
    : clickedFeature
      ? [clickedFeature]
      : [];

  if (!members.length) return [];

  // Whole-scope group — try a tighter spatial cluster, then the clicked ward.
  if (scope.length > 1 && members.length >= scope.length) {
    if (clickedFeature) {
      const spatialMembers = getSpatialClusterMembers(scope, clickedFeature, tierId);
      if (spatialMembers.length > 1 && spatialMembers.length < members.length) {
        return spatialMembers;
      }
      return [clickedFeature];
    }
    return members;
  }

  if (members.length === 1 && clickedFeature) {
    const spatialMembers = getSpatialClusterMembers(scope, clickedFeature, tierId);
    if (spatialMembers.length > 1) return spatialMembers;
  }

  // Still covering the full map at the top level — zoom to clicked ward minimum.
  if (all.length > 1 && members.length >= all.length && clickedFeature) {
    return [clickedFeature];
  }

  return members;
}

/** Fly/zoom map to drill target; nudge zoom in when bounds barely change. */
export function flyToDrillBounds(
  map,
  features = [],
  { padding = 0.12, maxZoom = MAP_COMPLAINT_PIN_MAX_ZOOM } = {}
) {
  if (!map) return;

  const bounds = boundsForGeoFeatures(features);
  if (!bounds?.isValid()) {
    map.setZoom(Math.min(map.getZoom() + 2, maxZoom), { animate: true });
    return;
  }

  const padded = bounds.pad(padding);
  const currentBounds = map.getBounds();
  const targetZoom = map.getBoundsZoom(padded, false);
  const alreadyFramed =
    currentBounds.contains(padded) && targetZoom <= map.getZoom() + 0.5;

  if (alreadyFramed) {
    map.flyToBounds(padded, {
      maxZoom: Math.min(map.getZoom() + 2, maxZoom),
      animate: true,
    });
    return;
  }

  map.flyToBounds(padded, { maxZoom, animate: true });
}

/** Ward polygons that share the same hierarchy group key at a drill tier. */
export function getWardFeaturesInHierarchyGroup(
  allFeatures,
  wardCode,
  hierarchyIndex,
  tierId
) {
  const features = allFeatures ?? [];
  const code = String(wardCode ?? "").trim();
  if (!code || !features.length) return [];

  const groupKey = getHierarchyGroupKey(code, hierarchyIndex, tierId);
  const members = features.filter(
    (feature) =>
      getHierarchyGroupKey(feature?.properties?.code, hierarchyIndex, tierId) === groupKey
  );

  if (members.length) return members;

  const single = features.find((feature) => feature?.properties?.code === code);
  return single ? [single] : [];
}

/** Leaflet bounds for one or more GeoJSON features (actual ward polygons). */
export function boundsForGeoFeatures(features = []) {
  if (!features.length) return null;

  const group = L.featureGroup();
  L.geoJSON({ type: "FeatureCollection", features }, {
    onEachFeature: (_feature, layer) => {
      group.addLayer(layer);
    },
  });

  const bounds = group.getBounds();
  return bounds?.isValid() ? bounds : null;
}

/**
 * Build choropleth + point layers.
 * Always renders every ward polygon from boundary geometry.
 * Complaint pins are always shown when data is available.
 */
export function buildMapDisplayLayers(
  joined,
  _drillLevel,
  complaintPins = [],
  _hierarchyIndex = {}
) {
  const rawFeatures = joined?.geoFeatures?.features ?? [];
  const visibleComplaintPins = complaintPins.length
    ? resolveComplaintPinPositions(complaintPins, joined)
    : [];

  return {
    geoFeatures: { type: "FeatureCollection", features: rawFeatures },
    pointMarkers: joined?.markers ?? [],
    complaintPins: visibleComplaintPins,
  };
}

/** Ward centroid markers and complaint pins scale with map zoom. */
export function markerRadiusForZoom(zoom, isFocused = false, { complaint = false } = {}) {
  if (complaint) {
    if (zoom >= 16) return isFocused ? 8 : 6;
    if (zoom >= 14) return isFocused ? 7 : 5;
    return isFocused ? 6 : 4;
  }
  if (zoom >= 14) return isFocused ? 6 : 4;
  if (zoom >= 11) return isFocused ? 5 : 3;
  return isFocused ? 4 : 2;
}

export function fitBoundsToGeoFeatures(
  map,
  features = [],
  { padding = 0.12, animate = true, maxZoom = MAP_COMPLAINT_PIN_MAX_ZOOM } = {}
) {
  if (!map || !features.length) return null;

  const group = L.featureGroup();
  L.geoJSON({ type: "FeatureCollection", features }, {
    onEachFeature: (_feature, layer) => {
      group.addLayer(layer);
    },
  });

  const bounds = group.getBounds();
  if (!bounds?.isValid()) return null;

  map.fitBounds(bounds.pad(padding), {
    animate,
    maxZoom,
  });

  return { center: map.getCenter(), zoom: map.getZoom() };
}

export function fitMapToJoinedData(
  map,
  joined,
  { padding = 0.12, maxZoom, animate = false, scopeCodes = null } = {}
) {
  if (!map) return null;

  let bounds = null;
  if (scopeCodes?.length) {
    const scoped = filterFeaturesToScope(joined?.geoFeatures?.features ?? [], scopeCodes);
    bounds = fitBoundsToGeoFeatures(map, scoped, { padding, animate, maxZoom });
    return bounds;
  }

  bounds = resolveJoinedMapBounds(joined);
  if (!bounds) {
    const center = getMapCenter();
    map.setView(center, 11, { animate });
    return { center: map.getCenter(), zoom: map.getZoom() };
  }

  map.fitBounds(bounds.pad(padding), {
    animate,
    ...(maxZoom != null ? { maxZoom } : {}),
  });

  return { center: map.getCenter(), zoom: map.getZoom() };
}
