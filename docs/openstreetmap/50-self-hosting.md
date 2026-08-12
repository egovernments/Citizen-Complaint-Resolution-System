# 50 — Self-hosting

Every public OSM service can be run yourself. This part covers what each one costs to
run, the images to use, and the traps that make a first attempt silently return empty
results.

## Why and when

Self-host when any of these is true:

- The call is on a **user-facing hot path** (per page view, per keystroke, per complaint).
- You need **predictable latency** or an actual SLA.
- The deployment is **air-gapped** or egress-restricted — common for government hosting.
- Public quotas or usage policies **forbid** what you want to build ([part 30](30-apis.md)).
- Data must be **reproducible**: a pinned extract means today's onboarding produces the
  same boundaries as last month's.

Do **not** self-host when the call is operator-triggered, occasional, and tolerant of a
slow response — the public service plus a retry is genuinely cheaper than the ops burden.

The general pattern that works well: **bind the service to loopback, put it behind the
existing reverse proxy under a path prefix, and gate the whole thing behind a
deploy flag that is off by default.** The client reads the endpoint from configuration,
defaulting to the public service. That way a deployment that skips the add-on still
works, and the same build artefact serves both.

```
browser ──> nginx https://host/overpass/ ──> 127.0.0.1:12346 (container)
                  ^ trailing slash strips the prefix before proxying
```

## Overpass API

