import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `RAINMAKER-PGR.MapConfig` — the single source of truth for the
 * citizen complaint maps: base tiles, ward highlight, where the map opens, which
 * tenant's wards it draws, and how far the address search reaches.
 *
 * Every field is optional. The runtime hook (digit-ui-esbuild
 * `products/pgr/src/hooks/pgr/useMapConfig.js`) resolves each one
 * MDMS -> globalConfigs -> built-in default, so a partial record only overrides
 * what it sets and an absent record reproduces the pre-MDMS behaviour exactly.
 *
 * Help text describes the *visible effect* of each field — an operator should not
 * have to know that `bounded=1` is a Nominatim query parameter to use the form.
 */
export const mapConfigDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.MapConfig',
  groups: [
    { title: 'Identity', fields: ['code'] },
    { title: 'Basemap', fields: ['baseMapTheme', 'tileUrl', 'tileAttribution', 'wardHighlightColor'] },
    { title: 'Starting position', fields: ['center.lat', 'center.lng', 'defaultZoom', 'minZoom', 'maxZoom'] },
    { title: 'Ward boundaries', fields: ['boundaryTenantId', 'hierarchyType'] },
    {
      title: 'Address search',
      fields: [
        'geocodeCountryCodes',
        'searchViewbox.minLon',
        'searchViewbox.minLat',
        'searchViewbox.maxLon',
        'searchViewbox.maxLat',
      ],
    },
  ],
  fields: [
    { path: 'code', widget: 'text', required: true,
      help: 'Record key. The maps read a single config, so use "DEFAULT" unless you are deliberately keeping several variants.' },

    { path: 'baseMapTheme', widget: 'text', label: 'Base map theme',
      help: 'Tile style the map is drawn in: voyager (light, labelled — the default), light, dark, or osm. Ignored if a custom tile URL is set below.' },
    { path: 'tileUrl', widget: 'text', label: 'Custom tile URL',
      help: 'Advanced. Point the map at your own tile provider, e.g. https://{s}.tile.example.org/{z}/{x}/{y}.png. Overrides the theme above. Leave blank to use the theme.' },
    { path: 'tileAttribution', widget: 'text', label: 'Custom tile attribution',
      help: 'Credit line shown in the map corner. Only used alongside a custom tile URL — the built-in themes carry their own.' },
    { path: 'wardHighlightColor', widget: 'color', label: 'Ward highlight colour',
      help: 'Fill and outline colour of the ward the citizen has pinned. Defaults to orange (#FFA74F).' },

    { path: 'center.lat', widget: 'number', label: 'Start latitude', min: -90, max: 90,
      help: 'Where the map opens when the citizen has not shared their location. Pick a point inside your service area — otherwise the citizen starts somewhere they have to pan away from.' },
    { path: 'center.lng', widget: 'number', label: 'Start longitude', min: -180, max: 180,
      help: 'Longitude of the starting point.' },
    { path: 'defaultZoom', widget: 'integer', label: 'Start zoom', min: 0, max: 22,
      help: 'How far in the map opens once a location is known. 13 is neighbourhood level (the default), 15 is street level, 10 shows a whole city.' },
    { path: 'minZoom', widget: 'integer', label: 'Minimum zoom', min: 0, max: 22,
      help: 'Furthest the citizen can zoom out.' },
    { path: 'maxZoom', widget: 'integer', label: 'Maximum zoom', min: 0, max: 22,
      help: 'Closest the citizen can zoom in.' },

    { path: 'boundaryTenantId', widget: 'text', label: 'Boundary tenant',
      help: 'Tenant whose ward polygons are drawn over the map and used to resolve a dropped pin to a ward, e.g. "ke.bomet". Leave blank to draw no ward overlay.' },
    { path: 'hierarchyType', widget: 'text', label: 'Boundary hierarchy',
      help: 'Which boundary hierarchy the wards come from. Defaults to ADMIN.' },

    { path: 'geocodeCountryCodes', widget: 'text', label: 'Search country codes',
      help: 'Restrict address search to these countries, as comma-separated two-letter codes (e.g. "ke"). Leave blank to search worldwide.' },
    { path: 'searchViewbox.minLon', widget: 'number', label: 'Search box — west', min: -180, max: 180,
      help: 'Optional. Confines address search to a bounding box. Addresses OUTSIDE the box are discarded entirely, so leave all four blank unless the box definitely covers your whole service area — a box that is too small silently hides valid addresses.' },
    { path: 'searchViewbox.minLat', widget: 'number', label: 'Search box — south', min: -90, max: 90,
      help: 'South edge of the address-search box.' },
    { path: 'searchViewbox.maxLon', widget: 'number', label: 'Search box — east', min: -180, max: 180,
      help: 'East edge of the address-search box.' },
    { path: 'searchViewbox.maxLat', widget: 'number', label: 'Search box — north', min: -90, max: 90,
      help: 'North edge of the address-search box.' },
  ],
};
