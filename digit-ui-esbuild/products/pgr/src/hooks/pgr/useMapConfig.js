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

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Resolves the complaint-location maps' theming from MDMS so it can be set
// per tenant without a code change. Reads `RAINMAKER-PGR.MapConfig[0]` and
// returns a normalised `{ tileUrl, tileAttribution, wardHighlightColor }`.
//
// Supported MapConfig fields (all optional):
//   baseMapTheme       one of BASE_MAP_THEMES keys ("voyager" | "light" |
//                      "dark" | "osm"). Picks a known tile URL + attribution.
//                      Defaults to "voyager" (light) so the map never falls
//                      back to the legacy black `dark_all` theme.
//   tileUrl            raw Leaflet tile-URL template ({s}/{z}/{x}/{y}). When
//                      present it overrides baseMapTheme, letting an operator
//                      point at any provider.
//   tileAttribution    HTML attribution string paired with a raw tileUrl.
//   wardHighlightColor hex colour for the ward overlay (legacy field).
//
// MDMS errors (master not registered for this tenant) must not break the map
// — they are swallowed and every field falls through to its default.
//
// FOLLOW-UP: expose these fields in the DIGIT Studio configurator so operators
// can set them from the UI instead of seeding MDMS by hand.
const useMapConfig = () => {
  const tenantId =
    Digit?.SessionStorage?.get?.("CITIZEN.COMMON.HOME.CITY")?.code ||
    Digit?.ULBService?.getCurrentTenantId?.();

  const { data } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "MapConfig" }],
    {
      cacheTime: Infinity,
      retry: false,
      enabled: !!tenantId,
      select: (d) => d?.["RAINMAKER-PGR"]?.MapConfig,
    },
    { schemaCode: "RAINMAKER-PGR.MapConfig" }
  );

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

    return { tileUrl, tileAttribution, wardHighlightColor };
  }, [data]);
};

export default useMapConfig;
