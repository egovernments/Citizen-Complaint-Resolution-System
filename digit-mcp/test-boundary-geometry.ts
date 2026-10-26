// What digit-mcp sends boundary-service for a GeoJSON sidecar geometry. Same
// cases as configurator/src/utils/boundaryGeoJson.test.ts: the two copies of
// coerceForBoundaryService must agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coerceForBoundaryService, largestPart, largestPartCentroid } from './src/utils/boundary-geometry.js';

const outer = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
const hole = [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]];
const island = [[6, 0], [8, 0], [8, 2], [6, 2], [6, 0]];
const mainland = [[0, 0], [2, 0], [4, 0], [4, 4], [0, 4], [0, 0]];

/** Even-odd ray casting — what turf's booleanPointInPolygon (PGR) applies. */
function inside(ring: number[][], [x, y]: number[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

test('a hole nothing lies in is dropped: boundary-service refuses holes', () => {
  assert.deepEqual(coerceForBoundaryService({ type: 'Polygon', coordinates: [outer, hole] }, [[3, 3]]), {
    type: 'Polygon',
    coordinates: [outer],
  });
});

test('a hole another area lies in is kept as one keyhole ring', () => {
  const geom = coerceForBoundaryService({ type: 'Polygon', coordinates: [outer, hole] }, [[1.5, 1.5]]);
  const rings = geom?.coordinates as number[][][];
  assert.equal(rings.length, 1);
  assert.equal(inside(rings[0], [3, 3]), true);
  assert.equal(inside(rings[0], [1.5, 1.5]), false);
  assert.equal(inside(rings[0], [0.5, 0.4]), true);
});

test('a MultiPolygon keeps its largest part; degenerate rings never go through', () => {
  assert.deepEqual(coerceForBoundaryService({ type: 'MultiPolygon', coordinates: [[island], [mainland]] }), {
    type: 'Polygon',
    coordinates: [mainland],
  });
  assert.deepEqual(coerceForBoundaryService({ type: 'Polygon', coordinates: [outer, [[1, 1], [2, 1], [1, 1]]] }), {
    type: 'Polygon',
    coordinates: [outer],
  });
  assert.deepEqual(largestPart({ type: 'MultiPolygon', coordinates: [[island], [mainland, hole]] }), [mainland, hole]);
  assert.deepEqual(largestPartCentroid({ type: 'MultiPolygon', coordinates: [[island], [mainland]] }), [2, 2]);
});

test('points pass through; what boundary-service cannot store is undefined', () => {
  const point = { type: 'Point', coordinates: [1, 2] };
  assert.equal(coerceForBoundaryService(point), point);
  assert.equal(coerceForBoundaryService({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }), undefined);
  assert.equal(coerceForBoundaryService({ type: 'MultiPolygon', coordinates: [] }), undefined);
});
