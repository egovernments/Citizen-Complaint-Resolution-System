# 40 — Map rendering

Putting a map on a screen: the tile model, the client libraries, the provider landscape,
and the attribution rules.

## The tile pyramid

Web maps are not images; they are a pyramid of 256×256 px (sometimes 512) square tiles in
**Web Mercator (EPSG:3857)**, addressed by `{z}/{x}/{y}`:

- `z` = zoom, 0 (whole world in one tile) to ~19–22.
- At zoom `z` there are `2^z × 2^z` tiles. `z=19` is ~275 billion tiles globally — which
  is why "just pre-render the world" is not a plan.
- `x` increases east from the antimeridian, `y` increases **south** from the north pole in
  the standard XYZ scheme. (TMS, an older scheme, flips `y`. If your map is
  vertically mirrored, this is why.)
- Ground resolution at the equator ≈ `156543.03 / 2^z` metres/pixel. So `z=13` ≈ 19 m/px
  (a town), `z=16` ≈ 2.4 m/px (a street), `z=19` ≈ 0.3 m/px (a building).
- Mercator distorts area increasingly toward the poles and cannot represent latitudes
  beyond ±85.051°.

URL templates you will see:

```
https://tile.openstreetmap.org/{z}/{x}/{y}.png          # canonical raster
https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png
https://api.example.com/v1/{z}/{x}/{y}.pbf?key=…        # vector
```

- `{s}` = a subdomain rotation placeholder (`a`,`b`,`c`), a legacy workaround for
  HTTP/1.1 per-host connection limits. **Obsolete under HTTP/2**, and the OSM Foundation
  has retired its `{s}.tile.openstreetmap.org` form in favour of plain
  `tile.openstreetmap.org`. Some providers still document it.
- `{r}` = Leaflet's retina placeholder, expanding to `@2x` on high-DPI screens.

## Raster vs vector tiles

| | Raster (`.png`/`.jpg`) | Vector (`.pbf`, Mapbox Vector Tile) |
|---|---|---|
| Contains | Pre-rendered pixels | Encoded geometry + attributes |
| Styling | Baked in at render time | Applied **in the client**, changeable at runtime |
| Client cost | Trivial — it is an image | GPU rendering, a real style engine |
| Bandwidth | Higher at high zoom | Lower; one tile serves many zooms via overzoom |
| Rotation / tilt / smooth zoom | No | Yes |
| Label localisation | Fixed at render time | **Switchable at runtime** (`name:sw` vs `name:en`) |
| Library | Leaflet, OpenLayers | MapLibre GL JS, OpenLayers |
| Ops complexity | Lower | Higher (style JSON, glyphs, sprites, fonts) |

Choose raster when you want a basemap under your own overlays and nothing more — it is
dramatically simpler and every library supports it. Choose vector when you need runtime
theming, label language switching, or a genuinely modern feel. For a
multi-language municipal platform, runtime label localisation is the strongest single
argument for vector; it is otherwise hard to get right.

## Client libraries

