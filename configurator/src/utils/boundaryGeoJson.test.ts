import { describe, expect, it } from 'vitest';
import { coerceForBoundaryService } from './boundaryGeoJson';

const outer = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
const hole = [[1, 1], [2, 1], [2, 2], [1, 1]];
const small = [[10, 10], [11, 10], [11, 11], [10, 10]];

describe('coerceForBoundaryService', () => {
  it('drops holes, which boundary-service rejects', () => {
    // Liberia's country outline has one; without this the country and every area under it failed.
    expect(coerceForBoundaryService({ type: 'Polygon', coordinates: [outer, hole] })).toEqual({
      type: 'Polygon',
      coordinates: [outer],
    });
  });

  it('keeps a plain polygon and a point as they are', () => {
    const plain = { type: 'Polygon', coordinates: [outer] };
    expect(coerceForBoundaryService(plain)).toBe(plain);
    const point = { type: 'Point', coordinates: [1, 2] };
    expect(coerceForBoundaryService(point)).toBe(point);
  });

  it('collapses a MultiPolygon to its main part, without that part\'s holes', () => {
    expect(coerceForBoundaryService({ type: 'MultiPolygon', coordinates: [[small], [outer, hole]] })).toEqual({
      type: 'Polygon',
      coordinates: [outer],
    });
  });

  it('refuses what boundary-service cannot store', () => {
    expect(coerceForBoundaryService({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })).toBeUndefined();
    expect(coerceForBoundaryService({ type: 'MultiPolygon', coordinates: [] })).toBeUndefined();
  });
});
