import { describe, expect, it } from 'vitest';
import { coerceForBoundaryService } from './boundaryGeoJson';

const outer = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]; // counter-clockwise
const hole = [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]; // counter-clockwise too: must be flipped
const island = [[6, 0], [8, 0], [8, 2], [6, 2], [6, 0]];

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
  const [ring] = rings;
  expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
  return ring;
}

describe('coerceForBoundaryService', () => {
  it('keeps a hole as a keyhole cut that boundary-service accepts', () => {
    // Liberia's country outline has one; refusing it failed the country and every area under it.
    const ring = onlyRing(coerceForBoundaryService({ type: 'Polygon', coordinates: [outer, hole] }));
    expect(inside(ring, [3, 3])).toBe(true);
    expect(inside(ring, [1.5, 1.5])).toBe(false); // the enclave stays out of the surrounding area
    expect(inside(ring, [0.5, 0.4])).toBe(true); // beside the cut
    expect(inside(ring, [5, 5])).toBe(false);
  });

  it('runs the hole against the outer ring, so a nonzero fill also leaves it empty', () => {
    const ring = onlyRing(coerceForBoundaryService({ type: 'Polygon', coordinates: [outer, hole] }));
    const holePart = ring.slice(outer.length, outer.length + hole.length);
    const area = (r: number[][]) => r.slice(0, -1).reduce((s, p, k) => s + p[0] * r[k + 1][1] - r[k + 1][0] * p[1], 0);
    expect(Math.sign(area(holePart))).toBe(-1);
  });

  it('keeps every part of a MultiPolygon, islands included', () => {
    const ring = onlyRing(coerceForBoundaryService({ type: 'MultiPolygon', coordinates: [[outer, hole], [island]] }));
    expect(inside(ring, [3, 3])).toBe(true);
    expect(inside(ring, [7, 1])).toBe(true); // the island
    expect(inside(ring, [1.5, 1.5])).toBe(false); // the hole
    expect(inside(ring, [5, 1])).toBe(false); // the sea between, which the cut crosses
  });

  it('keeps a plain polygon and a point as they are, and a one-part MultiPolygon as its ring', () => {
    const plain = { type: 'Polygon', coordinates: [outer] };
    expect(coerceForBoundaryService(plain)).toBe(plain);
    const point = { type: 'Point', coordinates: [1, 2] };
    expect(coerceForBoundaryService(point)).toBe(point);
    expect(coerceForBoundaryService({ type: 'MultiPolygon', coordinates: [[island]] })).toEqual({
      type: 'Polygon',
      coordinates: [island],
    });
  });

  it('refuses what boundary-service cannot store', () => {
    expect(coerceForBoundaryService({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })).toBeUndefined();
    expect(coerceForBoundaryService({ type: 'MultiPolygon', coordinates: [] })).toBeUndefined();
    expect(coerceForBoundaryService({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] })).toBeUndefined();
  });
});
