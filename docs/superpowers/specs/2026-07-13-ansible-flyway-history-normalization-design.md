# Flyway history normalization on operator-supplied dumps (item #10 follow-up)

**Status:** design, approved 2026-07-13
**Extends:** PR #1142 (`feat/item10-db-migration-parity`), spec `2026-07-10-compose-k8s-migration-parity-design.md`

## Problem

PR #1142 replaced compose's embedded Flyway with per-service `-db` migration init
containers pulled from the same `egovio/<service>-db:<tag>` images K8s runs. Those
images locate their Flyway history by the K8s table name (`SCHEMA_TABLE`, e.g.
`boundary_service_schema`). The PR made this work by **re-baking the dump it ships**
(`local-setup/db/full-dump.sql`) so its history rows sit under those names.

That fix covers the repo's own dump. It does not cover a dump handed over by a
service team or lifted from a running environment, and the fast-path overlay mounts
*whatever* file sits at `db/full-dump.sql` into `/docker-entrypoint-initdb.d/`. The
standing assumption was that every team would rename their history tables at source.
They have not, and nothing in the deploy checks.

### What actually happens (measured, not predicted)

Verified 2026-07-13 against a team-supplied dump (`egov_backup_20260709_082159.sql`,
21 MB, 57 tables, 97,250 rows) in throwaway containers. The dump carries the **legacy
compose history names** (`boundary_schema_version`, `enc_schema_version`, …). Loading
it and running the eleven pinned `-db` migrators unmodified:

**97,250 rows → 26,377. 73% of the data destroyed.**

| Table | Before | After |
|---|---|---|
| `message` (localization) | 70,835 | **0** |
| `eg_enc_symmetric_keys` | 27 | **0** |
| `eg_enc_asymmetric_keys` | 27 | **0** |

Each migrator looks for its K8s-named history table, finds none, concludes the
database is empty, and replays every migration from V1 (2017) against a populated
database. Nine crash with `42P07 relation already exists` — that crash is the only
reason their data survived. The two that do **not** crash are the ones that cause the
damage, because their V1 migration opens with a drop:

- `egov-localization` → `V20170502122717__localization_create_message.sql` begins
  `DROP TABLE IF EXISTS message;`
- `egov-enc-service` → `V20180607185601__eg_enc.sql` begins
  `DROP TABLE IF EXISTS eg_enc_symmetric_keys; DROP TABLE IF EXISTS eg_enc_asymmetric_keys;`

Both drop, recreate empty, and **exit 0**. A green deploy that ate the data.

The encryption keys are the unrecoverable part: `eg_user.name` and `mobilenumber` are
ciphertext in this dump, and those keys are the only thing that could decrypt them.
Losing them permanently destroys the PII of 534 users and 496 employees. No re-seed
recovers it. (`inventory/host_vars/_example.yml:446` already documents that the dump's
`eg_enc_*_keys` decrypt only under the matching master password — the table is known to
be load-bearing.)

### Verified remedy

Renaming the ten legacy history tables to their canonical K8s names, then running the
same eleven migrators against the same dump:

**Zero data change — every pre-existing table byte-identical (rows + checksum).** All
ten report `Schema "public" is up to date / No migration necessary`.

Renaming is a pure catalog operation. It rewrites no rows.

One service does not resolve by rename. `egov-otp` has `eg_token` in the dump but **no
history table at all**, so Flyway baselines at v1, replays
`V20170303153029__otp_create_token_table.sql`, and hits 42P07. It rolls back cleanly and
`eg_token` is empty here, so nothing is lost — but the migrator exits 1, and under
`service_completed_successfully` that blocks `egov-otp` from booting.

## Goals

1. A deploy over **any** dump either leaves existing data untouched or fails loudly.
   No path may silently succeed while destroying data.
2. Remove the dependency on every service team renaming their history tables.
3. Protect a bare `docker compose up`, not just an Ansible deploy.

**Non-goal:** verifying that the dump's *schema* matches what its history claims. See
Known limitation.

## Design

### Components

