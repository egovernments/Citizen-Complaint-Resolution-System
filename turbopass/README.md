# Turbopass

Turbopass is the boundary backend for the configurator's Phase 2 **OSM boundary fetch**. Instead of the operator hand-authoring a boundaries `.xlsx`, the configurator queries Turbopass as they type a city name, then resolves the selected place's full administrative boundary **hierarchy + GeoJSON geometry** straight into the DIGIT boundary payload.

It serves boundaries from three interchangeable sources:

| `source=` | Backend | Needs |
|---|---|---|
| `overture` | **Self-hosted offline** SQLite DB built from [Overture Maps](https://overturemaps.org/) divisions | The bootstrap pipeline (below). No network at query time. |
| `geoapify` | Hosted [Geoapify](https://www.geoapify.com/) geocoding + boundaries API | `GEOAPIFY_API_KEY` on the service. |
| _(legacy `/search`)_ | In-memory **Trie** over the committed `data/**/hierarchy.json` | Nothing — data is vendored. Fuzzy name autocomplete only, no geometry. |

The rest of this README covers the **Overture offline path** — the recommended, no-external-dependency way to run Turbopass for the P0 countries (**India, Kenya, Mozambique**).

> The `scraper/` (Overpass) directory and `data/` hierarchies are vendored from [dhruv-1001/osm-mapped-data](https://github.com/dhruv-1001/osm-mapped-data) at the commit in [`.vendored-from`](.vendored-from). Keep diffs against those minimal.

## Layout

| Path | What it is |
|---|---|
| `search-api/` | NestJS service. Serves `/boundary/search`, `/boundary/fetch`, legacy `/search`, `/health`. Listens on `:3000`. |
| `overture-scraper/` | The offline data pipeline: `scrape.py` → `apply_admin_levels.py` → `build_hierarchy.py`, wrapped by `bootstrap.sh`. |
| `data/` | Vendored Trie hierarchies (`<Continent>/<Country>/hierarchy.json`) for the legacy `/search`. |
| `scraper/` | Vendored local Overpass instance used to (re)generate `data/`. See `scraper/README.md`. |
| `overture-data/` | **Generated, gitignored.** `boundaries.sqlite` (~1GB) produced by the bootstrap pipeline. |
| `docker-compose.yml` | Bootstrap the DB and run the service. |

## API contract

```
GET /boundary/search?q=<term>&source=overture|geoapify
→ GeoJSON FeatureCollection of matching places (properties.place_id is the fetch id)

GET /boundary/fetch?id=<place_id>&source=overture|geoapify
→ GeoJSON FeatureCollection: the place plus its full nested admin hierarchy

GET /health
→ { status: "ok", locationsLoaded: <n> }
```

The configurator calls this through a same-origin base path, default `/turbopass` (override via Vite env `VITE_TURBOPASS_URL`), and picks the source via `VITE_TURBOPASS_SOURCE` (`geoapify` by default; set to `overture` for the offline DB).

---

## Deploy with Docker Compose (recommended)

Everything runs from this directory. Requires Docker with Compose v2.

### 1. Bootstrap the boundary data (one-time, ~1GB download)

```bash
docker compose --profile bootstrap up --build bootstrap
```

This runs the full pipeline (scrape Overture S3 → assign synthetic admin levels → compute the spatial parent/child hierarchy) and writes `./overture-data/boundaries.sqlite`. The `bootstrap` profile keeps it out of the default `up`, so the multi-GB download only happens when you ask for it.

Retarget the countries (ISO 3166-1 alpha-2, comma-separated) without editing any file:

```bash
TURBOPASS_COUNTRIES="IN,KE,MZ,ZA" docker compose --profile bootstrap up --build bootstrap
```

### 2. Run the service

```bash
docker compose up -d --build search-api
```

The API is now on `http://localhost:3000` (override the host port with `TURBOPASS_PORT`). Verify:

```bash
curl -s "http://localhost:3000/health" | jq .
curl -s "http://localhost:3000/boundary/search?q=Maputo&source=overture" | jq '.features[].properties.name'
# Fetch a hierarchy (Maputo City → Distritos → Bairros):
curl -s "http://localhost:3000/boundary/fetch?id=e93d7baf-bdc6-4182-8b2b-1ef8a9b21a34&source=overture" | jq '.features | length'
```

### 3. Point the configurator at it

Set `VITE_TURBOPASS_SOURCE=overture` (and `VITE_TURBOPASS_URL` if the service isn't same-origin `/turbopass`) in the configurator's build env, then use Phase 2's OSM boundary fetch as normal.

### Environment variables

| Var | Where | Default | Purpose |
|---|---|---|---|
| `TURBOPASS_COUNTRIES` | compose (bootstrap) | `IN,KE,MZ` | Countries to scrape. |
| `OVERTURE_RELEASE` | compose (bootstrap) | `2026-06-17.0` | Overture Maps release tag. |
| `TURBOPASS_PORT` | compose (search-api) | `3000` | Host port. |
| `GEOAPIFY_API_KEY` | compose (search-api) | _(unset)_ | Enables `source=geoapify`. |
| `OVERTURE_DB_PATH` | search-api / scripts | `/overture-data/boundaries.sqlite` (container) | SQLite DB location. |
| `DATA_DIR` | search-api | `/data` (container) | Trie data dir for legacy `/search`. |

---

## Run without Docker (local dev)

Bootstrap the DB on the host (creates a `venv` and installs `overture-scraper/requirements.txt` automatically):

```bash
cd overture-scraper
./bootstrap.sh                      # or: COUNTRIES="IN,KE,MZ,ZA" ./bootstrap.sh
```

Then run the API against the DB it produced (`../overture-data/boundaries.sqlite`):

```bash
cd ../search-api
npm install
npm run start:dev                   # http://localhost:3000
# If better-sqlite3 complains about a Node ABI mismatch: npm rebuild better-sqlite3
```

The manual, step-by-step version of the pipeline is in [`RUNNING_TURBOPASS.md`](RUNNING_TURBOPASS.md); the design/data-model details are in [`OVERTURE_INTEGRATION.md`](OVERTURE_INTEGRATION.md).

---

## Deploy on a DIGIT box (Ansible)

Enabled per-tenant via the `enable_turbopass` host_var. The playbook builds `search-api/Dockerfile` and runs the container on loopback `127.0.0.1:13301`; host nginx proxies `/turbopass/` to it, so the configurator's same-origin default works without extra config. To serve the offline Overture source there, mount the generated `overture-data/boundaries.sqlite` into the container at `OVERTURE_DB_PATH` (the compose file above is the reference wiring).

## Extending coverage

Add ISO codes to `TURBOPASS_COUNTRIES` (or `COUNTRIES` when running `bootstrap.sh` directly) and re-run the bootstrap — it drops and rebuilds `boundaries.sqlite` for the full set. To extend the legacy Trie `/search`, run the Overpass scraper (see `scraper/README.md`), which writes new `hierarchy.json` files under `data/`.
