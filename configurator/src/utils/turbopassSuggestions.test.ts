import { describe, expect, it } from 'vitest';
import {
  formatSuggestionLabel,
  matchesNameFamily,
  normalizePlaceName,
  pickPromptMessage,
  pickSuggestion,
  deadEndMessage,
  turbopassErrorMessage,
  turbopassSearchUrl,
} from './turbopassSuggestions';

const feat = (name: string, extra: Record<string, unknown> = {}) => ({
  type: 'Feature',
  properties: { place_id: `${name}-${JSON.stringify(extra)}`, name, ...extra },
});

describe('matchesNameFamily', () => {
  it('matches the whole name, not a substring', () => {
    expect(matchesNameFamily({ name: 'Delhi' }, 'delhi')).toBe(true);
    expect(matchesNameFamily({ name: 'Delhi Govt Flats' }, 'Delhi')).toBe(false);
  });

  it('matches any name variant, diacritic-insensitively', () => {
    expect(matchesNameFamily({ name: 'Maputo', 'name:en': 'Maputo Province' }, 'maputo province')).toBe(true);
    expect(matchesNameFamily({ name: 'Moçambique' }, ' MOCAMBIQUE ')).toBe(true);
    expect(normalizePlaceName('Ambrósio')).toBe('ambrosio');
  });

  it('is false for empty input', () => {
    expect(matchesNameFamily(undefined, 'Delhi')).toBe(false);
    expect(matchesNameFamily({ name: 'Delhi' }, '  ')).toBe(false);
  });
});

describe('pickSuggestion', () => {
  it('does not auto-pick a partial match that came first (the "Delhi Govt Flats" bug)', () => {
    const r = pickSuggestion([feat('Delhi Govt Flats'), feat('New Delhi')], 'Delhi');
    expect(r.pick).toBeNull();
    expect(r.reason).toBe('no-exact');
  });

  it('asks the operator when several places carry the exact name', () => {
    const region = feat('Delhi', { subtype: 'region' });
    const hood = feat('Delhi', { subtype: 'neighborhood' });
    const r = pickSuggestion([feat('Delhi Govt Flats'), region, hood], 'Delhi');
    expect(r).toMatchObject({ pick: null, reason: 'ambiguous', exactCount: 2 });
    expect(r.candidates.slice(0, 2)).toEqual([region, hood]);
    expect(r.candidates).toHaveLength(3);
  });

  it('auto-picks the single exact match even when it is not first', () => {
    const maputo = feat('Maputo');
    const r = pickSuggestion([feat('Cidade de Maputo'), maputo], 'Maputo');
    expect(r).toMatchObject({ pick: maputo, reason: 'single-exact', exactCount: 1 });
  });

  it('reports no results', () => {
    expect(pickSuggestion([], 'Atlantis')).toMatchObject({ pick: null, reason: 'no-results' });
    expect(pickSuggestion(undefined, 'Atlantis').reason).toBe('no-results');
  });
});

describe('pickPromptMessage', () => {
  it('prompts only when a choice is needed', () => {
    expect(pickPromptMessage(pickSuggestion([feat('Maputo')], 'Maputo'), 'Maputo')).toBeNull();
    expect(pickPromptMessage(pickSuggestion([feat('Delhi'), feat('Delhi', { x: 1 })], 'Delhi'), 'Delhi')).toBe(
      '2 places are named "Delhi". Pick the one you mean from the suggestions.',
    );
    expect(pickPromptMessage(pickSuggestion([feat('New Delhi')], 'Delhi'), 'Delhi')).toMatch(/No place is named exactly "Delhi"/);
    expect(pickPromptMessage(pickSuggestion([], 'Atlantis'), ' Atlantis ')).toMatch(/"Atlantis"/);
  });
});

