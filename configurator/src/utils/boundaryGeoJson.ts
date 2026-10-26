// Client-side counterpart to digit-mcp's xlsx-loader polygon sidecar logic.
// Operator picks a `02-Boundaries-Polygons.geojson` in Phase 2 alongside
// the boundary XLSX; we parse the FeatureCollection, key each feature by
// `properties.code` (preferred) or normalized `properties.name`, and
// attach the matching geometry to each boundary row before it's POSTed to
// boundary-service. boundary-service only accepts Point + single-ring
// Polygon: see coerceForBoundaryService for what is kept.
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

function pointInRing([x, y]: number[], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The part of a (Multi)Polygon boundary-service will store: the one whose
 * outer ring has the most points (the main contiguous piece), with its valid
 * rings only — outer first, then holes. Null for anything else. Callers that
 * need a point inside the stored shape (parent assignment) work from this, so
 * they agree with what is persisted.
 */
export function largestPart(geom: { type?: string; coordinates?: unknown } | null | undefined): Ring[] | null {
  const parts: unknown[] =
    geom?.type === 'Polygon' && Array.isArray(geom.coordinates)
      ? [geom.coordinates]
      : geom?.type === 'MultiPolygon' && Array.isArray(geom.coordinates)
        ? (geom.coordinates as unknown[])
        : [];
  let best: Ring[] | null = null;
  for (const part of parts) {
    if (!Array.isArray(part) || !isRing(part[0])) continue;
    if (!best || part[0].length > best[0].length) best = (part as unknown[]).filter(isRing);
  }
  return best;
}

/** Area-weighted centroid of the largest part's outer ring (null when degenerate). */
export function largestPartCentroid(geom: { type?: string; coordinates?: unknown } | null | undefined): number[] | null {
  const outer = largestPart(geom)?.[0];
  if (!outer) return null;
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const cross = outer[j][0] * outer[i][1] - outer[i][0] * outer[j][1];
    a2 += cross;
    cx += (outer[j][0] + outer[i][0]) * cross;
    cy += (outer[j][1] + outer[i][1]) * cross;
  }
  return Math.abs(a2) < 1e-12 ? null : [cx / (3 * a2), cy / (3 * a2)];
}

/**
 * boundary-service /boundary/_create takes Point and single-ring Polygon only:
 * it rejects MultiPolygon, and any polygon with a hole ("Polygon must not be
 * empty neither should it contain any holes"). Five of the twelve official
 * country outlines have a hole, and when the country is refused every area
 * under it fails too. So:
 *
 *  - a MultiPolygon keeps its largest part (islands are dropped, as before:
 *    joining them in would draw lines across the sea on every map);
 *  - a hole is dropped (a lake, a sliver, a neighbouring country) UNLESS one of
 *    `enclavePoints` — representative points of the other areas being created —
 *    lies in it. Then the area really has another area inside it, and dropping
 *    the hole would route that area's complaints to this one (PGR runs turf's
 *    booleanPointInPolygon on stored boundaries). Such holes are kept by
 *    joining them to the outer ring with a zero-width cut walked there and back
 *    (a "keyhole"): boundary-service accepts the single ring, and even-odd and
 *    nonzero containment both still exclude the hole. The cost is a thin line
 *    along the cut where the outline is drawn, which only enclaves pay.
 */
export function coerceForBoundaryService(
  geom: { type?: string; coordinates?: unknown },
  enclavePoints: number[][] = [],
): BoundaryGeometry | undefined {
  if (!geom || !geom.type) return undefined;
  if (geom.type === 'Point') return geom as BoundaryGeometry;
  const part = largestPart(geom);
  if (!part) return undefined; // LineString, MultiPoint, empty — unsupported here
  const [outer, ...holes] = part;
  const enclaves = holes.filter((hole) => {
    const xs = hole.map((p) => p[0]);
    const ys = hole.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return enclavePoints.some((p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1 && pointInRing(p, hole));
  });
  if (enclaves.length === 0) return { type: 'Polygon', coordinates: [outer] };
  const first = oriented(outer, true);
  const anchor = first[0];
  const ring: Ring = [...first];
  for (const hole of enclaves) ring.push(...oriented(hole, false), anchor);
  return { type: 'Polygon', coordinates: [ring] };
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
  // A hole is kept only when another area of the same file lies in it.
  const enclavePoints = features
    .map((f) => largestPartCentroid(f.geometry))
    .filter((p): p is number[] => p !== null);
  const byCode = new Map<string, BoundaryGeometry>();
  let matchedByCode = 0;
  let matchedByName = 0;
  let skipped = 0;
  for (const f of features) {
    const props = f.properties ?? {};
    const geom = coerceForBoundaryService(f.geometry ?? {}, enclavePoints);
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