**Image:** [`wiktorn/overpass-api`](https://hub.docker.com/r/wiktorn/overpass-api) is the
standard containerisation. Upstream is [drolbr/Overpass-API](https://github.com/drolbr/Overpass-API) (C++, AGPL-3.0).

```bash
docker run -d --name overpass --restart unless-stopped \
  -p 127.0.0.1:12346:80 \
  -e OVERPASS_MODE=init \
  -e OVERPASS_PLANET_URL=file:///data/boundaries.osm.bz2 \
  -e OVERPASS_META=no \
  -e OVERPASS_RULES_LOAD=10 \
  -v /opt/overpass/data:/data \
  -v /opt/overpass/db:/db \
  wiktorn/overpass-api
```

| Setting | Why |
|---|---|
| `OVERPASS_MODE=init` | First run imports and creates `/db/init_done`. It then exits by default; `--restart unless-stopped` restarts it automatically, or use `docker start overpass`. The next start sees the marker, skips initialisation, and serves the API |
| `OVERPASS_PLANET_URL` | Accepts `file://` for a local extract — use it, do not re-download |
| `OVERPASS_META=no` | Drops per-object user/version metadata. Much smaller and faster; you lose `out meta` |
| `OVERPASS_USE_AREAS` | Enables initial area generation and the area updater; defaults to `true` |
| `OVERPASS_RULES_LOAD=10` | Controls the area generator's work/sleep ratio; it does not enable area generation |
| `OVERPASS_DIFF_URL` | Optional: apply minutely/daily diffs to stay current |

Area generation runs during initialisation when `OVERPASS_USE_AREAS=true`, then the
area updater keeps it current. A higher `OVERPASS_RULES_LOAD` gives that updater more
work time relative to sleep time; set `OVERPASS_USE_AREAS=false` only when area queries
are intentionally disabled.

**Sizing.** Entirely a function of what you import:

| Import | Disk (db) | Import time | RAM |
|---|---|---|---|
| Admin boundaries, a few countries | ~1–5 GB | minutes | 2–4 GB |
| One country, all data | ~10–50 GB | hours | 8 GB |
| Full planet | ~500 GB–1 TB+ | days | 32 GB+, SSD mandatory |

Filtering to `boundary=administrative` before import ([part 20](20-data-sources.md)) is
what makes this a small, cheap service rather than a large one.

**Extending coverage** means re-running the import: add the new country's filtered
extract, `osmium merge` it into the combined file, clear the db directory, and re-init.
A country that was not imported returns empty results — again, no error, so an operator
searching for a place in an un-imported country sees "nothing found" and reasonably
concludes the feature is broken.

**Verify** after import, and make this a documented step rather than an assumption:

```bash
curl -s http://127.0.0.1:12346/api/interpreter \
  --data-urlencode 'data=[out:json][timeout:30];
    area["name"="Nairobi"]->.a;
    rel(area.a)["boundary"="administrative"];
    out ids;' | head -40
```

An empty `elements` array means one of: the country was not imported, area generation did
not run, or the name does not match OSM's local-language `name` ([part 10](10-osm-fundamentals.md)).

## Nominatim

**Image:** [`mediagis/nominatim-docker`](https://github.com/mediagis/nominatim-docker).
Upstream [nominatim.org](https://nominatim.org) (PostgreSQL/PostGIS + PHP/Python).

```bash
docker run -d --name nominatim \
  -p 127.0.0.1:8080:8080 \
  -e PBF_URL=https://download.geofabrik.de/africa/kenya-latest.osm.pbf \
  -e REPLICATION_URL=https://download.geofabrik.de/africa/kenya-updates/ \
  -e UPDATE_MODE=continuous \
  -e IMPORT_STYLE=address \
  -v nominatim-data:/var/lib/postgresql/16/main \
  mediagis/nominatim:5.3.2
```

**This is the heaviest of the OSM services** — it is a full PostGIS database with a
tokenised address index, not a query proxy.

| Import | Disk | Import time | RAM |
|---|---|---|---|
| One medium country | 20–60 GB | 1–6 h | 8–16 GB |
| Continent | 100–400 GB | ~1 day | 32 GB |
| Full planet | ~1 TB+ SSD | 2–5 days | 64 GB+ recommended |

Notes that matter:

- `IMPORT_STYLE=address` (vs `full`) drops POI detail and cuts the import substantially.
  For "reverse-geocode a pin to a street and postcode", `address` is sufficient.
- `REPLICATION_URL` selects the update feed; `UPDATE_MODE=continuous` starts the
  replication loop. Without both, the index is frozen at import.
- Use the **country extract, not the planet**, unless you genuinely serve worldwide.
  Country-scoped is the difference between a 30 GB volume and a 1 TB one.
- Postcode coverage is inherited from OSM. Self-hosting does not conjure postcodes that
  are not mapped.
- **Your own instance has no OSMF usage policy** — the 1 req/s ceiling and the
  autocomplete prohibition are properties of the *public* service, not the software.
  Autocomplete against your own Nominatim is permitted, though Photon is better at it.

**Lighter alternative — Photon:** [`komoot/photon`](https://github.com/komoot/photon) is
a single Java jar plus an Elasticsearch/OpenSearch index, and it distributes
**pre-built indices** you can download instead of importing. If autocomplete is the
requirement, Photon is the pragmatic choice: hours to stand up, not days.

## Tile servers

Three distinct architectures, in increasing order of modernity and decreasing order of
operational weight:

### 1. Raster, rendered on demand

[`overv/openstreetmap-tile-server`](https://github.com/Overv/openstreetmap-tile-server) —
`osm2pgsql` + PostGIS + Mapnik + `renderd` + Apache `mod_tile`, the classic OSM stack in
one image.

```bash
docker run -d -p 127.0.0.1:8080:80 \
  -e DOWNLOAD_PBF=https://download.geofabrik.de/africa/kenya-latest.osm.pbf \
  -v osm-tiles:/data/database -v osm-tiles-cache:/data/tiles \
  overv/openstreetmap-tile-server run
```

Renders on first request and caches to disk. Simple mental model; heavy CPU on cold
cache; disk grows without bound unless you cap the cache.

### 2. Vector tiles, pre-generated

**[Planetiler](https://github.com/onthegomap/planetiler)** turns an `.osm.pbf` into an
`.mbtiles`/`.pmtiles` vector tileset — a country in minutes, the planet in a few hours on
a decent machine. Then serve it:

- **[tileserver-gl](https://github.com/maptiler/tileserver-gl)** — serves vector *and*
  server-rendered raster from `.mbtiles`.
- **[martin](https://github.com/maplibre/martin)** — Rust tile server, PostGIS/PMTiles/MBTiles.
- **[tegola](https://tegola.io)** — Go, PostGIS-backed.

### 3. PMTiles — no tile server at all

[**PMTiles**](https://github.com/protomaps/PMTiles) is a single-file tile archive designed
for HTTP range requests. Put the file on S3/MinIO/nginx and let MapLibre read ranges
directly. **No tile server process, no database, no scaling story** — the cheapest
credible way to own your basemap, and the one to reach for first in a constrained
deployment. [Protomaps](https://protomaps.com) publishes ready-made basemap builds.

**Sizing, vector tiles:** a country basemap is typically tens to low hundreds of MB; the
planet is ~100 GB as PMTiles. Compare with on-demand raster, where the PostGIS database
alone for one country is tens of GB.

For a municipal deployment that needs to own its basemap, the recommended shape is:
**Planetiler → PMTiles on object storage → MapLibre.** It removes the tile server, the
render queue and the cache-eviction problem in one move.

## Keeping data current

| Approach | Mechanism | Fits |
|---|---|---|
| **Frozen extract** | Import once, pin the file | Boundaries — they change on a legal timescale, not a daily one. Reproducibility is a feature |
| **Periodic re-import** | Cron: fetch extract, re-import, swap | Simple, predictable, needs double disk during the swap |
| **Diff replication** | `OVERPASS_DIFF_URL` / Nominatim `REPLICATION_URL` | Near-live freshness; more moving parts to monitor |

For administrative boundaries, **frozen is usually correct.** You do not want a mapper's
edit in OSM to silently reshape a tenant's ward next Tuesday. Re-import deliberately, and
diff the result before promoting it.

## Operational checklist

- [ ] Bound to **loopback**, exposed only through the reverse proxy. An open Overpass or
      Nominatim on a public port is an open invitation to be someone else's free API.
- [ ] Behind a **deploy flag, off by default**, so a deployment without the data still
      converges.
- [ ] `--restart unless-stopped` (or the orchestrator equivalent) — an import you cannot
      afford to repeat should survive a reboot.
- [ ] Data and database on **named volumes or host paths**, never an anonymous volume that
      a `down -v` can destroy.
- [ ] The deploy **warns rather than fails** when the extract is missing, and says exactly
      which file it wanted. A silent skip produces a flag that is on and a service that
      is absent.
- [ ] A **post-import verification query** in the runbook, with its expected non-empty
      result.
- [ ] Client endpoint is **configuration, not a constant** — and the fallback to the
      public service is deliberate, not accidental.
- [ ] Disk monitoring. Tile caches and PostGIS both grow silently.
- [ ] The import command is **recorded** — which extract, which date, which filter — so
      the dataset is reproducible.

## Further reading

- [Switch2OSM](https://switch2osm.org) — the canonical, well-maintained guides for
  serving your own tiles and running your own stack. Start here
- [Overpass API installation](https://wiki.openstreetmap.org/wiki/Overpass_API/Installation)
- [Nominatim installation](https://nominatim.org/release-docs/latest/admin/Installation/)
- [Planetiler](https://github.com/onthegomap/planetiler) ·
  [PMTiles](https://docs.protomaps.com/pmtiles/)
- [osm2pgsql](https://osm2pgsql.org) — OSM into PostGIS, for SQL-based workflows
