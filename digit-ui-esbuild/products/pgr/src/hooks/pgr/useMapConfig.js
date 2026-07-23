import { useMemo } from "react";

// Default = the legacy hardcoded ward-highlight orange. Anything without
// an MDMS MapConfig record keeps the exact original behaviour.
export const DEFAULT_WARD_HIGHLIGHT_COLOR = "#FFA74F";

// Named base-map presets. The complaint-location maps used to hardcode the
// CARTO `dark_all` raster theme, which renders as a black background on
// tenants that expect a light map (egovernments/CCRS#882). The base theme is
// now resolved per tenant from MDMS so operators can switch it without a code
// change; `voyager` (a light, labelled basemap) is the default.
export const BASE_MAP_THEMES = {
  voyager: {
    tileUrl: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    tileAttribution: '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  },
  light: {
    tileUrl: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    tileAttribution: '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  },
  dark: {
    tileUrl: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    tileAttribution: '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  },
  osm: {
    tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
};

export const DEFAULT_BASE_MAP_THEME = "voyager";

// Zero Mile Stone, Nagpur — the geographical centre of India, and the legacy
// last-resort centre from when this was an India-only product. Kept only so a
// tenant that configures nothing behaves exactly as it did before.
export const DEFAULT_CENTER = { lat: 21.1498, lng: 79.0806 };
export const DEFAULT_ZOOM = 13;
export const DEFAULT_MIN_ZOOM = 0;
export const DEFAULT_MAX_ZOOM = 19;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const getGlobalConfig = (key) => window?.globalConfigs?.getConfig?.(key);

const inRange = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;

// Both halves must be usable: a half-filled record (lat set, lng missing) would
// otherwise drop the map at the equator instead of falling through to the next
// config tier.
const asLatLng = (v) => {
  const lat = Number(v?.lat);
  const lng = Number(v?.lng);
  return inRange(lat, -90, 90) && inRange(lng, -180, 180) ? { lat, lng } : undefined;
};

const asZoom = (v) => {
  const z = Number(v);
  return inRange(z, 0, 22) ? Math.round(z) : undefined;
};

const asNonEmptyString = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// Nominatim only honours `viewbox` alongside `bounded=1`, which DISCARDS every
// result outside the box. A partial or inverted box is therefore worse than no
// box at all — it silently hides every valid address — so require all four
// edges and a non-degenerate extent.
const asViewbox = (v) => {
  const minLon = Number(v?.minLon);
  const minLat = Number(v?.minLat);
  const maxLon = Number(v?.maxLon);
  const maxLat = Number(v?.maxLat);
  const usable =
    inRange(minLon, -180, 180) &&
    inRange(maxLon, -180, 180) &&
    inRange(minLat, -90, 90) &&
    inRange(maxLat, -90, 90) &&
    minLon < maxLon &&
    minLat < maxLat;
  return usable ? { minLon, minLat, maxLon, maxLat } : undefined;
};

// Resolves the complaint-location maps' theming, starting position, boundary
// source and geocoding scope from MDMS so they can be set per tenant without a
// code change. Reads `RAINMAKER-PGR.MapConfig[0]`.
//
// The config is per tenant, and the tenant is always the CITY the user is acting
// in — never the state root. mdms-v2 itself resolves up the tenant tree, so a
// city that has its own record overrides, and one that doesn't inherits whatever
// the parent holds. That inheritance is the platform's, not ours: nothing here
// may substitute a root tenant of its own accord.
//
// Every field resolves MDMS -> globalConfigs -> built-in default. A tenant with
// no MapConfig record (or a partial one) keeps exactly the behaviour it had
// before this master existed: the globalConfigs tier is the deploy-time Ansible
// layer (MAP_CENTER / MAP_TENANT) and stays in place, so existing installations
// need no migration.
//
// Supported MapConfig fields (all optional):
//   baseMapTheme        one of BASE_MAP_THEMES keys. Defaults to "voyager" so
//                       the map never falls back to the legacy black theme.
//   tileUrl             raw Leaflet tile-URL template. Overrides baseMapTheme.
//   tileAttribution     HTML attribution paired with a raw tileUrl.
//   wardHighlightColor  hex colour for the ward overlay.
//   center              { lat, lng } the map opens at.
//   defaultZoom         zoom the map opens at once a location is known.
//   minZoom / maxZoom   zoom bounds.
//   boundaryTenantId    tenant whose boundary tree supplies the ward polygons.
//   geocodeCountryCodes ISO codes the address search is restricted to.
//   searchViewbox       bounding box the address search is confined to.
//
// The boundary HIERARCHY is deliberately not here — it is a boundary construct,
// not a map one, and belongs to a default-boundary-hierarchy master rather than
// to map presentation. Until that master exists, consumers keep reading the
// globalConfigs HIERARCHY_TYPE key.
//
// MDMS errors (master not registered for this tenant) must not break the map —
// they are swallowed and every field falls through to its next tier.
const useMapConfig = (tenantIdOverride) => {
  // Acting tenant, most specific first: an explicit caller override (the
  // citizen wizard's authority-resolved sub-tenant), the citizen's chosen
  // city, then the logged-in tenant.
  const tenantId =
    (typeof tenantIdOverride === "string" && tenantIdOverride.trim()) ||
    Digit?.SessionStorage?.get?.("CITIZEN.COMMON.HOME.CITY")?.code ||
    Digit?.ULBService?.getCurrentTenantId?.();

  const { data, isLoading } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "MapConfig" }],
    {
      cacheTime: Infinity,
      retry: false,
      enabled: !!tenantId,
      select: (d) => d?.["RAINMAKER-PGR"]?.MapConfig,
    },
    // tenantId MUST ride inside the mdmsv2 arg: the hook's mdmsv2 branch
    // ignores the positional tenant and falls back to the logged-in tenant
    // (state root "mz" for citizens) — which is how the citizen map read the
    // state MapConfig record instead of the acting authority's. Also
    // tenant-scopes the hook's cache key.
    { schemaCode: "RAINMAKER-PGR.MapConfig", tenantId }
  );

  // The MDMS read is async, so on the first render every field still holds its
  // fallback. Callers that latch a value once (seeding map state, firing a
  // one-shot effect) must wait for this before reading `center` etc., or they
  // would pin themselves to the fallback and silently ignore the tenant's
  // configured position. With no tenant there is nothing to wait for.
  const isReady = !tenantId || !isLoading;

  return useMemo(() => {
    const cfg = Array.isArray(data) ? data[0] : undefined;

    // Ward highlight colour (back-compat with useWardHighlightColor).
    const rawWard = cfg?.wardHighlightColor;
    const wardHighlightColor =
      typeof rawWard === "string" && HEX.test(rawWard.trim())
        ? rawWard.trim()
        : DEFAULT_WARD_HIGHLIGHT_COLOR;

    // Base tile theme. A raw tileUrl always wins; otherwise resolve the named
    // preset, defaulting to voyager when the value is missing or unknown.
    const themeKey =
      typeof cfg?.baseMapTheme === "string" && BASE_MAP_THEMES[cfg.baseMapTheme.trim()]
        ? cfg.baseMapTheme.trim()
        : DEFAULT_BASE_MAP_THEME;
    const preset = BASE_MAP_THEMES[themeKey];

    const rawUrl = typeof cfg?.tileUrl === "string" ? cfg.tileUrl.trim() : "";
    const tileUrl = rawUrl || preset.tileUrl;
    const rawAttr = typeof cfg?.tileAttribution === "string" ? cfg.tileAttribution.trim() : "";
    // Pair a custom attribution with a raw URL; named presets carry their own.
    const tileAttribution = rawUrl ? rawAttr || preset.tileAttribution : preset.tileAttribution;

    const center = asLatLng(cfg?.center) || asLatLng(getGlobalConfig("MAP_CENTER")) || DEFAULT_CENTER;
    const defaultZoom = asZoom(cfg?.defaultZoom) ?? DEFAULT_ZOOM;
    const minZoom = asZoom(cfg?.minZoom) ?? DEFAULT_MIN_ZOOM;
    const maxZoom = asZoom(cfg?.maxZoom) ?? DEFAULT_MAX_ZOOM;

    const boundaryTenantId =
      asNonEmptyString(cfg?.boundaryTenantId) ||
      asNonEmptyString(getGlobalConfig("MAP_TENANT")) ||
      asNonEmptyString(process.env.REACT_APP_MAP_TENANT);
    // Deliberately no default country or viewbox. An unset geocoding scope means
    // a worldwide search, which is merely broad; a wrong one hides every valid
    // address (see asViewbox).
    const geocodeCountryCodes = asNonEmptyString(cfg?.geocodeCountryCodes);
    const searchViewbox = asViewbox(cfg?.searchViewbox);

    return {
      isReady,
      tileUrl,
      tileAttribution,
      wardHighlightColor,
      center,
      defaultZoom,
      minZoom,
      maxZoom,
      boundaryTenantId,
      geocodeCountryCodes,
      searchViewbox,
    };
  }, [data, isReady]);
};

export default useMapConfig;
