import { LEVEL_NAMES, levelNameFor } from './level-names';

describe('levelNameFor', () => {
  it('names an official level by country and ADM number', () => {
    expect(
      levelNameFor({ country: 'KE', source: 'geoboundaries', admin_level: 3 }),
    ).toBe('Ward');
    expect(levelNameFor({ country: 'RW', source: 'cod', admin_level: 5 })).toBe(
      'Village',
    );
  });

  it("follows each source's own structure — Burundi's sets differ", () => {
    expect(levelNameFor({ country: 'BI', source: 'cod', admin_level: 3 })).toBe(
      'Zone',
    );
    expect(
      levelNameFor({ country: 'BI', source: 'geoboundaries', admin_level: 3 }),
    ).toBe('Colline');
  });

  it('gives no name where one could be wrong or is unknown', () => {
    expect(
      levelNameFor({ country: 'KE', source: 'overture', admin_level: 1 }),
    ).toBeNull();
    expect(
      levelNameFor({ country: 'KE', source: 'cod', admin_level: 0 }),
    ).toBeNull(); // the country
    expect(
      levelNameFor({ country: 'KE', source: 'cod', admin_level: 4 }),
    ).toBeNull();
    expect(
      levelNameFor({ country: 'FR', source: 'cod', admin_level: 1 }),
    ).toBeNull();
  });

  it('covers the 12 priority countries of #1994', () => {
    expect(Object.keys(LEVEL_NAMES).sort()).toEqual([
      'BI',
      'BJ',
      'BR',
      'DJ',
      'ET',
      'GW',
      'IN',
      'KE',
      'LR',
      'MZ',
      'RW',
      'ZA',
    ]);
  });
});
