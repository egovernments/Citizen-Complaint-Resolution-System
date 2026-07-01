# Running Turbopass and Setting Up Overture Maps Local Data

This guide explains how to fetch the offline administrative boundary data for the target P0 countries (**Mozambique, Kenya, and India**) and run the Turbopass service locally.

> **Just want it running?** See [`README.md`](README.md). The whole pipeline below is wrapped by `overture-scraper/bootstrap.sh` and the root `docker-compose.yml`:
> ```bash
> # Docker (no local Python needed):
> docker compose --profile bootstrap up --build bootstrap   # build the DB
> docker compose up -d --build search-api                   # serve it
>
> # or on the host, one command (auto-creates a venv):
> cd overture-scraper && ./bootstrap.sh
> ```
> The sections below are the manual, step-by-step version of what those do.

---

## 1. Local Database and Git Policy
The local boundary database file (`turbopass/overture-data/boundaries.sqlite`) is approximately 1GB+ after processing the geometries for India, Kenya, and Mozambique. 

**This file is explicitly added to `.gitignore` and must NOT be committed to git.**

Every developer setting up this repository for the first time must execute the scraper pipeline below to generate this local database.

---

## 2. Scraping Data for P0 Countries (India, Kenya, Mozambique)

To fetch and prepare the boundaries locally:

### Step A: Set Up Scraper Environment
Run these commands to set up the Python environment and install the required geospatial libraries:
```bash
cd turbopass/overture-scraper
python3 -m venv venv
source venv/bin/activate
pip install duckdb pandas geopandas shapely requests
```

### Step B: Download Overture Maps Data
Run the scraping script. By default, it accesses Overture's S3 data partitions using DuckDB and downloads division geometries for India (`IN`), Kenya (`KE`), and Mozambique (`MZ`):
```bash
python scrape.py
```
*(This will download and write the raw geometries directly into `turbopass/overture-data/boundaries.sqlite`).*

### Step C: Apply Synthetic Admin Levels
Overture Maps does not assign numerical admin levels to lower-tier divisions (like neighborhoods/Bairros). We must map synthetic levels so spatial parentage calculations work:
```bash
sqlite3 ../overture-data/boundaries.sqlite "
UPDATE boundaries SET admin_level = 3 WHERE subtype = 'locality' AND admin_level IS NULL;
UPDATE boundaries SET admin_level = 4 WHERE subtype = 'macrohood' AND admin_level IS NULL;
UPDATE boundaries SET admin_level = 5 WHERE subtype = 'neighborhood' AND admin_level IS NULL;
UPDATE boundaries SET admin_level = 6 WHERE subtype = 'microhood' AND admin_level IS NULL;
"
```

### Step D: Recompute Spatial Hierarchy
Run the hierarchy builder. It computes centroids and constructs the parent-child connections:
```bash
python build_hierarchy.py
```

Once this script finishes with `Hierarchy built successfully!`, your local database is ready to be used by the NestJS API.

---

## 3. Running the Turbopass Service

Once the data is generated:

### Step A: Install Node Dependencies
Go to the `search-api` directory and install dependencies (including the native SQLite module `better-sqlite3`):
```bash
cd ../search-api
npm install
```

*Note: If you run into Node version compile mismatch errors with `better-sqlite3` when running the app, rebuild it using:*
```bash
npm rebuild better-sqlite3
```

### Step B: Start the NestJS Dev Server
Run the NestJS service in watch mode:
```bash
npm run start:dev
```
The service will start listening on `http://localhost:3000`.

---

## 4. Verification

To verify that the service is running and correctly serving Overture Maps data:

### Search Test
```bash
curl -s "http://127.0.0.1:3000/boundary/search?q=Maputo&source=overture" | jq .
```

### Fetch (Hierarchy) Test
```bash
# Using Maputo City's Overture ID: e93d7baf-bdc6-4182-8b2b-1ef8a9b21a34
curl -s "http://127.0.0.1:3000/boundary/fetch?id=e93d7baf-bdc6-4182-8b2b-1ef8a9b21a34&source=overture" | jq .
```
*(This should return Maputo City alongside its nested administrative children, e.g. Distritos and Bairros).*
