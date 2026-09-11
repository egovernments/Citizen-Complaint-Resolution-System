# Compose↔K8s Migration Parity — pgr-services Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the per-service Flyway init-container model on one service (`pgr-services`) end-to-end in compose, exactly as K8s does it, without breaking the fast-path boot.

**Architecture:** Add a one-shot `pgr-services-migration` compose service (built from the existing in-repo `backend/pgr-services/src/main/resources/db` Dockerfile — the same `-db` image K8s uses), connected directly to the real Postgres. Gate the `pgr-services` app on it and turn the app's embedded Flyway off. All changes live in a new `docker-compose.migrations.yml` overlay so the base stack is untouched and the pilot is reviewable in isolation.

**Tech Stack:** Docker Compose (multi-file overlays), Flyway 10.7.1 (`egovio/flyway`), PostgreSQL 16, pgbouncer, Python 3 (the alignment check).

## Global Constraints

- Canonical stack = `local-setup/docker-compose.egov-digit.yaml` + `local-setup/docker-compose.fast-path.yml`. All compose commands run from `local-setup/` and include both, plus the new overlay.
- Migrators MUST connect to **`postgres-db:5432`** (the real DB), never `postgres` (that hostname is a pgbouncer alias in `POOL_MODE: transaction`, which breaks Flyway).
- `pgr-services` history table name is **`pgr_services_schema`** — identical in the dump and in K8s. The pilot performs **no dump rename** (that is deliberately the easiest first service).
- The `-db` image contract (from `backend/pgr-services/src/main/resources/db/migrate.sh`) is: `DB_URL`, `SCHEMA_TABLE`, `FLYWAY_USER`, `FLYWAY_PASSWORD`, `FLYWAY_LOCATIONS`; it hardcodes `-baselineOnMigrate=true -outOfOrder=true`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work on branch `feat/compose-migration-parity` (already checked out).
- Repo is PUBLIC — no secrets or exploit detail in commits.

---

### Task 1: Migration overlay + `pgr-services-migration` (no-ops on the dump)

**Files:**
- Create: `local-setup/docker-compose.migrations.yml`

**Interfaces:**
- Produces: a compose service `pgr-services-migration` (one-shot, `restart: "no"`) built from `../backend/pgr-services/src/main/resources/db`, that runs Flyway `migrate` against `postgres-db:5432` with `SCHEMA_TABLE=pgr_services_schema`. Later tasks add `depends_on: { pgr-services-migration: { condition: service_completed_successfully } }`.

- [ ] **Step 1: Write the overlay with just the migration service**

Create `local-setup/docker-compose.migrations.yml`:

```yaml
# Deployment-parity item #10 — per-service Flyway init containers (pilot).
# Mirrors the K8s db-migration init container: a one-shot Flyway run per
# service, from the same in-repo <service>-db image, writing history to the
# K8s <service>_schema table, connected DIRECTLY to postgres-db (never the
# pgbouncer 'postgres' alias, which runs in transaction mode and breaks Flyway).
services:
  pgr-services-migration:
    build:
      context: ../backend/pgr-services/src/main/resources/db
    container_name: pgr-services-migration
    depends_on:
      postgres-db:
        condition: service_healthy
    environment:
      DB_URL: jdbc:postgresql://postgres-db:5432/egov
      SCHEMA_TABLE: pgr_services_schema
      FLYWAY_USER: egov
      FLYWAY_PASSWORD: ${POSTGRES_PASSWORD:-egov123}
      FLYWAY_LOCATIONS: filesystem:/flyway/sql
      FLYWAY_VALIDATE_ON_MIGRATE: "false"
    restart: "no"
    networks:
      - egov-network
```

- [ ] **Step 2: Reset to a fresh dump-loaded DB and confirm the "before" state**

Run:
```bash
cd local-setup
export COMPOSE="docker compose -f docker-compose.egov-digit.yaml -f docker-compose.fast-path.yml -f docker-compose.migrations.yml"
$COMPOSE down -v
$COMPOSE up -d --wait postgres-db   # --wait blocks until the healthcheck passes,
                                    # i.e. after the dump finishes loading via initdb
docker exec docker-postgres psql -U egov -d egov -c \
  "select count(*) as applied_migrations from pgr_services_schema where success;"
```
Expected: a non-zero count (the dump ships an already-populated `pgr_services_schema` history). Record this number — call it **N**.

- [ ] **Step 3: Build the migration image**

Run:
```bash
$COMPOSE build pgr-services-migration
```
Expected: build succeeds; final image has `/flyway/sql` populated and `migrate.sh` as entrypoint.

- [ ] **Step 4: Run the migrator against the dump-loaded DB**

