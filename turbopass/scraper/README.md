# Turbopass Scraper

This directory contains the scripts and configuration required to run a local Overpass API instance and scrape geographic hierarchical data (continents, countries, states, and cities) from OpenStreetMap.

## Components

1. **`docker-compose.yml`**: Configures the local Overpass API container (`wiktorn/overpass-api`).
2. **`custom-entrypoint.sh`**: Overrides the default entrypoint to optimize the initialization time by skipping metadata parsing and timestamp indexing.
3. **`scraper.py`**: A resilient Python script that queries the Overpass API to fetch hierarchical data and saves it as JSON files. It supports infinite retries and automatic resuming.

## Getting Started

### 1. Start the Local Overpass API

If you have a massive planet or continent `.osm.bz2` file inside `../data/merged.osm.bz2`, run the docker container in `init` mode first (configurable via environment variables in `docker-compose.yml`), then switch it to normal mode:

```bash
docker compose up -d
```

### 2. Run the Scraper

Ensure your API is running and responding to queries. Set the `OVERPASS_URL` if you're targeting a local instance (defaults to public otherwise).

```bash
export OVERPASS_URL="http://localhost:8080/api/interpreter"
python3 scraper.py
```

Data will be saved incrementally in `../data/<Continent>/<Country>.json`.
