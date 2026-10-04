// Helpers for Phase 2's one-click fetch path: turn the admin-level groups
// built from a turbopass /boundary/fetch response (GeoJSON features grouped
// by admin_level, from whichever source served them) into the Boundary[]
// payload boundary-service expects. Pure functions — the fetch and all UI
// state stay in Phase2Page.
//
// Two deliberate exclusion rules (surfaced to the operator as a "skipped"
// report instead of silently mangling the tree):
//   - features with no usable name are dropped: codes are derived from
//     names, and falling back to opaque OSM ids produces codes nobody can
//     read in MDMS/localization later.
//   - features whose representative point lands in NO immediate-parent
//     polygon are dropped: attaching them to an arbitrary parent (the old
//     fallback was parentLvl.features[0]) silently corrupts the hierarchy.
import { coerceForBoundaryService } from './boundaryGeoJson';
import type { Boundary } from '@/api/types';

export interface OsmAdminLevel {
  /** Admin level as the source numbers it (higher = more specific) */
  level: number;
  /** GeoJSON features the turbopass fetch returned at this admin_level */
  features: any[];
  examples: string[];
  /** Operator-provided hierarchy level name, e.g. "District" */
  mappedName: string;
  /** The level's local name from the boundary source ("Ward"), used to
   *  pre-fill mappedName; absent when the source doesn't know it. */
  suggestedName?: string;
  /**
   * Whether this level is included in the hierarchy. The operator picks a
   * CONTIGUOUS subset of the discovered levels (trim the top/bottom, never a
   * gap) — a boundary hierarchy is a strict parent→child chain, so skipping a
   * middle level would silently collapse its children onto the level above.
   */
  selected: boolean;
}

export interface SkippedOsmFeature {
  /** Feature name (native when available), or the OSM id purely for display when unnamed */
  name: string;
  /** Operator's level name (mappedName) */
  levelName: string;
  osmLevel: number;
  reason: 'unnamed' | 'name not romanizable' | 'no parent found';
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

/** Signed shoelace sum of a ring (×2). |result|/2 is the planar area. */
function ringShoelace(ring: number[][]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return sum;
}

/** Planar area of a ring via the shoelace formula. */
function ringArea(ring: number[][]): number {
  return Math.abs(ringShoelace(ring)) / 2;
}

/** Total outer-ring area of a feature (sum over MultiPolygon members).
 *  Holes deliberately excluded — this is a tie-breaker for picking the
 *  SMALLEST containing parent, where the enclosing outline is what matters. */
export function featureOuterArea(feature: any): number {
  const geom = feature?.geometry;
  if (!geom) return 0;
  if (geom.type === 'Polygon') {
    return ringArea(geom.coordinates?.[0] ?? []);
  }
  if (geom.type === 'MultiPolygon') {
    let total = 0;
    for (const poly of geom.coordinates ?? []) {
      total += ringArea(poly?.[0] ?? []);
    }
    return total;
  }
  return 0;
}

/** Shoelace area-weighted centroid of a ring, or null when degenerate. */
function ringCentroid(ring: number[][]): number[] | null {
  if (!ring || ring.length < 3) return null;
  let a2 = 0; // 2×signed area
  let cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a2 += cross;
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  if (Math.abs(a2) < 1e-12) return null;
  return [cx / (3 * a2), cy / (3 * a2)];
}

/** Vertex average of a ring — last-resort fallback only. */
function ringVertexAverage(ring: number[][]): number[] | null {
  if (!ring || ring.length === 0) return null;
  let x = 0, y = 0;
  for (const pt of ring) {
    x += pt[0];
    y += pt[1];
  }
  return [x / ring.length, y / ring.length];
}

/** Point-on-surface approximation: intersect the horizontal line at `y`
 *  with all rings (outer + holes), pair the sorted crossings into interior
 *  segments (even-odd rule), and return the midpoint of the longest one.
 *  Returns null when the scanline yields no clean interior segment. */
function scanlineMidpoint(rings: number[][][], y: number): number[] | null {
  const xs: number[] = [];
  for (const ring of rings) {
    if (!ring) continue;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][1], yj = ring[j][1];
      if ((yi > y) !== (yj > y)) {
        xs.push(ring[i][0] + ((y - yi) * (ring[j][0] - ring[i][0])) / (yj - yi));
      }
    }
  }
  if (xs.length < 2 || xs.length % 2 !== 0) return null;
  xs.sort((a, b) => a - b);
  let bestMid: number[] | null = null;
  let bestWidth = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const width = xs[i + 1] - xs[i];
    if (width > bestWidth) {
      bestWidth = width;
      bestMid = [(xs[i] + xs[i + 1]) / 2, y];
    }
  }
  return bestMid;
}

