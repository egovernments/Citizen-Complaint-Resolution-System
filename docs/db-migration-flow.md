# DB migrations on Docker Compose — how future migrations flow

**Scope:** the Docker Compose stack (`local-setup/`). Explains how a new database
migration reaches a running compose environment, the conditions that must hold for
it to work, and how to add / test / troubleshoot one.

**Model:** compose mirrors Kubernetes — **one Flyway "migration" init container per
service** (`<service>-migration` in `local-setup/docker-compose.migrations.yml`),
run *before* the app, using the **same `egovio/<service>-db:<tag>` image K8s pins**,
writing to the same `<service>_schema` history table. The app's own (embedded)
Flyway is off. Design detail: `docs/superpowers/specs/2026-07-10-compose-k8s-migration-parity-design.md`.

---

## How a future migration flows

A migration is a versioned SQL file (`V<timestamp>__<desc>.sql`). Nobody hand-runs
it; the flow is:

1. **Authoring (upstream, once).** A developer adds `V…__*.sql` to the service's
   repo (`.../db/migration/main/`). This is the only manual step, and it happens in
   the product repo — *not* per environment.
2. **Packaging (automatic).** The `-db` image is a **separate image from the app
   image**, but nobody builds it by hand. Each service's CI builds **both** — the
   service image *and* its `<service>-db` Flyway image (`FROM flyway/flyway` + `COPY
   migration/main /flyway/sql`) — and publishes a **new tag** to `egovio` on Docker
   Hub. This split is declared in **`build/build-config.yml`** (entries whose
   `image-name` ends in `-db`) and driven by `.github/workflows/build.yml`, which
   detects a service's `db/` folder and builds the `-db` target alongside the app.

   > **New service?** Whoever adds it must add its **`<service>-db` entry to
   > `build/build-config.yml`** (next to the app-image entry), the same way K8s
   > needs a `-db` image. Without it, the service's migrations have no image to
   > propagate through — CI won't build one, and there's nothing for the migrator
   > to pull.
3. **Propagation (the compose step).** Bump the service's image tag in
   `local-setup/docker-compose.migrations.yml`:
   ```yaml
   <service>-migration:
     image: egovio/<service>-db:<NEW_TAG>   # was <OLD_TAG>
   ```
4. **Application (automatic, on boot).** On the next `docker compose up`, the
   `<service>-migration` container pulls the new image, Flyway compares its files
   against the recorded history, sees the new version as **pending**, applies it,
   and exits 0. Only then does the app start (it `depends_on:
   service_completed_successfully`).

**Propagation is image-version-gated:** a migration reaches the DB *only* when the
`-db` image tag is bumped. An unchanged tag = no new files = the migrator no-ops.
This is identical to how K8s bumps `initContainers.dbMigration.image.tag`.

```
author V…sql ──► CI builds egovio/<svc>-db:<newtag> ──► bump tag in migrations.yml
                                                              │
                                                    docker compose up
                                                              │
                          <svc>-migration pulls image ► applies pending ► exits 0 ► app starts
```

---

## Conditions for it to work

These are the invariants. If one breaks, boot fails (usually `42P07 relation already
exists`) or the migration silently doesn't apply.

1. **Image is pullable.** `egovio/<service>-db:<tag>` must exist on Docker Hub
   (all current core `-db` images do). Compose only pulls from public registries.
2. **History-table name matches the dump.** The migrator's `SCHEMA_TABLE` must equal
   the history table the dump ships for that service (the K8s `<service>_schema`
   name). If they differ, Flyway sees an empty history and re-runs everything →
   `42P07`. **Enforced in CI** by `.github/scripts/check-flyway-dump-alignment.py`.
3. **The dump records *real* applied versions, not just a baseline.** The dump was
   re-baked so each history table holds the actual applied rows. This is why new
   migrations read as "pending" and already-applied ones as "done." A baseline-only
   history would make the `-db` image re-run everything → `42P07`. (If you ever
   regenerate the dump, keep it consistent with the `-db` images — see Maintenance.)
