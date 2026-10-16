# 50 — What we have onboarded

Three real onboardings, and what each taught us. Onboarding kits and OSM extracts are
operator-supplied and not committed to this repo, so the figures below are recorded here
rather than linked.

## Maputo (`mz.maputo`) — OSM as the source, and where it ran out

The onboarding kit defines **1,256 boundaries across four levels**: 1 Município, 7 Distrito
Municipal, 63 Bairro, 1,185 Quarteirão.

OSM, queried through Overpass and assembled with `osm2geojson`, supplied **70 polygons**:

| Level | OSM `admin_level` | Polygons |
|---|---|---|
| Cidade de Maputo | 4 | 1 |
| Distrito Municipal | 5 | 6 of 7 |
| Bairro | 8 | 63 of 63 |
| Quarteirão | — | **0 of 1,185** |

Of those 70 features, **68 matched kit codes**; the two that did not (`Ribjene`,
`Bairro 7 de Setembro`) carry no `code` property at all and are silently dropped. All 70
arrive as `MultiPolygon` and are therefore collapsed to a single ring by
`coerceForBoundaryService` ([part 40](40-cms-implementation.md)).

**The lesson:** OSM covered the top three levels completely and the fourth not at all. The
quarteirão is the level closest to actual service delivery, and 94% of this tenant's
boundaries sit there with placeholder geometry. Assume OSM depth runs out one level above
where the work happens, and plan the fallback before onboarding rather than after.

Two smaller findings: one distrito has no OSM polygon despite the level being otherwise
complete, so per-level coverage is not all-or-nothing; and the kit's XLSX has `latitude` /
`longitude` columns that are entirely empty, so the GeoJSON sidecar was the only route to
real geometry.

## Bomet wards — OSM was the wrong source

Bomet's 25 ward polygons did **not** come from OSM. They came from the HDX dataset
*administrative-wards-in-kenya-1450* (CC BY; American Red Cross / NLC / IEBC / SOK), an
Esri shapefile in EPSG:4326 covering all 1,450 Kenyan wards, converted to GeoJSON and
filtered to the 25 in Bomet.

Two things this cost:

- **Joining by name, not code.** The shapefile carries the ward's display name
  (`Chesoen`), while DIGIT carries a hierarchical code
  (`BOMET_BOMET_CENTRAL_CHESOEN`). Matching needed normalisation and, in places, fuzzy
  matching — `Ndaraweta` against `NADARAWETA`, `Kapletundo` against `APLETUNDO`.
- **Backfilling an existing tenant.** These wards already existed with placeholder
  geometry, and `boundary-service` has no `/boundary/_update`
  ([part 40](40-cms-implementation.md)), so the geometry had to be written another way.
  Getting geometry right during onboarding is much cheaper than adding it later.

**The lesson:** for the level that carries legal and service-delivery meaning, the national
source beat OSM outright — it was complete, authoritative, and matched what the county
actually administers. This is the concrete case behind the source-selection order in
[part 10](10-data.md).

## Nairobi — the static sidecar, and why it is gone

Early citizen maps shipped a bundled `ke_nairobi_wards` GeoJSON file inside the JS bundle,
used as a fallback when boundary geometry was unavailable. It made the map work in a demo
and then caused a subtler failure: the fallback's ward codes differed from the codes in the
tenant's seeded hierarchy, so ward resolution succeeded, the locality autofill silently
found no match, and the citizen was left with a mandatory dropdown to fill by hand. A
fallback that half-works is harder to diagnose than one that fails.

The static sidecar is no longer in the tree; geometry comes from `boundary-service`. Issue
**#874** tracks this and is still open.

**The lesson:** placeholder and fallback geometry must be visibly distinguishable from real
geometry, which is what `hasRealGeometry` now enforces.

## Timeline

| What | Where |
|---|---|
| Real boundary geometry pipeline (XLSX lat/long + GeoJSON sidecar) for `city_setup_from_xlsx` | PR #621 |
| One-click OSM boundary onboarding alongside Excel upload | PR #844 |
| Selectable, contiguous OSM admin levels; self-hosted Overpass; Management maps | PR #886 (superseding #873, #875) |
| Translated-name resolution across `name`/`name:en`/`int_name`/`alt_name` | PR #980, closing #757 |
| `RAINMAKER-PGR.MapConfig` as single source of truth, start position derived from the onboarded bbox | PR #1162 |
| Shipped as "one-click geography setup through OpenStreetMap", with `enable_overpass` / `enable_turbopass` off by default | v2.12-beta |

### The translated-name failure, in full

Worth recording because it was invisible from the code. An operator searching "Maputo
Province" in the typeahead, then clicking through, got **"No administrative boundaries
found"**. The typeahead surfaced an anglicised name; the Overpass query matched
`["name"="Maputo Province"]` strictly; OSM stores `name="Maputo"` with
`name:en="Maputo Province"`. Zero elements, and an error message that suggested a transient
network problem. The native form "Cidade de Maputo" worked throughout, which is why it
survived testing.

Fixed in PR #980 by matching across all four name keys in both query branches and
broadening `targetAdminLevel` detection to the same set. See [part 10](10-data.md).
