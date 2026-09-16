# 40 — DIGIT CMS implementation

The code is authoritative; fix this page when it drifts. File paths are given without line
numbers, which decay immediately.

```
configurator (operator)                     digit-ui-esbuild pgr (citizen)
  Turbopass /search   (self-hosted)           CARTO / OSMF raster tiles
  Overpass /interpreter                       Nominatim reverse + search
    → osmtogeojson → group by admin_level     boundary-service geometry
    → operator names the levels                 → Turf point-in-polygon
    → boundary-service hierarchy/entities       → resolve ward → autofill locality
    → localisation, MapConfig, fix_boundary_paths
```

The operator side is occasional and self-hostable; the citizen side is per-complaint and is
not.

## Configurator — boundary onboarding

`configurator/src/pages/Phase2Page.tsx` is the sole Overpass caller in the repo. It offers
an OSM one-click path and an XLSX + GeoJSON sidecar path, which converge on a shared
post-create pipeline, so the downstream result is identical either way.

The endpoint is `VITE_OVERPASS_URL`, defaulting to public `overpass-api.de`. The query is
the country-scoped shape from [part 20](20-services.md): resolve the country by
`ISO3166-1`, union relation matches across
`NAME_KEYS = ['name', 'name:en', 'int_name', 'alt_name']`, `map_to_area`, then pull all
administrative relations inside. Country scoping comes from the `countryCode` on the picked
Turbopass suggestion. The multi-key union exists because a strict `["name"="…"]` returned
zero results in production ([part 50](50-case-studies.md)).

Because `map_to_area` drags in the enclosing country relation, a `targetAdminLevel` filter
strips levels above the searched place. Removing that filter reintroduces a spurious top
level.

The Overpass `fetch` sends no headers, has no retry, no caching and no abort, and collapses
every failure to "Failed to fetch data from OSM. Please try again." — so a rate-limit, a
timeout and a misconfigured endpoint are indistinguishable to the operator.

### Turbopass

`turbopass/` is a NestJS service (`GET /search?q=&limit=`, `GET /health`) that loads
pre-scraped `data/<Continent>/<Country>/hierarchy.json` into an in-memory trie with fuzzy
prefix matching. Coverage is Africa (54 countries) and India.
`turbopass/scraper/scraper.py` produced that data from Overpass offline, and is the one
client in the repo that sets a `User-Agent`, retries and sleeps between requests.

It exists because Nominatim's policy forbids client-side autocomplete
([part 20](20-services.md)). Suggestions are optional: failures are `console.debug` only and
the operator can type a place name directly.

### OSM features → DIGIT boundaries

`configurator/src/utils/osmBoundaries.ts` holds the algorithms worth knowing:

- `codeFromOsmName` — NFD, strip diacritics, uppercase, `_`. Codes derive from names, not
  OSM IDs, which are not stable keys ([part 10](10-data.md)).
- Shoelace centroid plus `scanlineMidpoint` point-on-surface, so a concave boundary's
  representative point lies inside it.
- `featureContainsPoint` is **hole-aware**; `buildOsmBoundaries` parents by
  **smallest containing area**.
- Unplaceable features are surfaced with explicit skip reasons — `unnamed`,
  `name not romanizable`, `no parent found` — rather than dropped.
- Only Polygon/MultiPolygon features are kept; bare ways are discarded.
- The operator maps a **contiguous** subset of discovered `admin_level`s to hierarchy level
  names, because OSM levels are non-contiguous and country-specific.

Also: `boundaryGeoJson.ts` (sidecar parsing, `coerceForBoundaryService`),
`mapConfigFromBoundaries.ts` (`deriveMapPosition` → `{center, defaultZoom, searchViewbox}`
from the onboarded bbox), `mdms.ts` (`upsertMapConfig`, own-vs-inherited tenant guard).
Maps are `components/ui/BoundaryMap.tsx` (vanilla Leaflet, largest-bbox-first so children
stay clickable, placeholder when geometry is absent), `BoundaryOverviewMap.tsx` (a whole
tenant), and `MapConfigEditor.tsx` (live preview; framing it writes the position fields).

## Citizen side

The live tree is **`digit-ui-esbuild/products/pgr/`**. `frontend/micro-ui/…/modules/pgr/`
and `digit-ui-v2/` also contain map code; check which tree a deployment serves before
debugging.

`components/GeoLocations.js` calls Nominatim `reverse`, `search`, and a postcode lookup, and
is the best-hardened caller. Three fixes in it are the accumulated scar tissue:

- **`Accept-Language`** derived from the active i18n locale (`sw_KE` → `sw`), so returned
  place names are localised. Tile labels cannot be: they are baked into the CARTO raster,
  and localising them requires the vector migration in [part 30](30-rendering.md).
