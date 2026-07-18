# Dump-based seeding + DDH retirement (Helm / deploy-as-code)

**Date:** 2026-07-18
**Status:** Design approved, pending implementation plan
**Scope:** `devops/deploy-as-code` (the Helmfile/chart cloud deploy) only. `local-setup/k8s` and the compose/ansible path are out of scope.

## Problem

The Helm deploy seeds base data two ways today:

- **Per-service Flyway** `dbMigration` initContainers (schema + service seed data).
- **`default-data-handler` (DDH)**, deployed as a live release in `charts/urban/urban-helmfile.yaml`, which at runtime seeds MDMS schemas/data, localization, `tenant.tenants`, and DataSecurity policies (its `DEFAULT_MDMS_SCHEMA_CREATE_LIST`, `mdms-schemacode-map`, `DEFAULT_LOCALIZATION_*` env).

Unlike the compose/ansible path — where MCP + `full-dump.sql` seed and DDH is dormant — the Helm deploy has **no MCP release and no unified db-migrations release**. In Helm, **DDH is the active MDMS/localization/tenant/DataSecurity seeder**. Seeding this way is slow and couples first-boot correctness to a long-running service.

We want to seed the DB from a checked-in snapshot (`local-setup/db/full-dump.sql`, ~11 MB) and retire DDH.

## Key constraint: the DB is external and managed

In `charts/environments/env.yaml` the DB is an operator-provided managed instance (`db-host: …database.azure.com`, RDS examples), and the in-cluster `postgresql` release is `installed: false`. Therefore:

- No `/docker-entrypoint-initdb.d` hook (that is the compose and `local-setup/k8s` mechanism; both are out of scope here).
- No baked-Postgres-image or hostPath option.
- A ConfigMap cannot carry the dump (11 MB > 1 MB limit).

The only viable "dump-based process" against a managed DB is a **Kubernetes Job that connects and runs the dump**, guarded so it never overwrites live data.

## Approved decisions

