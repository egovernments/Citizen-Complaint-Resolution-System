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
`docker volume prune`, `docker system prune`. This procedure never deletes anything — the
old volume is your rollback, and it stays until a separate cleanup weeks from now.

Every step below says what you should see. **If you see anything else, stop.** Do not
continue to the next step and do not improvise — an aborted migration leaves the box exactly
as it was.

---

## 1. Confirm the box is actually affected

```bash
cd /opt/digit   # or wherever the stack lives
docker inspect docker-postgres \
  --format '{{ range .Mounts }}{{ .Destination }}  {{ .Name }}{{ "\n" }}{{ end }}'
```

**Expect** two lines, one of them a 64-character hex name at the real data path:

```
/var/lib/docker-postgresql/data   digit_postgres_data
/var/lib/postgresql/data          9c2f1ab4de77aa1190c3e5b8f0d6c4a72e5b9138aa4c6d2e0f7b3a5c8d1e4f60
```

- **Hex name on the `/var/lib/postgresql/data` line** → affected, continue.
- **A `*_postgres_data` name on that line** → already migrated, or never affected. **Stop,
  there is nothing to do.**
- **No `/var/lib/postgresql/data` line at all** → stop and escalate; this box is in a shape
  this runbook does not cover.

Capture both names — the rest of the procedure uses them:

```bash
ANON=$(docker inspect docker-postgres \
  --format '{{ range .Mounts }}{{ if eq .Destination "/var/lib/postgresql/data" }}{{ .Name }}{{ end }}{{ end }}')
NAMED=$(docker inspect docker-postgres \
  --format '{{ range .Mounts }}{{ if eq .Destination "/var/lib/docker-postgresql/data" }}{{ .Name }}{{ end }}{{ end }}')
echo "anonymous: $ANON"
echo "named    : $NAMED"
```

**Expect** the same two values you just read. Do not type these by hand anywhere below —
use the variables, and keep this shell open for the whole procedure.

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
docker compose -f docker-compose.egov-digit.yaml stop
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

---

## 6. Bring it back up

```bash
docker compose -f docker-compose.egov-digit.yaml up -d postgres-db
sleep 15
docker logs docker-postgres 2>&1 | tail -20
```

**Expect** `database system is ready to accept connections`.

- **You see `initdb` running, or `Success. You can now start the database server`** →
  **stop immediately** and go to [Rollback](#rollback). That message means it came up on an
  empty directory and the copy did not take.

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
docker compose -f docker-compose.egov-digit.yaml up -d
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
docker compose -f docker-compose.egov-digit.yaml stop
# revert the volume line in docker-compose.egov-digit.yaml
docker compose -f docker-compose.egov-digit.yaml up -d
```

The original anonymous volume is untouched and re-attaches by name. Confirm with the
step 7 counts, then escalate with what you saw.

If the anonymous volume has somehow been lost, restore the step 2 backup into a fresh
cluster instead — which is why that backup is not optional:

```bash
zcat /root/pg-backup-*.sql.gz | docker exec -i docker-postgres psql -U egov -d postgres
```

**Expect** it to run to completion without errors, then verify with the step 7 counts.

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
