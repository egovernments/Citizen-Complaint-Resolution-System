/**
 * Base-map and starting-position rules for the Map Configuration editor (#2804).
 *
 * The tile rules mirror digit-ui-esbuild products/pgr/src/utils/mapView.js, so
 * the preview shows the basemap citizens will actually get.
 */

type Obj = Record<string, unknown>;

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
const KEY_PARAM = /[?&](?:api_?key|key)=[^&#]+/i;

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

export const KEYLESS_CARTO_NOTE =
  'CARTO maps need an API key. Without one, citizens see OpenStreetMap instead. To use CARTO, paste your tile URL with its key into Custom tile URL.';

const isBlank = (v: unknown) => v === undefined || v === null || v === '';

/**
 * Plain-language reason the record can't be saved, or null. Checks only what
 * the citizen map would otherwise ignore or the server would refuse with a
 * schema error: the starting point needs both halves, in range.
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
  if (!isBlank(data.defaultZoom)) {
    const z = Number(data.defaultZoom);
    if (!Number.isInteger(z) || z < 0 || z > 22) return 'Start zoom must be a whole number from 0 to 22.';
  }
  return null;
}
