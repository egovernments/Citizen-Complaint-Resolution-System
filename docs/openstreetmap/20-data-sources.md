# 20 — Data sources

Where geodata actually comes from. This part is about **acquiring** data; [part 30](30-apis.md)
is about **querying** it at runtime.

## The five ways to get OSM data

| Route | Size | Freshness | Use when |
|---|---|---|---|
| **Planet dump** | ~80 GB `.osm.pbf`, growing | Weekly, plus minutely diffs | You are self-hosting a global service |
| **Region extract** (Geofabrik, BBBike) | MB–GB | Daily | You need one country/city, which is almost always |
| **Overpass query** | KB–MB | Minutes behind live | You need a specific tagged subset, e.g. all admin boundaries |
| **Main OSM API** (`/api/0.6`) | small | Live | **Editing only.** Not for bulk reads — it is the editing API and reading it in bulk is abuse |
| **Third-party derived** (geoBoundaries, HDX) | small | Snapshot | You want a curated, citable boundary set rather than raw OSM |

### Planet and diffs

- <https://planet.openstreetmap.org> — full planet in `.osm.pbf` (binary, compact) and
  `.osm.bz2` (XML, larger). Use PBF unless a tool demands XML. Mirrors are listed on
  the wiki; use a mirror, not the origin, for repeated pulls.
- **Diffs** let you keep a local copy current without re-downloading: minutely, hourly
  and daily `.osc.gz` change files. `pyosmium-get-changes` downloads and combines
  changes; apply the result to a snapshot with `osmium apply-changes` (or feed it to
  the updater for your target database). `osmosis` can also run an update pipeline.
- Rule of thumb: a full planet download plus import is a multi-hour-to-multi-day
  operation. Do not put it on a critical path you have not rehearsed.

### Region extracts — the default choice