| File | Change |
|---|---|
| `local-setup/db/flyway-history-map.yml` | **new** — source of truth: canonical table, legacy aliases, data tables |
| `local-setup/db/normalize/` (`normalize.py`, `Dockerfile`) | **new** — the normalizer |
| `local-setup/docker-compose.migrations.yml` | **edit** — add `db-history-normalize`; gate every migrator on it |
| `.github/scripts/check-flyway-dump-alignment.py` | **edit** — read the map instead of hardcoding names |

No change to `playbook-deploy.yml`. Ansible already runs these compose files, so it
inherits the guard.

### Ordering

Compose enforces it, not Ansible task order:

```
postgres-db  (initdb runs the dump; healthcheck green only after it completes)
    │  condition: service_healthy
    ▼
db-history-normalize   ← one-shot; exit 0 to proceed, non-zero to stop the deploy
    │  condition: service_completed_successfully
    ▼
11 × <service>-migration   → "No migration necessary"
    │  condition: service_completed_successfully
    ▼
apps
```

Because the migrators are gated on the normalizer, they **cannot** run before it. A
non-zero normalizer means compose never starts them, never starts the apps, and
`docker compose up -d` returns non-zero — so the Ansible task fails too.

### Decision table

Applied per service in the map. This is the whole of the logic.

| Canonical | Legacy alias | Data tables | Action |
|---|---|---|---|
| present | — | — | no-op |
| — | present | — | **rename** alias → canonical |
| present | present | — | **abort** — ambiguous, cannot tell which is authoritative |
| — | — | absent | no-op — genuine fresh install; migrator builds from scratch |
| — | — | present, **0 rows** | **drop** them; migrator rebuilds (the `egov-otp` path) |
| — | — | present, **has rows** | **abort** — cannot prove which migrations are applied |

Entries marked `embedded: true` are **skipped before the table is consulted** — they
have no migration init container, so nothing would replay against them. They appear in
the map only so the CI check knows their history table is claimed and does not report
it as orphaned.

**Unknown history tables are a warning, not an error.** A migrator only exists for a
service in the map, so a history table we do not recognise has nothing that would
replay against it. It is logged and skipped. `accesscontrol_schema_version` is exactly
this case: `egov-accesscontrol` stays on embedded Flyway (its K8s chart declares no
`schemaTable`), so it is recorded in the map as `embedded: true` and never touched.

### The map

Canonical names are the `SCHEMA_TABLE` values already declared in
`docker-compose.migrations.yml`. Aliases are the legacy compose names. Data tables are
derived from the `CREATE TABLE` statements in each `-db` image's own migration SQL, so
ownership is authoritative rather than guessed.

```yaml
boundary-service:
  canonical: boundary_service_schema
  aliases: [boundary_schema_version]
  data_tables: [boundary, boundary_hierarchy, boundary_relationship]

egov-user:
  canonical: egov_user_schema
  aliases: [egov_user_schema_version]
  data_tables: [eg_address, eg_role, eg_user, eg_user_address, eg_user_audit_table,
                eg_user_login_failed_attempts, eg_userrole, eg_userrole_v1]

mdms-backend:
  canonical: mdms_v2_schema
  aliases: [mdms_schema_version]
  data_tables: [eg_mdms_data, eg_mdms_schema_definition]

egov-idgen:
  canonical: egov_idgen_schema
  aliases: [egov_idgen_schema_version]
  data_tables: [id_generator]

egov-localization:
  canonical: egov_localization_schema
  aliases: [egov_localization_schema_version]
  data_tables: [message]

egov-enc-service:
  canonical: egov_enc_service_schema
  aliases: [enc_schema_version]
  data_tables: [eg_enc_asymmetric_keys, eg_enc_symmetric_keys]

egov-filestore:
  canonical: egov_filestore_schema
  aliases: [filestore_schema_version]
  data_tables: [eg_filestoremap]

egov-workflow-v2:
  canonical: egov_workflow_v2_schema
  aliases: [workflow_schema_version]
  data_tables: [eg_wf_action_v2, eg_wf_assignee_v2, eg_wf_businessservice_v2,
                eg_wf_document_v2, eg_wf_processinstance_v2, eg_wf_state_v2]

egov-hrms:
  canonical: egov_hrms_schema
  aliases: [hrms_schema_version]
  data_tables: [eg_hrms_assignment, eg_hrms_deactivationdetails, eg_hrms_departmentaltests,
                eg_hrms_educationaldetails, eg_hrms_empdocuments, eg_hrms_employee,
                eg_hrms_jurisdiction, eg_hrms_reactivationdetails, eg_hrms_servicehistory]

egov-url-shortening:
  canonical: "egov-url-shortening_schema"    # hyphenated, as in the K8s chart
  aliases: [egov_url_shortening_schema_version]
  data_tables: [eg_url_shortener]

egov-otp:
  canonical: egov_otp_schema
  aliases: []                                 # no legacy history exists anywhere
  data_tables: [eg_token]

pgr-services:
  canonical: pgr_services_schema
  aliases: []                                 # already canonical in the dump
  data_tables: [complaint_open_state_daily, eg_pgr_address_v2, eg_pgr_document_v2,
                eg_pgr_service_v2]            # materialized views are not data tables

egov-accesscontrol:
  embedded: true                              # stays on embedded Flyway; never touched
  canonical: accesscontrol_schema_version
```

