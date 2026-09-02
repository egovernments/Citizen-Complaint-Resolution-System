# Migrating `ServiceDefs` to `ComplaintHierarchy` — current (v2.12+) procedure

*For an operator moving an existing tenant's complaint-category data (and the transactional complaints that reference it) from the old flat `RAINMAKER-PGR.ServiceDefs` master to the new `ComplaintHierarchyDefinition` + `ComplaintHierarchy` masters, on a deployment that is already running v2.12 (or later) — i.e. the backend, frontends, and MDMS schemas for the new model are already the live deployment, not something you still need to build or cut over.*

> **This document supersedes the cutover-deploy portions of [operator-runbook.md](./operator-runbook.md) for any v2.12+ deployment.** That runbook was written while the two-master model was still on a feature branch (`feat/complaint-hierarchy-2master`) — its Section 3 ("build pgr-services from the branch", "deploy via ansible with `build_*: true`") described *shipping the feature*, which is no longer relevant once you're running v2.12: the schemas are already registered by `default-data-handler`, and `pgr-services`/the frontends already validate exclusively against `ComplaintHierarchy`. What's left for a v2.12 operator is purely the **per-tenant data migration** — this document covers exactly that, for both Docker Compose and Kubernetes deployments. The gotchas catalogued in `operator-runbook.md` (G1–G10) and the department/analytics checks in [tenant-department-migration-guide.md](./tenant-department-migration-guide.md) are still fully applicable and are cited by number below rather than repeated.

---

## 1. What this migrates, and what it does not touch

- **Migrates:** the city-editable master data — `RAINMAKER-PGR.ServiceDefs` (and, if present, the older `ClassificationNode`/`ComplaintTypeDepartments` masters) — into `RAINMAKER-PGR.ComplaintHierarchyDefinition` (the hierarchy shape) and `RAINMAKER-PGR.ComplaintHierarchy` (the actual category/sub-type tree).
- **Does not rewrite:** the transactional complaint records themselves. `eg_pgr_service_v2.servicecode` is left completely untouched. This works because the migration keeps every leaf's `code` **verbatim** equal to the old `serviceCode` — a complaint filed against `NoWaterSupply` before the migration still has `servicecode = 'NoWaterSupply'` after it, and that string now resolves against the new master instead of the old one. **No `UPDATE` against `eg_pgr_service_v2` is part of this procedure, and none should be needed.**
- **Does touch, indirectly, other transactional/reporting data:** the analytics grain tables (`complaint_facts`, `complaint_events`) re-resolve each complaint's department/category through the new master on their next refresh, and any in-flight workflow notification for an old complaint is only as good as whether that complaint's `servicecode` has a matching leaf in the new master (see §4).

## 2. Before you start

1. **Snapshot the source masters for every tenant you're migrating** — export `RAINMAKER-PGR.ServiceDefs` (and `ClassificationNode`/`ComplaintTypeDepartments` if present) via an MDMS `_search`, and take a full database snapshot. This is your rollback artifact. The leaves are *moved*, not copied-and-kept, so you cannot reconstruct them by deleting the new master and hoping the old one is still intact — restoring from this snapshot is the only rollback path.
   - Docker Compose: `docker exec docker-postgres pg_dump -U egov -Fc egov > pre-migration-$(date +%F).dump`
   - Kubernetes: `kubectl exec -n digit $(kubectl get pod -n digit -l app=postgres-db -o jsonpath='{.items[0].metadata.name}') -- pg_dump -U egov -Fc egov > pre-migration-$(date +%F).dump`
2. Know your tenant IDs: the **city tenant** (where citizens/employees pick a category) and its **state-root tenant** (where `pgr-services` actually validates — `MultiStateInstanceUtil.getStateLevelTenant`). Both need the migrated data; the scripts below write to both automatically when you pass `STATE_TENANT`.
3. Know your gateway address (`BASE_URL` below):
   - Docker Compose: `http://localhost:18000` (or your published Kong port)
   - Kubernetes: port-forward the gateway first — `kubectl port-forward -n digit svc/kong 18000:8000` — then use `http://localhost:18000` from your workstation, or run the script from a pod already inside the cluster using `http://kong.digit.svc.cluster.local:8000`.

## 3. Run the data migration

Two equivalent options — pick whichever fits your workflow. Both produce the same data.

### Option A — one tenant, from the Admin Console (no scripting)

In the Configurator (DIGIT Studio), go to **Manage → Complaint Hierarchies** and use the **"Migrate from 2-level"** action. It reads the old masters read-only, writes the merged `ComplaintHierarchy` rows (city tenant + derived state root), shows live per-step status, and is idempotent — safe to re-run if it's interrupted. This is `configurator/src/resources/complaint-hierarchies/MigrateHierarchyAction.tsx` / `configurator/src/api/services/hierarchyMigration.ts`; the "Download standalone script" button on that same dialog generates a pre-filled copy of the headless script below for the tenant you're viewing, if you'd rather run it outside the browser.

### Option B — headless script (many tenants, or CI)