/**
 * Representative point of a feature, computed from the LARGEST MultiPolygon
 * member — the same member coerceForBoundaryService persists — so parent
 * assignment can never disagree with the stored geometry.
 *
 * Strategy, in order:
 *  1. shoelace area-weighted centroid of that member's outer ring, if it
 *     passes the feature's own containment test;
 *  2. point-on-surface approximation (midpoint of the longest horizontal
 *     interior segment at the centroid's latitude), if it passes containment;
 *  3. vertex average of the outer ring (last resort, may be outside).
 */
export function getCentroid(feature: any): number[] {
  const geom = feature?.geometry;
  const coerced = geom ? coerceForBoundaryService(geom) : undefined;
  if (coerced?.type === 'Point') return coerced.coordinates as number[];

  const rings: number[][][] =
    coerced?.type === 'Polygon' ? (coerced.coordinates as number[][][]) : [];
  const outer = rings[0] ?? [];

  const centroid = ringCentroid(outer);
  if (centroid) {
    if (featureContainsPoint(feature, centroid)) return centroid;
    // Concave shape: centroid fell outside (or in a hole) — approximate a
    // point-on-surface along the centroid's latitude.
    const onSurface = scanlineMidpoint(rings, centroid[1]);
    if (onSurface && featureContainsPoint(feature, onSurface)) return onSurface;
  }

  return ringVertexAverage(outer) ?? [NaN, NaN];
}

