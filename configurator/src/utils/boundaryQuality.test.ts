import { describe, expect, it } from 'vitest';
import { summarizeBoundaryQuality } from './boundaryQuality';
import type { OsmAdminLevel } from './osmBoundaries';

const sq = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});
const f = (id: string, name: string | null, geometry: unknown) => ({
  type: 'Feature',
  id,
  properties: name ? { name } : {},
  geometry,
});
const lvl = (level: number, features: unknown[], selected = true): OsmAdminLevel => ({
  level, features, examples: [], mappedName: '', selected,
});

// Root ⊃ {Alpha, Beta}; level 3 has two places in Alpha, none in Beta, one
// outside everything, and one without a name.
const levels = () => [
  lvl(1, [f('r', 'Root', sq(0, 0, 10, 10))]),
  lvl(2, [f('a', 'Alpha', sq(0, 0, 5, 10)), f('b', 'Beta', sq(5, 0, 10, 10))]),
  lvl(3, [
    f('a1', 'A One', sq(1, 1, 2, 2)),
    f('a2', 'A Two', sq(3, 3, 4, 4)),
    f('x', 'Outside', sq(20, 20, 21, 21)),
    f('u', null, sq(1, 5, 2, 6)),
  ]),
];

describe('summarizeBoundaryQuality', () => {
  it('counts what will be created, what is dropped and why, and where the data stops', () => {
    const q = summarizeBoundaryQuality(levels())!;
    expect(q.levels).toEqual([
      { level: 1, total: 1, kept: 1, unnamed: 0, noParent: 0, parentsTotal: null, parentsCovered: null },
      { level: 2, total: 2, kept: 2, unnamed: 0, noParent: 0, parentsTotal: 1, parentsCovered: 1 },
      { level: 3, total: 4, kept: 2, unnamed: 1, noParent: 1, parentsTotal: 2, parentsCovered: 1 },
    ]);
    expect(q).toMatchObject({ totalAreas: 7, kept: 5, skipped: 2 });
  });

  it('measures parenting against the level actually above in the selection', () => {
    const [l1, , l3] = levels();
    const q = summarizeBoundaryQuality([l1, { ...levels()[1], selected: false }, l3]);
    expect(q).toBeNull(); // a gap — the level screen rejects this selection too
    const trimmed = summarizeBoundaryQuality([{ ...l1, selected: false }, levels()[1], l3])!;
    expect(trimmed.levels.map((l) => l.level)).toEqual([2, 3]);
    expect(trimmed.levels[1]).toMatchObject({ parentsTotal: 2, parentsCovered: 1, noParent: 1 });
  });

  it('is null for fewer than two selected levels', () => {
    expect(summarizeBoundaryQuality([levels()[0]])).toBeNull();
    expect(summarizeBoundaryQuality([])).toBeNull();
  });
});
