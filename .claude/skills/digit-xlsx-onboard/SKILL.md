---
name: digit-xlsx-onboard
description: Use when an operator says "onboard a city from XLSX", "load this Feliciano/Maputo-style dump onto tenant X", "set up a new tenant from these four files", "drive the 4-phase wizard for me", or similar. This skill takes a folder of operator-prepared XLSX files (Tenant Info + Branding, Boundaries, Common Masters, Employees), drives `city_setup_from_xlsx` through the on-host MCP REST shim, and verifies the result with independent reads against DIGIT.
---

# DIGIT Tenant Onboard from XLSX

End-to-end guided ingest of a configurator-style (or legacy CCRS) XLSX dump into an existing DIGIT installation. Probes the target's MCP, validates the dump, drives the 4-phase wizard (`tenant → boundaries → masters → employees`), and reads back to verify each resource landed at the right tenant level. Designed for operators handed a folder of XLSX files by a citizen-engagement partner (e.g. Feliciano for Maputo) who don't want to load it through the UI by hand.

Requires a DIGIT host with the MCP container running (every CCRS-Ansible deploy bakes this in — see `digit-ansible-onboard`). The MCP must be built from `feat/rest-shim-tenant-onboarding` or later — i.e. the `/v1/*` REST shim is exposed and `city_setup_from_xlsx` is in the tool registry.

## IRON LAW

```
NEVER ONBOARD ONTO AN EXISTING POPULATED TENANT WITHOUT EXPLICIT OPERATOR CONFIRMATION.
NEVER WIDEN COMMON-MASTERS.USERVALIDATION ON A PRODUCTION ROOT WITHOUT EXPLICIT OPERATOR CONFIRMATION.
```

Idempotent re-runs against a half-onboarded tenant of your own creation are fine — the MCP reports `exists` for every duplicate. But pointing the wizard at a tenant that has live citizen complaints or live employees, and getting the codes wrong, can collide with production user data. When in doubt, ASK.

## Inputs

- A folder of XLSX files on the operator's machine (or on the DIGIT host) following the configurator template:
  - `Tenant And Branding Master.xlsx` — sheets `Tenant Info` (required) + `Tenant Branding Details` (optional)
  - `boundaries.xlsx` — sheet `Boundary` with columns `code, name, boundaryType, parentCode, latitude, longitude`
  - `Common_and_Complaint_Master.xlsx` — separate sheets `Department`, `Designation`, `ComplaintType` with explicit `code` columns
  - `Employee_Template.xlsx` — sheet `Employee` with columns `employeeCode, name, userName, mobileNumber, emailId, gender, dob, department, designation, roles, jurisdictions, dateOfAppointment`
- An SSH alias for the target DIGIT host (the MCP listens on `127.0.0.1:13101` on each box; we tunnel via SSH).
- A target city tenant id (e.g. `ke.maputopoc`). **No hyphens** in any segment — egov-user rejects them.

The skill also accepts the legacy CCRS dataloader format (combined `Department And Designation Master` sheet + `Complaint Type Master` parent/child rows + `Employee Master` sheet). Format detection is automatic; you do not need to ask the operator.

## Procedure

### Step 1 — Probe the target MCP

Before touching any files, confirm the target is set up for this workflow:

```bash
ssh <alias> "curl -sS http://127.0.0.1:13101/v1/version"
```

Expect a 200 with `features[]` containing `v1/tools/:name`. If you get `Not found` or HTTP 404, the MCP on this box is older than `4d88968` (REST shim) and the skill cannot run — fall back to `digit-ansible-onboard` to rebuild, or use the JSON-RPC path at `/mcp` (more brittle; prefer rebuild).

Also probe **which tools exist** so a feature-gap is loud, not silent:

```bash
ssh <alias> "curl -sS http://127.0.0.1:13101/v1/tools" \
  | python3 -c 'import sys,json; t=[x["name"] for x in json.load(sys.stdin)["tools"]]; print("city_setup_from_xlsx:", "city_setup_from_xlsx" in t); print("tenant_cleanup:", "tenant_cleanup" in t); print("validate_tenant:", "validate_tenant" in t)'
```

If `city_setup_from_xlsx` is missing, refuse — the operator needs a newer MCP image.

Snapshot the existing tenants so you can sanity-check the target tenant in step 4:

```bash
ssh <alias> "curl -sS -X POST http://127.0.0.1:13101/v1/tools/mdms_get_tenants \
  -H 'Content-Type: application/json' -d '{}'" | python3 -m json.tool | head -40
```

