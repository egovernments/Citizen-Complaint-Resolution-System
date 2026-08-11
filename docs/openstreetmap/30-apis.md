# 30 — APIs

The runtime services. Each section gives the endpoint, the query shape, the real quota,
and the policy you are bound by. **Read the policy sections.** They are not boilerplate;
they define what we are and are not allowed to build, and one of them rules out a
feature people repeatedly ask for.

## Overpass API — querying OSM by tag and area

Overpass is a **read-only query service** over a continuously-updated OSM database. It
is the right tool for "find me every object matching these tags in this area", which is
exactly the administrative-boundary onboarding problem.

### Endpoint

```
POST https://overpass-api.de/api/interpreter
Content-Type: application/x-www-form-urlencoded
body: data=<query>          # or the raw query as the whole body
```

`GET` with `?data=<urlencoded query>` also works and is handy for `curl`, but URL length
limits bite quickly — use `POST` from code.

### Overpass QL in five minutes

```overpassql
[out:json][timeout:90];                    // settings: output format, server-side timeout

// find the country relation by ISO code, name it .country
area["ISO3166-1"="KE"][admin_level=2]->.country;

// all administrative-boundary relations inside it whose name matches, as .target
(
  rel(area.country)["boundary"="administrative"]["name"="Bomet"];
  rel(area.country)["boundary"="administrative"]["name:en"="Bomet"];
)->.target;

.target map_to_area ->.searchArea;         // turn the matched relation into an area
(
  rel(area.searchArea)["boundary"="administrative"];   // everything inside it
  .target;                                             // plus the thing itself
);

out body;                                  // emit the elements with their tags
>;                                         // recurse down to member ways/nodes
out skel qt;                               // emit that geometry, sorted for speed
```

The pieces you actually need to know:

| Construct | Meaning |
|---|---|
| `[out:json]` | JSON instead of XML. Always use it |
| `[timeout:N]` | Server-side seconds. Default 180. Raise for big queries, but a long timeout does not make a bad query fast |
| `[maxsize:N]` | Memory budget in bytes. Default ~512 MB |
| `[bbox:s,w,n,e]` | Global bounding box for the query |
| `node` / `way` / `rel` | Element type filter |
| `["k"="v"]`, `["k"~"re"]`, `["k"]`, `["k"!~"."]` | Tag filters: exact, regex, presence, absence |
| `->.setname`, `.setname` | Store to / read from a named result set |
| `(area.x)` | Spatial filter: inside area `x` |
| `map_to_area` | Convert matched **relations/closed ways** into areas |
| `out body` / `geom` / `center` / `skel` / `meta` | What to emit: tags; tags+geometry; centroid only; bare geometry; +user/version |
| `>` / `<` | Recurse down (to members) / up (to parents) |
| `qt` | Sort by quadtile — faster to emit and to parse |

**Areas are derived objects.** The `area` construct works off a pre-built area index. An
area's ID is the OSM relation ID + `3600000000` (ways: + `2400000000`), which you will
see hardcoded in scraping scripts. Crucially, a **self-hosted** Overpass only has this
index if it was initialised to build one; a fresh import without area generation makes
every `area[...]` query silently return nothing. See [part 50](50-self-hosting.md).

### Practical query gotchas

- **`map_to_area` drags in ancestors.** Matching a city and mapping it to an area can
  pull the enclosing country relation into the result set. Filter the returned levels to
  the ones you asked for.
- **Name matching must be multi-key.** Per [part 10](10-osm-fundamentals.md), match
  across `name`, `name:en`, `int_name`, `alt_name` — a single strict `["name"="X"]` is
  the classic zero-results bug.
- **Escape interpolated values.** Anything inside `"…"` needs `\` and `"` escaped, or a
  place name with an apostrophe/quote becomes a syntax error — and, in principle, query
  injection. Prefer to interpolate only values you obtained from a trusted picker.
- **Regex filters are expensive.** `["admin_level"~"4|5|8"]` over a country is far
  slower than three exact filters unioned.
- **Ask for less.** `out center` instead of `out geom` when you only need a point;
  restrict by area before by tag.

### Quotas, and why you cannot rely on them

For the main `overpass-api.de` instance the operators state that you are not disturbing
others below roughly **10,000 queries/day and 1 GB/day**. Enforcement is via a small
number of concurrent **slots per IP** (typically 2) plus a rate/quota tracker; exceeding
them yields `429 Too Many Requests` or a `504`, sometimes after you have already waited
out the timeout. Status is readable at `/api/status`.

