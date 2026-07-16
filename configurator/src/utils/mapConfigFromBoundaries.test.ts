import { describe, it, expect } from 'vitest';
import type { Boundary } from '@/api/types';
import { boundsOfBoundaries, zoomForBounds, deriveMapPosition } from './mapConfigFromBoundaries';

// A minimal Boundary carrying just the geometry the derivation reads.
const poly = (ring: number[][]): Boundary =>
  ({ geometry: { type: 'Polygon', coordinates: [ring] } } as unknown as Boundary);

const rect = (minLon: number, minLat: number, maxLon: number, maxLat: number): Boundary =>
  poly([
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ]);

describe('boundsOfBoundaries', () => {
  it('unions across several boundaries', () => {
    const b = boundsOfBoundaries([rect(35.0, -1.0, 35.4, -0.8), rect(35.2, -1.2, 35.6, -0.6)]);
    expect(b).toEqual({ minLon: 35.0, minLat: -1.2, maxLon: 35.6, maxLat: -0.6 });
  });

  it('walks MultiPolygon nesting', () => {
    const multi = {
      geometry: { type: 'MultiPolygon', coordinates: [[[[35, -1], [35.1, -1], [35.1, -0.9], [35, -1]]]] },
    } as unknown as Boundary;
    expect(boundsOfBoundaries([multi])).toEqual({ minLon: 35, minLat: -1, maxLon: 35.1, maxLat: -0.9 });
  });

  it('ignores out-of-range and non-finite coordinates instead of widening to them', () => {
    // A stray [999, 999] must not blow the bbox out to the antimeridian.
    const b = boundsOfBoundaries([poly([[999, 999], [35.0, -1.0], [35.2, -0.8], [NaN, 5]])]);
    expect(b).toEqual({ minLon: 35.0, minLat: -1.0, maxLon: 35.2, maxLat: -0.8 });
  });

  it('returns undefined when no boundary carries geometry (never 0,0)', () => {
    expect(boundsOfBoundaries([{ code: 'A' } as unknown as Boundary])).toBeUndefined();
  });
});

describe('zoomForBounds', () => {
  it('clamps a country-sized extent to the min derived zoom', () => {
    expect(zoomForBounds({ minLon: -20, minLat: -35, maxLon: 55, maxLat: 38 })).toBe(4);
  });

  it('clamps a tiny extent to the max derived zoom', () => {
    expect(zoomForBounds({ minLon: 35.0, minLat: -1.0, maxLon: 35.001, maxLat: -0.999 })).toBe(16);
  });

  it('a county-sized extent lands at a city zoom, not street or globe', () => {
    const z = zoomForBounds({ minLon: 35.0, minLat: -1.05, maxLon: 35.6, maxLat: -0.55 });
    expect(z).toBeGreaterThanOrEqual(9);
    expect(z).toBeLessThanOrEqual(12);
  });
});

describe('deriveMapPosition', () => {
  it('reproduces the operator-set centre for Bomet from its boundary extent', () => {
    // The hand-set map_center host_var on the live box is { -0.78, 35.34 }.
    // Deriving from Bomet's extent must land in the same place, or the whole
    // premise (derive instead of asking) is unsound.
    const d = deriveMapPosition([rect(35.0, -1.05, 35.6, -0.55)])!;
    expect(d.center.lng).toBeCloseTo(35.3, 1);
    expect(d.center.lat).toBeCloseTo(-0.8, 1);
  });

  it('pads the search viewbox outside the boundary extent', () => {
    const d = deriveMapPosition([rect(36.66, -1.44, 37.1, -1.16)])!;
    // Padded box strictly contains the raw extent on every edge.
    expect(d.searchViewbox!.minLon).toBeLessThan(36.66);
    expect(d.searchViewbox!.maxLon).toBeGreaterThan(37.1);
    expect(d.searchViewbox!.minLat).toBeLessThan(-1.44);
    expect(d.searchViewbox!.maxLat).toBeGreaterThan(-1.16);
  });

  it('omits the viewbox for a zero-area extent (a bounded search there matches nothing)', () => {
    const d = deriveMapPosition([poly([[35, -1]])])!;
    expect(d).toBeDefined();
    expect(d.searchViewbox).toBeUndefined();
  });

  it('returns undefined when there is no usable geometry', () => {
    expect(deriveMapPosition([{ code: 'A' } as unknown as Boundary])).toBeUndefined();
  });
});