### Step 2 — Inventory + classify the dump locally

Before sending anything to the host, parse the files on the controller (where Claude is running) so any format problems surface as a clear "fix the file" prompt rather than as a buried MCP error.

For each file in the dump folder, check the sheet names. Tell the operator which format was detected:

```python
import openpyxl
for path in sorted(glob.glob(f"{dump_dir}/*.xlsx")):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    print(path, "→ sheets:", wb.sheetnames)
```

You should see exactly one of these layouts per file. Tell the operator which:

| File | Configurator layout | Legacy CCRS layout |
|---|---|---|
| Tenant | `Tenant Info`, `Tenant Branding Details` | same |
| Boundaries | `Boundary` | same |
| Masters | `Department`, `Designation`, `ComplaintType` | `Department And Designation Master`, `Complaint Type Master` |
| Employees | `Employee` (cols: `employeeCode`/`mobileNumber`/…) | `Employee Master` (cols: `User Name*`/`Mobile Number*`/…) |

Both formats work — `city_setup_from_xlsx` auto-detects. But if a file matches NEITHER, stop and tell the operator which file is off-spec.

While you're parsing, sample two numbers and surface them:

- **Boundary type levels** in topological order (e.g. `Município → Distrito Municipal → Bairro → Quarteirão`). If they don't match the existing hierarchy at `<root>` (look at `boundary_hierarchy_search` from step 1), the wizard will auto-create a `<CITY_PORTION>_ADMIN` hierarchy at the city — call this out so the operator knows.
- **Mobile number sample** from the first employee row. If it doesn't match the state's `common-masters.UserValidation` pattern (Kenya = `^[17][0-9]{8}$`), every employee create will fail. See step 5.