1. **Dump delivery:** baked into a versioned OCI `db-dump` image, built in CI (matches eGov's existing per-service db-image pattern; immutable, version-pinned).
2. **Safety guard:** belt-and-suspenders — an opt-in values flag (**default off**) **AND** an empty-DB probe. Both must pass for the restore to run.
3. **DDH removal:** staged — set the release to `installed: false`, keep the chart and resource files. Reversible.

## Design

### 1. `db-dump` image

- Minimal image (a `postgres` client base, e.g. `postgres:16-alpine` for `psql`) with `local-setup/db/full-dump.sql` copied in at a known path (e.g. `/dump/full-dump.sql`).
- Built and pushed by the same CI pipeline that builds the service `*-db` (Flyway) images, tagged consistently.
- The dump must be a snapshot of a **fully-seeded single-tenant DB** — it has to carry everything DDH produces at runtime (MDMS data, localization, `tenant.tenants`, DataSecurity policies), or enc-service / PGR / other consumers break once DDH is gone. Regenerate cleanly (no PII) if taken from a real tenant DB.

### 2. `db-dump-restore` release (new chart)

- A new chart under `charts/` deploying a single **Job** (plus the values flag). Runs the `db-dump` image.
- **Helmfile ordering:** placed after `backbone-services` (DB reachable) and **before `core-services`** (before any service `dbMigration` initContainer runs), so the dump's schema + Flyway history exist when Flyway checks.
- **Gate:** values flag `dbDump.enabled`, **default `false`**. When false the release renders nothing (or the Job is a no-op) — parallels compose's `db_fast_path`.
- **Empty-DB probe:** even when enabled, the Job first checks a sentinel against the target DB (candidate: existence + non-empty `tenant.tenants`; fallback: presence of a known Flyway history table). If data is present, log a clear message and **exit 0** without loading. This makes it impossible to clobber a live tenant (the compose fast-path documents this exact data-loss vector for Bomet/Nairobi).
- **Load:** on a confirmed-empty DB, run `psql "<db-url>" -v ON_ERROR_STOP=1 -f /dump/full-dump.sql`.
- **Credentials:** reuse the existing `db` secret / `egov-config` `db-url` used by the `dbMigration` initContainers.
- **Restart policy:** `OnFailure`; the Job should be idempotent (guard makes re-runs safe no-ops).

#### Why an explicit sentinel is needed here (the ansible parallel)

The two-layer guard is not a new invention — it reproduces, against a managed DB, protection the compose/ansible path gets for free:

| Layer | Compose / ansible | K8S restore Job |
| --- | --- | --- |
| Opt-in flag | `db_fast_path` (default `false`) — computed into the compose `-f` flags in `playbook-deploy.yml`, so the fast-path overlay is layered in only when a tenant opts in; live tenants never mount the dump. | `dbDump.enabled` (default `false`). |
| Empty-DB check | **Implicit — Postgres does it.** The overlay just mounts the dump at `/docker-entrypoint-initdb.d/01-full-dump.sql`; the Postgres entrypoint runs init scripts **only when PGDATA is empty** (fresh volume / first boot) and skips them entirely on a volume that already holds a cluster. The filesystem state *is* the sentinel — no SQL probe. | **Explicit `SELECT` sentinel** (see below). |

Against the external managed DB (Azure/RDS) there is no PGDATA volume we control, no `/docker-entrypoint-initdb.d/` hook, and no "runs only on empty data directory" behavior. So the implicit Layer-2 guarantee disappears, and the Job must **re-implement that emptiness check explicitly**. This framing is also how to choose the query: pick whatever most faithfully reproduces "the data directory was already initialized" — hence treat *any* sign of prior provisioning (Flyway history present, not just `tenant.tenants` rows) as "skip," rather than only checking for tenant rows.

### 3. Flyway coexistence

In Helm, migrations run in each service's separate `dbMigration` initContainer (a Flyway image), with the history table set via `initContainers.dbMigration.schemaTable` → `SCHEMA_TABLE` env (default `SCHEMA_NAME: public`). If the dump pre-creates a service's tables but its Flyway history table name does **not** match that service's `schemaTable`, Flyway sees no applied history, re-runs `CREATE`, and fails with `42P07 relation already exists` (the exact failure the compose fast-path fixed for url-shortening via `SPRING_FLYWAY_TABLE`).

Implementation task: enumerate every service with `dbMigration.enabled: true`, list its `schemaTable`, and cross-check against the Flyway history table names the dump carries. Align them so each initContainer sees migrations as applied and no-ops — by adjusting how the dump is generated and/or the per-service `schemaTable`. Known divergent case to verify first: `egov-url-shortening` (`schemaTable: egov-url-shortening_schema`).

### 4. Retire DDH (staged)

- In `charts/urban/urban-helmfile.yaml`, set the `default-data-handler` release to `installed: false`.
- **Keep** the `default-data-handler` chart and the `utilities/default-data-handler/src/main/resources` files — `seed-notifications.py` and drift/golden tests read those files (not the running service).
- Reversible: flip back to `installed: true` to restore the old behavior.

## Verification

- **Fresh DB, flag on:** dump loads; every Flyway `dbMigration` initContainer no-ops (no `42P07`); MDMS / localization / `tenant.tenants` / DataSecurity present (DDH's former output) so enc-service and PGR start; app reachable end-to-end.
- **Seeded DB, flag on:** restore Job's empty-DB probe trips → Job logs and exits 0 → no data change.
- **Flag off (default):** restore release renders nothing; deploy behaves as a normal upgrade.
- **DDH gone:** confirm no service depends on DDH at runtime — the Kafka `create-tenant` consumer is dormant (no in-repo producer; MCP/configurator write `tenant.tenants` directly), and DDH's HTTP `/defaultdata/setup` callers (sandbox Setup-Master) are dead in CCRS.

## Out of scope

- `local-setup/k8s` (already dump-based, no DDH) and the compose/ansible path.
- Full deletion of the DDH chart/files (deferred to a later staged step).
- Migrating the external managed DB to the in-cluster `postgresql` chart.

## Open items for the plan

- Exact sentinel table/query for the empty-DB probe (rationale settled — see "Why an explicit sentinel is needed here"; still need to pin the precise query and its handling of the half-provisioned edge case).
- Whether the `db-dump` image builds in the same CI pipeline/workflow as the service db images.
- Full per-service `schemaTable` ↔ dump-history-table cross-check list.
