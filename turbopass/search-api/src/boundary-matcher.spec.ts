import {
  BoundaryIndex,
  type BoundaryRow,
  formatBoundaryLabel,
  isMatchMode,
  maxEditsFor,
  normalizeName,
  osaDistance,
} from './boundary-matcher';

// A small tree shaped like the real IN data: India exists twice (the land and
// maritime areas of one division), "Delhi" is a region AND two unrelated
// neighbourhoods, and several other places merely contain "Delhi".
const row = (
  id: string,
  name: string,
  subtype: string,
  admin_level: number,
  parent_id: string | null,
  extra: Partial<BoundaryRow> = {},
): BoundaryRow => ({
  id,
  name,
  subtype,
  admin_level,
  parent_id,
  division_id: id,
  class: 'land',
  country: 'IN',
  ...extra,
});

const FIXTURE: BoundaryRow[] = [
  row('in-land', 'India', 'country', 0, null, { division_id: 'div-in' }),
  row('in-sea', 'India', 'country', 0, null, {
    division_id: 'div-in',
    class: 'maritime',
  }),
  row('dl', 'Delhi', 'region', 1, 'in-sea'),
  row('mp', 'Madhya Pradesh', 'region', 1, 'in-sea'),
  row('swd', 'South West Delhi', 'county', 2, 'dl'),
  row('rewa', 'Rewa', 'county', 2, 'mp'),
  row('flats', 'Delhi Govt Flats', 'locality', 3, 'swd'),
  row('newdl', 'New Delhi', 'locality', 3, 'swd'),
  row('nb-dl-1', 'Delhi', 'neighborhood', 5, 'rewa'),
  row('nb-dl-2', 'Delhi', 'neighborhood', 5, 'rewa'),
  row('blk', 'Block_A', 'neighborhood', 5, 'flats'),
  row('mz', 'Moçambique', 'country', 0, null, { country: 'MZ' }),
  row('amb', 'Ambrósio', 'neighborhood', 5, 'mz', { country: 'MZ' }),
];

const index = new BoundaryIndex(FIXTURE);
const ids = (
  q: string,
  mode: Parameters<BoundaryIndex['search']>[1],
  limit = 10,
) => index.search(q, mode, limit).map((h) => h.id);

describe('normalizeName / osaDistance / maxEditsFor', () => {
  it('folds case, diacritics and whitespace', () => {
    expect(normalizeName('  Moçambique ')).toBe('mocambique');
    expect(normalizeName('AMBRÓSIO')).toBe('ambrosio');
    expect(normalizeName('South   West\tDelhi')).toBe('south west delhi');
  });

  it('counts an adjacent transposition as one edit and stops past the bound', () => {
    expect(osaDistance('dehli', 'delhi', 1)).toBe(1);
    expect(osaDistance('mapto', 'maputo', 1)).toBe(1);
    expect(osaDistance('nairobbi', 'nairobi', 2)).toBe(1);
    expect(osaDistance('delhi', 'mumbai', 2)).toBe(3);
  });

  it('scales the edit budget with query length', () => {
    expect([3, 4, 6, 7].map(maxEditsFor)).toEqual([0, 1, 1, 2]);
  });

  it('knows the match modes', () => {
    expect(['exact', 'prefix', 'substring', 'fuzzy'].every(isMatchMode)).toBe(
      true,
    );
    expect(isMatchMode('bogus')).toBe(false);
  });
});

describe('BoundaryIndex.search ranking', () => {
  it('ranks exact → prefix → substring, then broadest level, then shorter name', () => {
    const hits = index.search('Delhi', 'substring', 10);
    expect(hits.map((h) => [h.id, h.match_type])).toEqual([
      ['dl', 'exact'],
      ['nb-dl-1', 'exact'],
      ['nb-dl-2', 'exact'],
      ['flats', 'prefix'],
      ['swd', 'substring'],
      ['newdl', 'substring'],
    ]);
  });

  it('narrows the candidate set per mode', () => {
    expect(ids('Delhi', 'exact')).toEqual(['dl', 'nb-dl-1', 'nb-dl-2']);
    expect(ids('Delhi', 'prefix')).toEqual([
      'dl',
      'nb-dl-1',
      'nb-dl-2',
      'flats',
    ]);
  });

  it('honours limit', () => {
    expect(ids('Delhi', 'substring', 2)).toEqual(['dl', 'nb-dl-1']);
  });
});

describe('BoundaryIndex.search fuzzy', () => {
  it('finds a typo only in fuzzy mode, broadest place first', () => {
    expect(ids('Dehli', 'substring')).toEqual([]);
    const hits = index.search('Dehli', 'fuzzy', 10);
    expect(hits[0]).toMatchObject({
      id: 'dl',
      match_type: 'fuzzy',
      distance: 1,
      score: 0.5,
    });
    expect(hits.map((h) => h.id)).toContain('newdl'); // one word of a multi-word name
  });

  it('does not invent matches', () => {
    expect(ids('Mumbai', 'fuzzy')).toEqual([]);
    expect(ids('Dli', 'fuzzy')).toEqual([]); // under 4 chars: no edits allowed
  });
});

describe('BoundaryIndex.search input handling', () => {
  it('is diacritic- and case-insensitive', () => {
    expect(index.search('mocambique', 'exact', 10).map((h) => h.name)).toEqual([
      'Moçambique',
    ]);
    expect(index.search('AMBROSIO', 'exact', 10)[0]).toMatchObject({
      name: 'Ambrósio',
      match_type: 'exact',
    });
  });

  it('treats % and _ as literal characters', () => {
    expect(ids('%', 'substring')).toEqual([]);
    expect(ids('_', 'substring')).toEqual(['blk']);
  });
});

describe('BoundaryIndex disambiguation', () => {
  it('lists a land+maritime division once, keeping the area the hierarchy hangs off', () => {
    const hits = index.search('India', 'substring', 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: 'in-sea', descendant_count: 9 });
  });

  it('labels same-name places with subtype and ancestry', () => {
    const [region, hood] = index.search('Delhi', 'exact', 10);
    expect(region).toMatchObject({
      formatted: 'Delhi — region, India',
      parent_name: 'India',
      region_name: null,
      country_name: 'India',
    });
    expect(hood).toMatchObject({
      formatted: 'Delhi — neighborhood, Rewa, Madhya Pradesh, India',
      parent_name: 'Rewa',
      region_name: 'Madhya Pradesh',
    });
    expect(index.search('Delhi Govt Flats', 'exact', 1)[0].formatted).toBe(
      'Delhi Govt Flats — locality, South West Delhi, Delhi, India',
    );
    expect(index.search('India', 'exact', 1)[0].formatted).toBe(
      'India — country',
    );
  });

  it('drops blank and repeated context in labels', () => {
    expect(formatBoundaryLabel('X', 'county', ['A', null, 'A', '', 'B'])).toBe(
      'X — county, A, B',
    );
    expect(formatBoundaryLabel('X', null, [])).toBe('X');
  });
});
