# Validation log — `servicedefs-to-complainthierarchy-migration.md`, 2026-08-24

*Real end-to-end run of the procedure in [servicedefs-to-complainthierarchy-migration.md](./servicedefs-to-complainthierarchy-migration.md), against a live v2.12 Docker Compose deployment, to confirm it holds up on real data and to catch anything the existing docs (`operator-runbook.md`, `tenant-department-migration-guide.md`) didn't already cover.*

## Environment

- Deployment: `local-setup/ansible/deploy.sh testtenant` (Ansible-driven Docker Compose, `docker-compose.egov-digit.yaml` + fast-path + migrations + monitoring overlays), tenant `testtenant` (flat — `state_tenant_id = tenant_id = testtenant`), gateway at `http://localhost:18000`.
- `testtenant` was **not** a fresh tenant — it already carried 42 rows of leftover `RAINMAKER-PGR.ServiceDefs`/`ComplaintHierarchy` MDMS data from prior test/CI runs on this box, plus a 4-level sample `ComplaintHierarchy` tree (`AUTHORITY_TYPE → MAIN_CATEGORY → SECTOR → SUB_TYPE`) seeded by `default-data-handler`, plus 3 HRMS employees and 1 real prior complaint. This is a genuine "messy, already-partly-set-up tenant" scenario rather than a clean-room test, which is closer to a real upgrade than a synthetic fixture would have been. Confirmed via `docker exec docker-postgres psql -U egov -d egov`.
- The old `RAINMAKER-PGR.ServiceDefs` schema was **still registered** in this deployment's MDMS schema table (`eg_mdms_schema_definition`) even though it's been removed from `default-data-handler`'s shipped schema set in the current codebase — this DB volume predates that removal. 34 real `ServiceDefs` data rows were present (the same shape as the sample rows the codebase's own `full-dump.sql` used to ship before this repo's dump was cleaned up in an earlier pass).
- **Deploy note (unrelated to the migration):** the `deploy.sh testtenant` run that brought this stack up exited with code 2 — one late, peripheral post-bootstrap task ("seed `INTERNAL_USER` on state_root") failed on this already-previously-bootstrapped tenant; its output is intentionally `no_log`'d so the exact cause wasn't inspected here. Every core service (Kong, MDMS, User, Workflow, HRMS, pgr-services) was confirmed healthy and API-reachable both before and after this task ran, and all of the validation below was performed against those live services — this failure did not affect anything in this log. Flagging it for anyone re-running this validation who might otherwise assume a non-zero `deploy.sh` exit means the stack itself is unhealthy.

## What was tested

### 1. Reproduced the documented "before" failure state
Inserted a synthetic pre-migration complaint directly into `eg_pgr_service_v2` (`servicecode = 'StreetLightNotWorking'`, a real leftover `ServiceDefs` code, department `DEPT_1`) — bypassing the create API, since **the create API itself refuses to file a new complaint against an un-migrated code** (confirmed: `POST /pgr-services/v2/request/_create` with that code returned `400 INVALID_SERVICECODE`). This confirms directly that on an already-running v2.12 deployment, "old complaints referencing a pre-migration serviceCode" can only be pre-existing rows from before the v2.12 cutover — you cannot manufacture new ones against a running v2.12 stack, which is a useful thing to know when explaining this to anyone who hasn't hit it before.

Called `POST /pgr-services/v2/request/_update` (action `ASSIGN`) against that synthetic complaint **before** migrating:
```
400 { "code": "INVALID_SERVICECODE", "message": "The service code: StreetLightNotWorking is not present in MDMS" }
```
This matches the documented "hard outage, no fallback" behavior exactly.

