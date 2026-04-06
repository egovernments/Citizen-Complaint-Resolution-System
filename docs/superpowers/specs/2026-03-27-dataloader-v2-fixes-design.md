# CRS DataLoader v2 Bug Fixes Design

## Summary

Fix 6 bugs in CRS DataLoader v2 (`crs_loader.py` and `unified_loader.py`) and add a CI regression test script that validates each fix against the local Docker Compose stack.

**GitHub Issue:** [#263](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/263)

## Issues & Root Causes

### Issue 1: No root-level tenant creation option

**File:** `crs_loader.py:234` — `_bootstrap_tenant_root()`

**Root cause:** When creating a tenant like `test.mombasa`, the code detects that `test` is a new root and calls `_bootstrap_tenant_root()`. This method copies schemas and master data from the source root (line 252-368) and creates a root self-record at line 325. However, the notebook workflow never offers a way to create a standalone root tenant — the user must start with a pre-existing root like `statea`.

**Fix:** Add a `create_root_tenant()` method to `CRSLoader` that:
1. Creates the root-level tenant record in `tenant.tenants` MDMS
2. Bootstraps schemas and essential data from a source root (defaults to `pg`)
3. Can be called standalone from the notebook (new cell option)

Also update `create_tenant()` to call this automatically when a new root is detected, instead of only bootstrapping schemas.

### Issue 2: Boundary API authorization failures

**File:** `unified_loader.py:2519-2603` — `_create_boundary_entity()`, `_create_boundary_relationship()`

**Root cause:** Boundary service APIs require specific roles (`BOUNDARY_ADMIN` or similar) but the code doesn't check for 403 responses distinctly from other errors. When the user lacks roles, the error is swallowed into generic "FAILED" status.

**Fix:**
- In boundary methods (`_create_boundary_entity`, `_create_boundary_relationship`, `generate_boundary_template`, `process_boundary_data`), detect 403 responses and raise a clear error: "Boundary operation failed: user lacks required roles. Ensure the user has BOUNDARY_ADMIN role and that role-action mappings exist for boundary endpoints."
- Add a pre-flight role check in `crs_loader.py:load_boundaries()` that warns if the user doesn't have boundary-related roles before attempting operations.

### Issue 3: Duplicate designation data not detected

**File:** `unified_loader.py:256-338` — `read_departments_designations()`, designation section

**Root cause:** The method fetches existing designations to find the max `DESIG_N` number (line 256-263), then generates new codes starting from `max_desig_num + 1` (line 267). But it never checks if a designation with the same **name** already exists. Running the same Excel twice creates `DESIG_01: "Officer"` then `DESIG_02: "Officer"`.

**Fix:** Before generating a new `DESIG_XX` code, check if `desig_name` already exists in the fetched designations (by name match). If it does, reuse the existing code. Build a `name_to_code` lookup from existing designations, same as the department logic already does.

### Issue 4: Department data silently skipped

**File:** `unified_loader.py:287-304` — `read_departments_designations()`, department section

**Root cause:** When a department name already exists in MDMS (`dept_name in dept_name_to_code`), the code reuses the existing code but does NOT add it to the returned `departments` list. The returned list only contains new departments. The caller sees a count that doesn't include existing ones, making it look like departments were "skipped."

**Fix:**
- Track existing vs new departments separately
- Print clear output: "Departments: X existing (reused), Y new (to create)"
- The returned `departments` list should still only contain new ones (to avoid duplicate create attempts), but the count reporting must be accurate

### Issue 5 & 6: Designation count inconsistency between runs

**File:** `unified_loader.py:2747` — `fetch_designations()` and callers

**Root cause:** `fetch_designations(tenant_id)` is called with the target city tenant (e.g., `test.mombasa`). On the first run, `test.mombasa` may not have designation data yet, so MDMS returns designations inherited from the root tenant (e.g., `test` or `pg`) — which has 35 records. After the first run creates 4 designations specifically on `test.mombasa`, the second search returns only those 4 city-specific records.

This is an MDMS v2 behavior: search on a city tenant returns inherited root data if the city has no overrides, but returns only city-specific data once overrides exist.

**Fix:**
- When counting designations for display to the user, always report the **target tenant count** explicitly
- When determining the next `DESIG_XX` number, search BOTH the root AND the city tenant to find the true max, avoiding code collisions
- After creating designations, re-fetch from the target tenant and display the accurate count
- Add a "before/after" pattern: "Designations on {tenant}: {before_count} before, {after_count} after ({new_count} created)"

## Files Changed

| Action | File | Description |
|---|---|---|
| **Modify** | `local-setup/jupyter/dataloader/crs_loader.py` | Fix 1: add `create_root_tenant()`, Fix 2: boundary role pre-check |
| **Modify** | `local-setup/jupyter/dataloader/unified_loader.py` | Fix 2: 403 handling, Fix 3: dedup designations, Fix 4: dept count, Fix 5-6: tenant-scoped counts |
| **Create** | `local-setup/scripts/ci-dataloader-v2-regression.py` | CI test script validating all 6 fixes |
| **Modify** | `.github/workflows/ci.yaml` | Add regression test step |

## CI Regression Test: `ci-dataloader-v2-regression.py`

Python script that runs against the local Docker Compose stack. Uses `CRSLoader` directly (same as `ci-dataloader.py`). Tests each fix:

### Test 1: Root tenant creation
```
1. Login as ADMIN on pg
2. Call create_root_tenant("ciregtest") — new root
3. Search tenant.tenants on "ciregtest" — verify record exists
4. Create "ciregtest.citya" — verify city tenant created under new root
```

### Test 2: Designation dedup
```
1. Create tenant "pg.cidesig" via ci-dataloader
2. Load common masters with Excel containing "Officer", "Manager", "Clerk"
3. Verify 3 designations created (DESIG_01, DESIG_02, DESIG_03)
4. Load same Excel again
5. Verify still 3 designations (no DESIG_04, DESIG_05, DESIG_06)
6. Verify counts match between runs
```

### Test 3: Department count accuracy
```
1. Create tenant "pg.cidept" via ci-dataloader
2. Load common masters — check output includes "X new, Y existing" message
3. Verify department count matches MDMS search count
4. Load again — verify "0 new, X existing" message
```

### Test 4: Tenant-scoped designation counts
```
1. Create "pg.cicounts"
2. Load 3 designations
3. Fetch designations for "pg.cicounts" — verify count = 3 (not root count)
4. Fetch designations for "pg" — verify count is root count (likely different)
5. Assert city count != root count (proves tenant scoping works)
```

### Test 5: Boundary auth error message
```
1. Create a user with NO boundary roles
2. Attempt boundary hierarchy creation
3. Verify error message contains "role" or "permission" or "unauthorized"
4. Verify it does NOT silently fail with generic error
```

### CI Workflow Addition

New step in `ci.yaml` docker-compose job, after the existing dataloader step:

```yaml
- name: Run DataLoader v2 regression tests
  run: |
    set +e
    REGRESSION_OUTPUT=$(DIGIT_URL=http://localhost:18000 python3 scripts/ci-dataloader-v2-regression.py 2>&1)
    REGRESSION_RC=$?
    set -e
    echo "$REGRESSION_OUTPUT"
    if [ $REGRESSION_RC -ne 0 ]; then
      echo "FATAL: DataLoader v2 regression tests failed (exit code $REGRESSION_RC)"
      exit 1
    fi
```

## Decisions

1. **One PR for all 6 fixes** — issues are related and small enough to review together
2. **CI tests against local Docker Compose** — fully self-contained, no external dependencies
3. **Boundary auth is a code+config issue** — we fix the error messaging in code; the actual role-action mappings are a platform config concern documented in the error message
4. **No refactoring of the large files** — out of scope, fix bugs only
5. **Regression test script pattern** — follows existing `ci-dataloader.py` and `ci-dataloader-crossroot.py` pattern (Python script using CRSLoader directly)