- **`lastReverseAttempt`** records coordinates *before* the request, so a failed or `429`d
  call cannot re-trigger itself through the form round-trip. An earlier version hammered
  Nominatim in an infinite loop.
- **`viewbox` + `bounded=1` only when all four edges are valid** (`useMapConfig.js`) — a
  hardcoded Nairobi viewbox had silently broken address search for every other tenant.

Ward resolution uses `@turf/boolean-point-in-polygon` against geometry from
`boundary-service`. `useTenantBoundaries.js` drops degenerate placeholder geometry via
`hasRealGeometry`, because freshly-seeded tenants carry `Point [0,0]` and unit-square
placeholders that would otherwise fit the map to the Gulf of Guinea.

Basemap themes and every configuration semantic live in
[`docs/map-config.md`](../map-config.md), which is authoritative for them.

## Deploy flags

| Flag | Container | Port | nginx | Build |
|---|---|---|---|---|
| `enable_overpass` | `wiktorn/overpass-api` | `127.0.0.1:12346` | `/overpass/` | bakes `VITE_OVERPASS_URL=/overpass/api/interpreter` |
| `enable_turbopass` | `turbopass-search:local` | `127.0.0.1:13301` | `/turbopass/` | client defaults to `/turbopass` |

Both default to false in `local-setup/ansible/inventory/host_vars/_example.yml`, which also
carries the ports, `overpass_data_dir`, `overpass_db_dir` and `overpass_planet_file`. The
playbook sets `OVERPASS_META=no`, `OVERPASS_MODE=init` and `OVERPASS_RULES_LOAD`; nginx
`/overpass/` and `/turbopass/` blocks render byte-identical when the flags are off (the
trailing slash strips the prefix). Data prep is `overpass/prepare-extract.sh`.

The deploy **warns rather than fails** when `enable_overpass: true` but no extract exists at
`overpass_planet_file` — so a flag can be on with the service effectively absent. Triage
order for "OSM search finds nothing" is in [part 20](20-services.md).

## boundary-service quirks

The most expensive facts here to rediscover:

- **`/boundary/_create` rejects MultiPolygon**, though jsonb stores it. Both the UI
  (`boundaryGeoJson.ts`) and the server-side twin (`digit-mcp/src/utils/xlsx-loader.ts`)
  collapse to the ring set with most coordinates, which **loses territory** — an island ward
  shrinks to its mainland part.
- **`/boundary/_search` binds criteria from query params only** (`tenantId` + `codes`
  mandatory) and defaults to ~50 rows, hence chunked fetches (`GEOMETRY_CHUNK_SIZE` in
  `useTenantBoundaries.js`; `BOUNDARY_SEARCH_LIMIT` / `VITE_BOUNDARY_SEARCH_LIMIT` in the
  configurator).
- **The relationships endpoint duplicates children under parents**, de-duped in
  `boundary.ts`.
- **`ancestralmaterializedpath` must be cleared after create** or `includeChildren=true`
  returns duplicates — the `fix_boundary_paths` MCP tool
  (`digit-mcp/src/tools/boundary.ts`), called fire-and-forget with a 10 s abort and tolerant
  of a 404, since not every deployment routes it.
- **There is no `/boundary/_update`** in the version we target, so geometry backfills on an
  existing tenant have needed direct SQL. Get geometry right at onboarding instead.

## Third ingestion path

`utilities/crs_dataloader/` also loads hierarchies, entities with GeoJSON, and
relationships — alongside the configurator UI and `digit-mcp`'s `city_setup_from_xlsx`. Any
change to boundary semantics needs checking against all three.

## Known gaps

| # | Gap | Impact |
|---|---|---|
| 1 | **Nominatim is a public-service dependency on the citizen hot path**, with no self-host option and no `User-Agent` on any caller. No self-hosted tile server either | Non-compliant identification; a rate-limit or outage degrades complaint filing; air-gapped deployments cannot run citizen maps at all |
| 2 | **Basemap tiles are keyless public endpoints** (CARTO by default, OSMF for the `osm` theme) | No SLA, and OSMF's policy makes its tiles unsuitable as a production backend |
| 3 | The configurator's Overpass call has **no headers, retry, caching or abort**, and one opaque error message | Rate-limit, timeout and misconfiguration are indistinguishable |
| 4 | The `osm` theme uses the **retired `{s}.tile.openstreetmap.org`** form | Deprecated by the tile policy |
| 5 | **MultiPolygon collapse silently loses territory** | Non-contiguous wards are geometrically wrong, with no operator warning |
| 6 | **Raster tile labels cannot follow the locale** | Non-English deployments show English map labels regardless of UI language |

Gaps 1 and 2 are one architectural decision: whether citizen-facing geo services get the
self-hosting treatment the operator-facing ones already have. [Part 20](20-services.md)
sketches the options.
