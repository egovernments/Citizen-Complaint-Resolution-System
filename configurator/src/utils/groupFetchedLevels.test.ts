import { describe, expect, it } from 'vitest';
import { groupFetchedLevels } from './osmBoundaries';

const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const f = (props: Record<string, unknown>, geometry: unknown = polygon) => ({ properties: props, geometry });

describe('groupFetchedLevels', () => {
  it('numbers levels 1, 2, 3 from the fetched place, whatever the source numbering', () => {
    // Geoapify / OpenStreetMap numbering for Nairobi: 4, 6, 8.
    const levels = groupFetchedLevels([
      f({ name: 'Westlands', admin_level: 6 }),
      f({ name: 'Nairobi', admin_level: 4 }),
      f({ name: 'Parklands', admin_level: 8 }),
    ]);
    expect(levels.map((l) => [l.level, l.examples])).toEqual([
      [1, ['Nairobi']],
      [2, ['Westlands']],
      [3, ['Parklands']],
    ]);
  });

  it('groups by depth when the server sends it', () => {
    const levels = groupFetchedLevels([
      f({ name: 'A', admin_level: 5, depth: 1 }),
      f({ name: 'Root', admin_level: 1, depth: 0 }),
    ]);
    expect(levels.map((l) => l.examples[0])).toEqual(['Root', 'A']);
  });

  it('renumbers after dropping levels without polygons', () => {
    const levels = groupFetchedLevels([
      f({ name: 'Root', depth: 0 }, null), // no polygon: not a level
      f({ name: 'Ward', depth: 1 }),
    ]);
    expect(levels.map((l) => l.level)).toEqual([1]);
  });

  it('pre-fills a level with its local name when all its areas agree', () => {
    const [county, mixed] = groupFetchedLevels([
      f({ name: 'Nairobi', depth: 0, level_name: 'County' }),
      f({ name: 'X', depth: 1, level_name: 'Sub-county' }),
      f({ name: 'Y', depth: 1, level_name: 'Ward' }),
    ]);
    expect([county.mappedName, county.suggestedName]).toEqual(['County', 'County']);
    expect([mixed.mappedName, mixed.suggestedName]).toEqual(['', undefined]);
  });

  it('leaves the name blank when the source has none', () => {
    const [level] = groupFetchedLevels([f({ name: 'Nairobi', depth: 0 })]);
    expect(level.mappedName).toBe('');
  });
});
