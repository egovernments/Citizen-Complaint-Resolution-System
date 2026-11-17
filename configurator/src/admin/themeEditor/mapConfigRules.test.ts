import { describe, it, expect } from 'vitest';
import { resolveTileUrl, resolveTileAttribution, mapConfigProblem, BASE_MAP_THEMES } from './mapConfigRules';

const OSM = BASE_MAP_THEMES.osm.tileUrl;

describe('resolveTileUrl (#2804)', () => {
  it('defaults to OpenStreetMap', () => {
    expect(resolveTileUrl(undefined, undefined)).toEqual({ url: OSM, keylessCarto: false });
    expect(resolveTileUrl('', '')).toEqual({ url: OSM, keylessCarto: false });
  });

  it('shows OpenStreetMap for a CARTO theme with no key, and says so', () => {
    for (const theme of ['voyager', 'light', 'dark']) {
      expect(resolveTileUrl(theme, undefined)).toEqual({ url: OSM, keylessCarto: true });
    }
    expect(resolveTileUrl('osm', 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png')).toEqual({ url: OSM, keylessCarto: true });
  });

  it('keeps a keyed CARTO URL and any other custom URL', () => {
    const keyed = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=abc';
    expect(resolveTileUrl('light', keyed)).toEqual({ url: keyed, keylessCarto: false });
    expect(resolveTileUrl('voyager', ' https://tiles.example.org/{z}/{x}/{y}.png ')).toEqual({
      url: 'https://tiles.example.org/{z}/{x}/{y}.png', keylessCarto: false,
    });
  });
});

describe('resolveTileAttribution (#2804)', () => {
  it('credits OpenStreetMap by default and when a keyless CARTO choice falls back to it', () => {
    expect(resolveTileAttribution(undefined, undefined, undefined)).toMatch(/OpenStreetMap<\/a> contributors/);
    expect(resolveTileAttribution('voyager', undefined, 'Ignored')).toMatch(/OpenStreetMap<\/a> contributors/);
    expect(resolveTileAttribution('osm', 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', 'Ignored')).toMatch(/OpenStreetMap<\/a> contributors/);
  });

  it('uses the custom credit line with a custom URL, else the credit of whoever serves it', () => {
    expect(resolveTileAttribution('osm', 'https://tiles.example.org/{z}/{x}/{y}.png', ' Example tiles ')).toBe('Example tiles');
    expect(resolveTileAttribution('osm', 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=k', '')).toMatch(/CARTO/);
    expect(resolveTileAttribution('dark', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', undefined)).toMatch(/OpenStreetMap<\/a> contributors/);
  });

  it('gives a custom URL without a credit line its own host, not the theme\'s', () => {
    expect(resolveTileAttribution('voyager', 'https://tiles.example.org/{z}/{x}/{y}.png', undefined)).toBe('&copy; tiles.example.org');
    expect(resolveTileAttribution('osm', 'https://u:p@{s}.maps.example.org:8443/{z}/{x}/{y}.png', '')).toBe('&copy; maps.example.org');
    expect(resolveTileAttribution('osm', '/tiles/{z}/{x}/{y}.png', '')).toBe('');
  });
});

describe('mapConfigProblem (#2804)', () => {
  it('accepts no starting point, or a complete one', () => {
    expect(mapConfigProblem({ code: 'DEFAULT' })).toBeNull();
    expect(mapConfigProblem({ center: { lat: -1.29, lng: 36.82 }, defaultZoom: 12 })).toBeNull();
  });

  it('refuses half a starting point', () => {
    expect(mapConfigProblem({ center: { lat: -1.29 } })).toMatch(/fill in both, or clear both/);
    expect(mapConfigProblem({ center: { lng: 36.82 } })).toMatch(/fill in both, or clear both/);
  });

  it('refuses coordinates out of range', () => {
    expect(mapConfigProblem({ center: { lat: 91, lng: 0 } })).toMatch(/latitude must be a number between -90 and 90/);
    expect(mapConfigProblem({ center: { lat: 0, lng: -181 } })).toMatch(/longitude must be a number between -180 and 180/);
    expect(mapConfigProblem({ center: { lat: Number.NaN, lng: 0 } })).toMatch(/latitude/);
  });

  it('refuses a zoom the schema would reject', () => {
    expect(mapConfigProblem({ defaultZoom: 12.5 })).toMatch(/whole number from 0 to 22/);
    expect(mapConfigProblem({ defaultZoom: 23 })).toMatch(/whole number from 0 to 22/);
  });

  it('refuses a minimum or maximum zoom the schema would reject', () => {
    expect(mapConfigProblem({ minZoom: 3.5 })).toBe('Minimum zoom must be a whole number from 0 to 22.');
    expect(mapConfigProblem({ minZoom: -1 })).toBe('Minimum zoom must be a whole number from 0 to 22.');
    expect(mapConfigProblem({ maxZoom: 23 })).toBe('Maximum zoom must be a whole number from 0 to 22.');
    expect(mapConfigProblem({ maxZoom: 18.2 })).toBe('Maximum zoom must be a whole number from 0 to 22.');
    expect(mapConfigProblem({ minZoom: 0, maxZoom: 22 })).toBeNull();
  });

  it('refuses a minimum zoom above the maximum', () => {
    expect(mapConfigProblem({ minZoom: 15, maxZoom: 10 })).toMatch(/Minimum zoom can't be more than Maximum zoom/);
    expect(mapConfigProblem({ minZoom: 10, maxZoom: 10 })).toBeNull();
  });

  const BOX = { minLon: 36.6, minLat: -1.45, maxLon: 37.1, maxLat: -1.15 };

  it('accepts no search box, or all four edges', () => {
    expect(mapConfigProblem({ searchViewbox: BOX })).toBeNull();
    expect(mapConfigProblem({ searchViewbox: {} })).toBeNull();
  });

  it('refuses a search box with only some of its edges', () => {
    expect(mapConfigProblem({ searchViewbox: { minLon: 36.6 } })).toMatch(/needs all four edges/);
    expect(mapConfigProblem({ searchViewbox: { minLon: BOX.minLon, minLat: BOX.minLat, maxLon: BOX.maxLon } })).toMatch(/needs all four edges/);
  });

  it('refuses a search box edge out of range, or a box turned inside out', () => {
    expect(mapConfigProblem({ searchViewbox: { ...BOX, minLon: -181 } })).toBe('Search box — west must be a number between -180 and 180.');
    expect(mapConfigProblem({ searchViewbox: { ...BOX, maxLat: 91 } })).toBe('Search box — north must be a number between -90 and 90.');
    expect(mapConfigProblem({ searchViewbox: { ...BOX, minLon: 37.2 } })).toMatch(/west edge must be left of its east edge/);
    expect(mapConfigProblem({ searchViewbox: { ...BOX, minLat: -1.15 } })).toMatch(/south edge below its north edge/);
  });
});
