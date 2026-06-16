# Self-hosted Overpass (boundary fetch for configurator Phase 2)

The configurator's Phase 2 OSM step fetches admin-boundary polygons from
Overpass. The public `overpass-api.de` is rate-limited and frequently returns
`504 Gateway Timeout` under load. A deployment can self-host Overpass instead.

## How it fits together

- **configurator** — `Phase2Page.tsx` calls `VITE_OVERPASS_URL || https://overpass-api.de/api/interpreter`.
  The `enable_overpass` deploy bakes `VITE_OVERPASS_URL=/overpass/api/interpreter`
  at build time, so Phase 2 hits the on-box instance same-origin.
- **ansible** — host_var `enable_overpass: true` runs a standalone
  `bomet-overpass` container (`wiktorn/overpass-api`, loopback `127.0.0.1:12346`)
  and renders an nginx `/overpass/` proxy in front of it. Default-off → nginx
  renders byte-identical and the configurator uses public Overpass.
- **data** — operator-prepared, because country choice + size are
  deployment-specific. Not committed (extracts are large).

## Prepare the data

`prepare-extract.sh` downloads Geofabrik country extracts, filters each to
`boundary=administrative` (keeps the Overpass DB tiny and area-generation fast),
merges them, and writes `boundaries.osm.bz2`:

```bash
./prepare-extract.sh /opt/overpass/data \
  https://download.geofabrik.de/africa/kenya-latest.osm.pbf \
  https://download.geofabrik.de/africa/mozambique-latest.osm.pbf
```

Then in `host_vars/<tenant>.yml`:

```yaml
enable_overpass: true
overpass_planet_file: /opt/overpass/data/boundaries.osm.bz2
```

and deploy. First start imports the extract and builds the area index
(`OVERPASS_RULES_LOAD=10`) — a few minutes for a country; the DB volume persists.

## Verify

```bash
curl -s -X POST http://127.0.0.1:12346/api/interpreter --data-urlencode \
  'data=[out:json];area["name"="Nairobi"]["boundary"="administrative"]->.a;(rel(area.a)["boundary"="administrative"];);out ids;' \
  | grep -c '"type": "relation"'
```
