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
| `overture-scraper/` | Builds the offline boundary DB from Overture Maps (`bootstrap.sh`); `coverage.py` |
| `data/`, `scraper/` | Name hierarchies for the legacy Trie `/search`, vendored from dhruv-1001/osm-mapped-data |
| `docker-compose.yml` | The one-shot `bootstrap` and the `search-api` |

## Sources

| `source=` | Backed by | Needs |
|---|---|---|
| `overture` (default) | Offline SQLite DB built from Overture Maps divisions | The DB (below). No network or key at query time. |
| `geoapify` | Hosted Geoapify API | `GEOAPIFY_API_KEY` on the service; every call spends that key's quota |

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

`overture-scraper/bootstrap.sh`, the bootstrap image's entrypoint, runs four steps and exits
non-zero if any fails — it never reports "ready" over an empty DB:

1. `scrape.py` reads Overture's `division_area` parquet on S3 for the requested countries.
2. `apply_admin_levels.py`: Overture numbers admin levels only down to county (country 0,
   region 1, county 2); this sets locality 3, macrohood 4, neighborhood 5, microhood 6.
3. `build_hierarchy.py` drops maritime duplicates — Overture ships every country and some
   coastal regions twice under one division, land plus territorial sea, and the land area is
   kept. It then links each area to its parent (centroid inside the polygon, same country,
   nearest shallower level), simplifies the geometry and indexes the table.
4. `verify_db.py` checks every requested country is present with a root, at least 90% of
   areas have a parent, and no division has two areas.

| Variable | Default | |
|---|---|---|
| `COUNTRIES` (`TURBOPASS_COUNTRIES` in compose) | `IN,KE,MZ` | ISO 3166-1 alpha-2 codes |
| `OVERTURE_RELEASE` | newest in the bucket | Overture keeps only its last few releases; a pinned release that has gone is a hard error |
| `SIMPLIFY_TOLERANCE` | `0.0001` (about 11 m) | `0` keeps full resolution |
| `OVERTURE_DB_PATH` | `../overture-data/boundaries.sqlite` | |

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
| `source` | `overture` | or `geoapify` |
| `match` | `substring` | `exact`, `prefix`, `substring`, or `fuzzy` (one typo up to 6 letters, two beyond) |
| `limit` | `10` | 1–50 |
| `min_descendants` | `0` | Only places with at least this many areas inside. The configurator sends `1`: a place with nothing inside can't form a hierarchy. |

`match`, `limit` and `min_descendants` apply to `overture`. Results rank exact → prefix →
substring → fuzzy, then broadest place first; matching ignores case and accents. Each result
carries `place_id`, `name`, `subtype`, `admin_level`, `parent_name`, `region_name`,
`country_name`, `descendant_count`, `match_type`, and a `formatted` label that tells
same-name places apart ("Delhi — region, India"). Search results have a GeoJSON `bbox`
(`[west, south, east, north]`) but no polygons — `geometry` is `null`.

`GET /boundary/fetch?id=<place_id>` — the place and every area inside it, with polygons. A
place with more than `FETCH_MAX_FEATURES` areas inside is refused with `413`, naming the count.

`GET /health` — `sources` (which of `overture` / `geoapify` can answer here) and `overture`
(release, countries, build time, number of places).

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
| `VITE_TURBOPASS_SOURCE` | `overture` | |
| `VITE_TURBOPASS_MATCH` | `substring` | The `match` mode the configurator sends |

## Adding countries

Add ISO codes to `TURBOPASS_COUNTRIES` (or `COUNTRIES`) and re-run the bootstrap; it rebuilds
the DB from scratch. Check `coverage.py` first.
