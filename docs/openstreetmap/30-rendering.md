# 30 — Rendering

## Tiles

Web maps are a pyramid of 256 px squares in **Web Mercator (EPSG:3857)**, addressed
`{z}/{x}/{y}`. At zoom `z` there are `2^z × 2^z` tiles — `z=19` is ~275 billion globally,
which is why "pre-render the world" is not a plan. `y` increases **south** in the standard
XYZ scheme (TMS flips it; a vertically mirrored map is usually this). Ground resolution at
the equator ≈ `156543 / 2^z` m/px: `z=13` a town, `z=16` a street, `z=19` a building.

Two template placeholders: `{s}` is a subdomain rotation for HTTP/1.1 connection limits,
**obsolete under HTTP/2** and retired by the OSM Foundation in favour of plain
`tile.openstreetmap.org`; `{r}` is Leaflet's retina placeholder, expanding to `@2x`.

## Raster vs vector

| | Raster | Vector (MVT) |
|---|---|---|
| Styling | Baked in at render time | Applied in the client, changeable at runtime |
| **Label language** | **Fixed when rendered** | **Switchable at runtime** |
| Rotation / tilt | No | Yes |
| Ops complexity | Low | Style JSON, glyphs, sprites |

For a multi-language municipal platform, runtime label localisation is the strongest
argument for vector: raster tile labels cannot follow the user's locale, so a Swahili or
Portuguese UI still shows English map labels. That is the one constraint here that has
actually bitten us — see [part 40](40-cms-implementation.md).

## Libraries

DIGIT CMS uses **[Leaflet](https://leafletjs.com) 1.9** everywhere, called directly rather than
through `react-leaflet` in newer code — the repo carries several React majors and
`react-leaflet` couples to specific ones, failing at runtime rather than at build.
[MapLibre GL JS](https://maplibre.org) (BSD-3, the open fork of Mapbox GL JS v1) is the
vector option if we migrate; Mapbox GL JS v2+ is proprietary and needs a token.

## Providers

| Provider | Key? | Terms |
|---|---|---|
| **OSMF** `tile.openstreetmap.org` | No | Community-funded, best-effort, [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) |
| **[CARTO](https://carto.com/basemaps)** basemaps CDN | No | Keyless courtesy service under CARTO's own terms — not an SLA'd endpoint |
| **[MapTiler](https://www.maptiler.com)**, **[Stadia](https://stadiamaps.com)**, **[Thunderforest](https://www.thunderforest.com)** | Yes | Raster + vector with free tiers |
| **[Protomaps](https://protomaps.com)**, **[OpenFreeMap](https://openfreemap.org)** | No | Vector; Protomaps ships PMTiles you host yourself |

The OSMF policy requires HTTPS, a **unique `User-Agent`** naming the app (generic library
defaults are blocked), a preserved `Referer` from browsers, caching for **≥7 days**, **no
bulk prefetch or offline archives**, and visible attribution. It also states availability
is best-effort with no SLA — which makes it unsuitable as the tile backend for a
public-facing government platform at real traffic.

## Attribution

- OSMF raster: `© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors`
- Provider styles: both parties, e.g. `© CARTO © OpenStreetMap contributors`
- **A custom tile URL and its attribution are a pair.** Configuration that lets them be set
  independently will eventually credit the wrong party — which is why
  [`docs/map-config.md`](../map-config.md) honours a custom `tileAttribution` only alongside
  a custom `tileUrl`.
- Disabling the attribution control is acceptable only in a transient internal preview.
  On a citizen surface it is a licence violation.

## Reference

[Slippy map tilenames](https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames) ·
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/) ·
[MapLibre Style Spec](https://maplibre.org/maplibre-style-spec/)
