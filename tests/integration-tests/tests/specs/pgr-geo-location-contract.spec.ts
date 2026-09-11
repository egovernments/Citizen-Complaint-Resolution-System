import { test, expect } from '@playwright/test';
// Production PGR helper is intentionally plain JavaScript; exercise the exact
// predicate/serializer used by citizen details, employee details, and both
// create payloads instead of copying its rules into the test suite.
// @ts-expect-error -- the product package does not publish declarations for this JS utility
import { hasUsableGeoLocation, serializeGeoLocation } from '../../../../digit-ui-esbuild/products/pgr/src/utils/geoLocation.js';

test.describe('PGR optional geo-location contract (#1750)', () => {
  test('distinguishes missing/legacy coordinates from valid zero-axis points', {
    annotation: {
      type: 'description',
      description: `Locks the shared coordinate contract used by citizen and employee PGR surfaces. Missing values, malformed/out-of-range values, and the historical (0,0) sentinel are absent; an otherwise-valid point on the equator or prime meridian remains displayable.`,
    },
    tag: ['@area:pgr', '@ccrs:1750', '@kind:regression', '@layer:unit', '@persona:cross'],
  }, () => {
    const absent = [
      null,
      {},
      { latitude: null, longitude: null },
      { latitude: 0, longitude: 0 },
      { latitude: Number.NaN, longitude: 36.8 },
      { latitude: 91, longitude: 36.8 },
      { latitude: -1.2, longitude: 181 },
    ];
    for (const location of absent) {
      expect(hasUsableGeoLocation(location), JSON.stringify(location)).toBe(false);
      expect(serializeGeoLocation(location), JSON.stringify(location)).toEqual({});
    }

    const usable = [
      { latitude: 0, longitude: 36.8 },
      { latitude: -1.2, longitude: 0 },
      { lat: -1.2921, lng: 36.8219 },
    ];
    for (const location of usable) {
      expect(hasUsableGeoLocation(location), JSON.stringify(location)).toBe(true);
    }

    expect(serializeGeoLocation(usable[0])).toEqual({ latitude: 0, longitude: 36.8 });
    expect(serializeGeoLocation(usable[1])).toEqual({ latitude: -1.2, longitude: 0 });
    expect(serializeGeoLocation(usable[2])).toEqual({ latitude: -1.2921, longitude: 36.8219 });
  });
});
