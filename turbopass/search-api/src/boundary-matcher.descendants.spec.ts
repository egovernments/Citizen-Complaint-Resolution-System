import { BoundaryIndex, type BoundaryRow } from './boundary-matcher';

const row = (
  id: string,
  name: string,
  subtype: string,
  admin_level: number,
  parent_id: string | null,
): BoundaryRow => ({
  id,
  division_id: `d-${id}`,
  name,
  subtype,
  class: 'land',
  country: 'IN',
  admin_level,
  parent_id,
});

describe('BoundaryIndex descendants', () => {
  const idx = new BoundaryIndex([
    row('in', 'India', 'country', 0, null),
    row('dl', 'Delhi', 'region', 1, 'in'),
    row('nd', 'New Delhi', 'county', 2, 'dl'),
    row('fl', 'Delhi Govt Flats', 'locality', 3, 'nd'),
  ]);

  it('counts every area underneath, at all depths', () => {
    expect(idx.descendantsOf('in')).toBe(3);
    expect(idx.descendantsOf('dl')).toBe(2);
    expect(idx.descendantsOf('fl')).toBe(0);
    expect(idx.descendantsOf('nope')).toBeUndefined();
    expect(idx.nameOf('nd')).toBe('New Delhi');
  });

  it('drops places with fewer areas under them than minDescendants', () => {
    const names = (min: number) =>
      idx.search('delhi', 'substring', 10, min).map((h) => h.name);
    expect(names(0)).toEqual(['Delhi', 'Delhi Govt Flats', 'New Delhi']);
    expect(names(1)).toEqual(['Delhi', 'New Delhi']);
    expect(names(2)).toEqual(['Delhi']);
  });
});