Run:
```bash
$COMPOSE run --rm pgr-services-migration
echo "exit=$?"
```
Expected: `exit=0`. Flyway output reports the schema is already up to date (0 migrations applied), OR applies only migrations newer than the dump's recorded version (any `V2026…` present in the repo but not yet in history). It must NOT error with `relation already exists` (42P07) or a checksum-mismatch failure.

- [ ] **Step 5: Confirm the migrator was a safe no-op / clean incremental**

Run:
```bash
docker exec docker-postgres psql -U egov -d egov -c \
  "select count(*) as applied_migrations from pgr_services_schema where success;"
```
Expected: count `>= N` (equal if the repo SQL matches the dump; slightly higher if the repo carries newer migrations — both are correct). No failed rows:
```bash
docker exec docker-postgres psql -U egov -d egov -c \
  "select version, description, success from pgr_services_schema where not success;"
```
Expected: **0 rows**.

> **If Step 4 fails on checksum mismatch:** `FLYWAY_VALIDATE_ON_MIGRATE=false` was not honored (migrate.sh builds an explicit CLI without that flag, and env precedence may differ by Flyway version). Fix by making the flag explicit in the image entrypoint — edit `backend/pgr-services/src/main/resources/db/migrate.sh` to add `-validateOnMigrate=false` to the `flyway` command, rebuild (Step 3), and re-run (Step 4). Note this change in the commit; it matches how DIGIT already runs Flyway leniently (baseline + out-of-order).

- [ ] **Step 6: Tear down and commit**

Run:
```bash
$COMPOSE down -v
git add local-setup/docker-compose.migrations.yml backend/pgr-services/src/main/resources/db/migrate.sh 2>/dev/null
git commit -m "feat(compose): add pgr-services Flyway init-container overlay (item #10 pilot)

One-shot pgr-services-migration built from the in-repo pgr-services-db
Dockerfile, connected directly to postgres-db (not the pgbouncer alias),
writing history to pgr_services_schema (same name as the dump and K8s).
No-ops on the fast-path dump; applies newer migrations incrementally.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Gate `pgr-services` on the migrator, disable embedded Flyway

**Files:**
- Modify: `local-setup/docker-compose.migrations.yml` (add a `pgr-services` override block)

**Interfaces:**
- Consumes: `pgr-services-migration` from Task 1.
- Produces: `pgr-services` now starts only after the migrator completes, with `SPRING_FLYWAY_ENABLED: "false"`.

- [ ] **Step 1: Add the app override to the overlay**

Append to `local-setup/docker-compose.migrations.yml` under `services:`:

```yaml
  # The app no longer self-migrates; the init container above owns it.
  pgr-services:
    environment:
      SPRING_FLYWAY_ENABLED: "false"
    depends_on:
      pgr-services-migration:
        condition: service_completed_successfully
```

- [ ] **Step 2: Verify compose merges the override without dropping base deps**

Run:
```bash
cd local-setup
$COMPOSE config | sed -n '/^  pgr-services:/,/^  [a-z]/p' | grep -E "SPRING_FLYWAY_ENABLED|pgr-services-migration|pgbouncer|condition"
```
Expected: shows `SPRING_FLYWAY_ENABLED: "false"`, the new `pgr-services-migration` dependency, AND the pre-existing base dependencies (`pgbouncer`, `redpanda`, etc.) — compose merges `depends_on`, it does not replace it.

- [ ] **Step 3: Boot the DB + migrator + app chain and confirm ordering**

Run:
```bash
$COMPOSE down -v
$COMPOSE up -d pgr-services
$COMPOSE ps
```
Expected: `pgr-services-migration` shows `Exited (0)`; `pgr-services` is `Up` (started only after the migrator exited 0). Its dependency infra (pgbouncer, redpanda, mdms, idgen, user, workflow, localization, enc) also came up because they remain in the merged `depends_on`.

- [ ] **Step 4: Confirm the app is healthy and its Flyway stayed off**

Run:
```bash
docker logs pgr-services 2>&1 | grep -iE "flyway|migrat" | head
```
Expected: **no** Flyway migration lines from the app (embedded Flyway disabled). Then hit the API:
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://localhost:18080/pgr-services/v2/request/_count?tenantId=pg"
```
Expected: `401` or `400` (reachable, auth-gated) — NOT `000`/`502` (which would mean the app never came up).

- [ ] **Step 5: Tear down and commit**

