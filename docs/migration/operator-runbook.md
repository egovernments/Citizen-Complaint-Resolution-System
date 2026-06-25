# Complaint Hierarchy Migration — Operator Runbook (2-level → N-level)

> **Status:** PROVEN end-to-end on the local `ke` stack (2026-06-24).
> This is the *battle-tested* step-by-step, including every gotcha we hit.
> For the design rationale see [complaint-type-2level-to-Nlevel.md](./complaint-type-2level-to-Nlevel.md) (§8 is the canonical lockstep).

## What this migrates
The old flat masters (`RAINMAKER-PGR.ServiceDefs` grouped by `menuPath`) → the merged N-level masters
(`RAINMAKER-PGR.ComplaintHierarchyDefinition` + `RAINMAKER-PGR.ComplaintHierarchy`). Leaf `code` is kept
**verbatim** from the old `serviceCode`, so already-filed complaints (`eg_pgr_service_v2.servicecode`) still resolve.

It is a **breaking, lockstep cutover with NO fallback**: after pgr-services is repointed, any *un-migrated*
tenant throws `INVALID_SERVICECODE` on every complaint. **Migrate every used tenant before the backend deploy.**

---

## 0. Prerequisites
- On the feature branch: `git checkout feat/complaint-hierarchy-2master`
- Know your values (local example shown):
  - Gateway `BASE_URL` = `http://localhost:18000` (server: `https://<domain>`)
  - State tenant = `ke`; tenants to migrate = `ke`, `ke.ige` (cities scoped to their own types)
  - DB: container `docker-postgres`, user/db `egov`/`egov`
- Scripts (all Node built-ins, no `npm install`): `docs/migration/{install-schemas.cjs, preflight-dryrun.cjs, migrate.cjs, run-data-migration.sh}`

## 1. Backup (rollback insurance — do this first)
```bash
docker exec docker-postgres pg_dump -U egov -Fc egov > ~/pre-migration-$(date +%F).dump
ls -lh ~/pre-migration-*.dump        # must be non-empty
# rollback later if needed:
# docker exec -i docker-postgres pg_restore -U egov -d egov --clean --if-exists < ~/pre-migration-<date>.dump
```

---

## 2. DATA migration — the one-command path
```bash
cd /home/user/Documents/CCRS/Citizen-Complaint-Resolution-System
BASE_URL=http://localhost:18000 \
TENANTS="ke ke.ige" \
PSQL="docker exec docker-postgres psql -U egov -d egov" \
  bash docs/migration/run-data-migration.sh
```
The script does, in order: **login once → install schemas → x-ref fix → migrate each tenant SCOPED → verify.**
It is idempotent. On the server, point `BASE_URL` at the gateway and `PSQL` at the MDMS DB.

> Cities are migrated **scoped** (`STATE_TENANT=<self>`) so each keeps only its own catalog. The state tenant
> (`ke`) holds the full master set. See gotcha (G2) for why scoping matters.

### What the script does, manually (if you need to run a step alone)
```bash
export BASE_URL=http://localhost:18000

# 2a. Install the schemas (migrate.cjs / configurator do NOT create them; they only write into them)
TENANT=ke.ige node docs/migration/install-schemas.cjs

# 2b. x-ref-schema jsonb fix (MDMS create persists [] as {} -> first data write 400s). REQUIRED.
docker exec docker-postgres psql -U egov -d egov -c \
"UPDATE eg_mdms_schema_definition SET definition=jsonb_set(definition,'{x-ref-schema}','[]'::jsonb)
 WHERE code LIKE 'RAINMAKER-PGR.ComplaintHierarchy%' AND jsonb_typeof(definition->'x-ref-schema')='object';"

# 2c. Preflight (READ-ONLY, must come back "SAFE TO MIGRATE")
TENANT=ke.ige node docs/migration/preflight-dryrun.cjs

# 2d. Migrate each tenant, scoped to its own types
TENANT=ke     STATE_TENANT=ke     node docs/migration/migrate.cjs
TENANT=ke.ige STATE_TENANT=ke.ige node docs/migration/migrate.cjs
```

### Verify the data landed
```bash
docker exec docker-postgres psql -U egov -d egov -tAc \
"SELECT tenantid,count(*) FROM eg_mdms_data WHERE schemacode='RAINMAKER-PGR.ComplaintHierarchy' GROUP BY tenantid ORDER BY 1;"
# proven result: ke=249 (76 cat + 173 leaf), ke.ige=138 (45 cat + 93 leaf)
```

---

## 3. CUTOVER deploy (lockstep — only after every used tenant is migrated)

### 3a. Build pgr-services from the branch — `deploy.sh` does NOT build it
```bash
cd /home/user/Documents/CCRS/Citizen-Complaint-Resolution-System
docker build -f build/maven/Dockerfile --build-arg WORK_DIR=backend/pgr-services -t pgr-services-dev:2master .
# verify the cutover code is in the jar:
docker run --rm --entrypoint sh pgr-services-dev:2master -c \
'cd /tmp && jar xf /opt/egov/*.jar BOOT-INF/classes && grep -rl ComplaintHierarchy BOOT-INF/classes | wc -l'
# expect 8 class files
```

