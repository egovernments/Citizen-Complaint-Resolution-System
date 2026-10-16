// One response shape for every source.
//
// Each source numbers its levels its own way: the official sets ADM1, ADM2, …;
// Overture 0-2 plus synthetic 3-6 for its partial levels; Geoapify passes on
// OpenStreetMap's admin_level (Nairobi: 4, 6, 8, 10). `depth` renumbers the
// levels of one fetch consecutively — 0 is the fetched place, 1 the level
// right under it, and so on — so a client can show "Level 1, 2, 3" whatever
// the source. `admin_level` keeps each source's own number.
//
// Geoapify's responses are translated into the fields the offline sources
// return, so clients read one set of fields.

/* eslint-disable @typescript-eslint/no-explicit-any -- Geoapify responses are untyped JSON */

export const GEOAPIFY_LICENCE =
  'ODbL — © OpenStreetMap contributors, via Geoapify';

interface FeatureLike {
  properties: Record<string, any>;
}

function level(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

/** Adds `depth` to each feature: its level's position among the levels present, shallowest = 0. */
export function withDepths<T extends FeatureLike>(features: T[]): T[] {
  const present = [
    ...new Set(
      features
        .map((f) => level(f.properties?.admin_level))
        .filter((l): l is number => l !== null),
    ),
  ].sort((a, b) => a - b);
  const depthOf = new Map(present.map((l, i) => [l, i]));
  return features.map((f) => {
    const l = level(f.properties?.admin_level);
    return {
      ...f,
      properties: {
        ...f.properties,
        depth: l === null ? null : (depthOf.get(l) ?? null),
      },
    };
  });
}

/** Geoapify keeps the OSM admin_level at the top level or under datasource.raw. */
function geoapifyLevel(p: Record<string, any>): number | null {
  return level(p.admin_level ?? p.datasource?.raw?.admin_level);
}

/** A Geoapify geocoding result as a search hit (no polygon, like the offline sources). */
export function geoapifySearchFeatures(data: any): any[] {
  return (data?.features ?? []).map((f: any) => {
    const p = f?.properties ?? {};
    return {
      type: 'Feature',
      properties: {
        place_id: p.place_id,
        name: p.name ?? p.city ?? p.formatted ?? null,
        formatted: p.formatted ?? p.name ?? null,
        country_code:
          typeof p.country_code === 'string'
            ? p.country_code.toUpperCase()
            : null,
        country_name: p.country ?? null,
        category: 'administrative',
        subtype: p.result_type ?? null,
        result_type: p.result_type ?? null,
        admin_level: geoapifyLevel(p),
        source: 'geoapify',
        licence: GEOAPIFY_LICENCE,
      },
      bbox: f?.bbox,
      geometry: null,
    };
  });
}

/** Geoapify boundary features, in the offline sources' fetch shape, with depths. */
export function geoapifyFetchFeatures(features: any[]): any[] {
  return withDepths(
    features.map((f: any) => {
      const p = f?.properties ?? {};
      return {
        type: 'Feature',
        properties: {
          place_id: p.place_id ?? null,
          name: p.name ?? p.formatted ?? null,
          formatted: p.formatted ?? p.name ?? null,
          admin_level: geoapifyLevel(p),
          subtype: p.result_type ?? null,
          source: 'geoapify',
          licence: GEOAPIFY_LICENCE,
        },
        geometry: f?.geometry ?? null,
      };
    }),
  );
}