Other public instances (Kumi Systems, `overpass.private.coffee`, and various regional
instances) have their own, generally undocumented, limits. The full list lives on the
[Overpass API wiki page](https://wiki.openstreetmap.org/wiki/Overpass_API).

**What this means for design:** Overpass is fine for an *operator-triggered,
low-frequency* action (onboarding a city: a handful of queries, once). It is not fine
for anything on a per-user or per-page-view path. If you need that, self-host.

Client-side obligations, in rough order of how much they matter:

1. Send an identifying `User-Agent` (or `Referer` from a browser).
2. Handle `429`/`504` with **backoff**, not immediate retry. Retrying instantly is what
   gets an IP blocked.
3. Cache results. Boundary geometry does not change between two clicks.
4. Set an explicit client-side timeout/abort, so a hung Overpass call does not hang the UI.
5. Never use Overpass for bulk download — use an extract ([part 20](20-data-sources.md)).

### Alternatives to Overpass for the same job

- **Local PostGIS** via `osm2pgsql`/`imposm` import, then plain SQL. Better for repeated
  analytical queries; more setup.
- **[QLever](https://qlever.cs.uni-freiburg.de/osm-planet)** — SPARQL over OSM, very
  fast for some aggregate queries.
- **Just download the extract** and filter with `osmium`. For "all boundaries in
  country X", this is genuinely the better tool, and is what our `prepare-extract.sh`
  does for the self-hosted case.

## Geocoding — Nominatim and the alternatives

### Nominatim endpoints

```
GET https://nominatim.openstreetmap.org/search?q=<free text>&format=json&limit=5&addressdetails=1
GET https://nominatim.openstreetmap.org/reverse?lat=<>&lon=<>&format=json&zoom=18&addressdetails=1
GET https://nominatim.openstreetmap.org/lookup?osm_ids=R123,W456&format=json
GET https://nominatim.openstreetmap.org/status?format=json
```

Parameters worth knowing:

| Param | Effect |
|---|---|
| `format` | `json` \| `jsonv2` \| `geojson` \| `xml`. `geojson` is the friendliest for maps |
| `addressdetails=1` | Adds the structured `address` object (`road`, `suburb`, `city`, `postcode`, `country_code`) |
| `countrycodes=ke,tz` | Restrict to ISO country codes |
| `viewbox=minLon,minLat,maxLon,maxLat` | Bias results to a box |
| `bounded=1` | Turn `viewbox` from a *bias* into a **hard filter** |
| `zoom` (reverse) | Granularity, 0 (country) – 18 (building) |
| `accept-language` header or `&accept-language=` | Result language |
| `extratags=1`, `polygon_geojson=1` | More tags; return the actual boundary polygon |
| `layer=`, `featureType=` | Restrict to settlement/address/poi classes |

Two field-tested gotchas:

- **`bounded=1` is a silent killer.** Combined with a viewbox derived from one city, it
  returns *nothing* for any query outside that box. If the viewbox is a stale hardcoded
  default, address search breaks for every other tenant with no error — just empty
  results. Only send `viewbox`/`bounded` when all four edges are genuinely valid for the
  current tenant.
- **Reverse geocoding has no postcode guarantee.** `address.postcode` is frequently
  absent, especially outside Europe. Country-specific fallback regexes over
  `display_name` are a hack, and a hack tuned for one country's postcode shape will
  mis-parse another's.

### The Nominatim usage policy — read this one

The [official policy](https://operations.osmfoundation.org/policies/nominatim/) for the
public instance is unusually strict, and it directly constrains product design:

| Rule | Detail |
|---|---|
| **Max 1 request/second** | Absolute ceiling for the public instance |
| **Bulk = 4 requests/minute** | For anything scripted, long-running or periodic; single-threaded, one machine |
| **Identify yourself** | A valid `Referer` or a `User-Agent` naming your application. Library defaults (`okhttp`, `python-requests`, `axios`) are explicitly insufficient and get blocked |
| **Caching is mandatory** | Repeating an identical query marks you as faulty and gets you blocked |
| **No autocomplete — at all** | *"Auto-complete search … you must not implement such a service on the client side using the API."* |
| No SLA | Best-effort community service |

The autocomplete prohibition is worth stating twice, because it is the single most
requested geo feature: **you may not wire a Nominatim call to a keystroke.** Debouncing
does not make it compliant — the policy bars the pattern, not merely the rate. If you
need type-ahead you need one of:

- a **purpose-built autocomplete engine** — [Photon](https://photon.komoot.io) is
  OSM-based, designed for exactly this, and self-hostable;
- **[Pelias](https://pelias.io)** — modular geocoder, autocomplete-capable, self-hostable;
- a **commercial provider** with an autocomplete product (see below);
- your **own gazetteer** — a bounded, pre-fetched place-name index served from your own
  process. This is a legitimate and cheap answer when the search space is a known set of
  administrative places rather than arbitrary addresses.

### Geocoder comparison

| Engine | Data | Autocomplete | Self-host | Notes |
|---|---|---|---|---|
| **Nominatim** | OSM | ✗ (forbidden on public; possible on your own) | Yes, heavy | The reference. Strong at full-address and reverse |
| **Photon** | OSM (via Nominatim import) | **Yes** | Yes, moderate | Elasticsearch/OpenSearch-backed, typo-tolerant, built for type-ahead |
| **Pelias** | OSM + OA + WOF + geonames | Yes | Yes, complex | Blends sources; more moving parts |
| **[OpenCage](https://opencagedata.com)** | OSM+ | Limited | No | Paid API, generous terms, good for reverse at volume |
| **[LocationIQ](https://locationiq.com)**, **[Geoapify](https://www.geoapify.com)**, **[MapTiler](https://www.maptiler.com)**, **[Stadia Maps](https://stadiamaps.com)** | OSM+ | Yes | No | Hosted Nominatim/Photon derivatives with SLAs and free tiers |
| **Google / Mapbox / HERE** | proprietary | Yes | No | Best quality in thin-OSM regions, but **their terms typically forbid storing results or showing them on a non-their-own basemap** — check before mixing with OSM tiles |

That last caveat matters: you generally cannot geocode with Google and render on OSM
tiles. Provider terms tie geocoding to their own maps.

## Tile APIs

Covered in [part 40](40-rendering.md), but noted here for completeness: tile servers are
the third OSM-adjacent API, with their own policy (identify yourself, cache ≥7 days, no
bulk prefetch, attribution visible).

## Routing engines

Not currently used by CCRS, but the obvious next geo capability (assigning a field crew,
estimating travel time to a complaint), so worth knowing they exist:

| Engine | Strengths |
|---|---|
| **[OSRM](https://project-osrm.org)** | Very fast shortest-path, simple to self-host, weak on multi-modal |
| **[Valhalla](https://valhalla.github.io/valhalla/)** | Tiled, multi-modal, time-dependent costing, matrix/isochrone APIs |
| **[GraphHopper](https://www.graphhopper.com)** | Java, good routing + matrix, commercial and OSS editions |

All three self-host from an `.osm.pbf`. The public demo instances of each are strictly
for evaluation.

## A generic checklist for calling any OSM service

Whatever the service, the same seven things decide whether you get a robust integration
or a mystery outage:

- [ ] Endpoint is **configurable**, defaulting to public but overridable to self-hosted.
- [ ] An identifying **`User-Agent`** (server-side) or `Referer` (browser) is sent.
- [ ] **Retry with backoff** on `429`/`5xx`; never a tight retry loop.
- [ ] **Client-side timeout / abort** so a slow upstream cannot hang the UI.
- [ ] **Caching** at the appropriate layer — in-memory, HTTP cache, or persisted.
- [ ] Failures are **visible**: a real error message, and a log line an operator can find.
      "Please try again" with no detail is how a misconfigured endpoint stays undiagnosed
      for weeks.
- [ ] **Attribution** rendered wherever the result is shown.

## Further reading

- [Overpass API wiki](https://wiki.openstreetmap.org/wiki/Overpass_API) ·
  [Overpass QL reference](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL) ·
  [Overpass Turbo](https://overpass-turbo.eu) (interactive query playground — build
  queries here before putting them in code)
- [Nominatim API docs](https://nominatim.org/release-docs/latest/api/Overview/) ·
  [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [OSM API v0.6](https://wiki.openstreetmap.org/wiki/API_v0.6) — the *editing* API,
  for reference only
- [OSMF operations policies index](https://operations.osmfoundation.org/policies/)