### 2. Ran preflight — it caught a real collision
```
BASE_URL=http://localhost:18000 TENANT=testtenant node docs/migration/preflight-dryrun.cjs
```
First run: `❌ 1 serviceCode(s) collide with an interior node code: OpenDefecation` — a genuine instance of gotcha **G4** (same-row case: `OpenDefecation`'s own `serviceCode` equals its own `menuPath`). Fixed per the documented remedy:
```sql
UPDATE eg_mdms_data SET data=jsonb_set(data,'{menuPath}','""')
WHERE tenantid='testtenant' AND schemacode='RAINMAKER-PGR.ServiceDefs' AND data->>'serviceCode'='OpenDefecation';
```
Re-ran preflight: `✅ SAFE TO MIGRATE — no errors predicted.`

### 3. Ran the migration
```
BASE_URL=http://localhost:18000 TENANT=testtenant STATE_TENANT=testtenant node docs/migration/migrate.cjs
```
Result: mode=derive, 13 new interior category nodes + 34 leaf complaint types created (folded in alongside the pre-existing 4 sample interior nodes / 3 sample leaves → 17 interior + 37 leaves total), 95 localization keys seeded, verification step passed. Re-ran the same command a second time: identical counts, no duplicates — confirmed idempotent.

### 4. Confirmed the leaf preserved the source data exactly
```sql
SELECT data->>'code', data->>'levelCode', data->>'parentCode', data->>'department', data->>'slaHours'
FROM eg_mdms_data WHERE tenantid='testtenant' AND schemacode='RAINMAKER-PGR.ComplaintHierarchy' AND isactive
  AND data->>'code' IN ('StreetLightNotWorking','OpenDefecation');
```
```
 StreetLightNotWorking | SUB_TYPE | StreetLights | DEPT_1 | 336
 OpenDefecation         | SUB_TYPE | Complaint    | DEPT_3 | 336
```
Both match the original `ServiceDefs` rows' `serviceCode`/`department`/`slaHours` exactly; `OpenDefecation` correctly landed under the `Complaint` fallback bucket after the menuPath fix.

### 5. Confirmed the "after" state: the specific `INVALID_SERVICECODE` failure is gone
Restarted `pgr-services` (clears the process-lifetime `serviceCodeToSlaCache`), then repeated the exact same `_update` call from step 1 against the same synthetic complaint:
```
400 { "id": "NullPointerException", "code": "An unhandled exception occurred on the server",
      "message": "Cannot invoke \"...AuditDetails.getCreatedBy()\" because ...Service.getAuditDetails() is null" }
```
The `INVALID_SERVICECODE` failure is gone — the request now gets past MDMS validation entirely and fails later, on an unrelated NPE caused by the synthetic row missing fields a real `_create` call would have populated (`auditDetails`), which is an artifact of the test setup (raw SQL insert), not of the migration. This is exactly the signal being tested for: **the specific failure mode this migration is supposed to fix is confirmed fixed**; the residual error is orthogonal.

### 6. Ran the documented department-completeness check (tenant-department-migration-guide.md, Check 1)
```sql
SELECT s.tenantid, s.servicecode, count(*) FROM eg_pgr_service_v2 s
LEFT JOIN (SELECT DISTINCT data->>'code' AS code FROM eg_mdms_data
           WHERE schemacode='RAINMAKER-PGR.ComplaintHierarchy' AND isactive) ch
  ON ch.code = s.servicecode
WHERE ch.code IS NULL AND s.tenantid='testtenant' GROUP BY 1,2;
```
0 rows — every complaint type in use (including the synthetic one) now has a matching hierarchy leaf.

### 7. Found a new gap: cross-tenant department collisions in the analytics grain (not previously documented)
Checked the actual `complaint_facts` materialized view for the synthetic complaint's category:
```sql
SELECT service_code, department_code, service_group FROM complaint_facts
WHERE service_code='StreetLightNotWorking' AND tenant_id='testtenant';
-- StreetLightNotWorking | DEPT_2 | StreetLights
```
`testtenant`'s own leaf has `department = DEPT_1` (step 4) — but the grain shows `DEPT_2`. Root cause, confirmed by reading the migration SQL (`V20260731000000__repoint_grain_mvs_to_complainthierarchy.sql` and `V20260810000000__tenant_business_calendar_grains.sql`, both containing `SELECT DISTINCT ON (data->>'code') ... ORDER BY data->>'code', length(tenantid), tenantid`): the grain's MDMS lookup dedupes leaf rows **globally by code, across every tenant in the deployment**, picking whichever tenant has the shortest `tenantid` string as the "canonical" source — not the complaint's own tenant. Confirmed directly:
```sql
SELECT tenantid, data->>'department' FROM eg_mdms_data
WHERE schemacode='RAINMAKER-PGR.ComplaintHierarchy' AND isactive AND data->>'code'='StreetLightNotWorking'
ORDER BY length(tenantid), tenantid;
--  ap        | DEPT_2   <- shortest tenantid, wins the dedup
--  ka        | DEPT_1
--  pg        | DEPT_1
--  ap.citya  | WORKS
--  testtenant| DEPT_1   <- testtenant's own (correct) value, discarded
```
Running the exposure-check query from the main document against `testtenant`'s full migrated leaf set found **5 of 34** leaves affected (`NoStreetlight`, `DamagedGarbageBin`, `BurningOfGarbage`, `StreetLightNotWorking`, `GarbageNeedsTobeCleared`) — all silently resolving to `ap`'s department instead of `testtenant`'s own. This is now documented in the main procedure, §4.2, as a new, unmitigated gap in the grain-MV design (not something the data migration itself can fix — the migration correctly preserves each tenant's own department; it's the analytics MV's dedup that discards it).

## Cleanup

The synthetic complaint (`eg_pgr_service_v2`/`eg_pgr_address_v2` rows) used for steps 1 and 5 was deleted after the test. The migrated `ComplaintHierarchy`/`ComplaintHierarchyDefinition` data, the `OpenDefecation` menuPath fix, and the seeded localization keys were left in place on `testtenant` (they are the correct, intended end state of a real migration, and this tenant already carried other test/CI artifacts prior to this validation). The old `ServiceDefs` master itself was **not** retired on this tenant — per §5 of the main document, retirement is deliberately a separate, later step, and doing it here wasn't necessary to validate the procedure.

## Summary

| Check | Result |
|---|---|
| Preflight catches a real collision before it causes a problem | ✅ confirmed (G4, `OpenDefecation`) |
| Migration is idempotent | ✅ confirmed (identical counts on re-run) |
| Leaf `code`/`department`/`slaHours` preserved verbatim from `ServiceDefs` | ✅ confirmed |
| Pre-migration complaint fails with `INVALID_SERVICECODE` before migrating | ✅ confirmed |
| That specific failure is gone after migrating (+ restarting pgr-services) | ✅ confirmed |
| Department-completeness check (Check 1) passes post-migration | ✅ confirmed (0 rows) |
| Analytics department resolution is per-tenant-correct | ❌ **new gap found** — cross-tenant dedup in the grain MV (§4.2 of the main document) |