Run:
```bash
$COMPOSE down -v
git add local-setup/docker-compose.migrations.yml
git commit -m "feat(compose): gate pgr-services on its migrator, disable embedded Flyway

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Prove incremental application (new migration) + slow path (empty DB)

**Files:**
- Temporary: `backend/pgr-services/src/main/resources/db/migration/main/V20260710000000__parity_probe.sql` (created then removed — never committed)

**Interfaces:**
- Consumes: `pgr-services-migration` from Task 1.

- [ ] **Step 1: Slow-path — migrator builds the schema from empty**

Prove the migrator works with no dump (the real product bring-up path). Use a scratch database so no volume juggling is needed:
```bash
cd local-setup
$COMPOSE down -v
$COMPOSE up -d --wait postgres-db   # --wait blocks until the healthcheck passes,
                                    # i.e. after the dump finishes loading via initdb
docker exec docker-postgres psql -U egov -d egov -c "CREATE DATABASE egov_slowtest;"
$COMPOSE run --rm -e DB_URL=jdbc:postgresql://postgres-db:5432/egov_slowtest pgr-services-migration
echo "exit=$?"
```
Expected: `exit=0`; Flyway applies ALL pgr migrations from scratch.

- [ ] **Step 2: Verify the fresh schema exists with the K8s-named history table**

Run:
```bash
docker exec docker-postgres psql -U egov -d egov_slowtest -c "\dt" | grep -iE "pgr|eg_pgr|service_request"
docker exec docker-postgres psql -U egov -d egov_slowtest -c \
  "select count(*) from pgr_services_schema where success;"
```
Expected: pgr tables present; `pgr_services_schema` populated with a full migration history. Then clean up:
```bash
docker exec docker-postgres psql -U egov -d egov -c "DROP DATABASE egov_slowtest;"
```

- [ ] **Step 3: New-migration test — write a probe migration**

Create `backend/pgr-services/src/main/resources/db/migration/main/V20260710000000__parity_probe.sql`:
```sql
CREATE TABLE IF NOT EXISTS pgr_parity_probe (id integer PRIMARY KEY);
```

- [ ] **Step 4: Rebuild the -db image and run it against the dump-loaded DB**

Run:
```bash
$COMPOSE down -v
$COMPOSE up -d --wait postgres-db   # --wait blocks until the healthcheck passes,
                                    # i.e. after the dump finishes loading via initdb
$COMPOSE build pgr-services-migration
$COMPOSE run --rm pgr-services-migration
echo "exit=$?"
```
Expected: `exit=0`; Flyway reports "Successfully applied 1 migration" (the probe), because `V20260710000000` is newer than everything in the dump's history.

- [ ] **Step 5: Verify the probe applied, then remove it**

Run:
```bash
docker exec docker-postgres psql -U egov -d egov -c "\dt pgr_parity_probe"
docker exec docker-postgres psql -U egov -d egov -c \
  "select version,description,success from pgr_services_schema where version='20260710000000';"
```
Expected: the `pgr_parity_probe` table exists; one successful history row for the probe. This empirically proves incremental Flyway on top of the dump. Now remove the probe (it must never be committed):
```bash
rm backend/pgr-services/src/main/resources/db/migration/main/V20260710000000__parity_probe.sql
$COMPOSE down -v
git status --short   # expect: nothing to commit (probe removed, no tracked changes)
```
Expected: clean tree. Nothing to commit for this task — it is a validation-only task.

---

### Task 4: Keep the alignment check green after the migrator move

**Files:**
- Modify: `.github/scripts/check-flyway-dump-alignment.py`
- Modify: `.github/workflows/flyway-dump-alignment.yml`

**Interfaces:**
- Consumes: the `docker-compose.migrations.yml` overlay from Tasks 1–2.
- Produces: `claimed_tables()` now also reads each `*-migration` service's `SCHEMA_TABLE`, so pgr's table stays "claimed" after its embedded `SPRING_FLYWAY_TABLE` is gone.

**Why:** Task 2 sets `pgr-services` `SPRING_FLYWAY_ENABLED: "false"`, so the current check (which only reads enabled services' `SPRING_FLYWAY_TABLE`) would stop counting `pgr_services_schema` as claimed and fail with `dump_not_claimed`. The check must learn the new source of truth: the migration service's `SCHEMA_TABLE`.

- [ ] **Step 1: Write a failing self-test case**

In `.github/scripts/check-flyway-dump-alignment.py`, inside `self_test()`, after the existing assertions and before the `PENDING_ENABLE, BASELINE_FRESH = saved_p, saved_b` restore line, add:
```python
    # A service migrated to an init container claims its table via SCHEMA_TABLE,
    # not SPRING_FLYWAY_TABLE. That must still count as claimed.
    PENDING_ENABLE, BASELINE_FRESH = set(), set()
    migrated = claimed_tables({
        "pgr-services": {"SPRING_FLYWAY_ENABLED": "false"},
        "pgr-services-migration": {"SCHEMA_TABLE": "pgr_services_schema"},
    })
    assert migrated == {"pgr_services_schema"}, f"migrator SCHEMA_TABLE not claimed: {migrated}"
