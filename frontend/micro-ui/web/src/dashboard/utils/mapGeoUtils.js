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

/** Zoom tier shown in the toolbar badge. */
export function getMapZoomTier(zoom) {
  if (zoom >= 13) return "ward";
  if (zoom >= 11) return "locality";
  return "city";
}

/** Grid cell size (degrees) — smaller zoom ⇒ larger cells ⇒ fewer merged clusters. */
function getClusterCellSize(zoom) {
  if (zoom >= 13) return null;
  if (zoom >= 11) return 0.022;
  return 0.055;
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
      ? `${members.length} localities`
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

function clusterGeoFeatures(features, zoom) {
  const cellSize = getClusterCellSize(zoom);
  if (!cellSize || features.length <= 1) {
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
 * Build choropleth + point layers for the current zoom.
 * Low zoom merges adjacent wards into cluster polygons; zooming in splits them apart.
 */
export function buildMapDisplayLayers(joined, zoom) {
  const { geoFeatures, markers } = joined ?? {};
  const rawFeatures = geoFeatures?.features ?? [];
  const displayFeatures = clusterGeoFeatures(rawFeatures, zoom);

  return {
    geoFeatures: { type: "FeatureCollection", features: displayFeatures },
    pointMarkers: markers ?? [],
  };
}

/** Point-only wards: tiny markers when zoomed out, slightly larger when zoomed in. */
export function markerRadiusForZoom(zoom, isFocused = false) {
  if (zoom <= 10) return isFocused ? 4 : 2;
  if (zoom <= 12) return isFocused ? 5 : 3;
  return isFocused ? 6 : 4;
}

export function fitMapToJoinedData(
  map,
  joined,
  { padding = 0.3, maxZoom, animate = false } = {}
) {
  if (!map) return null;
  const bounds = resolveJoinedMapBounds(joined);
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
