# egov-mdms migrations

Data-only cleanups of the mdms-v2 tables (`eg_mdms_data`,
`eg_mdms_schema_definition`). The mdms-v2 **service** owns those tables' DDL and
tracks it in its own `mdms_schema_version` table; this directory runs under a
separate history table (`egov_mdms_schema_version`, see `migrate-all.sh`) so the
two never collide. Keep everything here idempotent and guarded — these run on
every box, fresh or existing.

## Applying on an existing box

`docker-compose.egov-digit.yaml` pulls a **pre-built** db-migrations image
(`…/tilt-demo-db-migrations:latest`), so a new file here only reaches a box once
that image is rebuilt and repushed. Until then, apply it by hand — the SQL is
idempotent, so running it directly is equivalent to letting Flyway run it:

```sh
# from the box, against the egov DB (adjust container/creds to the host)
docker exec -i docker-postgres psql -U egov -d egov \
  < local-setup/docker/db-migrations/sql/egov-mdms/V20260715000000__mapconfig_recode_from_colour_key.sql
```

After it runs, restart the default-data-handler so it re-registers any schema the
migration removed:

```sh
docker compose restart default-data-handler   # or the equivalent on the host
```

## V20260715000000__mapconfig_recode_from_colour_key

Retires the colour-keyed `RAINMAKER-PGR.MapConfig` schema (`x-unique:
["wardHighlightColor"]`) that was hand-registered and then spread to every
bootstrapped tenant, and re-keys its data record to the stable `DEFAULT` key
while preserving the configured `wardHighlightColor`. mdms-v2 schema codes are
immutable over the API (`DUPLICATE_SCHEMA_CODE` / HTTP 501), so this is the only
way to replace it; the default-data-handler then registers the correct
code-keyed definition at startup. No-op on a box that already has the correct
schema or none at all. Pairs with egovernments/CCRS#1162.
