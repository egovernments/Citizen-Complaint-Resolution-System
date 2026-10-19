# Compose ↔ K8s DB-migration parity via per-service init containers

**Status:** Design — pending review
**Date:** 2026-07-10
**Context:** Deployment-parity Item #10. Follows the team decision to adopt "Option B"
(mirror the K8s per-service migration model in compose) over the compose-native
embedded-Flyway approach.

---

## 1. Problem

The two stacks apply DB migrations by different mechanisms, which diverge in
*structure* and in *history-table naming*:

- **K8s:** one Flyway **init container per service** (`<service>-db` image),
  running before the app, writing history to `<service>_schema`. The app does not
  self-migrate.
- **Compose:** a mix — embedded Spring Flyway in 11 app images, plus one
  consolidated `db-migrations` container (`tilt-demo-db-migrations`, partial: SQL
  for only 3 services) for 4 services, plus a fast-path override. History tables
  are named `*_schema_version` / `pgr_services_schema` — **not** the K8s names.

Consequences:
- The compose dump carries compose-flavoured history-table names, so it **cannot**
  be regenerated from a stock K8s DB, and a DB is **not portable** across stacks —
  a name mismatch produces `42P07 relation already exists` on boot (this is the
  class of failure behind the impel incident).
- New migrations propagate through two different code paths that must be reasoned
  about separately.

## 2. Goal & non-goals

**Goal:** compose applies migrations the *same way K8s does* — one Flyway init step
per service, from the same SQL, writing to the same `<service>_schema` history
table — so migrations propagate identically and the dump becomes portable across
stacks.

**Non-goals:**
- Changing the K8s stack (it is the reference; we conform to it).
- Changing seed/master data in the dump (only Flyway history-table *names* change).
- Changing app runtime behaviour beyond disabling embedded Flyway.
- Rebuilding the dump from scratch (see §6).

## 3. Reference model — what K8s actually does

The `<service>-db` image is a stock Flyway image plus that service's SQL — confirmed
by the per-service `db/Dockerfile`s already in this repo (`backend/pgr-services/
src/main/resources/db/Dockerfile`, `novu-bridge`, `digit-config-service`, …):

```dockerfile
FROM flyway/flyway:<version>
COPY ./migration/main /flyway/sql
```

The init container runs the stock `flyway migrate` with this contract
(`charts/common/values.yaml`, `charts/core-services/configmaps/values.yaml`):

| Var | Value |
|---|---|
| `SCHEMA_TABLE` | `<service>_schema` (per-service, e.g. `egov_hrms_schema`) |
| `SCHEMA_NAME` | `public` |
| `FLYWAY_LOCATIONS` | `filesystem:/flyway/sql,filesystem:/flyway/seed,filesystem:/flyway/qa` |
| `FLYWAY_USER` / `FLYWAY_PASSWORD` | DB creds |
| baseline-on-migrate | on |

Run as an init container **before** the app; the app has **no** embedded Flyway.

**Key point:** compose already runs this exact recipe today —
`local-setup/docker/db-migrations/Dockerfile` is `FROM flyway/flyway:9-alpine` +
`COPY sql /flyway/sql`. We are making an existing, K8s-identical mechanism faithful,
not inventing a new one.

## 4. Target architecture (compose)

For each Flyway-relevant service, add a one-shot **`<service>-migration`** compose
service (the init-container equivalent):

```yaml
<service>-migration:
  build:                              # repo-local: build from the in-repo db/Dockerfile
    context: ../backend/<service>/src/main/resources/db
  # image: <service>-db:<tag>         # core services: pull instead (see §5)
  depends_on:
    postgres-db: { condition: service_healthy }
  environment:
    # Contract expected by the -db image's migrate.sh (verified in
    # backend/pgr-services/src/main/resources/db/migrate.sh):
    #   flyway -url=$DB_URL -table=$SCHEMA_TABLE -user=$FLYWAY_USER
    #     -password=$FLYWAY_PASSWORD -locations=$FLYWAY_LOCATIONS
    #     -baselineOnMigrate=true -outOfOrder=true migrate
    DB_URL: jdbc:postgresql://postgres-db:5432/egov    # REAL postgres — see note below
    SCHEMA_TABLE: <service>_schema                      # the K8s name
    FLYWAY_USER: egov
    FLYWAY_PASSWORD: ${POSTGRES_PASSWORD:-egov123}
    FLYWAY_LOCATIONS: filesystem:/flyway/sql
    FLYWAY_VALIDATE_ON_MIGRATE: "false"                 # lenient — see §8
  restart: "no"

<service>:                            # the app
  environment:
    SPRING_FLYWAY_ENABLED: "false"    # app no longer self-migrates
  depends_on:
    <service>-migration: { condition: service_completed_successfully }
```

