# 20 — Services

Overpass and Nominatim: what to send, what the quotas really are, what the policies
forbid, and what self-hosting costs. The policy sections are not boilerplate — one of them
rules out a feature that gets requested repeatedly.

## Overpass — querying OSM by tag and area

A read-only query service over a continuously-updated OSM database. The right tool for
"every object with these tags in this area", which is the boundary-onboarding problem.

```
POST https://overpass-api.de/api/interpreter
body: data=<query>
```

`GET ?data=<urlencoded>` works for `curl` but hits URL length limits from code.

### Query language

```overpassql
[out:json][timeout:90];
area["ISO3166-1"="KE"][admin_level=2]->.country;
(
  rel(area.country)["boundary"="administrative"]["name"="Bomet"];
  rel(area.country)["boundary"="administrative"]["name:en"="Bomet"];
)->.target;
.target map_to_area ->.searchArea;
(
  rel(area.searchArea)["boundary"="administrative"];   // everything inside
  .target;                                             // plus itself
);
out body;    // elements with tags
>;           // recurse down to member ways/nodes
out skel qt; // that geometry, quadtile-sorted
```

| Construct | Meaning |
|---|---|
| `[timeout:N]` / `[maxsize:N]` | Server-side seconds (default 180) / memory budget (default ~512 MB) |
| `["k"="v"]`, `["k"~"re"]`, `["k"]`, `["k"!~"."]` | Exact, regex, presence, absence |
| `->.set`, `.set`, `(area.x)` | Store to / read from a named set; filter to inside area `x` |
| `map_to_area` | Turn matched relations/closed ways into areas |
| `out body`/`geom`/`center`/`skel`/`meta` | Tags; +geometry; centroid only; bare geometry; +user/version |

**Areas are derived objects** built from a separate index. An area's ID is the relation ID
+ `3600000000` (ways + `2400000000`), which is why you see those constants in scrapers. A
self-hosted instance without area generation returns nothing for every `area[...]` query,
with no error.

Gotchas: **`map_to_area` drags in ancestors**, so matching a city can pull in the enclosing
country relation — filter the returned levels. **Match names multi-key**; a strict
`["name"="X"]` is the classic zero-results bug ([part 10](10-data.md)). **Escape
interpolated values** — inside a double-quoted Overpass string, escape backslashes and
double quotes (apostrophes need none), using an encoder rather than ad-hoc interpolation.
**Regex filters are expensive**: `["admin_level"~"4|5|8"]` over a country is far slower than
three exact filters unioned.

### Quotas

The `overpass-api.de` operators state you are not disturbing others below roughly
**10,000 queries/day and 1 GB/day**. Enforcement is a small number of concurrent slots per
IP (typically 2) plus a quota tracker; exceeding them yields `429` or `504`, sometimes
after you have already waited out the timeout. Status at `/api/status`. Other public
instances have their own, mostly undocumented, limits.

So Overpass is fine for an operator-triggered action (onboard a city: a few queries, once)
and not for anything per-user or per-page-view. Client obligations: send an identifying
`User-Agent`/`Referer`; back off on `429`/`504` rather than retrying immediately; cache; set
a client-side abort so a hung call cannot hang the UI; never bulk-download — for "all
boundaries in country X", `osmium` over an extract is the better tool anyway, and is what
`overpass/prepare-extract.sh` does.

## Nominatim — geocoding

```
GET /search?q=<text>&format=json&limit=5&addressdetails=1
GET /reverse?lat=&lon=&format=json&zoom=18&addressdetails=1
```

Parameters that matter: `addressdetails=1` for the structured `address` object;
`countrycodes=ke,tz`; `viewbox=minLon,minLat,maxLon,maxLat` to bias; **`bounded=1` to turn
that bias into a hard filter**; `zoom` 0–18 for reverse granularity; `accept-language`;
`polygon_geojson=1` for the actual boundary.

- **`bounded=1` is a silent killer.** With a viewbox derived from one city it returns
  nothing for anything outside — so a stale hardcoded default breaks address search for
  every other tenant, with no error, just empty results.
- **Reverse geocoding does not guarantee a postcode.** `address.postcode` is frequently
  absent outside Europe, and a fallback regex tuned to one country's postcode shape
  mis-parses another's.

### The usage policy

