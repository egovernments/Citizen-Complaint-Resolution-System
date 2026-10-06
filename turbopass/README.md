# Turbopass

Boundary search and fetch for the configurator's Phase 2 "fetch boundaries" flow. An
operator types a place name, picks it, and gets that place's administrative hierarchy with
polygons — no spreadsheet.

Turbopass runs as **its own service**, apart from any DIGIT deployment: one instance can
serve every configurator. The Ansible playbook's `enable_turbopass` can also run it on a
DIGIT box, which suits a single box or local testing.

| Path | What |
|---|---|
| `search-api/` | NestJS service: `/boundary/search`, `/boundary/fetch`, `/health`, and the legacy `/search`. Port 3000. |
| `overture-scraper/` | Builds the offline boundary DB from Overture Maps plus the official sets (`bootstrap.sh`); `coverage.py` |
| `data/`, `scraper/` | Name hierarchies for the legacy Trie `/search`, vendored from dhruv-1001/osm-mapped-data |
| `docker-compose.yml` | The one-shot `bootstrap` and the `search-api` |

## Sources

| `source=` | Backed by | Needs |
|---|---|---|
| `overture` (API default) | Offline SQLite DB built from Overture Maps divisions | The DB (below). No network or key at query time. |
| `official` | Per country, whichever of `cod` / `geoboundaries` nests deepest | The DB, built with the official step (on by default) |
| `cod` | OCHA COD-AB from HDX — national statistics / mapping offices, curated by OCHA | same |
| `geoboundaries` | geoBoundaries gbOpen | same |
| `geoapify` | Hosted Geoapify API | `GEOAPIFY_API_KEY` on the service; every call spends that key's quota |

