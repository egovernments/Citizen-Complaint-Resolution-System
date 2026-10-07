import { describe, expect, it } from 'vitest';
import { buildOsmBoundaries, computeContainingParents, type OsmAdminLevel } from './osmBoundaries';
import { summarizeBoundaryQuality } from './boundaryQuality';

const square = (x: number, y: number, s: number) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]],
});
const area = (name: string, placeId: string, geometry: unknown) => ({
  type: 'Feature',
  properties: { name, place_id: placeId },
  geometry,
});
const level = (n: number, name: string, features: unknown[]): OsmAdminLevel => ({
  level: n,
  features,
  examples: [],
  mappedName: name,
  selected: true,
});

// A district holding two wards that share a name, plus one ward outside every district.
const district = level(1, 'District', [area('Central', 'd1', square(0, 0, 10))]);
const wardA = area('Riverside', 'w-a', square(1, 1, 2));
const wardB = area('Riverside', 'w-b', square(5, 5, 2));
const stray = area('Faraway', 'w-z', square(50, 50, 2));

describe('buildOsmBoundaries code suffixes', () => {
  it('assigns X and X_2 by place_id, whatever order the server returned', () => {
    const codes = (wards: unknown[]) =>
      buildOsmBoundaries([district, level(2, 'Ward', wards)], 'mz', 'ADMIN').boundaries
        .filter((b) => b.boundaryType === 'Ward')
        .map((b) => [b.name, b.code, (b as { geometry?: { coordinates: number[][][] } }).geometry?.coordinates[0][0][0]]);
    expect(codes([wardB, wardA])).toEqual(codes([wardA, wardB]));
    // w-a sorts first, so it keeps the bare code.
    expect(codes([wardB, wardA]).map((c) => c[1])).toEqual(['RIVERSIDE', 'RIVERSIDE_2']);
    expect(codes([wardB, wardA])[0][2]).toBe(1);
  });

  it('names an unnamed skipped area by its place_id', () => {
    const { skipped } = buildOsmBoundaries(
      [district, level(2, 'Ward', [{ type: 'Feature', properties: { place_id: 'p-9' }, geometry: square(2, 2, 1) }])],
      'mz',
      'ADMIN',
    );
    expect(skipped[0]).toMatchObject({ name: 'p-9', reason: 'unnamed' });
  });
});

describe('computeContainingParents', () => {
  const levels = [district, level(2, 'Ward', [wardA, wardB, stray])];

  it('gives the same build as finding parents inline', () => {
    const parents = computeContainingParents(levels);
    expect(buildOsmBoundaries(levels, 'mz', 'ADMIN', parents)).toEqual(buildOsmBoundaries(levels, 'mz', 'ADMIN'));
  });

  it('gives the same data check', () => {
    const parents = computeContainingParents(levels);
    const withMap = summarizeBoundaryQuality(levels, parents);
    expect(withMap).toEqual(summarizeBoundaryQuality(levels));
    expect(withMap?.levels[1]).toMatchObject({ total: 3, kept: 2, noParent: 1 });
  });

  it('lists the smallest containing parent first', () => {
    const big = area('Big', 'p-big', square(0, 0, 20));
    const small = area('Small', 'p-small', square(0, 0, 5));
    const child = area('Child', 'c', square(1, 1, 1));
    const parents = computeContainingParents([level(1, 'A', [big, small]), level(2, 'B', [child])]);
    expect(parents.get(child)).toEqual([small, big]);
  });
});

describe('buildOsmBoundaries stored geometry', () => {
  const holed = (x: number, y: number, s: number, hx: number, hy: number, hs: number) => ({
    type: 'Polygon',
    coordinates: [square(x, y, s).coordinates[0], square(hx, hy, hs).coordinates[0]],
  });
  const ringsOf = (code: string, levels: OsmAdminLevel[]) =>
    (buildOsmBoundaries(levels, 'mz', 'ADMIN').boundaries.find((b) => b.code === code)!.geometry!.coordinates as number[][][]);

  it('keeps a hole as a keyhole only when an area being created lies in it', () => {
    // A rural district around a town district: the town's complaints must not land in the rural one.
    const rural = area('Rural', 'd-r', holed(0, 0, 10, 4, 4, 2));
    const town = area('Town', 'd-t', square(4, 4, 2));
    const withTown = ringsOf('RURAL', [level(1, 'District', [rural, town])]);
    expect(withTown).toHaveLength(1);
    expect(withTown[0].length).toBeGreaterThan(5); // outer + cut + hole
    // The same district on its own: the hole is a lake, and is dropped.
    expect(ringsOf('RURAL', [level(1, 'District', [rural])])).toEqual([square(0, 0, 10).coordinates[0]]);
  });
});