### 3b. Deploy the rest via ansible (builds digit-ui / configurator / default-data-handler / mcp from the branch)
```bash
cd local-setup/ansible && ./deploy.sh bomet     # bomet = localhost; ~20-45 min; data-safe (no down -v)
```
*(Faster targeted alternative if you only need backend + UI: recreate pgr-services with
`cd /opt/digit && sudo env PGR_SERVICES_IMAGE=pgr-services-dev:2master docker compose -f docker-compose.egov-digit.yaml up -d --no-deps --force-recreate pgr-services`, then build digit-ui via esbuild + `docker cp`.)*

### 3c. Post-deploy re-checks (DDH re-seed can revert the x-ref fix)
```bash
# re-apply x-ref fix
docker exec docker-postgres psql -U egov -d egov -c \
"UPDATE eg_mdms_schema_definition SET definition=jsonb_set(definition,'{x-ref-schema}','[]'::jsonb)
 WHERE code LIKE 'RAINMAKER-PGR.ComplaintHierarchy%' AND jsonb_typeof(definition->'x-ref-schema')='object';"
# confirm data survived
docker exec docker-postgres psql -U egov -d egov -tAc \
"SELECT tenantid,count(*) FROM eg_mdms_data WHERE schemacode='RAINMAKER-PGR.ComplaintHierarchy' GROUP BY tenantid ORDER BY 1;"
# confirm pgr-services is on the new image + healthy
docker inspect digit-pgr-services-1 --format '{{.Image}}  {{.State.Health.Status}}'
# confirm digit-ui is the branch bundle
docker exec digit-ui sh -c 'grep -lq COMPLAINT_HIERARCHY /var/web/digit-ui/index.js && echo "branch ✅" || echo "stock ❌"'
```

---

## 4. Verify end-to-end (the gate before retiring old masters)
At tenant **ke.ige** (hard-refresh the browser first):
1. Citizen → create complaint → N-level picker renders (`COMPLAINT_HIERARCHY.*` labels).
2. Employee → assign → **no `INVALID_ASSIGNMENT`** (proves pgr-services validates against ComplaintHierarchy).
3. Resolve → RESOLVED.
4. A pre-migration complaint still opens (serviceCode preserved).

## 5. Retire old masters — LAST, only after step 4 passes
Deactivate/delete `RAINMAKER-PGR.ServiceDefs` / `ClassificationNode` / `ComplaintTypeDepartments`.
**Keep them until step 4 passes** — together with your snapshot they are the rollback path.

## 6. Rollback
```bash
docker exec -i docker-postgres pg_restore -U egov -d egov --clean --if-exists < ~/pre-migration-<date>.dump
# + redeploy the previous (pre-cutover) pgr-services image and frontend.
```

---

## Gotchas reference (the ones that actually bit us)
- **(G1) Schema is a prerequisite.** `migrate.cjs` and the configurator migrate button both ABORT if the
  `ComplaintHierarchy` schemas are missing — neither creates them. Use `install-schemas.cjs` (local) or rely on
  the branch's `default-data-handler` (server CD).
- **(G2) `TENANTS` overrides `TENANT` in `migrate.cjs`.** If `TENANTS` is exported it runs **union mode**
  (every city inherits the full state catalog). For per-tenant "own types only", run each with
  `STATE_TENANT=<self>` and do not export `TENANTS`. (`run-data-migration.sh` handles this.)
- **(G3) x-ref-schema `{}` quirk.** MDMS schema create persists `x-ref-schema: []` as `{}` → first data write
  400s. Fix in SQL after every schema (re)create; `_update` is 501 so it can't be fixed via API.
- **(G4) serviceCode == menuPath collisions.** A malformed `ServiceDef` whose `serviceCode` equals its
  `menuPath` (e.g. seed `OpenDefecation` at `ke`/`pg`) collides (leaf code == category code). Blank the
  `menuPath` (`UPDATE eg_mdms_data SET data=jsonb_set(data,'{menuPath}','""') WHERE ...`) or migrate that
  tenant scoped so it isn't pulled in.
- **(G5) `deploy.sh bomet` builds everything EXCEPT pgr-services.** host_vars `build_*: true` cover
  digit-ui/configurator/DDH/mcp; pgr-services is *run* from the `pgr-services-dev:2master` image — build it
  manually first (step 3a) or you deploy a stale backend.
- **(G6) deploy is data-safe but re-seeds DDH.** No `down -v` (volumes kept; full-dump only loads into an
  empty DB), so data survives — but DDH re-seed can revert the x-ref fix → re-apply (step 3c).
- **(G7) No fallback.** Migrate every used tenant before the backend cutover, or those tenants hard-fail.
- **(G8) V2 grain-MV gap.** The analytics materialized-view forward Flyway migration was not authored on the
  branch (still reads `ServiceDefs`/`menuPath`) — does not block the complaint flow, but dashboards using the
  grain MV are stale until a `repoint_grain_mvs_to_complainthierarchy` migration is added.

## Server differences
- **Schema install:** your CD deploys the branch `default-data-handler`, which registers the schema — so you
  can skip step 2a (`install-schemas.cjs` is the fallback). Still apply the x-ref fix + run `migrate.cjs`.
- **Deploy:** replace `deploy.sh bomet` / local docker steps with your CD/helm pipeline (deploy pgr-services,
  digit-ui, configurator, default-data-handler from the release).
- **Same everywhere:** the data migration (steps 1–2, 4–6) and all gotchas above.
