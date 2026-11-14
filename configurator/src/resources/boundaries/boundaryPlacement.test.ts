import { describe, it, expect } from 'vitest';
import { parentChoices, placementOf } from './boundaryPlacement';

const rows = [
  { id: 'C', code: 'C', boundaryType: 'County', hierarchyType: 'ADMIN' },
  { id: 'S1', code: 'S1', name: 'Sub one', boundaryType: 'SubCounty', hierarchyType: 'ADMIN', parentCode: 'C' },
  { id: 'S2', code: 'S2', boundaryType: 'SubCounty', hierarchyType: 'ADMIN', parentCode: 'C' },
  { id: 'W1', code: 'W1', boundaryType: 'Ward', hierarchyType: 'ADMIN', parentCode: 'S1' },
  { id: 'X', code: 'X', boundaryType: 'SubCounty', hierarchyType: 'OTHER', parentCode: 'C' },
];

describe('boundary placement (Edit: parent)', () => {
  it('reads type, hierarchy, parent and the parent level from the tree', () => {
    expect(placementOf(rows, 'W1')).toEqual({ code: 'W1', boundaryType: 'Ward', hierarchyType: 'ADMIN', parent: 'S1', parentType: 'SubCounty' });
    expect(placementOf(rows, 'C')?.parent).toBeNull();
    expect(placementOf(rows, 'nope')).toBeNull();
  });
  it('offers the boundaries of the parent level in the same hierarchy only', () => {
    expect(parentChoices(rows, placementOf(rows, 'W1')!)).toEqual([{ value: 'S1', label: 'Sub one (S1)' }, { value: 'S2', label: 'S2' }]);
  });
});
