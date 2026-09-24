# Migrating PostgreSQL onto the named volume

**For:** the engineer who owns the deployment. Server access, root, a maintenance window.

**Why:** the base compose mounts `postgres_data` at `/var/lib/docker-postgresql/data` — a
path PostgreSQL never uses. The real database therefore lives in an **anonymous** volume
that Docker created on its own. The volume the compose file names is empty
([#2085](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2085)).

Nothing is broken today: the database persists across restarts. But the data is one
`docker compose down -v`, one `docker system prune`, or one change to the postgres volume
line away from being stranded. This procedure moves it into the named volume, after which
that exposure is gone and `db_fast_path` is safe to use on the box.

**Run this before** pulling any branch that corrects the mount path, and before enabling
`db_fast_path` on a box that already holds data.

← back to **[Operations handbook](README.md)**

---

## Before you start

- [ ] A maintenance window. The stack is down for the whole procedure.
- [ ] Free disk space on this box for **twice** the database size — once for the backup,
      once for the copy in step 4. Step 2 checks this.
- [ ] Somewhere off the box for a second copy of the backup, **if you have it**. Not required;
      the procedure is written to work on a single machine.
- [ ] Do this on **one box at a time**, least critical first.
- [ ] Nobody else is deploying to this box while you work.

**Do not run any of these at any point:** `docker compose down -v`, `docker volume rm`,
`docker volume prune`, `docker system prune`. Steps 1–8 never delete anything — the old
volume is your rollback, and it stays until a separate cleanup weeks from now. The one
deletion in this runbook is step D of
[Data directory not on a volume](#data-directory-not-on-a-volume), and it runs only after an
archive has been checked.

Every step below says what you should see. **If you see anything else, stop.** Do not
continue to the next step and do not improvise — an aborted migration leaves the box exactly
as it was.

---

## 1. Confirm the box is actually affected

Ask the running server where its data is. Do not infer it from the mount paths: a
per-tenant overlay can set `PGDATA` (Nairobi's did), and then the mounts alone mislead.

```bash
cd /opt/digit   # or wherever the stack lives
DATADIR=$(docker exec docker-postgres psql -U egov -d egov -tAc 'show data_directory')
echo "data dir : $DATADIR"
docker inspect docker-postgres \
  --format '{{ range .Mounts }}{{ .Destination }}  {{ .Name }}{{ "\n" }}{{ end }}'
```

**Expect** `data dir : /var/lib/postgresql/data`, and a 64-character hex name on the mount
line with that same path:

```
data dir : /var/lib/postgresql/data
/var/lib/docker-postgresql/data   digit_postgres_data
/var/lib/postgresql/data          9c2f1ab4de77aa1190c3e5b8f0d6c4a72e5b9138aa4c6d2e0f7b3a5c8d1e4f60
```

Find the mount line whose path is **exactly** `data dir`:

- **Hex name, and `data dir` is `/var/lib/postgresql/data`** → affected, continue.
- **A `*_postgres_data` name** → the data is already on the named volume. **Stop, there is
  nothing to do** — whatever `data dir` says. On a box whose `data dir` is
  `/var/lib/docker-postgresql/data`, steps 5–6 would move the volume *off* the data and
  bring Postgres up empty.
- **No mount line matches `data dir`** → the database is in the container's own filesystem,
  and the next recreate or redeploy deletes it. **Do not stop, recreate or redeploy
  anything.** Go to [Data directory not on a volume](#data-directory-not-on-a-volume).
- **Hex name at any other path, `data dir` empty, or `psql` fails** → stop and escalate; this
  box is in a shape this runbook does not cover.

Capture both names — the rest of the procedure uses them:

```bash
ANON=$(docker inspect docker-postgres \
  --format '{{ range .Mounts }}{{ if eq .Destination "/var/lib/postgresql/data" }}{{ .Name }}{{ end }}{{ end }}')
NAMED=$(docker inspect docker-postgres \
  --format '{{ range .Mounts }}{{ if eq .Destination "/var/lib/docker-postgresql/data" }}{{ .Name }}{{ end }}{{ end }}')
echo "anonymous: $ANON"
echo "named    : $NAMED"

# The -f list this stack was actually brought up with. The deploy layers
# several files (fast-path, migrations, monitoring, matomo, sometimes a
# per-tenant overlay); a bare `-f docker-compose.egov-digit.yaml` would
# recreate services from their BASE definitions and silently drop whatever
# those overlays set. Take it from the container rather than retyping it.
COMPOSE_FILES=$(docker inspect docker-postgres \
  --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' \
  | tr ',' '\n' | sed 's/^/-f /' | tr '\n' ' ')
echo "compose  : $COMPOSE_FILES"
```

**Expect** the same two values, and a `compose` line naming every file the deploy layered —
on a normal box that is five or six, not one. Do not type any of these by hand below: use the
variables, and keep this shell open for the whole procedure.

---

## 2. Back up

**Check there is room first.** The backup and the volume copy in step 4 each need space, and
a box that fills up mid-copy is a worse problem than the one you are fixing:

```bash
df -h /var/lib/docker /root
docker exec docker-postgres psql -U egov -d egov -tAc \
  "select pg_size_pretty(pg_database_size('egov'));"
```

**Expect** free space of at least twice the reported database size.

- **Space is tight** → **stop** and free some first. Do not start and hope.

With the stack still running:

```bash
docker exec docker-postgres pg_dumpall -U egov | gzip > /root/pg-backup-$(date +%F).sql.gz
ls -lh /root/pg-backup-*.sql.gz
gzip -t /root/pg-backup-*.sql.gz && echo "archive OK"
zcat /root/pg-backup-*.sql.gz | tail -3
```

**Expect** a plausible file size (tens to hundreds of MB compressed on a live tenant, never a
few KB), the words `archive OK`, and a last line reading `--` or
`-- PostgreSQL database cluster dump complete`.

- **File is tiny, `gzip -t` fails, or the tail shows an error** → **stop.** The backup did not
  work, and nothing else in this procedure should run.

`/root` is deliberate: it is outside `/var/lib/docker`, so a `docker system prune` cannot
reach it. Do not put the backup inside the stack directory.

If you do have somewhere off the box, copy it there as well — that is the only copy that
survives the disk itself failing. It is not required for this procedure:

```bash
# optional, only if you have somewhere to put it
scp /root/pg-backup-*.sql.gz you@elsewhere:/backups/
```

Record the row counts you will verify against later:

```bash
docker exec docker-postgres psql -U egov -d egov -tAc \
  "select count(*) from eg_pgr_service_v2;"
docker exec docker-postgres psql -U egov -d egov -tAc \
  "select count(*) from pg_tables where schemaname='public';"
```

**Expect** two numbers. Write them down.

---

## 3. Stop the stack

```bash
docker compose $COMPOSE_FILES stop
docker ps --filter "name=docker-postgres" --format '{{.Names}} {{.Status}}'
```

**Expect** no output from the second command — the container is stopped.

`stop`, not `down`. The container must survive so its volume stays attached and nothing
becomes dangling mid-procedure.

---

## 4. Copy the data into the named volume

```bash
docker run --rm \
  -v "$ANON":/from:ro \
  -v "$NAMED":/to \
  alpine sh -c 'cp -a /from/. /to/ && ls /to/PG_VERSION && du -sh /from /to'
```

**Expect** `/to/PG_VERSION` to be listed, and the two `du` sizes to match.

- **Sizes differ, or `PG_VERSION` is missing** → **stop.** Nothing has been lost: the source
  is mounted read-only and the stack is still pointing at it. Escalate.

The source is `:ro` on purpose. This step cannot damage the original.

This is the one step that needs an image the box may not have. If `alpine` is not present
locally, Docker pulls it (~4 MB) — so on a box with restricted egress, pull it before your
maintenance window, or substitute an image that is already there:

```bash
docker image inspect alpine >/dev/null 2>&1 && echo "alpine present" || docker pull alpine
```

---

## 5. Point the compose file at the named volume

Edit `docker-compose.egov-digit.yaml`, in the `postgres-db` service:

```diff
   volumes:
-    - postgres_data:/var/lib/docker-postgresql/data
+    - postgres_data:/var/lib/postgresql/data
```

```bash
grep -nE '^[[:space:]]*-[[:space:]]*postgres_data:' docker-compose.egov-digit.yaml
```

**Expect** exactly one line, ending `/var/lib/postgresql/data`. The anchor matters: an
unanchored search also matches `mcp_postgres_data` and `keycloak_postgres_data`, which are
digit-mcp's and Keycloak's own databases and are not what you are editing.

Then check what compose will actually run, after every overlay has been merged:

```bash
docker compose $COMPOSE_FILES config postgres-db | grep -E 'PGDATA|source: postgres_data|target: /var/lib'
```

**Expect** `source: postgres_data` with `target: /var/lib/postgresql/data`, and either no
`PGDATA` line or `PGDATA: /var/lib/postgresql/data`.

- **`PGDATA` names any other path** → an overlay overrides it. **Stop.** Starting now would
  put Postgres on an unmounted directory and bring it up empty.

---

## 6. Bring it back up

```bash
docker compose $COMPOSE_FILES up -d postgres-db
sleep 15
docker logs docker-postgres 2>&1 | grep -E 'init process complete|ready to accept'
```

The container was just recreated, so these are its logs only. **Expect**
`database system is ready to accept connections`, and **nothing else**.

- **You see `PostgreSQL init process complete`** → **stop immediately** and go to
  [Rollback](#rollback). It came up on an empty directory: the copy did not take, or step 4
  was skipped. Do not start the rest of the stack.

---

## 7. Verify before releasing the box

```bash
docker exec docker-postgres psql -U egov -d egov -tAc \
  "select count(*) from eg_pgr_service_v2;"
docker exec docker-postgres psql -U egov -d egov -tAc \
  "select count(*) from pg_tables where schemaname='public';"
docker inspect docker-postgres \
  --format '{{ range .Mounts }}{{ .Destination }}  {{ .Name }}{{ "\n" }}{{ end }}'
```

**Expect** both counts to match what you wrote down in step 2, and the mount at
`/var/lib/postgresql/data` to now show the `*_postgres_data` name rather than a hex string.

- **Counts differ** → **stop** and go to [Rollback](#rollback).

Then start everything else and check the application actually works — log in, open a
complaint, confirm the data is the tenant's own:

```bash
docker compose $COMPOSE_FILES up -d
```

---

## 8. Leave the old volume alone

`$ANON` is still on the box, holding the pre-migration database. **Leave it there.**

Do not delete it in this window, this week, or as part of this task. Reclaiming it is a
separate decision, taken after the migrated volume has carried production for a few weeks
and a fresh backup has been taken. Until then it is the only rollback that needs no restore.

Record the volume id in the deployment notes so whoever cleans up later knows what it was.

---

## Rollback

Nothing destructive has happened at any point, so rollback is just pointing the compose file
back:

```bash
docker compose $COMPOSE_FILES stop
# revert the volume line in docker-compose.egov-digit.yaml
docker compose $COMPOSE_FILES up -d
```

The original anonymous volume is untouched. Compose carries the previous container's
mount at `/var/lib/postgresql/data` across the recreate, so reverting the line puts Postgres
back on the data it had — measured, not assumed.

**That depends on the container still existing.** Step 3 says `stop`, not `down`, for exactly
this reason. If the container has since been removed — you ran `down`, or `force_clean` — there
is nothing to carry over and Postgres will come up on a fresh empty volume. In that case mount
the old volume explicitly by its id instead of relying on the carry-over: put

```yaml
services:
  postgres-db:
    volumes:
      - <the $ANON id from step 1>:/var/lib/postgresql/data
```

in a small override file and add it to the `-f` list.

Either way, confirm with the step 7 counts before you believe it, then escalate with what you
saw.

If the anonymous volume has somehow been lost, restore the step 2 backup into a fresh
cluster instead — which is why that backup is not optional:

```bash
zcat /root/pg-backup-*.sql.gz | docker exec -i docker-postgres psql -U egov -d postgres
```

**Expect** it to run to completion without errors, then verify with the step 7 counts.

---

## Data directory not on a volume

Step 1 sent you here because no mount matches `data dir`. The database lives in the
container's writable layer: it survives restarts, and is deleted by the next recreate. There
is nothing to copy from, so the procedure is **dump, rebuild on the named volume, restore**.

The dump is the only copy of the data. Do step A before anything else.

**A. Dump.** Step 2 as written, with the stack still running, then keep a second copy:

```bash
cp /root/pg-backup-$(date +%F).sql.gz /root/pg-backup-$(date +%F).KEEP.sql.gz
```

**B. Make the compose files agree.** Back up every file you edit to `/root` first. Set the
base mount as in step 5, and in any overlay that sets `PGDATA`, change it to
`/var/lib/postgresql/data`. Then run the step 5 `config` check.

**Expect** `PGDATA: /var/lib/postgresql/data` (or none), `source: postgres_data` and
`target: /var/lib/postgresql/data`, with no other path anywhere.

**C. Stop the stack** as in step 3, and capture the compose list first if you have not.

**D. Empty the named volume.** It usually holds an older cluster, and the restore needs an
empty one — restoring over it mixes old and new rows without an obvious error. Archive it,
check the archive, and only then empty it:

```bash
docker run --rm -v digit_postgres_data:/v:ro -v /root:/backup alpine \
  tar czf /backup/digit_postgres_data-before-restore.tgz -C /v .
ls -lh /root/digit_postgres_data-before-restore.tgz
tar tzf /root/digit_postgres_data-before-restore.tgz | grep -c PG_VERSION
```

**Expect** a non-trivial size and a non-zero count if the volume held a cluster, or a
tiny archive and `0` if it was already empty. Then:

```bash
docker run --rm -v digit_postgres_data:/v alpine sh -c 'rm -rf /v/* && ls -A /v | wc -l'
```

**Expect** `0`.

**E. Start Postgres alone.** This time `initdb` must run, **inside the volume**:

```bash
docker compose $COMPOSE_FILES up -d postgres-db
sleep 15
docker logs docker-postgres 2>&1 | grep -E 'init process complete|ready to accept'
docker inspect docker-postgres \
  --format '{{ range .Mounts }}{{ .Destination }}  {{ .Name }}{{ "\n" }}{{ end }}'
stat -c '%y' /var/lib/docker/volumes/digit_postgres_data/_data/global/pg_control
```

**Expect** `init process complete` then `ready to accept connections`, one mount
`/var/lib/postgresql/data  digit_postgres_data`, and a `pg_control` time from the last minute.

- **`pg_control` is old or missing** → Postgres is not writing to the volume. **Stop.**

**F. Restore:**

```bash
zcat /root/pg-backup-$(date +%F).sql.gz \
  | docker exec -i docker-postgres psql -U egov -d postgres 2>&1 \
  | grep -E 'ERROR|FATAL' | sort | uniq -c
```

**Expect** exactly two lines: `role "egov" already exists` and `database "egov" already
exists`. `initdb` created both; the rest of the dump loads into them.

- **Any other error** → **stop** and escalate. Do not start the stack.

**G. Verify** with the step 7 counts. They must match step 2.

**H. Prove it survives a recreate** — the failure that made this section necessary:

```bash
docker compose $COMPOSE_FILES up -d --force-recreate postgres-db
sleep 15
docker logs docker-postgres 2>&1 | grep -c 'init process complete'
docker exec docker-postgres psql -U egov -d egov -tAc "select count(*) from eg_pgr_service_v2;"
```

**Expect** `0`, then the step 2 complaint count.

**I. Start the stack**, as at the end of step 7. Leave the dumps, the archive and every old
volume in place, as in step 8.

**Before the next deploy to this box:** the edits in B exist only on the box. Make the same
change wherever the playbook copies the overlay from, or the deploy puts the old `PGDATA`
back. The playbook's guard compares mount paths; it does not read `PGDATA`, so it will not
stop that deploy.

---

## Field notes

What running this runbook on real boxes found. Read these before you start.

**Bomet** (`egov-digit-installation`, 2026-09-24) — **not affected, nothing to do.** Deployed
with `db_fast_path`, so `digit_postgres_data` is mounted twice: at `/var/lib/postgresql/data`
(from `docker-compose.fast-path.yml`) and at `/var/lib/docker-postgresql/data` (from the base).
Compose merges volume lists by container path, and the paths differ, so both are kept. Both
point at the same directory; Postgres uses only the first. `data dir` is
`/var/lib/postgresql/data`, the volume holds 11 GB written continuously, and no anonymous
volume on the box holds a cluster. The fast-path dump is still mounted into
`/docker-entrypoint-initdb.d/`; it only runs if the data directory is ever empty. Never empty
this volume.

**Nairobi** (`egov-nairobi`, 2026-09-24) — **the old step 1 did not catch it, and the database
came up empty.** On 2026-08-06 someone had worked around #2085 by hand: they copied the
cluster into `digit_postgres_data` and set `PGDATA: /var/lib/docker-postgresql/data` in
`docker-compose.nairobi.yml`, keeping the base mount. The old step 1 looked only at mounts,
saw a hex name at `/var/lib/postgresql/data`, and called the box affected. Step 5 then moved
the volume away from the path `PGDATA` names; `initdb` ran in the container's own filesystem
and Postgres came up empty.

Worse, neither volume had been written since 2026-08-06 — both clusters' `pg_control` said so
— while that morning's database had 11 more tables than on 2026-08-06. The live database had
been in the container's writable layer, and the recreate deleted it. Why the container was not
writing to the volume `PGDATA` named was not established.

It was recovered with the step 2 dump, using the procedure in
[Data directory not on a volume](#data-directory-not-on-a-volume). Final state:
`digit_postgres_data` at `/var/lib/postgresql/data`, the overlay's `PGDATA` set to the same
path, survives a recreate. The new step 1 check (`show data_directory`) and the step 5
`config` check both exist because of this box. So does the step 6 `grep`: `tail -20` had
scrolled the `initdb` messages out of view.

---

## After every box is migrated

The compose path fix lands centrally so nobody has to hand-edit it again
([#2085](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2085)).
Until then, a box migrated by this runbook has a locally modified
`docker-compose.egov-digit.yaml`, and a deploy from a branch without that fix would overwrite
it and put the wrong path back — stranding the data a second time.

You do not have to remember this. The playbook refuses in both directions:

- an **unmigrated** box (database in an anonymous volume) — it will not deploy at all;
- a **migrated** box where the compose file being installed still has the old path — it stops
  and tells you to deploy from a branch carrying the fix, or to re-apply steps 5 and 6
  immediately afterwards.

So the safe order is: migrate the box, then deploy only from a branch that has the mount-path
fix. A routine deploy in between is blocked rather than silently destructive.
