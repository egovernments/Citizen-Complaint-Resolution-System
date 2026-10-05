import { afterEach, describe, expect, it, vi } from 'vitest';
import sets from './__fixtures__/officialSets.json';
import {
  confidenceHeadline,
  fetchOfficialSet,
  formatDatasetDate,
  levelStatus,
  sourceLine,
  statusDetail,
  type OfficialSet,
} from './officialBoundaries';

// GET /boundary/official for the 12 priority countries, from a boundary DB whose
// agreement figures official.py computed (trimmed licences aside, verbatim).
const SETS = sets as unknown as Record<string, OfficialSet>;

describe('levelStatus', () => {
  it('reads the agreement figures with the documented thresholds', () => {
    expect(levelStatus({ other_areas: 47, matched: 100 })).toBe('confirmed');
    expect(levelStatus({ other_areas: 30, matched: 90 })).toBe('confirmed');
    expect(levelStatus({ other_areas: 158, matched: 89.9 })).toBe('partly');
    expect(levelStatus({ other_areas: 39, matched: 50 })).toBe('partly');
    expect(levelStatus({ other_areas: 74, matched: 43 })).toBe('differs');
    expect(levelStatus({ other_areas: 0, matched: null })).toBe('single');
    expect(levelStatus({ other_areas: null, matched: null })).toBe('unmeasured');
  });
});

describe('confidenceHeadline for the 12 priority countries', () => {
  it.each([
    ['ZA', 'Confirmed by two sources at all 4 levels, down to wards.'],
    ['LR', 'Confirmed by two sources at both levels, down to districts.'],
    ['BR', 'Confirmed by two sources at both levels, down to municipalities.'],
    ['KE', 'Confirmed down to sub-counties. Wards come from one source only.'],
    ['RW', 'Confirmed down to sectors. Cells and villages come from one source only.'],
    [
      'MZ',
      'Provinces confirmed. Districts and administrative posts partly match an older source (2017–2021). ' +
        'Localities come from one source only.',
    ],
    [
      'BJ',
      'Communes confirmed. Departments partly match an older source (Aug 2019). ' +
        'Littoral, Oueme and Mono are drawn differently. Arrondissements come from one source only.',
    ],
    ['GW', 'Partly matches an older source (2017). Bolama/Bijagos, Bissau and Quinara are drawn differently.'],
    ['ET', 'Differs from an older source (2016): 15 regions here, 11 there. This set is the newer one.'],
    [
      'BI',
      'Differs from an older source (2006–2015): 5 provinces here, 18 there. This set is the newer one. ' +
        'Collines come from one source only.',
    ],
    ['DJ', 'One source only: 6 regions, with no second source to check against.'],
    ['IN', 'One source only, down to sub-districts, with no second source to check against.'],
  ])('%s', (country, headline) => {
    expect(confidenceHeadline(SETS[country])).toBe(headline);
  });

  it('says nothing on a DB built before the agreement check', () => {
    expect(confidenceHeadline({ ...SETS.KE, agreement_measured: false })).toBeNull();
  });

  it('does not call a newer other source "older"', () => {
    // Liberia's geoBoundaries (2021) is newer than its chosen COD (2019).
    const lr = SETS.LR;
    const partly = { ...lr, levels: lr.levels.map((l) => ({ ...l, matched: 70 })) };
    expect(confidenceHeadline(partly)).toBe('Partly matches a second source.');
  });
});

describe('dates and source lines', () => {
  it('formats COD dates as month + year and geoBoundaries year lists as a span', () => {
    expect(formatDatasetDate('2019-10-31')).toBe('Oct 2019');
    expect(formatDatasetDate('2011/2014/2018/2019/2021')).toBe('2011–2021');
    expect(formatDatasetDate('2020')).toBe('2020');
    expect(formatDatasetDate('')).toBeNull();
    expect(sourceLine(SETS.ZA)).toBe('OCHA COD-AB · Nov 2020');
    expect(sourceLine(SETS.KE)).toBe('geoBoundaries · 2020');
  });

  it('explains a level in one line', () => {
    const [province, , , colline] = SETS.BI.levels;
    expect(statusDetail(province, SETS.BI)).toBe('0% of 5 areas closely match geoBoundaries (18 areas there).');
    expect(statusDetail(colline, SETS.BI)).toBe("geoBoundaries has no areas at this level, so it couldn't be checked.");
    expect(statusDetail(SETS.RW.levels[1], SETS.RW)).toBe(
      '93.3% of 30 areas closely match OCHA COD-AB (30 areas there). Drawn differently: Karongi and Rutsiro.',
    );
  });
});

describe('fetchOfficialSet', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (impl: () => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(impl));

  it('returns the set, null for a country without one, and "unavailable" otherwise', async () => {
    stub(async () => new Response(JSON.stringify(SETS.KE), { status: 200 }));
    expect((await fetchOfficialSet('/turbopass', 'KE')) as OfficialSet).toMatchObject({ country: 'KE' });
    stub(async () => new Response('{"message":"none"}', { status: 404 }));
    expect(await fetchOfficialSet('/turbopass', 'TZ')).toBeNull();
    stub(async () => new Response('', { status: 503 }));
    expect(await fetchOfficialSet('/turbopass', 'KE')).toBe('unavailable');
    // Not deployed: the SPA answers /turbopass/ with its own HTML.
    stub(async () => new Response('<!doctype html>', { status: 200 }));
    expect(await fetchOfficialSet('/turbopass', 'KE')).toBe('unavailable');
    stub(async () => Promise.reject(new TypeError('network')));
    expect(await fetchOfficialSet('/turbopass', 'KE')).toBe('unavailable');
  });
});
