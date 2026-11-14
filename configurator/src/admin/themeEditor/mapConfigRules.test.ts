import { describe, it, expect } from 'vitest';
import { resolveTileUrl, mapConfigProblem, BASE_MAP_THEMES } from './mapConfigRules';

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
});
