/**
 * Base-map and starting-position rules for the Map Configuration editor (#2804).
 *
 * The tile rules mirror digit-ui-esbuild products/pgr/src/utils/mapView.js, so
 * the preview shows the basemap citizens will actually get.
 */

type Obj = Record<string, unknown>;

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Base-tile presets. CARTO (voyager, light, dark) needs an API key; without one
// every tile is an "API KEY REQUIRED" watermark, so the citizen map uses
// OpenStreetMap instead. A keyed CARTO URL goes in the custom tile URL.
export const BASE_MAP_THEMES: Record<string, { tileUrl: string; label: string }> = {
  voyager: { label: 'Voyager (CARTO, needs an API key)', tileUrl: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png' },
  light: { label: 'Light (CARTO, needs an API key)', tileUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' },
  dark: { label: 'Dark (CARTO, needs an API key)', tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' },
  osm: { label: 'OpenStreetMap', tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
};
export const DEFAULT_THEME = 'osm';

const CARTO_TILE_HOST = /^(?:https?:)?\/\/(?:[^/?#]*\.)?basemaps\.cartocdn\.com\//i;
const OSM_TILE_HOST = /^(?:https?:)?\/\/(?:[^/?#]*\.)?tile\.openstreetmap\.org\//i;
const KEY_PARAM = /[?&](?:api_?key|key)=[^&#]+/i;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);

/** Credit for a custom tile URL that came without one: its host, never a preset's. */
export function genericTileCredit(url: string): string {
  const match = /^(?:https?:)?\/\/([^/?#]+)/i.exec(url);
  if (!match) return '';
  const host = match[1]
    .replace(/^.*@/, '')
    .replace(/:\d*$/, '')
    .replace(/^(?:\{[^}]*\}\.)+/, '');
  return host ? `&copy; ${escapeHtml(host)}` : '';
}

/** A CARTO basemap URL with no API key: CARTO answers it with watermark tiles only. */
export const isKeylessCartoUrl = (url: string): boolean => CARTO_TILE_HOST.test(url.trim()) && !KEY_PARAM.test(url);

/**
 * The tile URL citizens will get for this theme / custom URL, and whether a
 * CARTO choice was replaced by OpenStreetMap for lack of a key.
 */
export function resolveTileUrl(theme: unknown, tileUrl: unknown): { url: string; keylessCarto: boolean } {
  const custom = typeof tileUrl === 'string' ? tileUrl.trim() : '';
  const name = typeof theme === 'string' && BASE_MAP_THEMES[theme.trim()] ? theme.trim() : DEFAULT_THEME;
  const url = custom || BASE_MAP_THEMES[name].tileUrl;
  if (isKeylessCartoUrl(url)) return { url: BASE_MAP_THEMES.osm.tileUrl, keylessCarto: true };
  return { url, keylessCarto: false };
}

/**
 * The credit line citizens see for this theme / custom URL: the custom
 * attribution if set, else the credit of whoever serves the tiles.
 */
export function resolveTileAttribution(theme: unknown, tileUrl: unknown, tileAttribution: unknown): string {
  const { url, keylessCarto } = resolveTileUrl(theme, tileUrl);
  const custom = typeof tileUrl === 'string' ? tileUrl.trim() : '';
  const credit = typeof tileAttribution === 'string' ? tileAttribution.trim() : '';
  if (custom && !keylessCarto) {
    if (credit) return credit;
    if (CARTO_TILE_HOST.test(url)) return CARTO_ATTRIBUTION;
    if (OSM_TILE_HOST.test(url)) return OSM_ATTRIBUTION;
    return genericTileCredit(url);
  }
  return CARTO_TILE_HOST.test(url) ? CARTO_ATTRIBUTION : OSM_ATTRIBUTION;
}

export const KEYLESS_CARTO_NOTE =
  'CARTO maps need an API key. Without one, citizens see OpenStreetMap instead. To use CARTO, paste your tile URL with its key into Custom tile URL.';

const isBlank = (v: unknown) => v === undefined || v === null || v === '';

const isWholeZoom = (v: unknown) => {
  const z = Number(v);
  return Number.isInteger(z) && z >= 0 && z <= 22;
};

const SEARCH_BOX_EDGES = [
  { key: 'minLon', label: 'Search box — west', min: -180, max: 180 },
  { key: 'minLat', label: 'Search box — south', min: -90, max: 90 },
  { key: 'maxLon', label: 'Search box — east', min: -180, max: 180 },
  { key: 'maxLat', label: 'Search box — north', min: -90, max: 90 },
] as const;

/**
 * Plain-language reason the record can't be saved, or null. Checks only what
 * the citizen map would otherwise ignore or the server would refuse with a
 * schema error: the starting point needs both halves, the search box all four
 * edges, every number in range and every zoom a whole number from 0 to 22.
 */
export function mapConfigProblem(data: Obj): string | null {
  const center = (data.center && typeof data.center === 'object' ? data.center : {}) as Obj;
  const lat = center.lat;
  const lng = center.lng;
  if (isBlank(lat) !== isBlank(lng)) {
    return 'Start latitude and Start longitude go together: fill in both, or clear both.';
  }
  if (!isBlank(lat)) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || la < -90 || la > 90) return 'Start latitude must be a number between -90 and 90.';
    if (!Number.isFinite(ln) || ln < -180 || ln > 180) return 'Start longitude must be a number between -180 and 180.';
  }
  if (!isBlank(data.defaultZoom) && !isWholeZoom(data.defaultZoom)) return 'Start zoom must be a whole number from 0 to 22.';
  if (!isBlank(data.minZoom) && !isWholeZoom(data.minZoom)) return 'Minimum zoom must be a whole number from 0 to 22.';
  if (!isBlank(data.maxZoom) && !isWholeZoom(data.maxZoom)) return 'Maximum zoom must be a whole number from 0 to 22.';
  if (!isBlank(data.minZoom) && !isBlank(data.maxZoom) && Number(data.minZoom) > Number(data.maxZoom)) {
    return 'Minimum zoom can\'t be more than Maximum zoom.';
  }

  const box = (data.searchViewbox && typeof data.searchViewbox === 'object' ? data.searchViewbox : {}) as Obj;
  const filled = SEARCH_BOX_EDGES.filter((edge) => !isBlank(box[edge.key]));
  if (filled.length > 0 && filled.length < SEARCH_BOX_EDGES.length) {
    return 'The search box needs all four edges (west, south, east and north), or none. Use "Set search area to this view" under the map, or "Clear search area".';
  }
  if (filled.length === SEARCH_BOX_EDGES.length) {
    for (const edge of SEARCH_BOX_EDGES) {
      const v = Number(box[edge.key]);
      if (!Number.isFinite(v) || v < edge.min || v > edge.max) return `${edge.label} must be a number between ${edge.min} and ${edge.max}.`;
    }
    if (Number(box.minLon) >= Number(box.maxLon) || Number(box.minLat) >= Number(box.maxLat)) {
      return 'The search box\'s west edge must be left of its east edge, and its south edge below its north edge.';
    }
  }
  return null;
}
