/**
 * Base tiles and opening view for the complaint maps (#2804).
 *
 * Plain functions with no React and no globals, so useMapConfig and
 * GeoLocations stay thin and the rules can be tested on their own.
 */

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Named base-map presets. The complaint-location maps used to hardcode the
// CARTO `dark_all` raster theme, which renders as a black background on
// tenants that expect a light map (egovernments/CCRS#882). The base theme is
// resolved per tenant from MDMS so operators can switch it without a code
// change.
export const BASE_MAP_THEMES = {
  voyager: {
    tileUrl: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    tileAttribution: CARTO_ATTRIBUTION,
  },
  light: {
    tileUrl: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    tileAttribution: CARTO_ATTRIBUTION,
  },
  dark: {
    tileUrl: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    tileAttribution: CARTO_ATTRIBUTION,
  },
  // The OSM tile policy asks for the plain host; the a/b/c subdomains are
  // legacy aliases.
  osm: {
    tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileAttribution: OSM_ATTRIBUTION,
  },
};

// OpenStreetMap is the default: it needs no key. CARTO raster tiles without a
// key now come back as "API KEY REQUIRED" watermarks, so a CARTO default left
// every tenant that never chose a theme with a blank map.
export const DEFAULT_BASE_MAP_THEME = "osm";

// Opening zoom when nothing says how big the tenant's area is: about a whole
// city in view. (The old opening zoom, 5, showed most of a continent.)
export const CITY_ZOOM = 12;

const CARTO_TILE_HOST = /^(?:https?:)?\/\/(?:[^/?#]*\.)?basemaps\.cartocdn\.com\//i;
const KEY_PARAM = /[?&](?:api_?key|key)=[^&#]+/i;

/**
 * True for a CARTO basemap URL that carries no API key. CARTO answers those with
 * a watermark tile (HTTP 200), so the map looks loaded but shows nothing. A
 * WRONG key looks the same and cannot be told apart here.
 */
export const isKeylessCartoUrl = (url) =>
  typeof url === "string" && CARTO_TILE_HOST.test(url.trim()) && !KEY_PARAM.test(url);

const trimmed = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Tile URL and attribution for a MapConfig record.
 *
 * - A raw `tileUrl` wins (this is how a keyed CARTO URL is configured).
 * - Otherwise the named `baseMapTheme`, defaulting to OpenStreetMap.
 * - Anything that resolves to CARTO without a key falls back to OpenStreetMap,
 *   because those tiles are only watermarks. `keylessCartoFallback` says so,
 *   for the console warning.
 */
export const resolveBaseTiles = (cfg) => {
  const themeName = trimmed(cfg?.baseMapTheme);
  const themeKey = BASE_MAP_THEMES[themeName] ? themeName : DEFAULT_BASE_MAP_THEME;
  const rawUrl = trimmed(cfg?.tileUrl);
  const rawAttr = trimmed(cfg?.tileAttribution);
  const osm = BASE_MAP_THEMES.osm;

  if (rawUrl) {
    if (isKeylessCartoUrl(rawUrl)) {
      return { tileUrl: osm.tileUrl, tileAttribution: osm.tileAttribution, keylessCartoFallback: true };
    }
    // A raw URL without its own credit line: CARTO's for a CARTO URL, otherwise
    // the named theme's (the previous behaviour).
    const fallbackAttr = CARTO_TILE_HOST.test(rawUrl) ? CARTO_ATTRIBUTION : BASE_MAP_THEMES[themeKey].tileAttribution;
    return { tileUrl: rawUrl, tileAttribution: rawAttr || fallbackAttr, keylessCartoFallback: false };
  }

  const preset = BASE_MAP_THEMES[themeKey];
  // Named CARTO presets never carry a key.
  if (isKeylessCartoUrl(preset.tileUrl)) {
    return { tileUrl: osm.tileUrl, tileAttribution: osm.tileAttribution, keylessCartoFallback: true };
  }
  return { tileUrl: preset.tileUrl, tileAttribution: preset.tileAttribution, keylessCartoFallback: false };
};

// Visits every [lng, lat] pair in a GeoJSON coordinate tree of any depth.
const eachPosition = (coords, visit) => {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    visit(coords[0], coords[1]);
    return;
  }
  for (const child of coords) eachPosition(child, visit);
};

/**
 * Bounding box ({ south, west, north, east }) of every feature in a GeoJSON
 * FeatureCollection, or undefined when nothing has usable coordinates.
 */
export const boundsOfFeatures = (collection) => {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const feature of collection?.features || []) {
    eachPosition(feature?.geometry?.coordinates, (lng, lat) => {
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
    });
  }
  if (!(south <= north && west <= east)) return undefined;
  return { south, west, north, east };
};

const clampZoom = (zoom, minZoom, maxZoom) => Math.max(minZoom, Math.min(zoom, maxZoom));

/**
 * Where the citizen map opens before a location is picked.
 *
 *   1. The centre set in MapConfig (by an admin, or by the configurator's
 *      Geography step), at the configured zoom or city zoom.
 *   2. Otherwise the tenant's boundary outline: `bounds` is set and the caller
 *      fits it; `center`/`zoom` are its midpoint and city zoom for the moment
 *      before the fit.
 *   3. Otherwise `fallbackCenter` (the deployment's MAP_CENTER, else the
 *      built-in default) at city zoom.
 */
export const resolveOpeningView = ({ configCenter, configZoom, outline, fallbackCenter, minZoom = 0, maxZoom = 22 }) => {
  if (configCenter) {
    return { source: "config", center: configCenter, zoom: clampZoom(configZoom ?? CITY_ZOOM, minZoom, maxZoom) };
  }
  if (outline) {
    return {
      source: "outline",
      center: { lat: (outline.south + outline.north) / 2, lng: (outline.west + outline.east) / 2 },
      zoom: clampZoom(CITY_ZOOM, minZoom, maxZoom),
      bounds: outline,
    };
  }
  return { source: "fallback", center: fallbackCenter, zoom: clampZoom(CITY_ZOOM, minZoom, maxZoom) };
};
