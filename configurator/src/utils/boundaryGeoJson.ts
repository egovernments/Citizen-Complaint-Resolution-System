// Client-side counterpart to digit-mcp's xlsx-loader polygon sidecar logic.
// Operator picks a `02-Boundaries-Polygons.geojson` in Phase 2 alongside
// the boundary XLSX; we parse the FeatureCollection, key each feature by
// `properties.code` (preferred) or normalized `properties.name`, and
// attach the matching geometry to each boundary row before it's POSTed to
// boundary-service. boundary-service only accepts Point + Polygon, so
// MultiPolygons are collapsed to their largest ring.
import type { BoundaryGeometry } from '@/api/types';

/** Lowercase, strip diacritics, strip "Distrito Municipal de " prefix,
 *  replace any non-alphanumeric with `_`. Brings OSM display names
 *  (`KaMavota`, `Distrito Municipal de KaMpfumu`) and XLSX codes
 *  (`kamavota`, `kampfumu`) to the same shape so they can be matched. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^distrito municipal de\s+/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** boundary-service /boundary/_create rejects MultiPolygon. Collapse to
 *  the ring set with the most coordinates (the main contiguous piece). */
export function coerceForBoundaryService(geom: { type?: string; coordinates?: unknown }): BoundaryGeometry | undefined {
  if (!geom || !geom.type) return undefined;
  if (geom.type === 'Point' || geom.type === 'Polygon') {
    return geom as BoundaryGeometry;
  }
  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    const polys = geom.coordinates as unknown[][][];
    if (polys.length === 0) return undefined;
    let largestIdx = 0;
    let largestPoints = 0;
    for (let i = 0; i < polys.length; i++) {
      const outer = polys[i]?.[0];
      const pts = Array.isArray(outer) ? outer.length : 0;
      if (pts > largestPoints) { largestPoints = pts; largestIdx = i; }
    }
    return { type: 'Polygon', coordinates: polys[largestIdx] as number[][][] };
  }
  return undefined; // LineString, MultiPoint, etc. — unsupported here
}

export interface ParsedGeoJsonSidecar {
  byCode: Map<string, BoundaryGeometry>;
  totalFeatures: number;
  matchedByCode: number;
  matchedByName: number;
  skipped: number;
}

export function parseGeoJsonSidecar(text: string): ParsedGeoJsonSidecar {
  let parsed: { features?: Array<{ properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }> };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Polygon GeoJSON: invalid JSON — ${e instanceof Error ? e.message : String(e)}`);
  }
  const features = parsed.features ?? [];
  const byCode = new Map<string, BoundaryGeometry>();
  let matchedByCode = 0;
  let matchedByName = 0;
  let skipped = 0;
  for (const f of features) {
    const props = f.properties ?? {};
    const geom = coerceForBoundaryService(f.geometry ?? {});
    if (!geom) { skipped++; continue; }
    const explicitCode = typeof props.code === 'string' ? props.code.trim() : '';
    if (explicitCode) {
      byCode.set(explicitCode, geom);
      matchedByCode++;
      continue;
    }
    const name = typeof props.name === 'string' ? props.name.trim() : '';
    if (name) {
      byCode.set(normalizeForMatch(name), geom);
      matchedByName++;
      continue;
    }
    skipped++;
  }
  return { byCode, totalFeatures: features.length, matchedByCode, matchedByName, skipped };
}

/** Return the geometry to use for a boundary row, or undefined to fall
 *  back to the unit-square placeholder. Sidecar > lat/long. */
export function geometryForBoundary(
  row: { code: string; name?: string; latitude?: number; longitude?: number },
  sidecar?: ParsedGeoJsonSidecar,
): BoundaryGeometry | undefined {
  if (sidecar) {
    const fromCode = sidecar.byCode.get(row.code);
    if (fromCode) return fromCode;
    if (row.name) {
      const fromName = sidecar.byCode.get(normalizeForMatch(row.name));
      if (fromName) return fromName;
    }
  }
  if (Number.isFinite(row.longitude) && Number.isFinite(row.latitude)) {
    return { type: 'Point', coordinates: [row.longitude as number, row.latitude as number] };
  }
  return undefined;
}