`data_tables` lists only real tables. `pgr-services` also creates materialized views
(`pgr_mv_*`, `complaint_events`, `complaint_facts`); they are excluded because the
"data tables present but no history" branch reasons about rows that cannot be
reconstructed, and an MV can always be rebuilt from its sources.

### Image

`FROM postgres:16` plus `python3-yaml`, built from `local-setup/db/normalize/Dockerfile`.
It needs `psql` and a YAML parser. This same overlay already builds
`pgr-services-migration`, `novu-bridge-migration` and `digit-config-service-migration`
from local Dockerfiles, so it introduces no new class of dependency. The eleven core
migrators keep pulling their pinned `egovio/*-db` images untouched.

## Error handling

Every abort exits non-zero and modifies nothing. The message states what was found,
what would have happened, and what to do:

```
db-history-normalize: ABORT

  egov-otp: eg_token has 4,102 rows but no Flyway history table.
  Cannot prove which migrations are already applied. Replaying from
  V1 would DROP eg_token.

  Resolve by seeding egov_otp_schema with the applied versions, or
  confirm the table is disposable and empty it.

Refusing to start migrators. No data was modified.
```

**The drop path is guarded twice.** The row count is re-checked *inside the same
transaction* as the `DROP`, so a table that gains rows between check and drop aborts
rather than proceeds. It only ever touches tables named in that service's
`data_tables`, and only when the service has no history table whatsoever.

**Idempotency.** Compose re-runs the normalizer on every `up`. The second run finds
canonical tables present and no aliases, so every service takes the no-op branch and it
exits 0. That is the steady state after the first deploy.

## Testing

| Test | Asserts |
|---|---|
| **Real proof** (integration) | Scratch Postgres + the team's dump → normalizer → 11 migrators. Every migrator reports `No migration necessary`, and a full before/after row-count + content-checksum snapshot of all 57 tables is byte-identical. |
| **Negative** | Same dump, normalizer skipped → data IS destroyed. If this ever stops failing, the guard has been silently disabled. |
| **Decision table** (unit) | The six rows above are a pure function of (canonical?, alias?, data tables, row counts). Table-driven, no DB. |
| **Idempotency** | Run the normalizer twice; the second run is a no-op. |
| **Fresh install** | No dump → normalizer no-ops, migrators build from scratch, stack comes up. |
| **CI** | `check-flyway-dump-alignment.py` reads the shared map, so a service added to the overlay without a map entry fails the PR. |

The integration harness already exists — it is what produced the measurements above.

## Known limitation

The rename asserts that the dump's *schema* matches what those migration files would
have produced. That holds for this dump (all eleven migrators go clean), but the
normalizer does not independently verify it: a dump whose schema had drifted from its
history would still be accepted, and a later migration could then fail against an
unexpected column. Closing that requires a real schema-drift check (build the schema
from migrations, build it from the dump, diff). Deliberately out of scope here — it is
a separate piece of work and bolting a half-version of it onto the normalizer would
give false confidence.
