import { describe, expect, it } from 'vitest';
import { coerceForBoundaryService, largestPart, largestPartCentroid, parseGeoJsonSidecar } from './boundaryGeoJson';

const outer = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]; // counter-clockwise
const hole = [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]; // counter-clockwise too: must be flipped when kept
const island = [[6, 0], [8, 0], [8, 2], [6, 2], [6, 0]];
// The main piece: more points than the island, which is how the largest part is picked.
const mainland = [[0, 0], [2, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
const inHole: [number, number] = [1.5, 1.5];

/** Even-odd ray casting over one ring — the rule turf's booleanPointInPolygon
 *  (PGR's complaint-to-boundary lookup) and Leaflet's fill apply. */
function inside(ring: number[][], [x, y]: [number, number]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function onlyRing(geom: ReturnType<typeof coerceForBoundaryService>): number[][] {
  expect(geom?.type).toBe('Polygon');
  const rings = geom!.coordinates as number[][][];
  expect(rings).toHaveLength(1); // boundary-service refuses holes
  return rings[0];
}

describe('coerceForBoundaryService', () => {
  it('drops a hole nothing lies in (a lake, a sliver, a neighbouring country)', () => {
    // Liberia's and South Africa's outlines (Lesotho) have one; refusing it failed every area under them.
    expect(coerceForBoundaryService({ type: 'Polygon', coordinates: [outer, hole] }, [[3, 3]])).toEqual({
      type: 'Polygon',
      coordinates: [outer],
    });
  });

  it('keeps a hole another created area lies in, as a keyhole boundary-service accepts', () => {
    const ring = onlyRing(coerceForBoundaryService({ type: 'Polygon', coordinates: [outer, hole] }, [inHole]));
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
    expect(inside(ring, [3, 3])).toBe(true);
    expect(inside(ring, inHole)).toBe(false); // the enclave's complaints stay in the enclave
    expect(inside(ring, [0.5, 0.4])).toBe(true); // beside the cut
    // The hole runs against the outer ring, so a nonzero fill leaves it empty too.
    const holePart = ring.slice(outer.length, outer.length + hole.length);
    const area = (r: number[][]) => r.slice(0, -1).reduce((s, p, k) => s + p[0] * r[k + 1][1] - r[k + 1][0] * p[1], 0);
    expect(Math.sign(area(holePart))).toBe(-1);
  });

  it('keeps the largest part of a MultiPolygon only, so no cut is drawn across the sea', () => {
    expect(coerceForBoundaryService({ type: 'MultiPolygon', coordinates: [[island], [mainland]] })).toEqual({
      type: 'Polygon',
      coordinates: [mainland],
    });
  });

  it('never sends a degenerate extra ring through', () => {
    // A 3-point "hole" left by repair or rounding: still one valid ring out.
    const sliver = [[1, 1], [2, 1], [1, 1]];
    expect(coerceForBoundaryService({ type: 'Polygon', coordinates: [outer, sliver] })).toEqual({
      type: 'Polygon',
      coordinates: [outer],
    });
  });

  it('keeps a point, and refuses what boundary-service cannot store', () => {
    const point = { type: 'Point', coordinates: [1, 2] };
    expect(coerceForBoundaryService(point)).toBe(point);
    expect(coerceForBoundaryService({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })).toBeUndefined();
    expect(coerceForBoundaryService({ type: 'MultiPolygon', coordinates: [] })).toBeUndefined();
    expect(coerceForBoundaryService({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] })).toBeUndefined();
  });
});

describe('largestPart / largestPartCentroid', () => {
  it('reads the part that is stored, with its holes, never the islands', () => {
    expect(largestPart({ type: 'MultiPolygon', coordinates: [[island], [mainland, hole]] })).toEqual([mainland, hole]);
    // The mainland's own centroid, not one pulled into the sea by the island.
    expect(largestPartCentroid({ type: 'MultiPolygon', coordinates: [[island], [mainland]] })).toEqual([2, 2]);
  });
});

describe('parseGeoJsonSidecar', () => {
  it('keeps a hole only where another feature of the file lies', () => {
    const fc = (features: unknown[]) => JSON.stringify({ type: 'FeatureCollection', features });
    const ward = { properties: { code: 'RURAL' }, geometry: { type: 'Polygon', coordinates: [outer, hole] } };
    const town = { properties: { code: 'TOWN' }, geometry: { type: 'Polygon', coordinates: [hole] } };
    expect((parseGeoJsonSidecar(fc([ward, town])).byCode.get('RURAL')!.coordinates as number[][][])[0]).toHaveLength(
      outer.length + hole.length + 1,
    );
    expect(parseGeoJsonSidecar(fc([ward])).byCode.get('RURAL')).toEqual({ type: 'Polygon', coordinates: [outer] });
  });
});
