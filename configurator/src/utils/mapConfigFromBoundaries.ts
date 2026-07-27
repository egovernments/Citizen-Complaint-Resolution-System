import type { Boundary } from '@/api/types';

/**
 * Derives the citizen map's starting position and address-search extent from the
 * boundaries an operator just onboarded.
 *
 * The alternative is asking a system admin to type a latitude, a longitude, a
 * zoom level and four viewbox edges — eight numbers, none of which they can
 * sanity-check without opening a map. But by the time Phase 2 finishes we already
 * hold the polygons of the exact area the tenant serves, and those polygons ARE
 * the answer: their bounding box is the region the map should open on and the box
 * the address search should be confined to.
 *
 * A wrong viewbox is not a cosmetic problem — Nominatim's `bounded=1` DISCARDS
 * every result outside the box, so a box that doesn't cover the service area
 * silently hides addresses the citizen is entitled to pick. Deriving it from the
 * boundaries the tenant actually onboarded removes the chance to get it wrong.
 */

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface DerivedMapPosition {
  center: { lat: number; lng: number };
  defaultZoom: number;
  /** Omitted when the boundaries have no area to bound (e.g. a lone point). */
  searchViewbox?: BoundingBox;
}

// Web Mercator, 256 px tiles. Assumed viewport for the citizen map — it is a
// panel rather than a full page, and guessing small errs toward being zoomed
// out, which is recoverable; guessing large would open past the region's edges.
const TILE_SIZE = 256;
const ASSUMED_VIEWPORT_PX = { width: 800, height: 500 };

// A bbox padded to its exact edges puts the region's border on the viewport
// border. 10% of span on each side leaves the region visibly inside the frame.
const EDGE_PADDING = 0.1;

// Zoom is clamped rather than trusted: a tenant with one tiny ward would
// otherwise open at building level, and a country-sized tenant at globe level.
const MIN_DERIVED_ZOOM = 4;
const MAX_DERIVED_ZOOM = 16;

// Latitude in Mercator is projected, so degrees of latitude are not linear in
// pixels — project before comparing spans, or tall regions far from the equator
// come out over-zoomed.
const latToMercatorY = (lat: number): number => {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI;
};

/** Walks a GeoJSON coordinate tree of any nesting depth, visiting [lon, lat] pairs. */
const eachPosition = (coords: unknown, visit: (lon: number, lat: number) => void): void => {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    visit(coords[0] as number, coords[1] as number);
    return;
  }
  for (const child of coords) eachPosition(child, visit);
};

/**
 * Bounding box of every boundary that carries real geometry. Boundaries without
 * geometry (XLSX onboarding with no lat/long) are skipped rather than treated as
 * points at 0,0 — Null Island would drag the box across the Atlantic.
 */
export function boundsOfBoundaries(boundaries: Boundary[]): BoundingBox | undefined {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let seen = 0;

  for (const b of boundaries) {
    eachPosition(b.geometry?.coordinates, (lon, lat) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return;
      seen += 1;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
  }

  if (seen === 0 || minLon > maxLon || minLat > maxLat) return undefined;
  return { minLon, minLat, maxLon, maxLat };
}

/** Zoom at which `bounds` fills the assumed viewport, padded and clamped. */
export function zoomForBounds(bounds: BoundingBox): number {
  const lonFraction = (bounds.maxLon - bounds.minLon) / 360;
  const latFraction = (latToMercatorY(bounds.maxLat) - latToMercatorY(bounds.minLat)) / 2;

  // A single point (or a degenerate line) has no extent to fit — there is no
  // "correct" zoom, so fall back to the neighbourhood-level default rather than
  // dividing by zero into Infinity.
  if (lonFraction <= 0 && latFraction <= 0) return MAX_DERIVED_ZOOM;

  const zoomFor = (fraction: number, px: number): number =>
    fraction <= 0 ? Infinity : Math.log2(px / TILE_SIZE / fraction);

  const fit = Math.min(
    zoomFor(lonFraction * (1 + 2 * EDGE_PADDING), ASSUMED_VIEWPORT_PX.width),
    zoomFor(latFraction * (1 + 2 * EDGE_PADDING), ASSUMED_VIEWPORT_PX.height),
  );

  return Math.max(MIN_DERIVED_ZOOM, Math.min(MAX_DERIVED_ZOOM, Math.floor(fit)));
}

/**
 * Starting centre, zoom and search viewbox for the onboarded region. Returns
 * undefined when no boundary carries usable geometry — the caller must then leave
 * MapConfig alone rather than write a centre of 0,0.
 */
export function deriveMapPosition(boundaries: Boundary[]): DerivedMapPosition | undefined {
  const bounds = boundsOfBoundaries(boundaries);
  if (!bounds) return undefined;

  const lonSpan = bounds.maxLon - bounds.minLon;
  const latSpan = bounds.maxLat - bounds.minLat;

  const position: DerivedMapPosition = {
    center: {
      lat: (bounds.minLat + bounds.maxLat) / 2,
      lng: (bounds.minLon + bounds.maxLon) / 2,
    },
    defaultZoom: zoomForBounds(bounds),
  };

  // A boundary set with no area (a single point, or all points on one line)
  // produces a zero-width box. Padding a zero span leaves it zero, and a bounded
  // search against a zero-area box matches nothing at all — so write no viewbox
  // and let the search stay unbounded rather than bound it to nowhere.
  if (lonSpan > 0 && latSpan > 0) {
    // The region's own extent, padded so an address just outside the
    // administrative border — the far side of a boundary road, say — is still
    // findable.
    position.searchViewbox = {
      minLon: bounds.minLon - lonSpan * EDGE_PADDING,
      minLat: bounds.minLat - latSpan * EDGE_PADDING,
      maxLon: bounds.maxLon + lonSpan * EDGE_PADDING,
      maxLat: bounds.maxLat + latSpan * EDGE_PADDING,
    };
  }

  return position;
}
