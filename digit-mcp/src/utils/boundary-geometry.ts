/**
 * What boundary-service /boundary/_create can store, from a GeoJSON geometry.
 *
 * Kept in step with configurator/src/utils/boundaryGeoJson.ts
 * (coerceForBoundaryService): the configurator and digit-mcp ship separate
 * copies of their shared package today, so the rule lives in both places and
 * test-boundary-geometry.ts pins the same cases the configurator's tests do.
 *
 * boundary-service takes Point and single-ring Polygon only: it 400s on
 * MultiPolygon and on any polygon with a hole ("Polygon must not be empty
 * neither should it contain any holes"). Five of the twelve official country
 * outlines (#1994) have a hole, and when the country is refused every area
 * under it fails too. So:
 *  - a MultiPolygon keeps its largest part (the main contiguous piece);
 *  - a hole is dropped (a lake, a sliver, a neighbouring country) UNLESS one of
 *    `enclavePoints` — points inside the other areas being created — lies in
 *    it. That area really has another inside it, and dropping the hole would
 *    route the enclave's complaints to it (PGR runs turf's
 *    booleanPointInPolygon on stored boundaries). Such holes are joined to the
 *    outer ring by a zero-width cut walked there and back (a "keyhole"):
 *    boundary-service accepts the single ring, and even-odd and nonzero
 *    containment still exclude the hole. Only enclaves pay the thin cut line
 *    a map draws along it.
 */
type Ring = number[][];
type Geometry = Record<string, unknown>;

function isRing(r: unknown): r is Ring {
  return Array.isArray(r) && r.length >= 4 && r.every((pt) => Array.isArray(pt) && pt.length >= 2);
}

function signedArea(ring: Ring): number {
  let sum = 0;
  for (let k = 0; k < ring.length - 1; k++) sum += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
  return sum / 2;
}

function oriented(ring: Ring, counterClockwise: boolean): Ring {
  return signedArea(ring) > 0 === counterClockwise ? ring : [...ring].reverse();
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

/** The part that is stored: the one whose outer ring has the most points, valid rings only (outer first). */
export function largestPart(geom: Geometry | null | undefined): Ring[] | null {
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

/** Area-weighted centroid of the largest part's outer ring, or null when degenerate. */
export function largestPartCentroid(geom: Geometry | null | undefined): number[] | null {
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

/** A Point as is; a (Multi)Polygon as one ring boundary-service accepts; anything else undefined. */
export function coerceForBoundaryService(geom: Geometry, enclavePoints: number[][] = []): Geometry | undefined {
  if (!geom || !geom.type) return undefined;
  if (geom.type === 'Point') return geom;
  const part = largestPart(geom);
  if (!part) return undefined;
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
