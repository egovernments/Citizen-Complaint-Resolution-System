# Runbook 02 — Tenant onboarding deploy: resolved vs. remaining

| Field | Value |
|---|---|
| When to use | Reviewing the state of `./deploy.sh <tenant>` end-to-end correctness as of 2026-05-24 |
| Severity | P1 (operator-blocking until items below are addressed) |
| Affects | All non-`pg` tenants (Maputo, Nairobi, Bomet) |
| Reverses | Each fix is independent; revert individually if needed |

## What "tenant onboarding" needs to do

A fresh deploy of `./deploy.sh <tenant>` must, after one run, leave the operator able to:

1. Open the employee UI login page and see `<tenant>` (e.g. `mz.maputo`) in the City dropdown.
2. Log in as `ADMIN` / `eGov@123` against `<tenant>`.
3. See `<tenant>` listed in the HRMS / PGR / Workbench module switchers post-login.
4. Find common-masters (Department, Designation, etc.) and default data populated for the tenant.

This runbook tracks how far the current implementation gets toward those goals.

## Resolved (commit 87b26d80 on `ansible_fixes`)

### Login dropdown shows the new tenant (`Bug A`)

`tenant_bootstrap` Step 2 writes the tenant's self-record into the `tenant.tenants` master. Two layered problems were silently failing the write:

1. For a city-tier target (e.g. `mz.maputo`), the write was scoped to the city itself — but the `tenant.tenants` schema definition only exists at root scope (`mz`), so MDMS returned `SCHEMA_DEFINITION_NOT_FOUND_ERR`.
2. The payload was missing seven schema-required top-level fields (`type`, `emailId`, `contactNumber`, `domainUrl`, `imageId`, `OfficeTimings`, `address`) and two `city.*` fields (`districtTenantCode`, `ulbGrade`). Even after fixing the scope, the write was rejected with `required key [X] not found`.

Both errors hit the catch block in `mdms-tenant.ts` but didn't match `/DUPLICATE|already exists|unique|NON_UNIQUE/i`, so they landed in `results.data.failed[]` as count-only failures without surfacing.

**Fix:** city-tier targets now write at root scope with uid `Tenant.<city>`, and the payload includes every schema-required field with sane placeholders. Verified live: `select uniqueidentifier from eg_mdms_data where schemacode='tenant.tenants' and tenantid='mz'` returns `mz.maputo` after deploy, and the login dropdown populates accordingly.

### HRMS / PGR / Workbench module switchers list the new tenant (`Bug B`)

The login dropdown reads `tenant.tenants`, but the post-login module switchers read `tenant.citymodule.<module>.tenants[].code` — a separate master with an embedded array. `tenant_bootstrap` copied the citymodule rows but `rewriteIdentityFields` only rewrote top-level identifier fields, leaving the nested `tenants[]` arrays with the source tenant's stale `pg.*` codes.

**Fix:** Option-2 / "proper split":
- Root-bootstrap: `rewriteIdentityFields` now deep-walks `tenant.citymodule.tenants[].code`.
- City-bootstrap: skips `tenant.citymodule` from the copy pass and instead does a read-modify-write at root scope — fetch each citymodule row, append `{code: target}` to its `tenants[]`, skip entries already present (idempotent). New helper `mdmsV2UpdateData()` added to `digit-api.ts`.

Verified live: HRMS, PGR, and Workbench all contain `mz.maputo` in their `tenants[]` after deploy.

### Bootstrap failures are no longer silent (`Meta-bug`)

The deploy log used to print `data_failed: 4` and move on. Operators had no actionable diagnostic — the actual failure entries lived in the MCP response body but were never surfaced. Both Bug A and Bug B fit this hole for weeks.

**Fix in `playbook-deploy.yml`:**
- New debug tasks dump `results.{schemas,data,workflow}.failed[]` (and per-locale localization counts) when `success=false`. Clean runs stay clean.
- New `fail:` task aborts the deploy when either root or city bootstrap reports `success=false`. Override with `tolerate_bootstrap_failures: true` for partial-seed testing.

### Other fixes folded in

