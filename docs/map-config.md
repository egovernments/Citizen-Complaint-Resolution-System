# Map configuration (`RAINMAKER-PGR.MapConfig`)

The MDMS master that controls the citizen complaint maps — how they look, where
they open, which wards they draw, and how far the address search reaches. It is
the single source of truth for map configuration; the deploy-time `globalConfigs`
keys and the hardcoded defaults survive only as fallbacks.

- **Schema:** `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json`
  (`RAINMAKER-PGR.MapConfig`)
- **Runtime hook:** `digit-ui-esbuild/products/pgr/src/hooks/pgr/useMapConfig.js`
- **Editor:** configurator → **Map Configuration** (`/manage/map-config`)
- **Feature PR:** egovernments/CCRS#1162 · **design discussion:** #1163

## The record

One record per tenant, keyed on a stable `code` (use `"DEFAULT"`). Every other
field is optional — a partial record only overrides what it sets.

```jsonc
{
  "code": "DEFAULT",
  // Basemap
  "baseMapTheme": "voyager",                 // voyager | light | dark | osm
  "tileUrl": "",                             // raw Leaflet template; overrides baseMapTheme
  "tileAttribution": "",                     // paired with a raw tileUrl only
  "wardHighlightColor": "#FFA74F",           // hex; ward fill/outline
  // Starting position
  "center": { "lat": -0.78, "lng": 35.34 },
  "defaultZoom": 13,                         // 0..22
  "minZoom": 0,
  "maxZoom": 19,
  // Ward boundaries
  "boundaryTenantId": "ke.bomet",            // whose ward polygons to draw
  // Address search (Nominatim)
  "geocodeCountryCodes": "ke",               // comma-separated ISO codes; blank = worldwide
  "searchViewbox": { "minLon": 35.0, "minLat": -1.05, "maxLon": 35.6, "maxLat": -0.55 }
}
```

`baseMapTheme` presets (tile URLs live in `useMapConfig.js` `BASE_MAP_THEMES`):

| key | look |
|---|---|
| `voyager` | light, labelled (default) |
| `light` | light |
| `dark` | dark |
| `osm` | OpenStreetMap |

The boundary **hierarchy** is deliberately *not* here — it is a boundary
construct, not a map one, and stays on the `HIERARCHY_TYPE` globalConfigs key
until a dedicated default-boundary-hierarchy master exists.

## Resolution order

Each field resolves **MDMS → globalConfigs → built-in default**, so a deployment
with no record (or a partial one) behaves exactly as it did before this master
existed:

| Field | globalConfigs fallback | built-in default |
|---|---|---|
| `center` | `MAP_CENTER` | `{ 21.1498, 79.0806 }` (Nagpur) |
| `boundaryTenantId` | `MAP_TENANT` (else `REACT_APP_MAP_TENANT`) | — (no ward overlay) |
| `defaultZoom` / `minZoom` / `maxZoom` | — | `13` / `0` / `19` |
| `baseMapTheme` | — | `voyager` |
| `wardHighlightColor` | — | `#FFA74F` |
| `geocodeCountryCodes` / `searchViewbox` | — | unset (worldwide, no box) |

MDMS read errors are swallowed — a missing schema or record never breaks the map.

## Consumers

- `useMapConfig.js` reads `RAINMAKER-PGR.MapConfig[0]` at the tenant resolved
  from `CITIZEN.COMMON.HOME.CITY` (else the current tenant). mdms-v2 resolves up
  the tenant tree, so a city inherits the parent's record unless it has its own.
  Cached `cacheTime: Infinity` → **hard-refresh after editing**.
- `ComplaintLocationMap.js` / `GeoLocations.js` — base tiles, ward colour, start
  centre/zoom, and the Nominatim country/viewbox scope.
- `useTenantBoundaries.js` — `boundaryTenantId` selects whose ward polygons the
  map draws and resolves pins against.

> **Address search gotcha.** Nominatim honours `searchViewbox` only alongside
> `bounded=1`, which *discards* every result outside the box. A box that is too
> small silently hides valid addresses — so `useMapConfig` sends no viewbox
> unless all four edges are present and non-degenerate.

## How it gets set

**Seeded once, at the state root.** The default-data-handler creates a minimal
`DEFAULT` row for `default.tenant.id` at startup. It establishes the neutral
presentation defaults (`voyager` tiles and `#FFA74F` ward highlighting) and
deliberately carries no centre, boundary tenant or geocoding extent.

The seed lives in the root-only `stateMdmsData/` bundle, *not* the shared
`mdmsData/` one that `loadNewTenantProductionData` replays for every new tenant.
That is deliberate: a city provisioned later owns no MapConfig row, so mdms-v2
resolves it up the tree and the city picks up the root's presentation values —
including any the operator changed after the seed. The city only gets its own
row when it genuinely needs one (Phase 2 geometry, or a manual edit), and that
row is created by merging the patch over the inherited values.

**Automatically, at onboarding (preferred).** Configurator Phase 2 already
fetches the OSM boundary polygons, so the centroid/bounding-box of the onboarded
area *is* the correct centre, zoom and search extent. `deriveMapPosition`
(`configurator/src/utils/mapConfigFromBoundaries.ts`) computes them and
`mdmsService.upsertMapConfig` writes the record — the operator types nothing.
The upsert only updates a record the tenant *owns*, otherwise it shadow-creates,
so it never rewrites a parent record inherited down the tenant tree.

**By hand, in management.** The **Map Configuration** editor exposes every field
as an override: a basemap dropdown, a colour picker, and a live map preview where
you set the start point and search area by **framing the map** rather than typing
coordinates. Save writes via a direct `mdmsUpdate` (with the same
own-vs-inherited guard).

## Schema registration & migration

On a **fresh** install the default-data-handler seeds the schema from
`schema/RAINMAKER-PGR.json` and the minimal root-owned `DEFAULT` row from
`stateMdmsData/RAINMAKER-PGR/RAINMAKER-PGR.MapConfig.json` at startup. Tenants
provisioned later get no row of their own — they inherit the root's.

On a box that carries the earlier hand-registered **colour-keyed** schema
(`x-unique: ["wardHighlightColor"]`), that schema squats the code — and mdms-v2
schema codes are immutable over the API (`DUPLICATE_SCHEMA_CODE`; `schema/v1/_update`
→ HTTP 501). The Flyway migration
`local-setup/docker/db-migrations/sql/egov-mdms/V20260715000000__mapconfig_recode_from_colour_key.sql`
fixes it at the DB level: it re-keys the legacy record to `DEFAULT` (preserving
the colour), rewrites the rogue schema in place to the correct code-keyed
definition, and registers the schema for any tenant that has data but no schema.
Idempotent and guarded (no-op on a correct/fresh box). Note the ordering: the
bulk loader's idempotency pre-check is per *schemaCode*, so a root that still
carries a legacy colour-keyed row gets no seed at all until that migration
re-keys it to `DEFAULT` — which is the intended outcome, never a second active
singleton. See that directory's
`README.md` for how to apply it, and keep its embedded definition in sync with
the JSON schema file.

## Availability

The digit-ui FE only reads the position/boundary/geocoding fields where this
branch is deployed; until #1162 merges to `develop`, a box off `develop` reads
only the pre-existing `baseMapTheme` / `wardHighlightColor`.