describe('formatSuggestionLabel', () => {
  it('shows the disambiguated label with subtype and level', () => {
    expect(
      formatSuggestionLabel(feat('Delhi', { formatted: 'Delhi — region, India', subtype: 'region', admin_level: 1 })),
    ).toEqual({ text: 'Delhi — region, India', type: '[region · L1]' });
  });

  it('falls back to the level for an older search-api, then to geoapify result_type', () => {
    expect(formatSuggestionLabel(feat('Delhi', { formatted: 'Delhi, IN', admin_level: 5 }))).toEqual({
      text: 'Delhi, IN',
      type: '[L5]',
    });
    expect(formatSuggestionLabel(feat('Nairobi', { formatted: 'Nairobi, Kenya', result_type: 'city' }))).toEqual({
      text: 'Nairobi, Kenya',
      type: '[city]',
    });
    expect(formatSuggestionLabel({})).toEqual({ text: '', type: '[location]' });
  });
});

describe('formatSuggestionLabel sub-area count', () => {
  it('shows how many areas lie inside, singular and plural, and flags a dead end', () => {
    const label = (n: number) => formatSuggestionLabel(feat('X', { subtype: 'region', admin_level: 1, descendant_count: n })).type;
    expect(label(1184)).toBe('[region · L1 · 1,184 sub-areas]');
    expect(label(1)).toBe('[region · L1 · 1 sub-area]');
    expect(label(0)).toBe('[region · L1 · no sub-areas]');
  });
});

describe('turbopassSearchUrl', () => {
  it('asks overture for onboardable places only when told to', () => {
    expect(turbopassSearchUrl('/turbopass', 'Delhi', 'overture', 'substring', true)).toBe(
      '/turbopass/boundary/search?q=Delhi&source=overture&match=substring&min_descendants=1',
    );
    expect(turbopassSearchUrl('/turbopass', 'Delhi', 'overture', 'substring', false)).not.toContain('min_descendants');
    expect(turbopassSearchUrl('/turbopass', 'Delhi', 'geoapify', 'substring', true)).not.toContain('min_descendants');
  });

  it('encodes the term', () => {
    expect(turbopassSearchUrl('', 'São Tomé & X', 'overture', 'exact', false)).toContain('q=S%C3%A3o+Tom%C3%A9+%26+X');
  });
});

describe('deadEndMessage', () => {
  it('names the place, its type, and the parent to search for instead', () => {
    expect(deadEndMessage(feat('Delhi Govt Flats', { subtype: 'locality', parent_name: 'New Delhi' }))).toBe(
      '"Delhi Govt Flats" (locality) has no smaller areas inside it, so it can\'t form a hierarchy. It lies in New Delhi — search for that instead.',
    );
  });

  it('still helps when the source gives no parent (geoapify)', () => {
    expect(deadEndMessage(feat('Somewhere'))).toMatch(/"Somewhere" has no smaller areas.*Search for a larger area/);
  });
});

describe('turbopassErrorMessage', () => {
  it('says a failed search is a server problem, not the operator\'s search', () => {
    const m = turbopassErrorMessage({ kind: 'search', source: 'geoapify', status: 500, serverMessage: 'GEOAPIFY_API_KEY config is missing' });
    expect(m).toContain('Geoapify returned an error (HTTP 500: GEOAPIFY_API_KEY config is missing)');
    expect(m).toContain('not your search');
    expect(m).not.toMatch(/select a valid location/i);
  });

  it('names the real source on a failed fetch (not always Geoapify)', () => {
    const m = turbopassErrorMessage({ kind: 'fetch', source: 'overture', status: 503, place: 'Delhi' });
    expect(m).toBe('Couldn\'t fetch the boundaries of "Delhi" from the offline boundary service (HTTP 503). Try again, or pick a different place.');
  });

  it('passes the server\'s size-cap message through as-is', () => {
    const cap = '"India" has 62095 areas under it — more than this server returns in one fetch (5000). Pick a smaller area inside it.';
    expect(turbopassErrorMessage({ kind: 'fetch', source: 'overture', status: 413, serverMessage: cap })).toBe(cap);
  });

  it('covers an unreachable service', () => {
    expect(turbopassErrorMessage({ kind: 'network', source: 'overture' })).toMatch(/Couldn't reach the offline boundary service/);
  });
});
