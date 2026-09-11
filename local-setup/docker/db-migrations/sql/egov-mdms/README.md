# egov-mdms migrations

Data-level fixes to the mdms-v2 tables (`eg_mdms_data`,
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

No service restart is required — the migration registers the corrected schema
itself (it does not depend on the default-data-handler re-registering).

## V20260715000000__mapconfig_recode_from_colour_key

Corrects the `RAINMAKER-PGR.MapConfig` schema and its data on a box that carries
the earlier hand-registered, colour-keyed schema (`x-unique:
["wardHighlightColor"]`, which then spread to every bootstrapped tenant because
tenant_bootstrap copies a source tenant's schemas verbatim). Keying a config on
its own ward colour makes editing the colour change the record's identity — so
edits either contradict the key or mint a duplicate, and the UI reads
`MapConfig[0]`.

mdms-v2 schema **codes are immutable over the API** (`schema/v1/_create` →
`DUPLICATE_SCHEMA_CODE`, `schema/v1/_update` → HTTP 501), so the fix has to
happen at the DB level. The migration, in one transaction:

1. re-keys the legacy `code`-less data record to the stable `DEFAULT` key,
   **preserving** its `wardHighlightColor` (deleting it would revert a
   deliberately-themed map — e.g. Bomet's `#22394D` — to the default orange);
2. rewrites the rogue colour-keyed schema **in place** to the correct
   code-keyed definition, for every tenant that has it;
3. registers the schema for any tenant that has MapConfig data but no schema row.

**The embedded schema definition must stay identical to**
`utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json`
(the source the default-data-handler seeds from on a fresh install). Change one,
change the other.

Guarded and idempotent: it matches only the colour-keyed schema shape and the
code-less legacy record, so a fresh box (correct schema, or none) and a re-run
are no-ops. Dry-run-verified against a live box in a rollback transaction. Pairs
with egovernments/CCRS#1162.

## V20260827000000__uiconstants_recode_from_reopensla_key

The same defect in `RAINMAKER-PGR.UIConstants`: it shipped with `x-unique:
["REOPENSLA"]` while `REOPENSLA` was its **only** property, so the record's single
value was also its primary key. mdms-v2 refuses to update a field listed in
`x-unique`, so every attempt to change the reopen window — configurator,
workbench or curl — came back `400 UNIQUE_KEY_UPDATE_ERR "Updating fields defined
as unique is not allowed."`, leaving the window frozen at whatever the tenant was
first seeded with. That is the "make it configurable" half of
egovernments/CCRS#1252, reported unresolved on the issue.

The migration, in one transaction:

1. deactivates duplicate active records per tenant — preferring a `code`-bearing
   row, then the most recently modified — so the re-key cannot collide on
   `(tenantid, schemacode, uniqueidentifier)`. Ranking only the `code`-less rows
   would leave a tenant that already has a `DEFAULT` record plus a stale
   value-keyed one with **two** active records, the stale one invalid against the
   schema installed below;
2. re-keys the survivor to `code = "DEFAULT"` (and `uniqueidentifier = DEFAULT`),
   **preserving** its configured `REOPENSLA`;
3. rewrites the REOPENSLA-keyed schema **in place** to the code-keyed definition,
   for every tenant that has it;
4. registers the schema for any tenant that has UIConstants data but no schema
   row;
5. moves tenants still on the pre-#1252 seed (`432000000`, 5 days) to the shipped
   72h default. Narrowly guarded to that exact value: until this migration the
   field could not be edited at all, so a `432000000` in the wild is always a
   leftover seed rather than an operator's choice. Every other value is left
   alone.

Step 5 is the only one that changes behaviour rather than just unblocking edits;
drop it if a deployment would rather migrate windows by hand.

Schema and data must move together — the schema is `additionalProperties: false`
and now `required: ["code", "REOPENSLA"]`, so a record left without `code` would
fail validation on the operator's next save. As above, **the embedded definition
must stay identical to** `RAINMAKER-PGR.json`.

Guarded and idempotent: it matches only the REOPENSLA-keyed schema shape and
`code`-less records, so a box seeded from the corrected `full-dump.sql` and a
re-run are both no-ops.
