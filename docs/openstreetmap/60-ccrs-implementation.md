# 60 — The CCRS implementation

Every place CCRS touches OSM, why it is built the way it is, and what is still weak.
Unlike parts 10–50, **this part goes stale when we ship** — treat the code as
authoritative and fix this page when it drifts.

## Map of the integration

```
                         ┌─ configurator (operator) ──────────────────────────┐
  place name typed  ───► │ Turbopass /search   (self-hosted autocomplete)     │
  place picked      ───► │ Overpass /api/interpreter  (boundary polygons)     │
                         │   → osmtogeojson → group by admin_level            │
                         │   → operator names the levels                     │
                         │   → boundary-service: hierarchy + entities + rels  │
                         │   → localisation + cache-bust                      │
                         │   → derive MapConfig (center/zoom/viewbox)         │
                         └────────────────────┬───────────────────────────────┘
                                              │  boundary geometry in DIGIT
                         ┌────────────────────▼───────────────────────────────┐
  citizen files a   ───► │ digit-ui-esbuild pgr                               │
  complaint              │ CARTO/OSM raster tiles  (basemap)                  │
                         │ Nominatim reverse+search (address, postcode)       │
                         │ boundary-service geometry → Turf point-in-polygon  │
                         │   → resolve ward → autofill locality               │
                         └────────────────────────────────────────────────────┘
```

Two OSM-dependent surfaces, with very different risk profiles: the operator side is
occasional and self-hostable; the citizen side is per-complaint and is not.

## Configurator — boundary onboarding

`configurator/src/pages/Phase2Page.tsx` is **the only place in the repo that calls
Overpass.** It offers two paths to the same destination:

| Path | Input | When to use |
|---|---|---|
| **OSM one-click** | A place name | Self-service onboarding; no GIS data to hand |
| **XLSX + GeoJSON sidecar** | Operator files | Authoritative/official boundaries ([part 20](20-data-sources.md)) |

Both converge on a shared post-create pipeline, so the downstream result is identical.

### The Overpass call

```ts
// configurator/src/pages/Phase2Page.tsx:96
const OVERPASS_URL: string =
  import.meta.env.VITE_OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
```

The query (`Phase2Page.tsx:592-628`) is the country-scoped shape documented in
[part 30](30-apis.md): resolve the country by `ISO3166-1`, union relation matches across
`NAME_KEYS = ['name', 'name:en', 'int_name', 'alt_name']`, `map_to_area`, then pull all
administrative relations inside. The multi-key name union exists because a strict
`["name"="…"]` returned zero results for every place picked by its translated name — the
[part 10](10-osm-fundamentals.md) local-language trap, met in production. Country scoping
comes from the `countryCode` on the picked Turbopass suggestion.

Because `map_to_area` drags in the enclosing country relation, a `targetAdminLevel` filter
downstream strips levels above the searched place. That filter is load-bearing; removing it
reintroduces a spurious top level.

### Turbopass — why a bespoke autocomplete service exists

```ts
// configurator/src/pages/Phase2Page.tsx:89
const TURBOPASS_BASE: string = import.meta.env.VITE_TURBOPASS_URL || '/turbopass';
```

`turbopass/` is a small NestJS service (`GET /search?q=&limit=`, `GET /health`) that loads
pre-scraped `data/<Continent>/<Country>/hierarchy.json` files into an in-memory trie with
fuzzy prefix matching. `turbopass/scraper/scraper.py` produced that data from Overpass
offline (and is the one client in the repo that sets a `User-Agent`, retries, and sleeps
between requests).

This looks like reinvention until you read the Nominatim policy: **client-side
autocomplete against Nominatim is explicitly forbidden** ([part 30](30-apis.md)).
A bounded, pre-fetched, self-hosted gazetteer is the compliant answer for a search space
that is a known set of administrative places. Suggestions are treated as sugar — failures
are `console.debug` only and the operator can still type a name directly.

### From OSM features to DIGIT boundaries

| File | Responsibility |
|---|---|
| `configurator/src/utils/osmBoundaries.ts` | `codeFromOsmName` (NFD → strip diacritics → uppercase → `_`), shoelace centroid + `scanlineMidpoint` point-on-surface, `featureContainsPoint` **with hole exclusion**, `featureOuterArea`, `buildOsmBoundaries` (smallest-containing-parent wins) |
| `configurator/src/utils/boundaryGeoJson.ts` | Sidecar parsing, `normalizeForMatch`, `coerceForBoundaryService` |
| `configurator/src/utils/mapConfigFromBoundaries.ts` | `boundsOfBoundaries`, `zoomForBounds`, `deriveMapPosition` → `{center, defaultZoom, searchViewbox}` |
| `configurator/src/api/services/boundary.ts` | boundary-service client (hierarchies, entities, relationships, chunked geometry fetch) |
| `configurator/src/api/services/mdms.ts` | `upsertMapConfig`, with an own-vs-inherited tenant guard |

Design decisions worth preserving:

- **Codes are derived from normalised names, not OSM IDs.** Per
  [part 10](10-osm-fundamentals.md), OSM IDs are not stable business keys, and a re-import
  keyed on them would not reconcile.