**Host note — `postgres` is NOT the database.** In compose, the hostname
`postgres` is a network **alias for pgbouncer**, which runs in `POOL_MODE:
transaction`. The real Postgres is the `postgres-db` service (container
`docker-postgres`). Flyway needs session-scoped connections (advisory locks,
multi-statement DDL), which transaction pooling breaks — *this is the actual
root of the `egov-otp` "Flyway incompatible with pgbouncer" exception.* Every
migrator therefore connects to **`postgres-db:5432` directly**, bypassing
pgbouncer, which both mirrors K8s (its init containers hit the DB directly) and
dissolves the otp exception.

**Removed** at the end of rollout:
- The consolidated `db-migrations` container and its `migrate-all.sh`.
- All `SPRING_FLYWAY_*` embedded config on app services.
- The fast-path `egov-url-shortening` `SPRING_FLYWAY_TABLE` override.

**Bonus:** connecting the migrator **directly to `postgres:5432`** (as the current
`db-migrations` container already does) dissolves the `egov-otp` exception — its
Flyway-disabled state was due to *pgbouncer transaction mode*, which the direct
connection bypasses. otp joins the uniform model.

## 5. Image sourcing

The `<service>-db` image = Flyway base + that service's `db/migration/main` SQL.
Two sources, chosen per service:

- **Repo-local services** (`pgr-services`, `novu-bridge`, `digit-config-service`,
  `default-data-handler`, `digit-user-preferences-service`, `xstate-chatbot`):
  build directly from the existing in-repo `db/Dockerfile`. Trivial.
- **Core services** (`boundary-service`, `egov-hrms`, `egov-idgen`, `egov-user`,
  `egov-localization`, `egov-enc-service`, `egov-filestore`, `egov-workflow-v2`,
  `mdms-v2`, `egov-url-shortening`, `egov-otp`): two acceptable paths —
  - **(preferred)** the platform team publishes the upstream `<service>-db` images
    to the public proxy `registry.preview.egov.theflywheel.in`; compose pulls them
    → true image-level parity with K8s.
  - **(fallback)** build locally: the SQL is already bundled inside each app image
    at `BOOT-INF/classes/db/migration/main` (verified: boundary=3, pgr=5, idgen=58,
    localization=4 files). Extract it into the Flyway recipe. No VPC access needed.

The design supports both; the choice is a registry-ownership decision, not a
technical blocker.

## 6. Naming convergence + dump re-bake

Chosen strategy: **rename in place, re-bake** (preserves all seed/master data;
one-time, deterministic, reviewable). Procedure:

1. Load current `local-setup/db/full-dump.sql` into a scratch Postgres.
2. Apply the rename SQL below (history tables only; data tables untouched).
3. `pg_dump` → new `full-dump.sql`. Commit the diff.

**Rename mapping** (compose/dump name → K8s name):

| Service | Dump table today | → K8s `<service>_schema` |
|---|---|---|
| pgr-services | `pgr_services_schema` | `pgr_services_schema` *(no change)* |
| boundary-service | `boundary_schema_version` | `boundary_service_schema` |
| egov-hrms | `hrms_schema_version` | `egov_hrms_schema` |
| egov-enc-service | `enc_schema_version` | `egov_enc_service_schema` |
| egov-filestore | `filestore_schema_version` | `egov_filestore_schema` |
| egov-workflow-v2 | `workflow_schema_version` | `egov_workflow_v2_schema` |
| mdms-v2 | `mdms_schema_version` | `mdms_v2_schema` |
| egov-user | `egov_user_schema_version` | `egov_user_schema` |
| egov-idgen | `egov_idgen_schema_version` | `egov_idgen_schema` |
| egov-localization | `egov_localization_schema_version` | `egov_localization_schema` |
| egov-url-shortening | `egov_url_shortening_schema_version` | `"egov-url-shortening_schema"` ⚠ hyphens → must be quoted everywhere |
| egov-accesscontrol | `accesscontrol_schema_version` | **OPEN** (see §9) |

**Baseline-fresh services** (`egov-indexer`, `digit-config-service`, `novu-bridge`):
already use K8s-matching names and have **no** dump history — nothing to rename;
their migrators create history fresh on first run.

**`egov-otp`:** no dump history table today; its migrator creates `egov_otp_schema`
fresh (baseline). Confirm otp data tables in the dump don't collide (§8).

