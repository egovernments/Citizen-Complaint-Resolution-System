// Helpers for Phase 2's one-click OSM path: turn the admin-level groups
// extracted from an Overpass dump (via osmtogeojson) into the Boundary[]
// payload boundary-service expects. Pure functions — the Overpass fetch and
// all UI state stay in Phase2Page.
//
// Two deliberate exclusion rules (surfaced to the operator as a "skipped"
// report instead of silently mangling the tree):
//   - features with no usable name are dropped: codes are derived from
//     names, and falling back to opaque OSM ids produces codes nobody can
//     read in MDMS/localization later.
//   - features whose centroid lands in NO immediate-parent polygon are
//     dropped: attaching them to an arbitrary parent (the old fallback was
//     parentLvl.features[0]) silently corrupts the hierarchy.
import { coerceForBoundaryService } from './boundaryGeoJson';
import type { Boundary } from '@/api/types';

export interface OsmAdminLevel {
  /** OSM admin_level (numeric; higher = more specific) */
  level: number;
  /** GeoJSON features from osmtogeojson for this admin_level */
  features: any[];
  examples: string[];
  /** Operator-provided hierarchy level name, e.g. "District" */
  mappedName: string;
}

export interface SkippedOsmFeature {
  /** Feature name, or the OSM id purely for display when unnamed */
  name: string;
  /** Operator's level name (mappedName) */
  levelName: string;
  osmLevel: number;
  reason: 'unnamed' | 'no parent found';
}

/** Derive a boundary code from a display name: Unicode NFD, strip
 *  diacritics, uppercase, collapse non-[A-Z0-9] runs to a single
 *  underscore, trim. Returns '' when nothing survives (treat as unnamed). */
export function codeFromOsmName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Centroid of the outer ring (first polygon for MultiPolygon). Rough, but
 *  only used to pick the containing parent polygon. */
export function getCentroid(feature: any): number[] {
  let x = 0, y = 0, pts = 0;
  const coords = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] :
                 feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates[0][0] : [];

  for (const pt of coords) {
    x += pt[0];
    y += pt[1];
    pts++;
  }
  return [x / pts, y / pts];
}

function pointInPolygon(point: number[], vs: number[][]): boolean {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) != (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function featureContainsPoint(feature: any, point: number[]): boolean {
  if (!feature.geometry) return false;
  if (feature.geometry.type === 'Polygon') {
    return pointInPolygon(point, feature.geometry.coordinates[0]);
  } else if (feature.geometry.type === 'MultiPolygon') {
    for (const poly of feature.geometry.coordinates) {
      if (pointInPolygon(point, poly[0])) return true;
    }
  }
  return false;
}

/**
 * Build the Boundary[] payload from operator-mapped admin levels.
 *
 * @param sortedLevels levels with non-empty mappedName, ascending by OSM
 *                     admin_level (root first)
 * Parenting searches ONLY the immediate parent level (strict tree), and
 * only its INCLUDED features — a child whose spatial parent was itself
 * skipped won't exist in DIGIT, so the child is skipped too.
 */
export function buildOsmBoundaries(
  sortedLevels: OsmAdminLevel[],
  tenantId: string,
  hierarchyType: string,
): { boundaries: Boundary[]; skipped: SkippedOsmFeature[] } {
  const boundaries: Boundary[] = [];
  const skipped: SkippedOsmFeature[] = [];
  const usedCodes = new Set<string>();
  // Included features of the previous (parent) level, with their assigned codes
  let parentIncluded: { feature: any; code: string }[] = [];

  for (let i = 0; i < sortedLevels.length; i++) {
    const lvl = sortedLevels[i];
    const bType = lvl.mappedName.trim();
    const included: { feature: any; code: string }[] = [];

    for (const feature of lvl.features) {
      const name: string | undefined = feature.properties?.name;
      const baseCode = name ? codeFromOsmName(name) : '';
      if (!name || !baseCode) {
        skipped.push({
          name: String(feature.id ?? '(unnamed)'),
          levelName: bType,
          osmLevel: lvl.level,
          reason: 'unnamed',
        });
        continue;
      }

      let parentCode: string | undefined = undefined;
      if (i > 0) {
        if (feature.geometry) {
          const centroid = getCentroid(feature);
          // Search ONLY the immediate parent level to maintain strict tree
          for (const p of parentIncluded) {
            if (featureContainsPoint(p.feature, centroid)) {
              parentCode = p.code;
              break;
            }
          }
        }
        if (!parentCode) {
          skipped.push({ name, levelName: bType, osmLevel: lvl.level, reason: 'no parent found' });
          continue;
        }
      }

      // De-dupe within the run: BOMET, BOMET_2, BOMET_3...
      let code = baseCode;
      for (let n = 2; usedCodes.has(code); n++) code = `${baseCode}_${n}`;
      usedCodes.add(code);

      boundaries.push({
        tenantId,
        code,
        name,
        boundaryType: bType,
        hierarchyType,
        parent: parentCode,
        // boundary-service rejects MultiPolygon → collapse to largest Polygon
        geometry: feature.geometry ? coerceForBoundaryService(feature.geometry) : undefined,
      });
      included.push({ feature, code });
    }

    parentIncluded = included;
  }

  return { boundaries, skipped };
}