- **Hole-aware containment.** A district enclosing another would otherwise mis-parent.
- **Smallest containing parent wins**, and unplaceable features are surfaced to the
  operator with explicit skip reasons (`unnamed`, `name not romanizable`,
  `no parent found`) rather than silently dropped.
- **Only Polygon/MultiPolygon features are kept**; bare ways are discarded
  (`Phase2Page.tsx:664-679`).
- **Levels must be contiguous.** The operator maps a contiguous subset of the discovered
  `admin_level`s to hierarchy level names, because OSM levels are non-contiguous and
  country-specific.

### Rendering in the configurator

`configurator/src/components/ui/BoundaryMap.tsx` is **vanilla Leaflet, deliberately not
`react-leaflet`** — the repo carries three different React majors across frontends and
`react-leaflet` couples to specific ones ([part 40](40-rendering.md)). It draws
largest-bbox-first so children stay clickable, and degrades to a placeholder when geometry
is absent. `resources/boundaries/BoundaryOverviewMap.tsx` feeds it a whole tenant, and
`admin/themeEditor/MapConfigEditor.tsx` provides a live preview in which framing the map
writes `center`/`defaultZoom`/`searchViewbox`.

## Citizen side — pin maps and geocoding

Live tree is **`digit-ui-esbuild/products/pgr/`**. (`frontend/micro-ui/…/modules/pgr/` and
`digit-ui-v2/` also contain map code; the esbuild bundle is what deployments serve. Check
which tree a deployment serves before debugging.)

`digit-ui-esbuild/products/pgr/src/components/GeoLocations.js` is the best-hardened caller:

| Line | Call |
|---|---|
| `:259` | `reverse?format=json&lat=&lon=&zoom=18&addressdetails=1` |
| `:315` | `search?format=json&q=&limit=5&addressdetails=1` |
| `:359` | `search?…&limit=1` (postcode lookup) |

- `Accept-Language` is derived from the active i18n locale (`sw_KE` → `sw`), so returned
  place names are localised. **Map tile labels are baked into the CARTO raster and cannot
  be localised without moving to vector tiles** — the clearest concrete case for the
  vector migration argued in [part 40](40-rendering.md).
- Rate-limit handling is a **loop guard, not a limiter**: `lastReverseAttempt` records the
  coordinates *before* the request, so a failed or `429`d call cannot re-trigger itself
  through the form round-trip. This exists because an earlier version hammered Nominatim
  in an infinite loop.
- `viewbox` is sent with `bounded=1` **only when all four edges are valid**
  (`useMapConfig.js:63-80`) — a fix for the [part 30](30-apis.md) `bounded=1` trap, where a
  hardcoded Nairobi viewbox silently broke address search for every other tenant.

Basemap themes (`useMapConfig.js:12-31`, mirrored in `MapConfigEditor.tsx:41-46`):

| Theme | Tile URL | Attribution |
|---|---|---|
| `voyager` (default) | `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png` | `© CARTO © OSM` |
| `light` / `dark` | `…/light_all/…`, `…/dark_all/…` | `© CARTO © OSM` |
| `osm` | `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` | `© OpenStreetMap contributors` |

A raw `tileUrl` overrides the theme, and a custom `tileAttribution` is honoured **only**
when paired with a raw `tileUrl` — the deliberate pairing described in
[part 40](40-rendering.md). Full configuration semantics live in
[`docs/map-config.md`](../map-config.md).

Ward resolution uses `@turf/boolean-point-in-polygon` against geometry fetched from
`boundary-service`, with `useTenantBoundaries.js` dropping degenerate placeholder geometry
via `hasRealGeometry` — necessary because freshly-seeded tenants carry `Point [0,0]` and
unit-square placeholders that would otherwise fit the map to the Gulf of Guinea.

## Deployment: the add-on flags

Both self-hosted services follow the loopback + path-prefix + off-by-default pattern from
[part 50](50-self-hosting.md).

| Flag | Container | Port | nginx | Build wiring |
|---|---|---|---|---|
| `enable_overpass` | `wiktorn/overpass-api` | `127.0.0.1:12346` | `/overpass/` | bakes `VITE_OVERPASS_URL=/overpass/api/interpreter` |
| `enable_turbopass` | `turbopass-search:local` | `127.0.0.1:13301` | `/turbopass/` | client defaults to `/turbopass` |

- Host vars: `local-setup/ansible/inventory/host_vars/_example.yml:294-322`
  (`enable_overpass: false`, `enable_turbopass: false`, ports, `overpass_data_dir`,
  `overpass_db_dir`, `overpass_planet_file`).
- Playbook: `local-setup/ansible/playbook-deploy.yml` — Overpass ~`:2601-2650`
  (`OVERPASS_META=no`, `OVERPASS_MODE=init`, **`OVERPASS_RULES_LOAD=10`** for the area
  index), configurator build env ~`:2501-2506`, Turbopass ~`:2538-2599`.
- nginx: `templates/nginx-site.conf.j2` — `/turbopass/` ~`:385-394`, `/overpass/`
  ~`:403-410`. Trailing slashes strip the prefix; renders byte-identical when off.
