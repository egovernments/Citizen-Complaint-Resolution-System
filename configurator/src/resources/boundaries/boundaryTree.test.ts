import { describe, it, expect } from 'vitest';
import { boundaryTree } from './boundaryTree';

// cfgreview F19 (#1565): boundaries as a named tree, not a flat list of codes.
describe('boundaryTree', () => {
  const rows = [
    { code: 'W2', parentCode: 'SC1', boundaryType: 'Ward' },
    { code: 'KE', boundaryType: 'Country' },
    { code: 'SC1', parentCode: 'C1', boundaryType: 'SubCounty' },
    { code: 'C1', parentCode: 'KE', boundaryType: 'County' },
    { code: 'W1', parentCode: 'SC1', boundaryType: 'Ward' },
    { code: 'ORPHAN', parentCode: 'GONE' },
  ];
  const names: Record<string, string> = { KE: 'Kenya', C1: 'Bomet', SC1: 'Chepalungu', W1: 'Siongiroi', W2: 'Kongasis' };
  it('orders depth first, children by name, with the depth', () => {
    expect(boundaryTree(rows, (c) => names[c]).map((r) => `${r.depth}:${r.name}`)).toEqual([
      '0:Kenya', '1:Bomet', '2:Chepalungu', '3:Kongasis', '3:Siongiroi', '0:ORPHAN',
    ]);
  });
  it('falls back to the code when a boundary has no label', () => {
    expect(boundaryTree([{ code: 'X' }], () => undefined)[0].name).toBe('X');
  });
});