4. **Migrator connects to the real Postgres.** `DB_URL` points at `postgres-db:5432`,
   **not** the `postgres` alias (that is pgbouncer in transaction mode, which breaks
   Flyway's session locks).
5. **Lenient Flyway flags.** Migrators run with `-baselineOnMigrate=true
   -outOfOrder=true` (from the image's `migrate.sh`) plus
   `FLYWAY_VALIDATE_ON_MIGRATE=false`, so a checksum/ordering difference between the
   dump's lineage and the image doesn't hard-fail.
6. **Cross-service ordering, if the migration reads another service's tables.**
   Most services are self-contained. If a migration `SELECT`s another service's
   tables (e.g. `pgr-services` analytics reads `boundary_relationship`, `eg_user`),
   its migrator must `depends_on` those services being healthy — otherwise it fails
   on a from-empty build. See the `pgr-services-migration` gates for the pattern.
7. **App has embedded Flyway off.** Each converted app sets `SPRING_FLYWAY_ENABLED:
   "false"` so the init container is the single source of migration truth.

---

## Procedure — propagate a new migration

1. Confirm the new `egovio/<service>-db:<tag>` is published and pullable:
   `docker manifest inspect egovio/<service>-db:<tag>`.
2. Edit `local-setup/docker-compose.migrations.yml` → set the `<service>-migration`
   `image:` tag to the new one.
3. Redeploy: `docker compose … up -d`. The migrator applies the new migration; the
   app restarts after it completes.
4. Verify: `docker logs <service>-migration` shows `Successfully applied N
   migration(s)`, and the app comes up healthy.
5. The CI alignment check must stay green (it runs on any change to the overlay /
   dump / compose).

---

## Testing — future-migration smoke test

You don't need a real upstream release to test the mechanism. For any service:

```bash
# 1. Simulate a newer -db image = the real image + one throwaway migration
mkdir probe && cd probe
printf 'CREATE TABLE IF NOT EXISTS <svc>_probe (id integer PRIMARY KEY);\n' \
  > V29990101000000__smoke_probe.sql
printf 'FROM egovio/<service>-db:<tag>\nCOPY V29990101000000__smoke_probe.sql /flyway/sql/\n' \
  > Dockerfile
docker build -t <service>-db:probe .

# 2. Run it against a dump-loaded DB (scratch or the live one)
docker run --rm --network digit_egov-network \
  -e DB_URL=jdbc:postgresql://postgres-db:5432/egov -e SCHEMA_NAME=public \
  -e SCHEMA_TABLE=<service>_schema -e FLYWAY_USER=egov -e FLYWAY_PASSWORD=egov123 \
  -e FLYWAY_LOCATIONS=filesystem:/flyway/sql -e FLYWAY_VALIDATE_ON_MIGRATE=false \
  <service>-db:probe
#   expect: "Successfully applied 1 migration"; re-run → "up to date"

# 3. Clean up
docker exec docker-postgres psql -U egov -d egov \
  -c "DROP TABLE IF EXISTS <svc>_probe;" \
  -c "DELETE FROM <service>_schema WHERE version='29990101000000';"
docker rmi <service>-db:probe
```

This exercises the full chain: pull → detect pending → apply → idempotent re-run.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `42P07 relation "X" already exists` on boot | `SCHEMA_TABLE` ≠ the dump's history name, or the dump's history is baseline-only | Align the name (run the alignment check); ensure the dump carries real history (Maintenance) |
| `relation "…" does not exist` (a *different* service's table) | migration reads another service's tables and ran too early | add `depends_on: { <dep-service>: { condition: service_healthy } }` to the migrator |
| Migrator no-ops but expected a new migration | image tag wasn't bumped | bump `<service>-migration` `image:` tag |
| `Migration checksum mismatch` | dump lineage ≠ image lineage | already mitigated by `FLYWAY_VALIDATE_ON_MIGRATE=false`; if it still fails, regenerate the dump |
| App won't start, migrator `Exited (1)` | migration itself failed | read `docker logs <service>-migration` |

---

## Maintenance — keeping the dump honest

The dump is the fast-path baseline; the migrators apply anything newer on top. The
further the dump lags the pinned `-db` tags, the more migrations apply at boot and
the higher the chance of hitting a lineage difference. Periodically **regenerate the
dump from the `-db` images** so its history matches them:

1. Load the current dump into a scratch DB (preserves seed/master data).
2. For each service, run its (current-tag) `-db` image on an empty DB, capture its
   history, and swap it into the dump under the `<service>_schema` name (data tables
   untouched). *(This is exactly the re-bake procedure from item #10.)*
3. Round-trip check: fresh-load the new dump, run all migrators → all no-op.

The **CI alignment check** guards naming drift on every PR; the **smoke test** above
guards the apply path. Regenerating the dump on a cadence guards content drift.