- Data prep: `overpass/prepare-extract.sh` (Geofabrik → `osmium tags-filter
  boundary=administrative` → `osmium merge` → `boundaries.osm.bz2`).

The deploy **warns rather than fails** when `enable_overpass: true` but no extract exists
at `overpass_planet_file` — so a flag can be on with the service effectively absent. If
OSM search returns nothing on a box that supposedly self-hosts Overpass, check the extract
first, then area generation, then the name-matching.

## boundary-service quirks that shape all of this

Documented in code, repeated here because they explain otherwise-baffling design:

- **`/boundary/_create` rejects MultiPolygon**, though jsonb stores it fine. Both the UI
  (`boundaryGeoJson.ts:24-44`) and the server-side twin
  (`digit-mcp/src/utils/xlsx-loader.ts:256-275`) collapse to the ring set with the most
  coordinates. **This loses territory** — an island ward shrinks to its mainland part.
- **`/boundary/_search` binds criteria from query params only** (`tenantId` + `codes`
  mandatory) and defaults to ~50 rows, hence chunked fetches
  (`useTenantBoundaries.js` `GEOMETRY_CHUNK_SIZE = 40`; configurator
  `BOUNDARY_SEARCH_LIMIT`, default 300, `VITE_BOUNDARY_SEARCH_LIMIT`).
- **The relationships endpoint duplicates children under parents** — de-duped in
  `boundary.ts:103,125`.
- **`ancestralmaterializedpath` must be cleared after create** or `includeChildren=true`
  returns duplicates. Handled by the `fix_boundary_paths` MCP tool
  (`digit-mcp/src/tools/boundary.ts:37-60`), called fire-and-forget with a 10 s abort from
  `Phase2Page.tsx:192-209` — and 404-tolerant, since not every deployment routes it.
- **There is no `/boundary/_update`** in the version we target, so geometry backfills on an
  existing tenant have historically needed direct SQL. Prefer getting geometry right at
  onboarding.

## Third ingestion path

`utilities/crs_dataloader/` (`crs_loader.py`, `unified_loader.py`, notebooks) also loads
boundary hierarchies, entities with GeoJSON, and relationships — a third path alongside
the configurator UI and `digit-mcp`'s `city_setup_from_xlsx`. Any change to boundary
semantics needs checking against all three.

## Known gaps

Honest list, roughly by risk. None of these are being fixed by this document — it is a
docs-only change — and none should become a PR without an issue behind it.

| # | Gap | Impact |
|---|---|---|
| 1 | **Nominatim is a public-service dependency on the citizen hot path**, with no self-host option and no `User-Agent` on any caller | Policy-non-compliant identification; a rate-limit or outage degrades complaint filing. The largest exposure |
| 2 | **Basemap tiles are keyless public endpoints** (CARTO courtesy CDN by default, OSMF tiles for the `osm` theme) with no self-host path | No SLA; OSMF's policy explicitly makes its tiles unsuitable as a production backend |
| 3 | **The configurator's Overpass `fetch` sends no headers, has no retry/backoff, no caching, and no abort**, collapsing every failure to "Failed to fetch data from OSM. Please try again." | A rate-limited, timed-out and misconfigured endpoint are indistinguishable to the operator |
| 4 | The `osm` theme uses the **retired `{s}.tile.openstreetmap.org`** subdomain form | Deprecated by the tile policy, which specifies plain `tile.openstreetmap.org` |
| 5 | **MultiPolygon collapse silently loses territory** | Non-contiguous wards are geometrically wrong; no operator warning |
| 6 | **No self-hosted Nominatim or tile server** is documented or codified anywhere | Air-gapped/egress-restricted deployments cannot run citizen maps at all |
| 7 | Map tile labels cannot be localised (baked into raster tiles) | Non-English deployments show English map labels regardless of locale |
| 8 | `MapConfigEditor.tsx:211` builds its preview with `attributionControl: false` | Acceptable for a transient internal preview; would be a licence violation on a citizen surface |

Gaps 1, 2 and 6 are one decision, not three: whether citizen-facing geo services get the
same self-hosting treatment the operator-facing ones already have. Parts
[40](40-rendering.md) and [50](50-self-hosting.md) sketch the cheapest credible route —
Planetiler → PMTiles → MapLibre for tiles, Photon or a country-scoped Nominatim for
geocoding.

## Related docs

- [`docs/map-config.md`](../map-config.md) — `RAINMAKER-PGR.MapConfig`, the configuration surface
- [`overpass/README.md`](../../overpass/README.md) · [`turbopass/README.md`](../../turbopass/README.md)
  · [`turbopass/scraper/README.md`](../../turbopass/scraper/README.md)
- [`local-setup/docs/ONBOARDING-AND-ADDONS.md`](../../local-setup/docs/ONBOARDING-AND-ADDONS.md)
  — GeoJSON sidecar in `city_setup_from_xlsx`; add-on rows for Overpass/Turbopass
- `digit-mcp/skills/digit-tenant-setup/SKILL.md` — "Boundary Data Sources", with a working
  locality query