## 7. Rollout — pilot first

- **Phase 0 — tooling.** Rename+re-bake script; update the Flyway-dump alignment
  check (§10); confirm the Flyway base-image version to match K8s.
- **Phase 1 — pilot: `pgr-services`.** Repo-local, flagship, and its name needs
  **no** rename (`pgr_services_schema` already matches K8s). Build `pgr-services-db`
  from the repo Dockerfile; add `pgr-services-migration`; disable pgr embedded
  Flyway; gate the app on the migrator. Validate all of §11 on this one service
  before templating. This de-risks the whole pattern cheaply.
- **Phase 2 — repo-local services.** Template Phase 1 across `novu-bridge`,
  `digit-config-service`, `digit-user-preferences-service`, `xstate-chatbot`,
  `default-data-handler`.
- **Phase 3 — core services.** Per the §5 sourcing decision. Resolve the
  `accesscontrol` and `otp` open items here.
- **Phase 4 — cleanup.** Re-bake the dump with all renames; remove the
  `db-migrations` container, `migrate-all.sh`, embedded `SPRING_FLYWAY_*`, and the
  url-shortening override; flip the alignment check to enforce K8s names.

Each phase is independently shippable and leaves the stack bootable.

## 8. Risks & mitigations

- **Checksum mismatch** — the re-baked dump's history rows were written by
  compose's *old* Flyway build, so a migrator that validates could fail on checksum
  differences. Mitigation: `FLYWAY_VALIDATE_ON_MIGRATE=false` (+ out-of-order,
  ignore-missing), consistent with how DIGIT already runs Flyway leniently.
- **Hyphenated identifier** (`egov-url-shortening_schema`) — must be double-quoted
  in the rename SQL and passed verbatim as `FLYWAY_TABLE`. Faithful to K8s, which
  uses the hyphen as-is.
- **Core-service SQL sourcing** depends on the registry decision (§5); design
  supports both, so this is not a blocker.
- **Boot time / noise** — ~14 one-shot containers spin up to no-op on the fast
  path. They exit immediately and run in parallel (all gated only on postgres
  health); acceptable.
- **otp data collision** — confirm the dump's otp data tables don't cause the fresh
  `egov_otp_schema` migrator to hit `42P07`; if they do, add otp to the rename set.

## 9. Open items to resolve during rollout

- **`egov-accesscontrol`:** its K8s chart has **no** `schemaTable` / `-db` init
  container, yet compose runs embedded Flyway for it and the dump carries
  `accesscontrol_schema_version`. Determine how accesscontrol's schema is created in
  K8s (embedded? another service? no migrations?) and mirror that — don't invent a
  `-db` step K8s doesn't have. Resolve before Phase 3 touches accesscontrol.
- **Flyway base version:** pin the `<service>-db` base image to the same Flyway
  version K8s uses (charts give no explicit tag; the repo's existing `db/Dockerfile`s
  and the `db-migrations` bundle use `flyway/flyway:9-alpine`). Confirm and
  standardize.
- **`/flyway/seed` and `/flyway/qa`:** K8s locations include seed/qa. Confirm
  whether any service relies on them and include those folders if so.

## 10. Alignment check evolution

The existing `check-flyway-dump-alignment.py` (compose `SPRING_FLYWAY_TABLE` ↔ dump)
evolves into a **three-way** parity assertion:

> per-service migrator `FLYWAY_TABLE` == dump history-table name == K8s chart
> `schemaTable`

for every service. The transitional `PENDING_ENABLE` / `BASELINE_FRESH` allowlists
shrink toward empty as services migrate; a service is "done" when all three names
agree. This makes cross-stack naming drift a CI failure, permanently.

## 11. Validation / success criteria

- **Fast path:** stack boots; every `<service>-migration` exits 0 and reports Flyway
  "up to date" (no-op); all apps start.
- **Slow path:** empty DB → migrators build the full schema with `<service>_schema`
  names → apps start → Newman suites pass (digit-core-validation + complaints-demo
  16/16; CRSLoader regression 11/11).
- **New-migration test:** add a probe migration to a service's SQL, rebuild its
  `-db` image, boot → migrator applies it (Flyway "migrated 1"), verified in DB.
- **Naming parity:** the §10 three-way check is green for every migrated service.
- **Dump portability:** a DB dumped from compose loads into a K8s-shaped schema
  layout without `42P07` (history-table names match K8s).

## 12. What this deliberately does NOT change

- K8s charts (reference model, unchanged).
- Seed/master data in the dump (only history-table names change).
- App business logic or images (beyond disabling embedded Flyway).