```bash
# Docker Compose:
BASE_URL=http://localhost:18000 \
TENANTS="<city-tenant> <state-tenant>" \
PSQL="docker exec docker-postgres psql -U egov -d egov" \
  bash docs/migration/run-data-migration.sh

# Kubernetes (after port-forwarding the gateway, per §2):
BASE_URL=http://localhost:18000 \
TENANTS="<city-tenant> <state-tenant>" \
PSQL="kubectl exec -n digit $(kubectl get pod -n digit -l app=postgres-db -o jsonpath='{.items[0].metadata.name}') -- psql -U egov -d egov" \
  bash docs/migration/run-data-migration.sh
```

This runs, in order: log in once → install the `ComplaintHierarchy` schemas (a no-op on any stack already running v2.12's `default-data-handler` — it's a safety net for older stacks, not a required step here) → apply the `x-ref-schema` jsonb fix (also usually a no-op on v2.12; see gotcha G3 in the operator runbook) → migrate each tenant, **scoped to its own types** (`STATE_TENANT=<self>` per tenant — see gotcha G2, do not export `TENANTS` when calling `migrate.cjs` directly or it switches to union mode) → verify row counts.

To dry-run first (recommended — makes zero writes):
```bash
BASE_URL=http://localhost:18000 TENANT=<city-tenant> node docs/migration/preflight-dryrun.cjs
```
It must come back "SAFE TO MIGRATE" before you proceed. If it reports `serviceCode(s) collide with an interior node code`, resolve that first per gotcha G4 in the operator runbook — **never rename the colliding leaf, only the interior/category node** (leaf codes are what historical complaints reference).

## 4. What "transactional data" actually needs verifying

Because the leaf code is preserved verbatim, most transactional data needs no verification beyond "does it still work" — but there are three specific things worth checking, one of which is **not** documented anywhere else in this repo as of this writing:

### 4.1 The complaint flow itself (documented — operator-runbook.md §4)
- A pre-migration complaint still opens and displays its category correctly.
- Assign/resolve/reopen work on that pre-migration complaint with no `INVALID_ASSIGNMENT` / `INVALID_SERVICECODE` errors.
- A brand-new complaint can be filed against a migrated category.

### 4.2 Analytics/reporting department data (documented — tenant-department-migration-guide.md — plus a new cross-tenant gap found during this validation)
- Run Check 1 and Check 2 from that guide. Row count matching is **not sufficient** — a tenant can migrate every row and still show blank department tiles if the source data had no department set (gotcha G10). Confirm real department names render on a department-grouped dashboard tile before considering the tenant done.
- On v2.12, the grain-MV repoint migrations (`V20260731000000__repoint_grain_mvs_to_complainthierarchy.sql` and `V20260810000000__tenant_business_calendar_grains.sql`) are already part of the standard Flyway migration set applied when the deployment was upgraded — you do **not** need to deploy them separately as operator-runbook.md §4.5 describes for the feature-branch era. You only need to confirm the grains have refreshed since your data migration (they rebuild on a scheduler, default every 5 minutes — see `pgr.dashboard.refresh.interval.ms`) before checking the dashboard tile.

> **New finding (not previously documented) — the grain MVs resolve `department_code` by a GLOBAL, cross-tenant dedup on leaf `code` alone, not scoped to the complaint's own tenant.** Both grain-MV migrations build their MDMS lookup as `SELECT DISTINCT ON (data->>'code') ... FROM eg_mdms_data WHERE schemacode = 'RAINMAKER-PGR.ComplaintHierarchy' ... ORDER BY data->>'code', length(tenantid), tenantid`. That `ORDER BY length(tenantid), tenantid` picks **one winning tenant's row per leaf code, across the entire deployment** — not per the complaint's own tenant. If two unrelated tenants both migrated a `ServiceDefs` row with the same `serviceCode` (extremely likely: the default seed data ships the same generic codes — `StreetLightNotWorking`, `BurningOfGarbage`, etc. — to every city by default) but mapped it to *different* department codes, every tenant **except the one with the shortest `tenantid` string** silently gets the *other* tenant's department on its dashboard tiles. This is not a blank tile (which Check 2 would catch) — it's a plausible-looking but **wrong** department, and it is not scoped by boundary/jurisdiction at all, so it isn't something dashboard department-scoping (`dss.DashboardConfig.departmentScoping`) can mitigate.
>
> **Check your exposure** (replace `<your-tenant>`):
> ```sql
> WITH my_leaves AS (
>   SELECT data->>'code' AS code, data->>'department' AS dept
>   FROM eg_mdms_data
>   WHERE schemacode='RAINMAKER-PGR.ComplaintHierarchy' AND isactive AND tenantid = '<your-tenant>'
> ),
> winners AS (
>   SELECT DISTINCT ON (data->>'code') data->>'code' AS code, tenantid AS winning_tenant, data->>'department' AS winning_dept
>   FROM eg_mdms_data
>   WHERE schemacode='RAINMAKER-PGR.ComplaintHierarchy' AND isactive
>   ORDER BY data->>'code', length(tenantid), tenantid
> )
> SELECT m.code, m.dept AS my_department, w.winning_tenant, w.winning_dept AS mv_will_show
> FROM my_leaves m JOIN winners w ON w.code = m.code
> WHERE w.winning_tenant <> '<your-tenant>' AND coalesce(w.winning_dept,'') <> coalesce(m.dept,'');
> ```
> Any row returned is a complaint type whose dashboard department tile will show the wrong department for `<your-tenant>`. In this validation, 5 of `testtenant`'s 34 migrated leaves were affected this way (confirmed reproduction — see the validation log). There is no per-tenant workaround short of a code fix to scope the MV's dedup by `tenantid`; if this affects a tenant you care about, treat it as a bug to raise against the grain-MV migrations, not something the data migration itself can avoid — the migration is correctly preserving each tenant's own department value in `ComplaintHierarchy`, it's specifically the *analytics MV's* cross-tenant dedup that discards it.

