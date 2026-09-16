# OpenStreetMap in DIGIT CMS

Every geospatial feature in the DIGIT Complaint Management System (DIGIT CMS) — citizen
complaint pin maps, configurator boundary onboarding, dashboard choropleths — sits on
OpenStreetMap. Parts 10–30 describe the OSM ecosystem and stay true regardless of our code.
Parts 40–50 describe our implementation and our history, and go stale when we ship.

| Part | Covers |
|---|---|
| [10 — Data](10-data.md) | The OSM data model, `admin_level`, ODbL, and where boundary data comes from (OSM and otherwise) |
| [20 — Services](20-services.md) | Overpass and Nominatim: query shapes, quotas, the policies that bind us, and how to self-host |
| [30 — Rendering](30-rendering.md) | Tiles, client libraries, providers, attribution |
| [40 — Our implementation](40-cms-implementation.md) | Every CMS call site, deploy flags, `boundary-service` quirks, known gaps |
| [50 — What we have onboarded](50-case-studies.md) | Maputo, Bomet, Nairobi: what worked, what OSM could not supply |

Adjacent docs, not duplicated here: [`docs/map-config.md`](../map-config.md) is
authoritative for the `RAINMAKER-PGR.MapConfig` master;
[`overpass/README.md`](../../overpass/README.md) and
[`turbopass/README.md`](../../turbopass/README.md) are the operator runbooks.

## The four access patterns

You never query "the" OSM database in production; picking the access pattern is the
engineering decision.

| Pattern | Service | Good for | Wrong for |
|---|---|---|---|
| Query by tag/area | **Overpass** | Extracting admin boundaries at onboarding | Per-keystroke or per-page-view calls |
| Address ⇄ coordinate | **Nominatim** | Reverse-geocoding a dropped pin | Type-ahead (forbidden by policy) |
| Draw a basemap | **Tile servers** | Any map a user sees | Bulk prefetch off community tiles |
| Own the dataset | **Planet / extracts** | Self-hosting, reproducibility | Minute-fresh edits |

Three constraints that have each cost us a bug:

1. **The free public services are not a production backend.** No SLA; they rate-limit and
   block. Anything on the citizen hot path needs self-hosting or a paid provider.
2. **Attribution is a licence obligation.** `© OpenStreetMap contributors` visible on
   every public map.
3. **OSM completeness is uneven, and thins from the bottom.** The level that carries
   service-delivery meaning — ward, bairro — is the first thing missing. Always have a
   non-OSM fallback ([part 10](10-data.md)).

## Where we stand

| Service | Where | Hosting | Risk |
|---|---|---|---|
| Overpass | configurator onboarding (operator-triggered) | self-hostable (`enable_overpass`) | low |
| Place autocomplete | configurator boundary search | self-hosted only (`enable_turbopass`) | low |
| Nominatim | citizen pin reverse-geocode + address search | public service only | **high — citizen hot path, no self-host option** |
| Basemap tiles | every map | public CARTO / OSMF endpoints | **high — keyless courtesy endpoints** |

The operator-side dependencies have been hardened; the citizen-side ones have not.
[Part 40](40-cms-implementation.md) lists the specific gaps.
