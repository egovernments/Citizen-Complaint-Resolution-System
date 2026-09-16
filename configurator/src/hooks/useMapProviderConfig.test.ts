import { describe, expect, it } from 'vitest';
import { mapProviderFrom } from './useMapProviderConfig';

describe('mapProviderFrom', () => {
  it('defaults to OpenStreetMap tiles', () => {
    expect(mapProviderFrom(undefined)).toEqual({ provider: 'leaflet', googleMapsApiKey: '', google: undefined });
  });

  it('turns Google on only with a key', () => {
    expect(mapProviderFrom({ mapProvider: 'google', googleMapsApiKey: ' k ' })).toEqual({
      provider: 'google', googleMapsApiKey: 'k', google: { apiKey: 'k' },
    });
    expect(mapProviderFrom({ mapProvider: 'google' }).provider).toBe('leaflet');
  });

  it('keeps a stored key while the provider is leaflet, without using it', () => {
    expect(mapProviderFrom({ mapProvider: 'leaflet', googleMapsApiKey: 'k' })).toEqual({
      provider: 'leaflet', googleMapsApiKey: 'k', google: undefined,
    });
  });
});
