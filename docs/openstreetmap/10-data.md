# 10 — Data

## The data model

OSM has three element types. There is no polygon type, which is the consequential fact
for boundary work.

- **Node** — a point with tags.
- **Way** — an ordered node list. Closed (first == last) means an area *by tag convention
  only*: `area=yes`, `building=*`, `landuse=*` imply area; a closed `highway=*` is a loop
  road.
- **Relation** — an ordered member list, each member with a role. Relations can nest.

Therefore:

- **Administrative boundaries are relations.** Their `outer`/`inner` member ways arrive in
  arbitrary order, reversed, and split into segments shared with neighbours. Assembling
  rings is an algorithm, not a concatenation — use `osmtogeojson` / `osm2geojson`, which
  also encode the closed-way conventions.
- **Holes are `inner` members.** Point-in-polygon that ignores interior rings assigns
  points to the wrong parent.
- **IDs are weak keys.** A mapper can delete and recreate an object. Do not persist
  `relation/123` as a business key; derive your own code from a normalised name, or a
  re-import will not reconcile.
- **Sibling boundaries may overlap or leave gaps.** Every point-in-polygon assignment
  needs defined behaviour for zero matches and for several — usually
  smallest-containing-area wins, with unplaceable features reported rather than dropped.

## Tags

Freeform `key=value` UTF-8. No schema, no enforced vocabulary, only wiki convention. So
`admin_level` is a *string* (`"4"` sorts before `"10"`), any tag may be absent or
misspelled, and values change when a mapper retags.

For administrative boundaries: `type=boundary`, `boundary=administrative`,
`admin_level=2..11`, `name`, `name:en`, `int_name`, `alt_name`, `ISO3166-1` (on country
relations), `wikidata` (a stable cross-source join key when present).

Two traps:

**`name` is in the local language.** Not English. Maputo city is `name="Cidade de
Maputo"`, `name:en="Maputo City"` — so an English-sourced string matches `name:en` and not
`name`. Name lookups must match across `name`/`name:en`/`int_name`/`alt_name` or they
return zero results for non-anglophone geographies. We shipped this bug; see
[part 50](50-case-studies.md).

**`admin_level` numbers are not portable.** The same number means different things per
country, and levels are frequently non-contiguous (2, 4, 8 with nothing between):

| Level | Kenya | Mozambique | India (typical) |
|---|---|---|---|
| 4 | County | Província / Cidade | State |
| 5 | — | Distrito | — |
| 6 | Sub-county | — | District |
| 8 | Ward-ish | Bairro | Municipality |

