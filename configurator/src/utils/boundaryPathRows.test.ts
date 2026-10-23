import { describe, expect, it } from 'vitest';
import { boundaryPathRows, computeContainingParents, type OsmAdminLevel } from './osmBoundaries';

/** A square from (x, y), `size` wide. */
const square = (name: string, x: number, y: number, size: number) => ({
  type: 'Feature',
  properties: { name },
  geometry: {
    type: 'Polygon',
    coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]],
  },
});
const level = (n: number, mappedName: string, features: ReturnType<typeof square>[]): OsmAdminLevel => ({
  level: n,
  features,
  examples: [],
  mappedName,
  selected: true,
});

describe('boundaryPathRows', () => {
  it('writes one row per area with nothing below it, after the areas it sits in', () => {
    const levels = [
      level(1, 'Country', [square('Kenya', 0, 0, 8)]),
      level(2, 'Area', [square('Area-1', 0, 0, 4), square('Area-2', 4, 0, 4), square('Area-3', 0, 4, 4)]),
      level(3, 'Sub Area', [
        square('Sub Area1-1', 0, 0, 2),
        square('Sub Area1-2', 2, 0, 2),
        square('Sub Area2-1', 4, 0, 2),
        square('Sub Area2-2', 6, 0, 2),
        // In no area of the level above.
        square('Stray', 20, 20, 2),
      ]),
    ];
    expect(boundaryPathRows(levels, computeContainingParents(levels))).toEqual([
      ['', '', 'Stray'],
      ['Kenya', 'Area-1', 'Sub Area1-1'],
      ['Kenya', 'Area-1', 'Sub Area1-2'],
      ['Kenya', 'Area-2', 'Sub Area2-1'],
      ['Kenya', 'Area-2', 'Sub Area2-2'],
      // Nothing below it: its own row, the last column blank.
      ['Kenya', 'Area-3', ''],
    ]);
  });

  it('carries the blanks of a parent that sits in nothing down to its children', () => {
    const levels = [
      level(1, 'Country', [square('Kenya', 0, 0, 8)]),
      level(2, 'Area', [square('Outside', 20, 20, 4)]),
      level(3, 'Sub Area', [square('Inside Outside', 21, 21, 1)]),
    ];
    expect(boundaryPathRows(levels, computeContainingParents(levels))).toEqual([
      ['', 'Outside', 'Inside Outside'],
      ['Kenya', '', ''],
    ]);
  });
});
