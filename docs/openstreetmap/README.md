# OpenStreetMap in CCRS

> Reference for the OpenStreetMap (OSM) ecosystem and how CCRS uses it. Parts 10–50
> are deliberately **vendor- and product-neutral**: they describe the data, the APIs,
> the rendering stack and the hosting options as they exist in the wider OSM world, so
> they stay true regardless of what our code does. Part 60 is the only part that
> describes the CCRS implementation, and it is the only part that goes stale when we
> ship.
>
> Written because every geospatial feature we have — citizen complaint pin maps,
> configurator boundary onboarding, dashboard choropleths — sits on OSM, and the
> knowledge was spread across five code paths, three READMEs and a lot of tribal
> memory.

## The parts

| Part | Covers | Read it when |
|---|---|---|
| [10 — Fundamentals](10-osm-fundamentals.md) | What OSM data actually is: nodes/ways/relations, tags, `admin_level`, the licence and what attribution it obliges | You are about to treat OSM as a database and want to know what it does and does not guarantee |
| [20 — Data sources](20-data-sources.md) | Planet, country extracts, Overpass, and the non-OSM alternatives (geoBoundaries, GADM, HDX, national mapping agencies) | You need administrative boundaries for a new city or country |
| [30 — APIs](30-apis.md) | Overpass (query), Nominatim (geocoding), routing engines — endpoints, query shapes, quotas, and the usage policies that bind us | You are writing code that calls an OSM service |
| [40 — Rendering](40-rendering.md) | Raster vs vector tiles, tile maths, Leaflet/MapLibre/OpenLayers, the tile provider landscape and its terms | You are putting a map on a screen |
| [50 — Self-hosting](50-self-hosting.md) | Running your own Overpass, Nominatim, geocoder and tile server: images, sizing, update strategy | Public services are too slow, too rate-limited, or not allowed for your deployment |
| [60 — CCRS implementation](60-ccrs-implementation.md) | Every place CCRS touches OSM, with file paths, endpoints, feature flags, and the known gaps | You are changing or debugging our geo code |

Adjacent docs, not duplicated here:

- [`docs/map-config.md`](../map-config.md) — the `RAINMAKER-PGR.MapConfig` MDMS master
  (basemap, start position, ward colours, geocode scoping). The **configuration
  surface**; this guide is the **technology** underneath it.
- [`overpass/README.md`](../../overpass/README.md) — operator runbook for our
  self-hosted Overpass.
- [`turbopass/README.md`](../../turbopass/README.md) — operator runbook for our
  place-name autocomplete service.

## The 60-second version

OSM is a single global, community-maintained, tagged geodatabase under the **ODbL**
licence. You never query "the" OSM database in production — you pick one of four
access patterns, and the choice is the whole engineering decision:

| Pattern | Service | Good for | Wrong for |
|---|---|---|---|
| Query live data by tag/area | **Overpass API** | "give me every `boundary=administrative` relation inside Kenya" — onboarding, one-off extraction | Per-keystroke or per-page-view calls |
| Address ⇄ coordinate | **Nominatim** and friends | Reverse-geocoding a dropped pin | Type-ahead autocomplete (**explicitly forbidden** by policy) |
| Draw a basemap | **Tile servers** | Every map you show a user | Bulk prefetch / offline caches off community tiles |
| Own the whole dataset | **Planet / extracts** | Analytics, self-hosting, reproducibility | Anything needing minute-fresh edits |

Three rules that catch everyone, in decreasing order of how often we have broken them:

1. **The free public services are not a production backend.** They are
   community-funded, have no SLA, and will rate-limit or block you. Anything on the
   citizen-facing hot path either gets self-hosted or gets a paid provider.
2. **Attribution is a licence obligation, not a nicety.** `© OpenStreetMap
   contributors` must be visible on every map. Derived data you publish inherits ODbL
   share-alike terms.
3. **OSM completeness is wildly uneven.** Nairobi and Maputo have clean multi-level
   administrative hierarchies; a given Kenyan ward may not exist in OSM at all. Always
   have a non-OSM fallback source for boundaries (see [part 20](20-data-sources.md)).

## Where CCRS stands today

Summarised from [part 60](60-ccrs-implementation.md), as of this document:

| Service | Where we call it | Hosting | Assessment |
|---|---|---|---|
| Overpass | configurator boundary onboarding (operator-triggered) | **self-hostable** (`enable_overpass`), public fallback | Healthy — the flag exists and works |
| Place autocomplete | configurator boundary search | **self-hosted only** (`enable_turbopass`) | Healthy — and the reason we do not autocomplete against Nominatim |
| Nominatim | citizen pin reverse-geocode + address search | **public service, always** | **The main exposure.** On the citizen hot path, no self-host option, no custom `User-Agent` |
| Basemap tiles | every map | **public CARTO / OSM tiles, always** | Keyless courtesy endpoints, no self-host option |

So the honest summary: the *operator-side* OSM dependencies have been hardened, and
the *citizen-side* ones have not. Part 60 lists the specific gaps.