So you cannot hardcode "wards are level 8". Discover the levels present and let an
operator name them. The [per-country tables](https://wiki.openstreetmap.org/wiki/Tag:boundary%3Dadministrative)
are on the wiki.

## Licensing

OSM data is **[ODbL 1.0](https://opendatacommons.org/licenses/odbl/)**. The standard
openstreetmap.org tiles are ODbL Produced Works; the OpenStreetMap Carto style is CC0 1.0;
third-party providers set their own terms.

1. **Attribution** — credit `© OpenStreetMap contributors` visibly on public use.
2. **Share-alike on publicly used Derivative Databases** — an adapted database that you
   publicly use must be offered under ODbL.
3. **Produced Works do not inherit share-alike** — a rendered map, screenshot or chart may
   be licensed separately, but public use still requires attribution and a notice that the
   underlying data is available under ODbL. If it came from a Derivative Database, that
   database must also be offered under ODbL.

Where the line falls for us:

| What we do | Status |
|---|---|
| Show OSM tiles + ward outlines in a UI | Produced Work — attribute, add the ODbL notice |
| Import boundaries into `boundary-service` and run on them | Internal Derivative Database — purely internal use does not trigger the public-use obligations |
| **Publish** a boundary dataset (onboarding kit, open-data release, GeoJSON endpoint) | Distributing a Derivative Database — **ODbL applies**; ship an attribution/licence note beside the file |

A file mixing OSM with a differently-licensed source needs both licences checked before
publication. Never copy from Google/Bing into OSM or an OSM-derived dataset.

## Where boundary data comes from

| Route | Freshness | Use when |
|---|---|---|
| **Region extract** (Geofabrik, BBBike) | Daily | You need one country — almost always |
| **Overpass query** | Minutes behind live | A specific tagged subset, e.g. all admin boundaries |
| **Planet dump** | Weekly + diffs | Self-hosting a global service |
| Main OSM API (`/api/0.6`) | Live | **Editing only** — bulk reading it is abuse |

Trim before importing. A country extract contains every building and tree; filtering to
boundaries turns GB into tens of MB:

```bash
osmium tags-filter -o kenya-boundaries.osm.pbf kenya-latest.osm.pbf r/boundary=administrative
osmium merge kenya-boundaries.osm.pbf mozambique-boundaries.osm.pbf -o boundaries.osm.pbf
```

The `r/` prefix means relations only; omitting it pulls in far more than you expect.
[osmium-tool](https://osmcode.org/osmium-tool/) is the modern tool;
`pyosmium-get-changes` + `osmium apply-changes` keeps a snapshot current.

### Non-OSM sources

Official administrative boundaries are a legal artefact; OSM is a crowd-sourced
approximation of one. Often the wrong source:

| Source | Licence | Notes |
|---|---|---|
| **[geoBoundaries](https://www.geoboundaries.org)** | CC BY / open | ADM0–ADM4, versioned, citable. Best general alternative |
| **[HDX](https://data.humdata.org)** COD-AB | usually CC BY | Government-endorsed sets for development/crisis countries |
| **National agency / electoral commission** | varies | The actual source of truth (Kenya: IEBC wards) |
| **[GADM](https://gadm.org)** | **non-commercial only** | Detailed, but the licence bars commercial use and redistribution |
| **[Natural Earth](https://www.naturalearthdata.com)** | public domain | Country/state only, too coarse for wards |
| **[Overture Places](https://docs.overturemaps.org/guides/places/)** | per source: CC0 / Apache-2.0 / CDLA | Consortium data blending OSM with corporate sources |

Choosing, in order: is there an official dataset? does the tenant already have GIS data?
does OSM have the depth I need? Only then OSM — whose advantage is that it needs no licence
negotiation and covers any city immediately, which is what a self-service onboarding wizard
requires. A workable default: **OSM for the upper levels and immediate onboarding; official
data for the level that carries service-delivery meaning**, backfilled later.

## Formats and hygiene

`.osm.pbf` for OSM interchange; **GeoJSON** (`[lon, lat]`, RFC 7946) for the web;
**shapefile** (a *set* of files, 10-char field names, encoding often unspecified) is what
agencies ship; **GeoPackage** is its better replacement. `ogr2ogr` converts anything;
[mapshaper](https://mapshaper.org) simplifies and repairs; [Turf.js](https://turfjs.org)
does in-browser geometry.

GeoJSON's `[longitude, latitude]` order contradicts almost every other API's "lat, lng".
If features land off West Africa or in the wrong hemisphere, check this first.

Before importing real-world data:

1. **Reproject** to EPSG:4326 and verify a known point.
2. **Validate** — self-intersections and unclosed rings break point-in-polygon
   (`ST_MakeValid`, mapshaper `-clean`).
3. **Decide on MultiPolygon.** Many consumers, ours included, accept only `Polygon`.
   Collapsing to the largest ring **loses territory** — an island ward silently shrinks.
4. **Simplify for display**, keep full precision for point-in-polygon. Hundreds of
   polygons at hundreds of vertices will stall a browser.
5. **Normalise join keys** — strip diacritics (NFD + combining-mark removal), uppercase,
   collapse punctuation. `Ndaraweta` / `NADARAWETA` / `Ndaraweta Ward` are one place to a
   human and three keys to a computer. Prefer official codes; report what did not match.
6. **Count against the authority** — "IEBC says 25 wards in Bomet; I have 25".

Areas and distances computed on raw lon/lat degrees are distorted — tolerable for
city-scale centroids, but project first to compare areas or distances.