### 4.3 Notification dispatch on old complaints (**not previously documented — found during this validation**)
Complaint *read* paths (`PGRService.getDepartmentFromMDMS`, `getServiceNameFromMDMS`) degrade gracefully if a `servicecode` has no matching leaf — they log a warning and fall back to `"NA"` or the raw code. **Notification dispatch does not**: `NotificationService.getDepartment(...)` and `NotificationService.getHRMSEmployee(...)` throw `INVALID_SERVICECODE` / `PARSING_ERROR` outright if the lookup misses. This means:

> Any complaint (old or new) whose `servicecode` does **not** have a matching leaf in the tenant's `ComplaintHierarchy` will fail to send a notification on its next workflow transition (assign/resolve/escalate/etc.), even though the complaint itself opens and displays fine.

This can happen to a small number of complaints even after a "successful" migration, if:
- The source `ServiceDefs` had a stray/malformed row whose `serviceCode` collided with a category code and got silently dropped on create (preflight should have caught this — but re-check if you skipped preflight or resolved a collision by editing the leaf instead of the category).
- A complaint's `servicecode` was already dangling *before* the migration (filed against a `ServiceDefs` row that was later deleted from MDMS without a corresponding hierarchy leaf ever being created).

**Check for this before declaring a tenant migrated:**
```sql
-- Same query as tenant-department-migration-guide.md Check 1, but this is specifically
-- what will break notification sending, not just the complaint-flow validation.
SELECT s.tenantid, s.servicecode, count(*) AS complaints
FROM eg_pgr_service_v2 s
LEFT JOIN (
  SELECT DISTINCT data->>'code' AS code
  FROM eg_mdms_data
  WHERE schemacode = 'RAINMAKER-PGR.ComplaintHierarchy' AND isactive
) ch ON ch.code = s.servicecode
WHERE ch.code IS NULL
GROUP BY 1, 2
ORDER BY 3 DESC;
```
Any row returned here is a set of complaints that will error on their next notification-triggering workflow action. Fix by adding the missing leaf (with the exact `code`) to `ComplaintHierarchy`, or accept the gap and communicate it to the tenant's operations team — this is not something the migration scripts can infer on their own; it's a data-completeness decision.

### 4.4 Restart `pgr-services` after migrating (documented in the design doc, easy to miss)
`pgr-services` caches `serviceCode → SLA` in a process-lifetime map (`serviceCodeToSlaCache`, built via `MigrationUtils.getServiceCodeToSLAMap`). If `pgr-services` was already running before you migrated a tenant's data, restart it (or let your deployment's rolling-restart handle it) so newly-migrated leaves' SLAs are picked up — otherwise SLA calculations for that tenant's complaints stay stale until the next restart for unrelated reasons.
- Docker Compose: `docker compose -f docker-compose.egov-digit.yaml restart pgr-services`
- Kubernetes: `kubectl rollout restart deployment/pgr-services -n digit` (or the equivalent Helm-managed deployment name in your release)

## 5. Retire the old masters — last step, per tenant

Only after §4.1–4.3 all pass for a tenant: deactivate/delete `RAINMAKER-PGR.ServiceDefs` (and `ClassificationNode`/`ComplaintTypeDepartments` if present) for that tenant. Keep them until then — together with your Step-2 snapshot, they are the rollback path.

## 6. Validated on local-setup

This procedure was run end-to-end against a local v2.12 deployment (Ansible-driven, Docker Compose, `local-setup/ansible/deploy.sh testtenant`) on 2026-08-24, using a disposable test tenant seeded with legacy `ServiceDefs`-shaped master data and a real filed complaint, specifically to exercise §4.1–4.3 above. See [validation-log-2026-08-24.md](./validation-log-2026-08-24.md) for the exact commands run and their output.

---

*See also: [operator-runbook.md](./operator-runbook.md) for the full gotcha catalog (G1–G10) and the historical feature-branch cutover record; [tenant-department-migration-guide.md](./tenant-department-migration-guide.md) for the analytics/department-data deep dive; [complaint-type-2level-to-Nlevel.md](./complaint-type-2level-to-Nlevel.md) for the design rationale behind the two-master model.*
