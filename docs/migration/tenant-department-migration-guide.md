# Tenant Guide — Departments on the Complaint Hierarchy

> Companion to [operator-runbook.md](./operator-runbook.md). Read this before deploying
> `V20260731000000__repoint_grain_mvs_to_complainthierarchy.sql`, and before retiring the
> `RAINMAKER-PGR.ServiceDefs` master on any tenant.

## Why this guide exists

Analytics dashboards resolve a complaint's department by joining the complaint's `servicecode` to
an MDMS master. That join used to read `RAINMAKER-PGR.ServiceDefs`, which is retired. It now reads
`RAINMAKER-PGR.ComplaintHierarchy`.

Switching the query is only half the job. **The new master has to actually carry departments for
that tenant.** Those are two independent conditions, and a tenant needs both:

| | hierarchy leaves have real departments | leaves have `NA` / no department |
|---|---|---|
| **MV repointed** | works | no department breakdown |
| **MV not repointed** | no department breakdown | no department breakdown |

A tenant can pass every check in the main runbook — correct row counts, working complaint flow —
and still show nothing on department tiles, because row count is not data quality.

## The three states a leaf can be in

A leaf is a filable complaint type (a `ComplaintHierarchy` row whose `levelCode` is the level flagged
`isLeafServiceCode`). Interior nodes are categories and never carry a department.

**1. Real department — the working state**
```json
{ "code": "StreetLightNotWorking", "levelCode": "SUB_TYPE",
  "department": "DEPT_1", "slaHours": 336 }
```

**2. `NA` — the silent failure**
```json
{ "code": "SomeComplaintType", "levelCode": "SUB_TYPE",
  "department": "NA" }
```
`NA` is a placeholder, not a department. The configurator writes it when the onboarding sheet's
Department column is blank. It is **valid data** — `ServiceRequestValidator` treats it as "no
department constraint", which is a deliberate, supported state for complaint types that any
department may handle. It is only a problem for analytics, where it means "no breakdown".

**3. Absent — same effect as `NA`**
```json
{ "code": "SomeComplaintType", "levelCode": "SUB_TYPE" }
```
The `#917` migration omits the key entirely when the source had no department. Backend code treats
absent and `NA` identically.

The migration normalises `NA` to `NULL` so it never renders as a department label on a dashboard.

## Preflight — run this before deploying the repoint

Two separate checks. **Both must pass.** The first is the one the main runbook already implies;
the second is the one that catches an `NA`-populated tenant.

### Check 1 — every in-use complaint type has a hierarchy node

```sql
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

- **No rows** → every complaint type in use has migrated. Good.
- **Rows returned** → those types were never migrated. They are *also* broken in the complaint
  flow (there is no fallback — the picker is built from the hierarchy), so fix them regardless.
  Re-run `migrate.cjs` for the tenant.

Count only what has complaints. A tenant may carry hundreds of orphaned `ServiceDefs` rows from an
old default seed with zero complaints against them — dead configuration, not a problem.

### Check 2 — leaves carry real departments

```sql
SELECT tenantid,
       count(*) FILTER (WHERE data->>'department' IS NOT NULL
                          AND data->>'department' <> 'NA') AS real_dept,
       count(*) FILTER (WHERE data->>'department' = 'NA')  AS na_dept,
       count(*) FILTER (WHERE data->>'department' IS NULL) AS no_dept,
       count(*) AS total_rows
FROM eg_mdms_data
WHERE schemacode = 'RAINMAKER-PGR.ComplaintHierarchy' AND isactive
GROUP BY 1 ORDER BY 1;
```

`total_rows` includes interior nodes, which correctly have no department — so `no_dept` is never
expected to be zero. What matters is **`real_dept` relative to the number of leaves**.

- **`real_dept` covers your leaves** → deploy the repoint; department tiles will populate.
- **`na_dept` is most or all of your leaves** → the repoint is safe but will show no department
  breakdown. Back-fill first (below) if those tiles matter to this tenant.

### Confirm the outcome before committing

This predicts the exact effect of the repoint without changing anything:

```sql
SELECT coalesce(f.department_code, '(none)') AS before,
       coalesce(ch.dept, '(none)')           AS after,
       count(*)
FROM complaint_facts f
LEFT JOIN (
  SELECT DISTINCT ON (data->>'code')
         data->>'code' AS code,
         nullif(coalesce(data->>'department', data->'departments'->>0), 'NA') AS dept
  FROM eg_mdms_data
  WHERE schemacode = 'RAINMAKER-PGR.ComplaintHierarchy' AND isactive
  ORDER BY 1, length(tenantid)
) ch ON ch.code = f.service_code
GROUP BY 1, 2 ORDER BY 3 DESC;
```

Read the result as:

- `(none) → DEPT_X` — rows the repoint **fixes**.
- `DEPT_X → DEPT_Y` — rows **remapped**. Expected where the hierarchy adopted a renamed department
  vocabulary; the new value is the correct one, but dashboard labels will visibly change.
- `DEPT_X → (none)` — rows that **regress**. Each one is a complaint type whose department exists
  only in the retired master. Back-fill it before deploying, or accept the loss knowingly.

## Back-filling departments

Needed when Check 2 shows `NA` leaves and you want department tiles for that tenant.

1. List the departments available to the tenant:
   ```sql
   SELECT data->>'code', data->>'name'
   FROM eg_mdms_data
   WHERE schemacode LIKE '%Department%' AND isactive AND tenantid = '<tenant>';
   ```
2. Map each `NA` leaf to one of those codes. This is a decision for the city, not a mechanical
   transform — nothing in the data implies the right answer.
3. Apply via the configurator's complaint-hierarchy editor, or by re-running the onboarding sheet
   with the Department column filled in.
4. Re-run Check 2, then refresh the grains (they rebuild on the scheduler, default 5 minutes).

Back-filling is safe to do before or after the repoint; the tiles populate once both are true.

## Interaction with department scoping

`dss.DashboardConfig.departmentScoping` controls whether employees are restricted to their own
department's rows. It is enforced unless explicitly set to `disabled`.

```sql
SELECT tenantid, data->>'departmentScoping'
FROM eg_mdms_data WHERE schemacode = 'dss.DashboardConfig' AND isactive;
```

**Do not enable scoping on a tenant whose leaves are `NA`.** Scoping filters with
`department_code IN (...)`, and `NULL` never matches — so every employee would see zero rows on
every tile, including tiles unrelated to department. Back-fill departments first, then enable.

## Ordering with the ServiceDefs retirement

Retiring `ServiceDefs` (#1496) is only safe **after** this repoint is deployed. Until then the grain
MVs still read that master, and on a properly-migrated tenant it is the source of a large share of
working `department_code` values — deleting it first blanks them.

Correct order:

1. Deploy the repoint migration.
2. Run Checks 1 and 2 per tenant; back-fill where needed.
3. Confirm department tiles render.
4. Then retire `ServiceDefs` / `ClassificationNode` / `ComplaintTypeDepartments`.