```

- [ ] **Step 2: Run the self-test to see it fail**

Run:
```bash
cd /home/ubuntu/projects/egov-devops/Citizen-Complaint-Resolution-System
python3 .github/scripts/check-flyway-dump-alignment.py --self-test
```
Expected: FAIL — `AssertionError: migrator SCHEMA_TABLE not claimed: set()` (the current `claimed_tables` ignores `SCHEMA_TABLE`).

- [ ] **Step 3: Teach `claimed_tables` about migration services**

In `claimed_tables()`, replace the loop body so a service claims a table via EITHER an enabled `SPRING_FLYWAY_TABLE` OR a `SCHEMA_TABLE` (the init-container contract):
```python
def claimed_tables(services: dict) -> set:
    """Tables claimed by (a) a Flyway-enabled app via SPRING_FLYWAY_TABLE, or
    (b) a per-service migration init container via SCHEMA_TABLE."""
    claimed = set()
    for env in services.values():
        # (b) init-container migrator: SCHEMA_TABLE is the authoritative name.
        schema_table = env.get("SCHEMA_TABLE")
        if schema_table:
            claimed.add(schema_table.strip())
            continue
        # (a) app with embedded Flyway still enabled.
        relevant = any(k.startswith("SPRING_FLYWAY") for k in env) or "FLYWAY_ENABLED" in env
        if not relevant:
            continue
        flag = env.get("SPRING_FLYWAY_ENABLED", env.get("FLYWAY_ENABLED", "")).strip().strip("'\"").lower()
        if flag in _FALSE:
            continue
        table = env.get("SPRING_FLYWAY_TABLE")
        if table:
            claimed.add(table.strip())
    return claimed
```

- [ ] **Step 4: Point the live check at the migrations overlay too**

In `main()`, add the overlay to the merged compose sources. Change:
```python
    claimed = claimed_tables(merged_services(COMPOSE.read_text(), FAST_PATH.read_text()))
```
to:
```python
    claimed = claimed_tables(merged_services(
        COMPOSE.read_text(), FAST_PATH.read_text(), MIGRATIONS.read_text()))
```
And update `merged_services` to accept a third overlay, plus add the constant near the other paths (after `FAST_PATH = ...`):
```python
MIGRATIONS = ROOT / "local-setup/docker-compose.migrations.yml"
```
Replace `merged_services` with:
```python
def merged_services(*compose_texts: str) -> dict:
    """Per-service env from the base compose with each overlay merged in order."""
    services = {}
    for text in compose_texts:
        data = yaml.safe_load(text) or {}
        for name, spec in (data.get("services") or {}).items():
            services.setdefault(name, {}).update(_env(spec))
    return services
```

- [ ] **Step 5: Run the self-test and the live check**

Run:
```bash
python3 .github/scripts/check-flyway-dump-alignment.py --self-test
python3 .github/scripts/check-flyway-dump-alignment.py; echo "exit=$?"
```
Expected: self-test prints OK; live check prints `OK: ...` with `exit=0` (pgr still counted via the migrator's `SCHEMA_TABLE`).

- [ ] **Step 6: Add the overlay to the workflow trigger paths**

In `.github/workflows/flyway-dump-alignment.yml`, add `local-setup/docker-compose.migrations.yml` to BOTH the `pull_request.paths` and `push.paths` lists (alongside the other compose files).

- [ ] **Step 7: Commit**

Run:
```bash
git add .github/scripts/check-flyway-dump-alignment.py .github/workflows/flyway-dump-alignment.yml
git commit -m "ci: alignment check reads per-service migrator SCHEMA_TABLE (item #10)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Out of scope for this plan (follow-up plans after the pilot proves out)

- **Phase 2** — template the pilot across the other repo-local services (`novu-bridge`, `digit-config-service`, `digit-user-preferences-service`, `xstate-chatbot`, `default-data-handler`).
- **Phase 3** — core services (`boundary-service`, `egov-hrms`, `egov-idgen`, `egov-user`, `egov-localization`, `egov-enc-service`, `egov-filestore`, `egov-workflow-v2`, `mdms-v2`, `egov-url-shortening`, `egov-otp`) + resolve the `egov-accesscontrol` open item; requires the §6 dump rename+re-bake and the §5 image-sourcing decision.
- **Phase 4** — retire the `db-migrations` container, remove embedded `SPRING_FLYWAY_*` and the url-shortening override, re-bake the dump with all renames, wire the overlay into the ansible playbook, and flip the alignment check to a three-way (migrator ↔ dump ↔ K8s `schemaTable`) enforcement.
