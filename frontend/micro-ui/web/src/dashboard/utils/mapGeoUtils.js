import L from "leaflet";
import { formatDimensionLabel } from "../config/kpiQueries";
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

/** Four click-drill levels: state → city → district → ward/zone. */
export const MAP_DRILL_TIERS = [
  { id: "state", label: "State", index: 0 },
  { id: "city", label: "City", index: 1 },
  { id: "district", label: "District", index: 2 },
  { id: "ward", label: "Ward", index: 3 },
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

function levelsUpFromLeafForTier(tier) {
  return { state: 3, city: 2, district: 1, ward: 0 }[tier] ?? 0;
}

/** Group key from boundary ancestry — coarser tiers merge more wards. */
export function getHierarchyGroupKey(code, hierarchyIndex, tier) {
  const wardCode = String(code ?? "").trim();
  if (!wardCode || tier === "ward") return wardCode;

  const entry = hierarchyIndex?.[wardCode];
  const levelsUp = levelsUpFromLeafForTier(tier);
  if (!entry || levelsUp <= 0) return wardCode;

  const chain = [...(entry.ancestors ?? []), wardCode];
  const idx = Math.max(0, chain.length - 1 - levelsUp);
  return chain[idx] || wardCode;
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

/**
 * Place each complaint on the map:
 *   1. Use its own latitude/longitude when valid.
 *   2. Otherwise fall back to its ward centroid (with jitter so stacked pins separate).
 * Pins that can't be placed by either method are dropped.
 */
export function resolveComplaintPinPositions(pins = [], joined) {
  const wardCentroids = buildWardCentroidIndex(joined);
  const wardSlot = new Map();

  return pins
    .map((pin, index) => {
      if (hasUsableGeoPin(pin)) {
        return { ...pin, lat: Number(pin.lat), lng: Number(pin.lng), approximate: false };
      }

      const wardCode = String(pin.wardCode ?? "").trim();
      if (!wardCode) return null;

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
  return Object.values(hierarchyIndex).some((entry) => (entry?.ancestors ?? []).length > 0);
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

/**
 * Build choropleth + point layers for the current drill level.
 * ALL polygons are always visible — scope only affects the camera zoom target.
 * Complaint pins appear at ward level (drill level 3) for every ward in the dataset.
 */
export function buildMapDisplayLayers(
  joined,
  drillLevel,
  complaintPins = [],
  hierarchyIndex = {},
  scopeCodes = null
) {
  const tier = getDrillTier(drillLevel);
  const { geoFeatures, markers } = joined ?? {};
  let rawFeatures = geoFeatures?.features ?? [];
  if (scopeCodes?.length) {
    const scopeSet = new Set(scopeCodes);
    rawFeatures = rawFeatures.filter((feature) => scopeSet.has(feature?.properties?.code));
  }
  const displayFeatures = clusterGeoFeatures(rawFeatures, tier.id, hierarchyIndex);

  const showWardDetail = tier.id === "ward";
  const visibleComplaintPins = showWardDetail && complaintPins.length
    ? resolveComplaintPinPositions(complaintPins, joined)
    : [];

  return {
    geoFeatures: { type: "FeatureCollection", features: displayFeatures },
    pointMarkers: showWardDetail ? (markers ?? []) : [],
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