**Why the official sets.** Evaluated for the 12 priority countries (#1994), COD-AB and
geoBoundaries nest perfectly (no orphans, full coverage) and go 1–2 levels deeper than
Overture, whose divisions are largely OpenStreetMap and stop at county level in most of
Africa. Neither is always better: COD wins in Burundi (only source with the 2025 reform),
Mozambique and Ethiopia; geoBoundaries in Rwanda (COD's ADM4 is cut off at 1,000 rows),
Kenya, Benin and India (no COD). The bootstrap measures this per country instead of
hard-coding it, so `official` follows the data when either source updates.

**Licences travel with the data.** Every official row carries its dataset's licence
(`licence` in search and fetch results, per country in `/health`). COD-AB is CC BY-IGO;
geoBoundaries varies by level — public domain, CC BY, or ODbL (share-alike). Credit the
source wherever the boundaries are shown; the configurator prints the line on its level
screen.

## Run it

```bash
cd turbopass
docker compose --profile bootstrap run --rm bootstrap   # 1. build the DB (~15 min, network-bound)
docker compose up -d search-api                         # 2. serve it
curl -s localhost:3000/health | jq .
```

CI (`.github/workflows/turbopass-build.yml`, which runs only when this directory changes)
publishes `egovio/turbopass-search` and `egovio/turbopass-bootstrap`. Add `--build` to build
from the checkout instead.

## Build the boundary DB

`overture-scraper/bootstrap.sh`, the bootstrap image's entrypoint, runs five steps and exits
non-zero if any fails — it never reports "ready" over an empty DB. It builds into
`boundaries.sqlite.building` next to the served file and renames it into place only after step 5
passes, so a failed or interrupted rebuild leaves the served DB untouched. search-api keeps
serving the DB it opened until it restarts; restart it to serve the new one.

1. `scrape.py` reads Overture's `division_area` parquet on S3 for the requested countries.
2. `apply_admin_levels.py`: Overture numbers admin levels only down to county (country 0,
   region 1, county 2); this sets locality 3, macrohood 4, neighborhood 5, microhood 6.
3. `build_hierarchy.py` drops maritime duplicates — Overture ships every country and some
   coastal regions twice under one division, land plus territorial sea, and the land area is
   kept. It then links each area to its parent (centroid inside the polygon, same country,
   nearest shallower level), simplifies the geometry and indexes the table.
4. `official.py` adds OCHA COD-AB (HDX package `cod-ab-<iso3>`) and geoBoundaries (gbOpen
   API) for the same countries. Each level is kept only if it covers at least
   `MIN_LEVEL_COVERAGE` of the level above (equal-area, slivers under 100 m ignored) with at
   most `MAX_LEVEL_ORPHANS` of its areas outside it; a failed level is dropped and the next
   one is checked against the last level kept. ADM1 hangs off the country; below that, COD
   links by parent P-code and anything else by the polygon holding the area's interior
   point. The source whose kept levels go deepest becomes the country's `official` set
   (ties: more areas, then an "enhanced" COD, then COD). COD sets built from GADM, whose
   licence forbids commercial use, are skipped unless `ALLOW_GADM_DERIVED=1`. What was
   kept, dropped and why is in the `official_datasets` table and the log.
5. `verify_db.py` checks every requested country is present with a root, at least 90% of
   Overture areas have a parent, no division has two areas, and — unless
   `OFFICIAL_SOURCES=none` — official rows all reach a parent. A country without a usable official set
   is a warning and stays Overture-only; the run fails only if no country got one (an outage).

| Variable | Default | |
|---|---|---|
| `COUNTRIES` (`TURBOPASS_COUNTRIES` in compose) | `IN,KE,MZ` | ISO 3166-1 alpha-2 codes |
| `OVERTURE_RELEASE` | newest in the bucket | Overture keeps only its last few releases; a pinned release that has gone is a hard error |
| `SIMPLIFY_TOLERANCE` | `0.0001` (about 11 m) | `0` keeps full resolution |
| `OVERTURE_DB_PATH` | `../overture-data/boundaries.sqlite` | |
| `OFFICIAL_SOURCES` | `cod,geoboundaries` | `none` skips step 4 |
| `MIN_LEVEL_COVERAGE` | `0.90` | Share of the parent level a level must cover to be kept |
| `MAX_LEVEL_ORPHANS` | `0.02` | Share of a level's areas allowed outside every parent (they are dropped) |
| `MAX_LEVEL_FEATURES` | `100000` | A geoBoundaries level with more areas is skipped without downloading (India ADM5: 649,771 areas, 1 GB) |
| `ALLOW_GADM_DERIVED` | `0` | `1` keeps GADM-derived COD sets (Djibouti) — not for commercial use |

`overture-data/` is gitignored.

**Which countries can be onboarded?** `coverage.py` counts Overture's division areas per
country and subtype without downloading any geometry:

```bash
docker compose --profile bootstrap run --rm --entrypoint python3 bootstrap coverage.py
```

A country whose data stops at region level gives operators a two-level hierarchy at best.

## API

`GET /boundary/search?q=<name>`

| Param | Default | |
|---|---|---|
| `source` | `overture` | `official`, `cod`, `geoboundaries`, or `geoapify` |
| `match` | `substring` | `exact`, `prefix`, `substring`, or `fuzzy` (one typo up to 6 letters, two beyond) |
| `limit` | `10` | 1–50 |
| `min_descendants` | `0` | Only places with at least this many areas inside. The configurator sends `1`: a place with nothing inside can't form a hierarchy. |

`match`, `limit` and `min_descendants` apply to the offline sources. Results rank exact → prefix →
substring → fuzzy, then broadest place first; matching ignores case and accents. Each result
carries `place_id`, `name`, `subtype`, `admin_level`, `level_name`, `parent_name`, `region_name`,
`country_name`, `descendant_count`, `match_type`, `source`, `licence`, and a `formatted`
label that tells same-name places apart ("Delhi — region, India", "Westlands — Sub-county,
Nairobi, Kenya"). Official places have subtype `ADM1`, `ADM2`, ... and ids
`<source>:<ISO3>:<P-code or shapeID>`. Search results have a GeoJSON `bbox`
(`[west, south, east, north]`) but no polygons — `geometry` is `null`.

`GET /boundary/fetch?id=<place_id>&source=<source>` — the place and every area inside it, with
polygons, `admin_level`, `depth`, `level_name`, `source`, `licence` and (COD) `pcode`. A place with
more than `FETCH_MAX_FEATURES` areas inside is refused with `413`, naming the count; an id that
isn't in that source answers `404`.

**Levels across sources.** Each source numbers levels its own way (`admin_level`: ADM number for
the official sets, 0–6 for Overture, OpenStreetMap's 2–10 for Geoapify). `depth` renumbers one
fetch consecutively — 0 is the fetched place, then 1, 2, … for each level present — so clients can
show "Level 1, 2, 3" for any source. `level_name` is the level's local name ("County", "Ward") for
the official sets of the 12 #1994 priority countries (`search-api/src/level-names.ts`); it is
`null` elsewhere, and always for Overture and Geoapify, whose levels don't follow the national
structure consistently.

Geoapify responses are translated into these same fields (no `descendant_count` or `level_name`;
`licence` credits OpenStreetMap), so every source returns one shape.

`GET /health` — `sources` (which of `overture` / `official` / `cod` / `geoboundaries` /
`geoapify` can answer here), `overture` (release, countries, build time, number of places) and
`official` (per country: source, licence, dataset date, levels kept, the set not chosen).

## Configuration

| Variable | Default | |
|---|---|---|
| `OVERTURE_DB_PATH` | `/overture-data/boundaries.sqlite` in the image | Without the DB, `overture` answers 503; the service still starts |
| `GEOAPIFY_API_KEY` | — | Enables `source=geoapify` |
| `GEOAPIFY_RATE_LIMIT` | `120` | Geoapify calls per minute, across all callers; `0` = off |
| `FETCH_MAX_FEATURES` | `5000` | Largest `/boundary/fetch`; `0` = off |
| `CORS_ORIGINS` | `*` | Comma-separated origins. Set it on a central instance that holds a Geoapify key. |
| `DATA_DIR` | `/data` | Vendored hierarchies for the legacy `/search` |

## Configurator side

| Build variable | Default | |
|---|---|---|
| `VITE_TURBOPASS_URL` | `/turbopass` | Same-origin path (nginx proxies it), or the central service's URL |
| `VITE_TURBOPASS_SOURCE` | — | The source Phase 2 starts on. Unset: `official` when the server's `/health` lists it, else `overture`. Operators can switch in Phase 2's **Boundary source** picker, which lists every source `/health` reports; a place is always fetched from the source that found it. |
| `VITE_TURBOPASS_MATCH` | `substring` | The `match` mode the configurator sends |

## Adding countries

Add ISO codes to `TURBOPASS_COUNTRIES` (or `COUNTRIES`) and re-run the bootstrap; it rebuilds
the DB from scratch. Check `coverage.py` first.
