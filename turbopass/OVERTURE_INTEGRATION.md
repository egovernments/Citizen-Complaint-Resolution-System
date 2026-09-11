# Overture Maps Integration for Administrative Boundaries

This document details the implementation of the Overture Maps offline fallback for search and hierarchical administrative boundaries in `turbopass`. 

---

## 1. Overview
Geoapify is the default service for searching and downloading administrative boundaries. To overcome rate limits, licensing, and latency issues, we implemented an offline-capable, local boundary database powered by **Overture Maps** (using the `divisions` theme).

Currently targeted P0 countries:
- **India (IN)**
- **Kenya (KE)**
- **Mozambique (MZ)**

---

## 2. Architecture & Data Pipeline

The integration is divided into three parts:
1. **Data Fetching (Scraping)** via `turbopass/overture-scraper`
2. **Hierarchy Calculation (Preprocessing)** via spatial joins
3. **API Integration (Serving)** via NestJS `search-api` using SQLite

```
               ┌────────────────────────┐
               │  Overture Maps (S3)    │
               └───────────┬────────────┘
                           │
                 [DuckDB Parquet Query]
                           │
                           ▼
               ┌────────────────────────┐
               │    boundaries.sqlite   │ (Raw Geometries)
               └───────────┬────────────┘
                           │
                  [GeoPandas sjoin]
                           │
                           ▼
               ┌────────────────────────┐
               │    boundaries.sqlite   │ (With pre-computed hierarchy)
               └───────────┬────────────┘
                           │
                   [Recursive CTE]
                           │
                           ▼
               ┌────────────────────────┐
               │    search-api REST     │ (offline, <10ms latency)
               └────────────────────────┘
```

---

## 3. Data Fetching & Preprocessing

### Scraping (`turbopass/overture-scraper/scrape.py`)
Because the global Overture Maps dataset is massive (terabytes), downloading it directly is not feasible. We use **DuckDB**'s spatial and HTTP extensions to query remote Parquet files on AWS S3 directly, pulling only the records we need:

1. **Query Filter**: Downloads records where `country IN ('IN', 'KE', 'MZ')` from the Overture Divisions dataset.
2. **Output**: Stores them in `turbopass/overture-data/boundaries.sqlite`.

### Hierarchy Construction (`turbopass/overture-scraper/build_hierarchy.py`)
Overture Maps does not natively assign standard numerical `admin_level`s to lower-tier divisions (like neighborhoods or sub-localities).
To build a proper parent-child hierarchy tree:
1. **Synthetic Admin Levels**: We assign fallback `admin_level`s to specific Overture subtypes:
   - `locality` ➔ `admin_level = 3`
   - `macrohood` ➔ `admin_level = 4`
   - `neighborhood` (e.g. `Bairro`) ➔ `admin_level = 5`
   - `microhood` ➔ `admin_level = 6`
2. **Spatial Join (`sjoin`)**: Using GeoPandas, the script computes the centroid of each boundary shape and joins it spatially against containing shapes with smaller `admin_level`s within the same country.
3. **Hierarchy Saving**: The script computes the immediate containing parent and updates the `parent_id` column in SQLite.

---

## 4. API Endpoints (`search-api`)

We added `better-sqlite3` support in NestJS to query the local SQLite database.

### A. Search Endpoint
- **URL**: `/boundary/search?q=<query>&source=overture`
- **Logic**: Performs a fast `LIKE` query against the `boundaries` table in SQLite.
- **Compatibility**: Formats response objects to match the exact schema expected by the frontend's Geoapify integration, preventing frontend churn.

### B. Fetch (Hierarchy) Endpoint
- **URL**: `/boundary/fetch?id=<place_id>&source=overture`
- **Logic**: Uses a **Recursive Common Table Expression (CTE)** query. With a single database lookup, it fetches the root boundary along with all nested descendant levels (e.g., Maputo City ➔ Distritos ➔ Bairros):
  ```sql
  WITH RECURSIVE children(id) AS (
      SELECT id FROM boundaries WHERE id = ?
      UNION ALL
      SELECT b.id FROM boundaries b
      JOIN children c ON b.parent_id = c.id
  )
  SELECT b.id, b.name, b.country, b.subtype, b.admin_level, b.geometry 
  FROM boundaries b
  WHERE b.id IN children
  ```

---

## 5. Setup & Running Instructions

### Pre-requisites
Make sure Python 3 is installed.

### Run Preprocessing
1. **Prepare Scraper Virtual Environment**:
   ```bash
   cd turbopass/overture-scraper
   python3 -m venv venv
   source venv/bin/activate
   pip install duckdb pandas geopandas shapely requests
   ```
2. **Fetch and Pre-compute Boundaries**:
   ```bash
   # Download data from Overture S3
   python scrape.py
   
   # Map synthetic admin levels to the dataset
   sqlite3 ../overture-data/boundaries.sqlite "
   UPDATE boundaries SET admin_level = 3 WHERE subtype = 'locality' AND admin_level IS NULL;
   UPDATE boundaries SET admin_level = 4 WHERE subtype = 'macrohood' AND admin_level IS NULL;
   UPDATE boundaries SET admin_level = 5 WHERE subtype = 'neighborhood' AND admin_level IS NULL;
   UPDATE boundaries SET admin_level = 6 WHERE subtype = 'microhood' AND admin_level IS NULL;
   "
   
   # Build spatial hierarchy relationships
   python build_hierarchy.py
   ```

### Switch to Overture on Frontend
Simply append `&source=overture` to your frontend network calls.
- Search: `/boundary/search?q=Maputo&source=overture`
- Fetch: `/boundary/fetch?id=e93d7baf-bdc6-4182-8b2b-1ef8a9b21a34&source=overture`

---

## 6. How to Add New Countries

If you need to fetch administrative boundary data for a new country (e.g., Brazil `BR` or South Africa `ZA`):

1. **Modify `scrape.py`**:
   Open `turbopass/overture-scraper/scrape.py` and locate the list of target countries:
   ```python
   COUNTRIES = ['IN', 'KE', 'MZ']
   ```
   Add your new country's 2-letter ISO code to the array:
   ```python
   COUNTRIES = ['IN', 'KE', 'MZ', 'ZA']
   ```

2. **Re-run the Scraper**:
   Run the scraping script. This will drop the existing local database, connect to the remote Overture S3 bucket, and fetch the boundary data for all specified countries:
   ```bash
   cd turbopass/overture-scraper
   source venv/bin/activate
   python scrape.py
   ```

3. **Re-apply Synthetic Admin Levels**:
   Run the SQLite update commands to populate missing `admin_level`s for neighborhoods, localities, and macrohoods (which Overture doesn't natively define numerically):
   ```bash
   sqlite3 ../overture-data/boundaries.sqlite "
   UPDATE boundaries SET admin_level = 3 WHERE subtype = 'locality' AND admin_level IS NULL;
   UPDATE boundaries SET admin_level = 4 WHERE subtype = 'macrohood' AND admin_level IS NULL;
   UPDATE boundaries SET admin_level = 5 WHERE subtype = 'neighborhood' AND admin_level IS NULL;
   UPDATE boundaries SET admin_level = 6 WHERE subtype = 'microhood' AND admin_level IS NULL;
   "
   ```

4. **Re-calculate Hierarchy**:
   Run the hierarchy calculation script. GeoPandas will run spatial containment calculations to reconstruct the parent-child mapping for the new dataset:
   ```bash
   python build_hierarchy.py
   ```