The [public instance policy](https://operations.osmfoundation.org/policies/nominatim/):

| Rule | Detail |
|---|---|
| **1 request/second** | Absolute ceiling |
| Bulk = 4/minute | Anything scripted or periodic; single-threaded, one machine |
| Identify yourself | `Referer` or a `User-Agent` naming the app. Library defaults get blocked |
| Caching mandatory | Repeating an identical query marks you faulty |
| **No autocomplete** | *"you must not implement such a service on the client side using the API"* |

The autocomplete prohibition bars the **pattern**, not merely the rate — debouncing does
not make it compliant. Type-ahead needs [Photon](https://photon.komoot.io) (OSM-based,
built for it, self-hostable), [Pelias](https://pelias.io), a commercial provider, or your
own bounded gazetteer. The last is legitimate and cheap when the search space is a known
set of administrative places, and is what `turbopass/` is.

Note also that Google/Mapbox/HERE terms generally forbid storing results or displaying
them over another provider's basemap — you cannot geocode with Google and render on OSM
tiles.

## Self-hosting

Self-host when the call is on a user-facing hot path, when you need predictable latency,
when the deployment is air-gapped, when policy forbids what you need, or when data must be
reproducible. Not for an occasional operator-triggered call that tolerates a slow response.

The pattern that works: **bind to loopback, expose through the existing reverse proxy under
a path prefix, gate it behind a deploy flag that is off by default**, and have the client
read its endpoint from configuration with the public service as the default. One build
artefact then serves both cases.

### Overpass

[`wiktorn/overpass-api`](https://hub.docker.com/r/wiktorn/overpass-api) wraps
[drolbr/Overpass-API](https://github.com/drolbr/Overpass-API) (C++, AGPL-3.0).

| Setting | Why |
|---|---|
| `OVERPASS_MODE=init` | First run imports, writes `/db/init_done`, then exits by default — `--restart unless-stopped` brings it back to serve. Later starts see the marker and skip the import |
| `OVERPASS_PLANET_URL=file:///data/…` | Use a local extract; do not re-download |
| `OVERPASS_META=no` | Drops per-object user/version metadata: much smaller and faster, and you lose `out meta` |
| **`OVERPASS_USE_AREAS`** | Enables initial area generation and the area updater. Defaults to `true`; `false` only if you intend area queries to be dead |
| `OVERPASS_RULES_LOAD` | The area updater's work/sleep ratio. It does **not** enable area generation |

Filtering to `boundary=administrative` is what keeps this small: admin boundaries for a few
countries import in minutes, one full country takes hours, the planet takes days on
mandatory SSD.

**Extending coverage means re-importing**: merge the new filtered extract, clear the db
directory, re-init. A country that was never imported returns empty — so "nothing found"
has three causes, to check in this order: **extract coverage → area generation →
local-language name match**. Verify with a query whose answer you know:

```bash
curl -s http://127.0.0.1:12346/api/interpreter \
  --data-urlencode 'data=[out:json][timeout:30];
    area["name"="Nairobi"]->.a; rel(area.a)["boundary"="administrative"]; out ids;'
```

For boundaries, a **frozen pinned extract is the right default** — you do not want a
mapper's edit to reshape a tenant's ward next Tuesday. Re-import deliberately and diff
before promoting.

### Nominatim

[`mediagis/nominatim-docker`](https://github.com/mediagis/nominatim-docker) — the heaviest
of these services, a full PostGIS database with a tokenised address index. A medium country
is 20–60 GB and hours; the planet is ~1 TB and days, so use a country extract unless you
serve worldwide.

- `IMPORT_STYLE=address` drops POI detail and cuts the import substantially; sufficient for
  "pin → street + postcode".
- `REPLICATION_URL` selects the update feed and `UPDATE_MODE=continuous` starts the loop —
  without both, the index is frozen at import.
- Postcode coverage is inherited from OSM; self-hosting does not conjure unmapped postcodes.
- **Your own instance carries no OSMF policy.** The 1 req/s ceiling and the autocomplete
  prohibition are properties of the public service, not the software.

**Lighter alternative:** [Photon](https://github.com/komoot/photon) is one Java jar plus a
search index, and distributes **pre-built indices** you can download instead of importing —
hours rather than days, and better at autocomplete.

### Tile servers

| Architecture | Stack | Trade-off |
|---|---|---|
| Raster on demand | [`overv/openstreetmap-tile-server`](https://github.com/Overv/openstreetmap-tile-server) (`osm2pgsql` + PostGIS + Mapnik + `mod_tile`) | Simple model; heavy CPU on cold cache; unbounded disk |
| Vector, pre-generated | [Planetiler](https://github.com/onthegomap/planetiler) → [tileserver-gl](https://github.com/maptiler/tileserver-gl) / [martin](https://github.com/maplibre/martin) | A country in minutes; a tile server to run |
| **PMTiles** | [PMTiles](https://github.com/protomaps/PMTiles) on object storage, read by HTTP range requests | No server, no database, no cache eviction |

A country vector basemap is tens to low hundreds of MB; the planet is ~100 GB as PMTiles.
For a deployment that must own its basemap, Planetiler → PMTiles → MapLibre removes the
tile server, the render queue and the eviction problem at once. This is an option we have
not taken, not current implementation — see the gaps in
[part 40](40-cms-implementation.md).

### Operational notes

Bind to loopback — an open Overpass or Nominatim on a public port becomes someone else's
free API. Keep data on named volumes, never an anonymous volume a `down -v` can destroy.
Record which extract and filter produced the data, so the dataset is reproducible.

## Reference

[Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL) ·
[Overpass Turbo](https://overpass-turbo.eu) (build queries here first) ·
[Nominatim API](https://nominatim.org/release-docs/latest/api/Overview/) ·
[OSMF policies](https://operations.osmfoundation.org/policies/) ·
[Switch2OSM](https://switch2osm.org)