function pointInRing(point: number[], vs: number[][]): boolean {
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

/** True containment for one polygon's ring set: inside the outer ring and
 *  NOT inside any interior (hole) ring — enclaves don't count. */
function pointInPolygonRings(point: number[], rings: number[][][]): boolean {
  if (!rings || rings.length === 0 || !pointInRing(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(point, rings[i])) return false;
  }
  return true;
}

export function featureContainsPoint(feature: any, point: number[]): boolean {
  if (!feature.geometry) return false;
  if (feature.geometry.type === 'Polygon') {
    return pointInPolygonRings(point, feature.geometry.coordinates);
  } else if (feature.geometry.type === 'MultiPolygon') {
    for (const poly of feature.geometry.coordinates) {
      if (pointInPolygonRings(point, poly)) return true;
    }
  }
  return false;
}

/** Pick the name + code for a feature. Codes need Latin output, so try the
 *  romanizable name tags in order: name:en, int_name, then name. The
 *  display name stays the native `name` when present so operators recognize
 *  it in the review/skip reports. */
function resolveNameAndCode(properties: any): {
  displayName: string;
  code: string;
  hasName: boolean;
} {
  const props = properties ?? {};
  const candidates = [props['name:en'], props.int_name, props.name];
  const nonEmpty = candidates.filter(
    (c): c is string => typeof c === 'string' && c.trim() !== ''
  );
  const displayName =
    (typeof props.name === 'string' && props.name.trim()) || nonEmpty[0] || '';
  for (const candidate of nonEmpty) {
    const code = codeFromOsmName(candidate);
    if (code) return { displayName, code, hasName: true };
  }
  return { displayName, code: '', hasName: nonEmpty.length > 0 };
}

/**
 * Build the Boundary[] payload from operator-mapped admin levels.
 *
 * @param sortedLevels levels with non-empty mappedName, ascending by OSM
 *                     admin_level (root first)
 * Parenting searches ONLY the immediate parent level (strict tree), and
 * only its INCLUDED features — a child whose spatial parent was itself
 * skipped won't exist in DIGIT, so the child is skipped too. When several
 * parents contain the child's representative point (enclaves), the
 * smallest-area parent wins — deterministic, and correct for enclaves.
 */
/**
 * Each feature's containing features at the level directly above it, smallest
 * first. Pure geometry — it doesn't depend on which levels are selected — so it
 * is computed once per fetch and shared by every data-check rebuild and by the
 * create step, instead of repeating the point-in-polygon work on each toggle.
 */
export type ContainingParents = WeakMap<object, object[]>;

export function computeContainingParents(levels: OsmAdminLevel[]): ContainingParents {
  const sorted = [...levels].sort((a, b) => a.level - b.level);
  const out: ContainingParents = new WeakMap();
  for (let i = 1; i < sorted.length; i++) {
    const parents = sorted[i - 1].features.map((feature) => ({ feature, area: featureOuterArea(feature) }));
    for (const feature of sorted[i].features) {
      if (!feature?.geometry) {
        out.set(feature, []);
        continue;
      }
      const centroid = getCentroid(feature);
      out.set(
        feature,
        parents
          .filter((p) => featureContainsPoint(p.feature, centroid))
          .sort((a, b) => a.area - b.area)
          .map((p) => p.feature),
      );
    }
  }
  return out;
}

export function buildOsmBoundaries(
  sortedLevels: OsmAdminLevel[],
  tenantId: string,
  hierarchyType: string,
  // From computeContainingParents over the same fetch; without it the parents are found here.
  containingParents?: ContainingParents,
): { boundaries: Boundary[]; skipped: SkippedOsmFeature[] } {
  const boundaries: Boundary[] = [];
  const skipped: SkippedOsmFeature[] = [];
  const usedCodes = new Set<string>();
  // Included features of the previous (parent) level, with their assigned
  // codes and outer-ring areas (for smallest-containing-parent selection)
  let parentIncluded: { feature: any; code: string; area: number }[] = [];

  for (let i = 0; i < sortedLevels.length; i++) {
    const lvl = sortedLevels[i];
    const bType = lvl.mappedName.trim();
    const included: { feature: any; code: string; area: number }[] = [];

    // Stable code-suffix assignment: which of two same-named areas becomes
    // BOMET and which BOMET_2 must not change between fetches, because the codes
    // are what complaints and localisation point at. turbopass features carry
    // their stable id in properties.place_id (older OSM-shaped input: id).
    const stableId = (f: { id?: unknown; properties?: { place_id?: unknown } } | null) =>
      String(f?.properties?.place_id ?? f?.id ?? '');
    const features = [...lvl.features].sort((a, b) => stableId(a).localeCompare(stableId(b)));
    const parentCodeOf = new Map(parentIncluded.map((p) => [p.feature, p.code]));

    for (const feature of features) {
      const { displayName, code: baseCode, hasName } = resolveNameAndCode(feature.properties);
      if (!baseCode) {
        skipped.push({
          name: hasName ? displayName : stableId(feature) || '(unnamed)',
          levelName: bType,
          osmLevel: lvl.level,
          reason: hasName ? 'name not romanizable' : 'unnamed',
        });
        continue;
      }
      const name = displayName;

      let parentCode: string | undefined = undefined;
      if (i > 0) {
        const containing = containingParents?.get(feature);
        if (containing) {
          // Smallest containing parent that was itself created.
          for (const p of containing) {
            const c = parentCodeOf.get(p);
            if (c) {
              parentCode = c;
              break;
            }
          }
        } else if (feature.geometry) {
          const centroid = getCentroid(feature);
          // Search ONLY the immediate parent level to maintain a strict
          // tree; among all containing parents, take the smallest area.
          let best: { code: string; area: number } | undefined;
          for (const p of parentIncluded) {
            if (featureContainsPoint(p.feature, centroid)) {
              if (!best || p.area < best.area) best = { code: p.code, area: p.area };
            }
          }
          parentCode = best?.code;
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
      included.push({ feature, code, area: featureOuterArea(feature) });
    }

    parentIncluded = included;
  }

  return { boundaries, skipped };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- turbopass GeoJSON is untyped */
function levelKey(props: any): number | null {
  if (Number.isInteger(props?.depth)) return props.depth;
  // Servers that predate `depth` (and raw Geoapify) only carry the source's own number.
  const n = Number.parseInt(props?.admin_level ?? props?.datasource?.raw?.admin_level, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Groups a turbopass /boundary/fetch response into the levels Phase 2 shows.
 * Only polygons count. Levels are numbered 1, 2, 3, … from the fetched place
 * down, whatever numbering the source uses, and a level whose features share
 * one local name (`level_name`, e.g. "Ward") gets it as its suggested name.
 */
export function groupFetchedLevels(features: any[] | null | undefined): OsmAdminLevel[] {
  const groups = new Map<number, any[]>();
  for (const feature of features ?? []) {
    const type = feature?.geometry?.type;
    if (type !== 'Polygon' && type !== 'MultiPolygon') continue;
    const key = levelKey(feature.properties);
    if (key === null) continue;
    const list = groups.get(key);
    if (list) list.push(feature);
    else groups.set(key, [feature]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, levelFeatures], i) => {
      const names = [...new Set(levelFeatures.map((f) => f.properties?.name).filter(Boolean))];
      const levelNames = [...new Set(levelFeatures.map((f) => f.properties?.level_name).filter(Boolean))];
      const suggestedName = levelNames.length === 1 ? String(levelNames[0]) : undefined;
      return {
        level: i + 1,
        features: levelFeatures,
        examples: names.slice(0, 3),
        mappedName: suggestedName ?? '',
        suggestedName,
        // Default all selected (a contiguous, valid starting point); the
        // operator trims the range and names what they keep.
        selected: true,
      };
    });
}
