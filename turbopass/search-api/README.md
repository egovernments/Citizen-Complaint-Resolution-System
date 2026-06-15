# Turbopass Search API

This is a lightning-fast, highly optimized backend built with NestJS. It reads the raw JSON geographic hierarchy scraped from OpenStreetMap and builds a custom **Trie** structure in-memory to support rapid fuzzy text search, autocomplete, and prefix matching across states, cities, and towns worldwide.

## Setup & Startup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Ensure Data is Available:**
   The API will automatically look for the `data/` directory located one level up in the project root (`../data/`). The scraper should have populated this directory with `.json` files.

3. **Start the API:**
   ```bash
   # Development mode with hot-reload
   npm run start:dev

   # Production mode
   npm run build
   npm run start:prod
   ```

The API will start on **`http://localhost:3000`**. You will see logs indicating exactly how many geographic locations were successfully loaded into the Trie.

## Usage

### 1. Search Geographic Locations
Provides a fuzzy search across all indexed states, cities, and towns globally. Multi-word names are fully tokenized (e.g., searching "Maputo" successfully matches the state "Cidade de Maputo").

**Endpoint:** `/search`  
**Method:** `GET`

#### Query Parameters:
| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `q`       | string | Yes      | The search query (e.g., "bangalore", "karnataka", "maputo"). Must be URL-encoded. |
| `limit`   | number | No       | Maximum number of results to return. Default is 20. |

#### Request Example:
```bash
curl "http://localhost:3000/search?q=karnataka&limit=10"
```

#### Response Example:
```json
{
  "query": "karnataka",
  "fuzzy": true,
  "timeMs": 2,
  "count": 1,
  "results": [
    {
      "code": "IN-KA",
      "name": "Karnataka",
      "stateCode": "IN-KA",
      "stateName": "Karnataka",
      "countryCode": "IN",
      "countryName": "India",
      "continent": "Asia",
      "placeType": "state"
    }
  ]
}
```

#### Result Object Schema:
| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Unique ID generated for the location (e.g., `CTY-123` for cities, or `IN-KA` for states) |
| `name` | string | The local or international name of the location |
| `stateCode` | string | ISO-3166-2 code for the state/region (if available) |
| `stateName` | string | Full name of the state/region |
| `countryCode` | string | ISO-3166-1 alpha-2 code for the country |
| `countryName` | string | Full name of the country |
| `continent` | string | The continent (e.g., "Africa", "Asia") |
| `population` | string | String representation of the population (often omitted or null for states) |
| `placeType` | string | The OSM place type (can be "state", "city", "town", or "village") |