| Library | Licence | Model | Notes |
|---|---|---|---|
| **[Leaflet](https://leafletjs.com)** 1.x | BSD-2 | Raster-first | ~40 KB, stable for a decade, huge plugin ecosystem. The safe default. Vector tiles only via plugins |
| **[MapLibre GL JS](https://maplibre.org)** | BSD-3 | Vector, WebGL | The open fork of Mapbox GL JS v1 (taken at the last BSD commit). Actively developed; the modern choice |
| **[OpenLayers](https://openlayers.org)** | BSD-2 | Both | Most capable and most complex; strong on projections, WMS/WMTS, GIS-grade interop |
| **[Mapbox GL JS](https://www.mapbox.com/mapbox-gljs)** v2+ | **Proprietary** | Vector | Requires a Mapbox access token and billing; v2 relicensed away from BSD. Use MapLibre unless you are deliberately buying Mapbox |
| **[deck.gl](https://deck.gl)** | MIT | WebGL overlay | Large-scale data viz on top of the above |

Framework wrappers (`react-leaflet`, `react-map-gl`) are convenient but add a
version-coupling axis: `react-leaflet` v3/v4/v5 track specific React versions, and a
mismatch fails at runtime rather than at build. In a repo with several frontends on
different React versions, calling the underlying library directly is often the lower-risk
choice — you trade a little ergonomics for one fewer dependency to reconcile.

### Rendering overlays: things that bite

- **Draw order and z-order.** Rendering child polygons after their parents (or explicitly
  largest-bbox-first) keeps small features clickable. Otherwise a county polygon covers
  every ward inside it.
- **Interactive vector layers swallow clicks.** A GeoJSON layer defaults to
  `interactive: true`. Leaflet paths do bubble their click to the map by default
  (`bubblingMouseEvents: true`), so a "clicking the polygon doesn't drop my pin" symptom
  is usually a *handler ordering or state* bug, not the layer eating the event — verify
  before reaching for `interactive: false`, which also kills your tooltips.
- **`fitBounds` on empty or degenerate geometry** throws or zooms to nowhere. Guard for
  zero features, and treat placeholder geometry (`Point [0,0]`, the unit square
  `[[0,0],[0,1],[1,1],[1,0],[0,0]]`) as *absent* rather than valid — such placeholders
  are common in freshly-seeded databases and will fit your map to the Gulf of Guinea.
- **Async races.** A reverse-geocode fired on mount can resolve *after* a newer one fired
  by a user click, overwriting fresh state with stale. Sequence or cancel requests; do not
  rely on arrival order.
- **Vertex budget.** Thousands of polygons with hundreds of vertices each will jank the
  main thread. Simplify for display ([part 20](20-data-sources.md)), or move to vector
  tiles / canvas rendering.
- **Container sizing.** A map initialised in a hidden or zero-height container renders
  blank; call `invalidateSize()` (Leaflet) / `resize()` (MapLibre) after it becomes
  visible.

## Tile providers

| Provider | Key? | Terms in brief |
|---|---|---|
| **OSM Foundation** `tile.openstreetmap.org` | No | Community-funded, **best-effort, no SLA**. Bound by the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) |
| **[CARTO](https://carto.com/basemaps)** basemaps CDN (`voyager`, `light_all`, `dark_all`) | No | Attractive, keyless, widely used — but a **courtesy service** under CARTO's own terms, not an SLA'd endpoint. Verify current terms before relying on it commercially |
| **[Stadia Maps](https://stadiamaps.com)** | Yes (free for dev/non-commercial) | Hosts Stamen styles; clear free tier |
| **[MapTiler](https://www.maptiler.com)** | Yes | Raster + vector + geocoding; solid free tier |
| **[Thunderforest](https://www.thunderforest.com)** | Yes | Themed styles (cycle, transport, outdoors) |
| **[Protomaps](https://protomaps.com)** | No (self-serve) | Ships a whole basemap as a **PMTiles** file you host on any static/object store — no tile server at all |
| **[OpenFreeMap](https://openfreemap.org)** | No | Free vector tiles, no key, no rate limit stated; donation-funded, verify current status |
| **[Esri](https://www.esri.com)**, **Google**, **Mapbox**, **HERE** | Yes | Commercial; terms usually forbid mixing their tiles with other providers' geocoding |

### The OSM tile usage policy — the rules that apply to us

From the [official policy](https://operations.osmfoundation.org/policies/tiles/):

| Rule | Detail |
|---|---|
| HTTPS only | `https://tile.openstreetmap.org/{z}/{x}/{y}.png`; the `{s}.` subdomain form is retired |
| Identify your app | A **unique `User-Agent`** naming the application. Generic library defaults get blocked |
| Preserve `Referer` | Browsers must not strip it via a restrictive `Referrer-Policy` |
| Cache | Respect HTTP cache headers, or cache ≥ **7 days**. Never default to `no-cache` |
| **No bulk prefetch** | No pre-seeding areas, no offline archives, no automated scans |
| Attribution | `© OpenStreetMap contributors` visible, bottom-right by convention, **not** behind a toggle |
| No SLA | May be blocked without notice if your usage degrades the service |

Read plainly: **the OSMF tile service is not a production backend for a public-facing
government platform.** For anything with real traffic, either buy a provider or self-host
([part 50](50-self-hosting.md)).

### Attribution, concretely

- Raster from OSMF: `© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors`
- Provider styles: **both** the provider and OSM, e.g. `© CARTO © OpenStreetMap contributors`
- Custom tile URL: the attribution must be supplied *with* it. A configuration model
  where the basemap URL and its attribution are set independently will eventually render
  a map crediting the wrong party — keep them paired, and treat a custom attribution as
  meaningful only alongside a custom URL.
- Disabling the attribution control (e.g. `attributionControl: false`) is acceptable only
  where the credit is rendered by other means, or in a transient internal preview.
  On anything a citizen sees, it is a licence violation.

## Further reading

- [OSM wiki: Slippy map tilenames](https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames)
  — the tile-maths reference, with conversion snippets
- [OSMF tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
- [OSM wiki: Raster tile providers](https://wiki.openstreetmap.org/wiki/Raster_tile_providers)
  · [Vector tile providers](https://wiki.openstreetmap.org/wiki/Vector_tiles)
- [Mapbox Vector Tile spec](https://github.com/mapbox/vector-tile-spec) ·
  [MapLibre Style Spec](https://maplibre.org/maplibre-style-spec/)
- [Leaflet docs](https://leafletjs.com/reference.html) ·
  [MapLibre GL JS docs](https://maplibre.org/maplibre-gl-js/docs/)
