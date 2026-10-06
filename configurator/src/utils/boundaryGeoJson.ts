// Client-side counterpart to digit-mcp's xlsx-loader polygon sidecar logic.
// Operator picks a `02-Boundaries-Polygons.geojson` in Phase 2 alongside
// the boundary XLSX; we parse the FeatureCollection, key each feature by
// `properties.code` (preferred) or normalized `properties.name`, and
// attach the matching geometry to each boundary row before it's POSTed to
// boundary-service. boundary-service only accepts Point + single-ring
// Polygon, so holes and extra parts are folded into one ring (keyholeRing).
import type { BoundaryGeometry } from '@/api/types';

/** Lowercase, strip diacritics, strip "Distrito Municipal de " prefix,
 *  replace any non-alphanumeric with `_`. Brings OSM display names
 *  (`KaMavota`, `Distrito Municipal de KaMpfumu`) and XLSX codes
 *  (`kamavota`, `kampfumu`) to the same shape so they can be matched. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^distrito municipal de\s+/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

type Ring = number[][];

/** Shoelace signed area; positive when the ring runs counter-clockwise. */
function signedArea(ring: Ring): number {
  let sum = 0;
  for (let k = 0; k < ring.length - 1; k++) sum += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
  return sum / 2;
}

function oriented(ring: Ring, counterClockwise: boolean): Ring {
  return signedArea(ring) > 0 === counterClockwise ? ring : [...ring].reverse();
}

function isRing(r: unknown): r is Ring {
  return Array.isArray(r) && r.length >= 4 && r.every((pt) => Array.isArray(pt) && pt.length >= 2);
}

/**
 * Every part and hole of a (Multi)Polygon as ONE ring, joined by zero-width
 * cuts back to the first point (a "keyhole"). Each cut is walked there and
 * back, so it cancels out of a point-in-polygon test: under even-odd (turf's
 * booleanPointInPolygon, which PGR runs on stored boundaries, and Leaflet's
 * fill) and — with parts counter-clockwise and holes clockwise — under nonzero
 * too. A complaint in an enclave still lands in the enclave, and islands stay.
 */
function keyholeRing(polygons: Ring[][]): Ring {
  const first = oriented(polygons[0][0], true);
  const anchor = first[0];
  const out: Ring = [...first];
  polygons.forEach((rings, p) =>
    rings.forEach((ring, k) => {
      if (p === 0 && k === 0) return;
      out.push(...oriented(ring, k === 0), anchor);
    }),
  );
  return out;
}

/** boundary-service /boundary/_create takes Point and single-ring Polygon only:
 *  it rejects MultiPolygon, and any polygon with a hole ("Polygon must not be
 *  empty neither should it contain any holes"). Five of the twelve official
 *  country outlines have a hole (a lake, an enclave such as Lesotho in South
 *  Africa); when the country is refused, every area under it fails too. So a
 *  polygon with holes, or several parts, is stored as one keyhole ring (see
 *  keyholeRing): accepted by boundary-service, and it keeps both the enclaves
 *  out and the islands in. */
export function coerceForBoundaryService(geom: { type?: string; coordinates?: unknown }): BoundaryGeometry | undefined {
  if (!geom || !geom.type) return undefined;
  if (geom.type === 'Point') {
    return geom as BoundaryGeometry;
  }
  const polygons: Ring[][] =
    geom.type === 'Polygon' && Array.isArray(geom.coordinates)
      ? [geom.coordinates as Ring[]]
      : geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)
        ? (geom.coordinates as Ring[][])
        : [];
  const usable = polygons.map((rings) => (Array.isArray(rings) ? rings.filter(isRing) : [])).filter((rings) => rings.length > 0);
  if (usable.length === 0) return undefined; // LineString, MultiPoint, empty — unsupported here
  if (usable.length === 1 && usable[0].length === 1) {
    return geom.type === 'Polygon' ? (geom as BoundaryGeometry) : { type: 'Polygon', coordinates: [usable[0][0]] };
  }
  return { type: 'Polygon', coordinates: [keyholeRing(usable)] };
}

export interface ParsedGeoJsonSidecar {
  byCode: Map<string, BoundaryGeometry>;
  totalFeatures: number;
  matchedByCode: number;
  matchedByName: number;
  skipped: number;
}

export function parseGeoJsonSidecar(text: string): ParsedGeoJsonSidecar {
  let parsed: { features?: Array<{ properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }> };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Polygon GeoJSON: invalid JSON — ${e instanceof Error ? e.message : String(e)}`);
  }
  const features = parsed.features ?? [];
  const byCode = new Map<string, BoundaryGeometry>();
  let matchedByCode = 0;
  let matchedByName = 0;
  let skipped = 0;
  for (const f of features) {
    const props = f.properties ?? {};
    const geom = coerceForBoundaryService(f.geometry ?? {});
    if (!geom) { skipped++; continue; }
    const explicitCode = typeof props.code === 'string' ? props.code.trim() : '';
    if (explicitCode) {
      byCode.set(explicitCode, geom);
      matchedByCode++;
      continue;
    }
    const name = typeof props.name === 'string' ? props.name.trim() : '';
    if (name) {
      byCode.set(normalizeForMatch(name), geom);
      matchedByName++;
      continue;
    }
    skipped++;
  }
  return { byCode, totalFeatures: features.length, matchedByCode, matchedByName, skipped };
}

/** Return the geometry to use for a boundary row, or undefined to fall
 *  back to the unit-square placeholder. Sidecar > lat/long. */
export function geometryForBoundary(
  row: { code: string; name?: string; latitude?: number; longitude?: number },
  sidecar?: ParsedGeoJsonSidecar,
): BoundaryGeometry | undefined {
  if (sidecar) {
    const fromCode = sidecar.byCode.get(row.code);
    if (fromCode) return fromCode;
    if (row.name) {
      const fromName = sidecar.byCode.get(normalizeForMatch(row.name));
      if (fromName) return fromName;
    }
  }
  if (Number.isFinite(row.longitude) && Number.isFinite(row.latitude)) {
    return { type: 'Point', coordinates: [row.longitude as number, row.latitude as number] };
  }
  return undefined;
}