- **MCP `[session-db] mcp` auth:** new `ALTER ROLE mcp WITH PASSWORD` task syncs mcp-postgres with OpenBao after every deploy (previously drifted on rotation).
- **MCP `[digit-db] egov` auth:** `DIGIT_DB_HOST/PORT/NAME/USER/PASSWORD` env wired into the `digit-mcp` compose service, routed via the pgbouncer `postgres` alias. In-code default also corrected.
- **ui-tenant readiness probe:** replaced a broken `docker inspect egov-user-proxy` wait (which satisfied on the first poll regardless of state) with an `ansible.builtin.uri` retry against Kong's `/user/oauth/token` accepting any non-5xx as readiness.
- **Localization batch failures:** dedup key changed to `${module}::${code}` to match the DB unique constraint `(tenantid, locale, module, code)`; the duplicate-tolerant regex now also matches `unique`. Eliminated false-negative dedup drops AND false-positive batch failures.
- **`admin_user_provisioned` flag surfaced** separately from `admin_employee_provisioned` to clarify which one gates login (the user, not the employee).

## Remaining problems (visible since the surface-failures patch)

Now that failures are no longer silent, the last clean deploy of Maputo exposed three classes of pre-existing bug:

### 1. `RAINMAKER-PGR.ServiceDefs` rows missing `menuPathName` (33 root + 1 city)

```
RAINMAKER-PGR.ServiceDefs/<hash>: required key [menuPathName] not found
```

Same shape as Bug A: bootstrap copies records from the source tenant (`pg`) that don't validate against the target's schema. Investigate whether `menuPathName` is missing in the source rows or added by an upstream UI patch we haven't pulled in. Likely fix: similar to Bug A, audit the source data and inject the missing required field with a sensible default at copy time, OR widen the schema to make the field optional.

### 2. `Duplicate record` not matched by the catch regex (2 entries per deploy)

```
ACCESSCONTROL-ROLES.roles/<hash>: Duplicate record
Workflow.BusinessServiceMasterConfig/<hash>: Duplicate record
```

These are benign — the records already exist on the target and the write should be a no-op skip. The catch regex `/DUPLICATE|already exists|unique|NON_UNIQUE/i` doesn't match "Duplicate record" (capital D, separate words). One-line fix: add `Duplicate record` (or `/duplicate/i`) to the pattern.

### 3. 4000 root-localization failures (en_IN locale)

```
Localization failures: en_IN: copied=4486 failed=4000
```

City-tier localization is clean (`copied=8486, failed=0`) — the (module, code) dedup + `unique` regex fix from this commit works on the city path. The root path regressed. Worth checking whether the root call hits a different code path or whether the first batch fails because pre-existing rows trip an error message format the regex still doesn't catch. See `digit-mcp/src/tools/mdms-tenant.ts` localization section (~line 1640 onward).

### Operational note: deploy halts at bootstrap step

Because the surface-failures patch now aborts on bootstrap failure, a deploy with any of items 1–3 above present will halt **before** the post-bootstrap `STATE_LEVEL_TENANT_ID` rewrite + service restart steps run. The stack ends up half-deployed: MDMS / users / dropdowns work (because they happen during bootstrap), but services still run against the original `pg` state tenant.

Workarounds until items 1–3 are fixed:
- Re-run with `tolerate_bootstrap_failures: true` to push through the post-bootstrap tasks. The visible bootstrap failures are all non-blocking for end-user login.
- Or, address items 1 and 2 (both small) and re-deploy clean. Item 3 may remain after that and would then need its own pass.

## Files touched (commit 87b26d80)

| File | Lines | Purpose |
|---|---|---|
| `digit-mcp/src/services/digit-api.ts` | +22 | `mdmsV2UpdateData()` helper for RMW |
| `digit-mcp/src/services/digit-db.ts` | +1/-1 | default host `docker-postgres` → `postgres` |
| `digit-mcp/src/tools/mdms-tenant.ts` | +193/-35 | Bug A v2 payload, Bug B Option-2 split, localization dedup, admin flag |
| `local-setup/ansible/playbook-deploy.yml` | +130/-9 | MCP probe + ALTER ROLE mcp + Kong probe + surface-failures + fail-on-success-false |
| `local-setup/docker-compose.egov-digit.yaml` | +11 | DIGIT_DB_* env into digit-mcp |