- **[Geofabrik](https://download.geofabrik.de)** — the standard. Per-continent,
  per-country, per-state `.osm.pbf`, refreshed daily, plus `.poly` boundary files for
  re-clipping. Stable, predictable URL shape:
  `https://download.geofabrik.de/africa/kenya-latest.osm.pbf`.
- **[BBBike](https://extract.bbbike.org)** — arbitrary custom bounding-box extracts in
  many formats, delivered by email. Good for a single city.
- **[Protomaps](https://protomaps.com)** / **[osm.pbf mirrors](https://wiki.openstreetmap.org/wiki/Planet.osm#Downloading)**
  — alternative extract sources.

### Trimming an extract

A country extract contains everything — every building, tree and bus stop. If you only
want administrative boundaries, filter before importing; it turns a multi-GB file into
tens of MB and cuts import time by an order of magnitude.

```bash
# keep only administrative-boundary objects, with the referenced geometry
osmium tags-filter -o kenya-boundaries.osm.pbf kenya-latest.osm.pbf \
  r/boundary=administrative

# merge several countries into one file for a single service instance
osmium merge kenya-boundaries.osm.pbf mozambique-boundaries.osm.pbf \
  -o boundaries.osm.pbf
```

Tool notes:

- **[osmium-tool](https://osmcode.org/osmium-tool/)** — the modern one. `tags-filter`,
  `extract` (by bbox/poly), `merge`, `sort`, `cat`, `fileinfo`. Fast, well documented.
- **[osmosis](https://wiki.openstreetmap.org/wiki/Osmosis)** — older Java tool, still
  the reference for applying diffs.
- `r/boundary=administrative` means "relations with this tag"; prefix with `n/`, `w/`
  or nothing for all types. Omitting the prefix pulls in far more than you expect.

## Non-OSM sources for administrative boundaries

OSM is often *not* the best source for official administrative boundaries, because
official boundaries are a legal artefact and OSM is a crowd-sourced approximation of
one. Know these alternatives:

| Source | Coverage | Licence | Notes |
|---|---|---|---|
| **[geoBoundaries](https://www.geoboundaries.org)** | Global, ADM0–ADM4 | CC BY / open | Academic, citable, versioned. Best general-purpose alternative to OSM; explicitly designed for comparability |
| **[GADM](https://gadm.org)** | Global, to level 5 | **Non-commercial only** | High detail but the licence bars commercial/redistribution use — check before touching |
| **[Natural Earth](https://www.naturalearthdata.com)** | Global, coarse | Public domain | Country/state level, cartographic generalisation. Too coarse for wards |
| **[HDX](https://data.humdata.org)** (OCHA) | Crisis/dev countries | Varies, usually CC BY | Hosts national **COD-AB** (Common Operational Datasets — Administrative Boundaries), typically the government-endorsed set |
| **National mapping agency / electoral commission** | One country, authoritative | Varies | The real source of truth. In Kenya, IEBC ward boundaries; in most countries, a national statistics or survey office |
| **[Overture Places](https://docs.overturemaps.org/guides/places/)** (`place` feature type) | Global | Per source: CC0-1.0, Apache-2.0, or CDLA-Permissive-2.0 | Point representations of businesses, services, and landmarks; inspect each feature's `sources` metadata. Not an administrative-boundary source |
| **[Who's On First](https://whosonfirst.org)** | Global gazetteer | CC0/varies | Good for place-name hierarchies rather than precise geometry |

### Choosing between them

Ask these in order:

1. **Is there an official government dataset?** If yes, prefer it — the platform makes
   legal/administrative decisions and should match the legal boundary. This is why our
   Kenyan ward work uses IEBC-derived data rather than OSM.
2. **Does the tenant already have GIS data?** Municipalities frequently do. An
   operator-provided shapefile beats every public source.
3. **Do I need depth OSM lacks?** Below district level, OSM coverage thins fast. Check
   before committing to an OSM-only path.
4. **Only then, OSM.** Its advantages are real: no licence negotiation, uniform tagging,
   queryable by API, and instant availability for any city in the world — which is
   exactly what a self-service onboarding wizard needs.

A pragmatic default for a new tenant: **OSM for the upper levels and for immediate
self-service onboarding; official data for the level that actually carries the
service-delivery meaning** (the ward, the bairro), backfilled later.

## Formats and conversion

| Format | Use | Notes |
|---|---|---|
| `.osm.pbf` | OSM interchange | Binary protobuf, compact, the default for extracts |
| `.osm` / `.osm.bz2` | OSM XML | Human-readable, 5–10× larger. Some tools only take this |
| **GeoJSON** | Web interchange | `[lon, lat]`. RFC 7946. What browsers and most APIs speak |
| **Shapefile** (`.shp` + `.dbf` + `.prj` + …) | GIS legacy | A *set* of files, must be zipped together. Attribute names truncated to 10 chars; encoding often unspecified. What government agencies ship |
| **GeoPackage** (`.gpkg`) | GIS modern | Single SQLite file, no field-name limits. Prefer over shapefile when offered |
| **PMTiles / MBTiles** | Tile archives | A whole tileset as one file — see [part 40](40-rendering.md) |
| **WKT / WKB** | Database geometry | What PostGIS and most geometry columns store |

Conversion tools:

- **[GDAL/OGR](https://gdal.org)** (`ogr2ogr`) — the universal converter. Shapefile →
  GeoJSON, reprojection, filtering, format detection. If you learn one geo tool, this.
  ```bash
  ogr2ogr -f GeoJSON -t_srs EPSG:4326 wards.geojson Kenya_Wards.shp
  ```
- **[osmtogeojson](https://github.com/tyrasd/osmtogeojson)** — Overpass/OSM JSON →
  GeoJSON, correctly applying the closed-way-is-an-area conventions and stitching
  multipolygon relations. Available as a JS library and a CLI.
- **[osm2geojson](https://pypi.org/project/osm2geojson/)** — Python equivalent.
- **[mapshaper](https://mapshaper.org)** — simplification, topology-preserving
  dissolve, and repair. Essential when polygons are too heavy for the browser.
- **[Turf.js](https://turfjs.org)** — in-browser geometry ops (point-in-polygon, area,
  centroid, bbox).

### Geometry hygiene before you import

Real-world boundary data arrives dirty. Check and fix, in this order:

1. **Coordinate order and CRS.** Reproject to EPSG:4326; verify a known point.
2. **Validity.** Self-intersections and unclosed rings break point-in-polygon.
   `ST_IsValid`/`ST_MakeValid` in PostGIS, or mapshaper's `-clean`.
3. **MultiPolygon vs Polygon.** Many consumers (including our `boundary-service`)
   accept only `Polygon`. Decide deliberately: collapse to the largest ring, or fix the
   consumer. Collapsing **loses territory** — an island ward silently shrinks.
4. **Vertex count.** A ward outline with 1,500 points × 200 wards will stall a browser.
   Simplify (Douglas–Peucker via mapshaper, `-simplify 10% keep-shapes`) for display,
   keep full precision for point-in-polygon.
5. **Name/code join keys.** Normalise for matching: strip diacritics (NFD +
   combining-mark removal), uppercase, collapse whitespace/punctuation to `_`.
   `Ndaraweta` vs `NADARAWETA` vs `Ndaraweta Ward` are the same place to a human and
   three different keys to a computer. Prefer joining on an official code where one
   exists; fall back to normalised names and **report** what did not match.
6. **Coverage check.** Do the children tile the parent? Count features against the
   authoritative count (e.g. "IEBC says 25 wards in Bomet; I have 25").

## Further reading

- [OSM wiki: Downloading data](https://wiki.openstreetmap.org/wiki/Downloading_data)
- [OSM wiki: Planet.osm](https://wiki.openstreetmap.org/wiki/Planet.osm)
- [OSM wiki: Boundaries](https://wiki.openstreetmap.org/wiki/Boundaries)
- [Geofabrik download server](https://download.geofabrik.de)
- [RFC 7946 — The GeoJSON Format](https://datatracker.ietf.org/doc/html/rfc7946)