**Pre-clean the recurring partner-dump defects (validated on Feliciano's Maputo dump).** These four are common in real configurator-style dumps, predictable, and safely auto-fixable on the controller copy *before* staging — fixing them here turns a multi-iteration grind into a clean run. Fix on a copy, show the operator a diff, never mutate the operator's originals:

1. **Boundary duplicates + whitespace** (`boundaries.xlsx`): strip leading/trailing whitespace from every `code`/`name`/`parentCode`, then drop exact-duplicate rows by `code` (Feliciano's had 11 dup Bairro under `kamavota` + 81 whitespace cells). After cleaning, assert 0 unresolved `parentCode`. This is deterministic *data hygiene*, distinct from the "don't fix bad data" rule — skipping it produces an inconsistent boundary tree.
2. **`Designation.department`** is comma-separated in the sheet but the schema wants `string[]` — the wizard splits it; just confirm the cell isn't already a stray JSON-array string.
3. **`ComplaintType`/`ServiceDefs.keywords`** must serialise as a **String**, not an array (the API rejects a JSON array: `expected type: String, found: JSONArray`). The wizard handles comma-sep → string; confirm the cell is comma-sep text.
4. **Phase-1 `Logo File Path`** is frequently a path on the partner's *own* machine (e.g. `/Users/feliciano.mazoio/Downloads/logo.png`) — unresolvable anywhere else. Blank that cell; the logo goes through the branding step / UI picker, not this column.

### Step 3 — Ask the operator ≤ 6 questions

Ask **one at a time**, in order. Show the default in parentheses where one exists.

| # | Question | Default | Notes |
|---|---|---|---|
| 1 | **Target city tenant id** (e.g. `ke.maputopoc`). Must be `<root>.<city>`. No hyphens, no digits in the city portion. | none — must ask | The MCP's `validateTenantId` allows hyphens but `egov-user` does not, and that path lights up during the employee phase. Refuse hyphens up front. |
| 2 | **Dump folder path** — local controller path (e.g. `/root/feliciano/onboarding_files_fixed/`). | inferred if operator pasted it in the request | Must contain the four XLSX files from Step 2's inventory. |
| 3 | **SSH alias** to reach the DIGIT host. | infer from `~/.ssh/config` if the host name was given | Must be the box whose `127.0.0.1:13101` MCP we probed in Step 1. |
| 4 | **Existing tenant at this code?** If `mdms_get_tenants` from Step 1 already shows the target city — confirm intent. | required when collision detected | Re-onboarding the SAME files onto an existing tenant is idempotent (everything reports `exists`). Re-onboarding *different* files is dangerous: codes will collide silently. |
| 5 | **Widen `common-masters.UserValidation`?** Only ask if Step 2 flagged a mobile mismatch (e.g. Maputo files on a Kenya root). | offer the widened rule `^0?[17][0-9]{8}$` length 9–10, plus Redis cache flush | Touches a root-level MDMS record; on a production tenant this affects every user create going forward. Ask once, never default to yes. |
| 6 | **Dry run first, or go straight to real?** | go straight on a fresh tenant; dry-run if Q4 flagged an existing tenant | `city_setup_from_xlsx` has no native dry_run flag, but you can preflight by running just `validate_tenant` + parsing the files locally. Tell the operator that "dry-run" here means probe-only, not a real `--dry-run`. |

After the answers, summarise back: target tenant, source dir, detected formats, mobile-rule decision, expected hierarchy. Confirm before any state-changing call.

### Step 4 — Stage files into the MCP container

The MCP reads files by local path *from inside its own container*. Ship the dump folder there:

```bash
# Controller → host
scp -r <dump_dir>/*.xlsx <alias>:/tmp/onboarding-poc/

# Host → MCP container
ssh <alias> "docker exec digit-mcp mkdir -p /tmp/onboarding-poc && \
             docker cp /tmp/onboarding-poc/. digit-mcp:/tmp/onboarding-poc/"
```

Pick the staging path consistently — `/tmp/onboarding-poc/` works because container `tmp` is per-container, not shared with the host's `/tmp`. The wizard expects the filenames to match exactly what you parsed in Step 2 (spaces and all — the Tenant XLSX has spaces in its name).

### Step 5 — (Conditional) widen UserValidation

Only if Step 3's Q5 was "yes". Otherwise skip.

The MCP has an `mdms_update` tool — use it instead of shelling out:

```bash
ssh <alias> "curl -sS -X POST http://127.0.0.1:13101/v1/tools/mdms_update \
  -H 'Content-Type: application/json' -d '{
    \"tenant_id\": \"<root>\",
    \"schema_code\": \"common-masters.UserValidation\",
    \"unique_identifier\": \"mobile\",
    \"patch\": {
      \"rules\": {
        \"pattern\": \"^0?[17][0-9]{8}$\",
        \"minLength\": 9,
        \"maxLength\": 10,
        \"allowedStartingCharacters\": [\"0\",\"1\",\"7\"],
        \"errorMessage\": \"CORE_COMMON_MOBILE_ERROR\"
      }
    },
    \"is_active\": true
  }'"
```

Then flush the Redis cache — egov-user pins `validationRules` in Redis and the MDMS write alone is not enough:

```bash
ssh <alias> "docker exec digit-redis redis-cli DEL validationRules"
```

(If the redis container is named differently on this host, `docker ps | grep redis` first.)

### Step 5b — (Conditional) bootstrap a brand-new state root

If `<root>` (the part of the target tenant before the first `.`) is a **country/state that has never been onboarded** — e.g. `mz` for `mz.maputo` when only `pg`/`statea` exist — its MDMS has **zero schemas**, and Phase 3–4 of the wizard will fail every write with `SCHEMA_DEFINITION_NOT_FOUND_ERR` / `INVALID_ROLE`. This MUST run **before** Step 6.

Detect: `mdms_search` for any schema at `<root>` returns empty / the root isn't in `mdms_get_tenants`. Then run the bootstrap (clones schema defs + ~14 essential data records + ADMIN + PGR workflow from a source state, default `pg`):

```bash
ssh <alias> "curl -sS -X POST http://127.0.0.1:13101/v1/tools/tenant_bootstrap \
  -H 'Content-Type: application/json' \
  -d '{\"target_tenant\":\"<root>\",\"source_tenant\":\"pg\",
       \"auth\":{\"username\":\"ADMIN\",\"password\":\"eGov@123\",\"tenant_id\":\"pg\"}}'"
```

Re-bootstrap of an already-bootstrapped root is idempotent. For an *existing* state (e.g. `ke.newcity` when `ke` is already seeded) this is skipped — the schemas inherit from the root. (This is the same logic the configurator wizard's Phase-1 runs inline; doing it here makes the dependency explicit instead of a silent Phase-3 failure.)

### Step 6 — Drive the wizard

**Prefer the `onboard_city` composite when the target MCP exposes it.** `onboard_city` is the canonical composite that wraps Step 5b + the wizard + the Step-2 pre-clean + read-back verification with every validated gotcha baked in (boundary hygiene, Designation/keywords shapes, mobile-regex, new-root bootstrap order). When present, call it instead of hand-driving `city_setup_from_xlsx` — this skill then just supplies inputs and narrates. Fall back to the explicit `city_setup_from_xlsx` call below only on older MCP images that lack the composite.

One POST per call to `city_setup_from_xlsx`. Use the in-container paths from Step 4:

```bash
ssh <alias> "curl -sS -X POST http://127.0.0.1:13101/v1/tools/city_setup_from_xlsx \
  -H 'Content-Type: application/json' -d '{
    \"tenant_id\": \"<target_tenant>\",
    \"tenant_file\":   \"/tmp/onboarding-poc/Tenant And Branding Master.xlsx\",
    \"boundary_file\": \"/tmp/onboarding-poc/boundaries.xlsx\",
    \"masters_file\":  \"/tmp/onboarding-poc/Common_and_Complaint_Master.xlsx\",
    \"employee_file\": \"/tmp/onboarding-poc/Employee_Template.xlsx\"
  }'" | tee /tmp/onboard-result.json | python3 -m json.tool
```

The call is synchronous and can take ~60–90s on a fresh tenant (1256-boundary case). Stream nothing to the operator while it runs unless they ask — chatter trains them to ignore real signals. Tell them once when you fire it ("running, ~90s") and once on return.

If you want SSE progress, send `Accept: text/event-stream` instead — the MCP emits `progress` events per phase. Use this for files with >5000 boundary rows where the call exceeds 2 min and the operator goes idle.

Read the response's `phases.{tenant,boundaries,masters,employees}.status` (`completed` / `failed`) plus the per-phase counts. Flag any `failed` with the specific error string — the wizard surfaces them under `entity_failures` / `relationship_failures` / `designation_failures` / `rows[*].error`.

### Step 7 — Verify with read-backs (don't trust the wizard's word)

The wizard reports what IT did. Independent reads from DIGIT confirm whether it actually landed. Run this matrix per resource, asserting both presence AND tenant scoping:

```bash
# 1. Tenant record at ROOT (not city — tenant.tenants lives at the parent)
curl -sS -X POST http://127.0.0.1:13101/v1/tools/mdms_search \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"<root>","schema_code":"tenant.tenants","unique_identifier":"<city_code>"}'
# Expect: 1 record, data.parent == <root>, data.code == <city_code>

# 2. Boundary hierarchy at CITY (hierarchies do NOT inherit)
curl -sS -X POST http://127.0.0.1:13101/v1/tools/validate_boundary_hierarchy \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"<target_tenant>","hierarchy_type":"<CITY>_ADMIN","expected_levels":[...]}'
# Expect: valid: true, owner_matches: true, order_matches: true

# 3. Departments / Designations / ComplaintTypes — present at ROOT, inherited by CITY
curl -sS -X POST http://127.0.0.1:13101/v1/tools/mdms_search \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"<root>","schema_code":"common-masters.Department","limit":500}'
# repeat for common-masters.Designation, RAINMAKER-PGR.ServiceDefs.
# Expect: every code from the source XLSX present with isActive=true.

# 4. Employees at CITY — by mobile (HRMS overrides userName=employeeCode, so by-username doesn't work for files whose userName column differs from code)
curl -sS -X POST http://127.0.0.1:13101/v1/tools/user_search \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"<target_tenant>","mobile_number":"<first_employee_mobile>"}'
# Expect: 1 user, name matches, tenantId == <target_tenant>, roles populated
```

If you have the ansible verifier from the POC (`/root/onboarding-poc/verify.yml`) on the controller, prefer it — it does the same checks against expectations derived from the source XLSX, with a structured pass/fail per resource and a `lib/parse_expected.py` that re-derives expectations on every run. If not, the four curls above are the minimum.

### Step 8 — Hand over (testable links)

Print this template back to the operator, with placeholders filled, and ✅ / ❌ from a fresh `curl` you run NOW (not from what the wizard "should have" produced).

```
═════════════════════════════════════════════════════════════════
  ONBOARDING SUMMARY — <target_tenant>  (<host>)
═════════════════════════════════════════════════════════════════

▼ What landed

  Tenant record         tenant.tenants/<city_code> @ <root>            [✅/❌]
  Boundary hierarchy    <CITY>_ADMIN @ <target_tenant> (<N> levels)    [✅/❌]
  Boundary entities     <N>/<expected>                                 [✅/❌]
  Boundary relations    <N>/<expected>                                 [✅/❌]
  Departments           <N> @ <root> (inherited by city)               [✅/❌]
  Designations          <N> @ <root>                                   [✅/❌]
  Complaint types       <N> @ <root>                                   [✅/❌]
  Employees             <N> @ <target_tenant>                          [✅/❌]

▼ URLs you can hit right now

  UI                    <scheme>://<host>/digit-ui/
                        login as ADMIN / eGov@123 on tenantId=<root>

  First employee login  userName: <first_employee_code> (HRMS uses code, not file's userName!)
                        password: eGov@123
                        tenantId: <target_tenant>

  MCP verify endpoints  <scheme>://<host>/v1/tools/mdms_search
                        <scheme>://<host>/v1/tools/validate_boundary_hierarchy
                        <scheme>://<host>/v1/tools/user_search

▼ Teardown (if this was a test run)

  curl -X POST http://127.0.0.1:13101/v1/tools/tenant_destroy \
    -H 'Content-Type: application/json' \
    -d '{"tenant_id":"<target_tenant>",
         "department_codes":[...],
         "designation_codes":[...],
         "complaint_type_codes":[...]}'

  tenant_destroy clears city-owned records AND the named root-level
  master entries this onboarding wrote. It does not delete boundary
  entities (boundary-service has no delete) — recreating with the
  same hierarchyType is idempotent.

▼ Re-run safely

  Re-issue the same city_setup_from_xlsx call any time — every phase
  treats "already exists" as success. The wizard's `exists` counter
  rather than `created` tells you a phase was a no-op.
═════════════════════════════════════════════════════════════════
```

## Known refusals

- **Hyphens in the target tenant id.** egov-user enforces `^[a-zA-Z. ]*$` on `user.tenantId` via javax — no hyphens, no digits. Refuse `ke.poc-mzpt`, accept `ke.pocmzpt`. (The MCP's own `validateTenantId` allows hyphens now to surface the real upstream error, but the employee phase still fails. Catch it before that.)
- **Mismatched mobile format with no operator approval to widen.** If Step 2 surfaces a mobile sample that won't pass the existing `common-masters.UserValidation`, and the operator declines Q5, REFUSE to proceed. The employee phase will fail and you'll have to roll back; better to refuse up front.
- **Re-onboarding *different* files onto a populated tenant.** If `mdms_get_tenants` shows the target city exists AND the operator confirms the XLSX is different from what created it, REFUSE without an explicit "destroy first" confirmation. Use `tenant_destroy` first.
- **MCP version too old.** No `/v1/tools/city_setup_from_xlsx` → refuse + recommend `digit-ansible-onboard --redeploy mcp` (or whatever the operator uses to bump the MCP image).
- **Operator points the skill at a CCRS production host** (e.g. `naipepea.digit.org`) **on the first run.** Push back: do the dry-run on a Tailscale-only sandbox first. Production boxes have real complaint data; tenant collisions there are unrecoverable.

## What this skill deliberately does NOT do

- It doesn't *hand-author* MDMS schemas. Schemas come from the fast-path dump (existing roots) or are cloned by Step 5b's `tenant_bootstrap` (brand-new roots). What it won't do is invent a schema that exists in neither — that's an upstream gap, not an onboarding step.
- It doesn't fix bad data in the source files. If a boundary row references a nonexistent parent, the wizard will fail that row and report it — your job is to surface the failure, not to silently drop it.
- It doesn't run `digit-ansible-onboard`. If the box has no MCP, that's a separate workflow.
- It doesn't push secrets or write to `host_vars/`. Tenant onboarding is data, not infrastructure.

## Useful references

- `local-setup/ansible/inventory/host_vars/_example.yml` — confirms the MCP image variable + the MCP port (`13101`).
- DIGIT-MCP issue [#40](https://github.com/ChakshuGautam/DIGIT-MCP/issues/40) — POC pipeline behaviour, the new tools (`mdms_update`, `tenant_destroy`, `validate_boundary_hierarchy`, `mdms_repair_identity`, `boundary_entity_{search,exists}`), and discovered DIGIT constraints (egov-user tenantId regex, HRMS userName override, Kenya/HRMS mobile conflict).
- DIGIT-MCP PR [#36](https://github.com/ChakshuGautam/DIGIT-MCP/pull/36) — the REST shim + `city_setup_from_xlsx` source.
- Sample reference dump (configurator format): `/root/feliciano/onboarding_files_fixed/` on operator boxes that have it. Use as a layout reference when an operator's files look off-spec.
- Sample ansible suite (optional accelerator): `/root/onboarding-poc/` — `onboard.yml`, `verify.yml`, `cleanup.yml`, plus `lib/parse_expected.py` that derives expectations from the source XLSX. If present on the controller, prefer it over hand-rolled curls — the verifier in particular is much richer than the four checks in Step 7.
