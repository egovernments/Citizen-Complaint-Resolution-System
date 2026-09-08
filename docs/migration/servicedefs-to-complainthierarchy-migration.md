# Migrating `ServiceDefs` to `ComplaintHierarchy` (v2.12+)

*For an operator moving an existing city's complaint categories from the old `ServiceDefs` master to the new two-master model (`ComplaintHierarchyDefinition` + `ComplaintHierarchy`), on a deployment already running v2.12. If you're setting up a brand-new city, none of this applies — new cities start on the new model already.*

## The key idea

This migration only moves *master data* — the list of complaint categories. It never touches an existing complaint. Each category keeps the exact same `code` it had as a `serviceCode`, so a complaint filed before the migration keeps working exactly as it did before — nothing about the complaint record itself needs to change.

Confirmed in the current codebase: the migration script writes each category's `code` as the old `serviceCode`, verbatim (`docs/migration/migrate.cjs`), and `pgr-services` looks up a complaint's category by matching that same field (`PGRConstants.MDMS_SERVICEDEF_SEARCH`, used in `ServiceRequestValidator`) — so a pre-migration complaint resolves against the new master with no changes needed. Also run end-to-end against a real v2.12 deployment; see [validation-log-2026-08-24.md](./validation-log-2026-08-24.md).

## 1. Before you start

1. **Back up the database.** This is your only way back — the migration moves the category data rather than copying it, so you can't reconstruct the old rows once they're gone.
   ```
   docker exec docker-postgres pg_dump -U egov -Fc egov > pre-migration-$(date +%F).dump
   ```
   (Kubernetes: `kubectl exec -n digit $(kubectl get pod -n digit -l app=postgres-db -o jsonpath='{.items[0].metadata.name}') -- pg_dump -U egov -Fc egov > pre-migration-$(date +%F).dump`)
2. **Know your two tenant IDs**: the city tenant (where staff pick a category) and its state-root tenant (where `pgr-services` actually validates). Both need the migrated data.
3. **Know your gateway URL** — `http://localhost:18000` on Docker Compose, or (on Kubernetes) port-forward it first: `kubectl port-forward -n digit svc/kong 18000:8000`.

## 2. Run the migration

Pick whichever fits your situation — both produce the same result.

**From the Admin Console, one city at a time:** in the Configurator (DIGIT Studio), go to **Manage → Complaint Hierarchies** and click **"Migrate from 2-level."** It's safe to re-run if interrupted.

> This is a **Manage** screen for a city that's already set up — it is **not** a step in the initial city-onboarding wizard, and it won't show up until the city's complaint-hierarchy master exists. Don't go looking for it in the onboarding flow; it's a separate, later screen, reached after the city itself is already onboarded.

**By script, for many cities or CI:**
```bash
BASE_URL=http://localhost:18000 \
TENANTS="<city-tenant> <state-tenant>" \
PSQL="docker exec docker-postgres psql -U egov -d egov" \
  bash docs/migration/run-data-migration.sh
```
(Kubernetes: swap `PSQL` for `kubectl exec -n digit $(kubectl get pod -n digit -l app=postgres-db -o jsonpath='{.items[0].metadata.name}') -- psql -U egov -d egov`, after port-forwarding the gateway as above.)

**Dry-run first — makes no writes:**
```bash
BASE_URL=http://localhost:18000 TENANT=<city-tenant> node docs/migration/preflight-dryrun.cjs
```
It must say "SAFE TO MIGRATE" before you continue. If it reports a code collision, fix the *category* node's code — never the individual complaint type's code, since that's what old complaints reference.

## 3. After migrating, check these three things

**3.1 — The complaint flow itself.** A pre-migration complaint still opens, shows its category, and can be assigned/resolved/reopened without errors. A brand-new complaint can be filed against a migrated category.

**3.2 — Dashboard department tiles show the right department.** Run the checks in [tenant-department-migration-guide.md](./tenant-department-migration-guide.md). A blank tile means a category had no department set in the source data. There's also a separate, known gap where a tile can show a *wrong-but-plausible* department — see below.

**3.3 — Notifications still send.** Unlike the complaint-display path (which degrades gracefully), sending a notification fails outright if a complaint's category code has no match in the new master:
```sql
SELECT s.tenantid, s.servicecode, count(*) FROM eg_pgr_service_v2 s
LEFT JOIN (SELECT DISTINCT data->>'code' AS code FROM eg_mdms_data
           WHERE schemacode='RAINMAKER-PGR.ComplaintHierarchy' AND isactive) ch
  ON ch.code = s.servicecode
WHERE ch.code IS NULL AND s.tenantid='<your-tenant>' GROUP BY 1,2;
```
Any row returned here will fail to notify on its next workflow action (assign/resolve/escalate). Fix by adding the missing category code, or knowingly accept the gap.

Then **restart `pgr-services`** — it caches category→SLA in memory for the life of the process, so a tenant migrated while it was already running needs a restart to pick up the new SLAs.

## 4. A known analytics caveat

The dashboard resolves a category's department by matching its code across **every city in the deployment**, not just your own. Two cities that happen to share a default category code (likely — the seed data ships the same generic codes to every city) but set different departments can end up seeing *each other's* department on a dashboard tile. This isn't a blank tile (3.2 catches that) — it's a wrong-but-plausible one.

Check your exposure:
```sql
WITH my_leaves AS (
  SELECT data->>'code' AS code, data->>'department' AS dept
  FROM eg_mdms_data
  WHERE schemacode='RAINMAKER-PGR.ComplaintHierarchy' AND isactive AND tenantid = '<your-tenant>'
),
winners AS (
  SELECT DISTINCT ON (data->>'code') data->>'code' AS code, tenantid AS winning_tenant, data->>'department' AS winning_dept
  FROM eg_mdms_data
  WHERE schemacode='RAINMAKER-PGR.ComplaintHierarchy' AND isactive
  ORDER BY data->>'code', length(tenantid), tenantid
)
SELECT m.code, m.dept AS my_department, w.winning_tenant, w.winning_dept AS mv_will_show
FROM my_leaves m JOIN winners w ON w.code = m.code
WHERE w.winning_tenant <> '<your-tenant>' AND coalesce(w.winning_dept,'') <> coalesce(m.dept,'');
```
Any row returned is a category that will show the wrong department for your tenant. There's no per-tenant fix today short of a code change to the dashboard's underlying view — this is a known bug to raise, not something the migration itself can avoid (it correctly preserves your own department value; it's specifically the dashboard's cross-tenant lookup that discards it).

## 5. Retire the old master

Once 3.1–3.3 all pass for a tenant: deactivate `ServiceDefs` (and `ClassificationNode`/`ComplaintTypeDepartments`, if present) for that tenant. Keep your backup until then — together, they're your rollback path.

---

*See also: [operator-runbook.md](./operator-runbook.md) for the historical feature-branch record and the full gotcha catalog; [tenant-department-migration-guide.md](./tenant-department-migration-guide.md) for the analytics/department deep dive; [complaint-type-2level-to-Nlevel.md](./complaint-type-2level-to-Nlevel.md) for the design rationale behind the two-master model; [validation-log-2026-08-24.md](./validation-log-2026-08-24.md) for a real end-to-end run of this procedure.*
