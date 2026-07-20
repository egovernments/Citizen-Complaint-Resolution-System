# Turbopass

Vendored from [dhruv-1001/osm-mapped-data](https://github.com/dhruv-1001/osm-mapped-data) at the commit recorded in [`.vendored-from`](.vendored-from). Do not reformat the scraped data or scraper code — keep diffs against the source repo minimal.

Turbopass is the autocomplete backend for the configurator's Phase 2 **OSM boundary fetch**: as the operator types a city name, the configurator queries Turbopass for place suggestions, then resolves the selected place's administrative boundary hierarchy from OpenStreetMap.

## Layout

| Path | What it is |
|---|---|
| `search-api/` | NestJS service. Loads all `data/**/hierarchy.json` files into an in-memory Trie at startup and serves fuzzy prefix search. Listens on `:3000`. |
| `data/` | Scraped OSM place hierarchies (`<Continent>/<Country>/hierarchy.json`). Currently Africa (54 countries) and India. |
| `scraper/` | Local Overpass API instance (docker-compose) + `scraper.py` to (re)generate `data/`. See `scraper/README.md`. |

## API contract

```
GET /search?q=<term>&limit=<n>
→ { results: [ { name, stateName, countryName, placeType, code, ... } ] }

GET /health
→ { status: "ok", locationsLoaded: <n> }
```

The configurator calls this through a same-origin base path, default `/turbopass` (override via Vite env `VITE_TURBOPASS_URL`).

## Run locally

```bash
cd search-api
npm install
npm run start:dev   # http://localhost:3000/search?q=maputo
```

By default the service reads data from `../data` (this directory's `data/`). Override with `DATA_DIR=/path/to/data`.

## Deployment on a DIGIT box

Enabled per-tenant via the `enable_turbopass` host_var. The playbook builds `search-api/Dockerfile` (multi-stage; runtime sets `DATA_DIR=/data` with the scraped data mounted there) and runs the container on `127.0.0.1:13301`. Host nginx proxies `/turbopass/` to it, so the configurator's same-origin default works without extra config.

## Extending coverage

To add countries/continents, run the scraper against a local Overpass instance (see `scraper/README.md`), which writes incrementally into `data/`. The search-api picks up any `hierarchy.json` found recursively under its data dir on next startup.
