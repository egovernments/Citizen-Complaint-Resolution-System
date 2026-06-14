import { formatDimensionLabel } from "../config/kpiQueries";

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
    const code = String(ward.label ?? ward.wardCode ?? "");
    const count = Number(ward.count) || 0;
    maxCount = Math.max(maxCount, count);

    const boundary = boundaryByCode[code];
    const geometry = boundary?.geometry;
    const label = formatDimensionLabel(code);
    const type = geometry?.type;

    if (!type) {
      geometrySummary.missing += 1;
      continue;
    }

    if (type === "Point") {
      geometrySummary.point += 1;
      const [lng, lat] = geometry.coordinates;
      markers.push({ code, label, count, lat, lng, geometry });
    } else if (type === "Polygon" || type === "MultiPolygon") {
      geometrySummary.polygon += 1;
      const centroid = geometryCentroid(geometry);
      if (centroid) {
        markers.push({ code, label, count, ...centroid, geometry });
      }
      geoFeatures.push({
        type: "Feature",
        properties: { code, label, count },
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
