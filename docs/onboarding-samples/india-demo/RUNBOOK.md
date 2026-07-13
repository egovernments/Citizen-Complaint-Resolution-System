# India Demo Tenant Onboarding Runbook (#1033)

Sets up `IN.PUNE` — a dedicated, never-before-used demo tenant modeled on Pune
Municipal Corporation — for eGov India authority walkthroughs. Prepared ahead
of the target environment existing; run this once that environment (and its
DIGIT-MCP container) is up. Uses the `digit-xlsx-onboard` skill's
`city_setup_from_xlsx` wizard plus supplementary steps the wizard doesn't
cover (mobile validation, localization, sample complaints).

**Do not run this against a live/production tenant.** `in` must be a brand
new root — confirm with `mdms_get_tenants` before Step 2.

## What's in this package

| File | Contents |
|---|---|
| `Tenant And Branding Master.xlsx` | Tenant Info + Branding — code `IN.PUNE`, "Pune Municipal Corporation (Demo)", real Pune lat/long, placeholder logo URLs (swap for real branding before a live demo) |
| `Boundary_Master.xlsx` | 5-level hierarchy: State (Maharashtra) → District (Pune) → City (Pune Municipal Corporation) → Zone (2: Kasba Vishrambaug, Sahakarnagar) → Ward (3: Kasba Peth, Shukrawar Peth, Sahakarnagar) |
| `Common and Complaint Master.xlsx` | 8 India-ULB-standard departments (Public Works, Health & Sanitation, Water Supply, Electrical, Town Planning, Revenue & Tax, Solid Waste Management, Fire & Emergency Services) with matching designations; 6 complaint types / 12 sub-types across the 5 most citizen-facing departments |
| `Employee_Template.xlsx` | 8 demo employees covering every standard PGR role (CSR, GRO ×2 zones, DGRO, PGR_LME ×3 wards/depts, Supervisor), wired to real department/designation/jurisdiction codes above |

Department/boundary/complaint-type codes are plain uppercase-with-underscores
(no hyphens anywhere, including in `IN.PUNE` itself) — matches the skill's
IRON LAW that `egov-user` rejects hyphens in tenant/employee identifiers.

## Step 0 — Prerequisites

- Target DIGIT host with the MCP container running (`digit-ansible-onboard`
  bakes this in for a fresh box).
- SSH alias to reach it.
- This `india-demo/` folder available on the controller.

## Step 1 — Probe the target MCP

```bash
ssh <alias> "curl -sS http://127.0.0.1:13101/v1/version"
ssh <alias> "curl -sS http://127.0.0.1:13101/v1/tools" \
  | python3 -c 'import sys,json; t=[x["name"] for x in json.load(sys.stdin)["tools"]]; print("city_setup_from_xlsx:", "city_setup_from_xlsx" in t); print("tenant_bootstrap:", "tenant_bootstrap" in t)'
ssh <alias> "curl -sS -X POST http://127.0.0.1:13101/v1/tools/mdms_get_tenants -H 'Content-Type: application/json' -d '{}'" | python3 -m json.tool
```

Confirm `in` does not already appear in the tenants list — this must be a
fresh root. If it does, STOP and get explicit confirmation before reusing it
(see the skill's IRON LAW).

## Step 2 — Bootstrap the new root (`in` has never been onboarded)

`in` has zero MDMS schemas until this runs. Do this BEFORE staging the XLSX
files — otherwise every masters/employee write fails with
`SCHEMA_DEFINITION_NOT_FOUND_ERR`.

```bash
ssh <alias> "curl -sS -X POST http://127.0.0.1:13101/v1/tools/tenant_bootstrap \
  -H 'Content-Type: application/json' \
  -d '{\"target_tenant\":\"in\",\"source_tenant\":\"pg\",
       \"auth\":{\"username\":\"ADMIN\",\"password\":\"eGov@123\",\"tenant_id\":\"pg\"}}'"
```

This clones schema defs, ~14 essential MDMS records, an ADMIN user, and PGR
workflow business-service definitions from `pg` onto `in`. Idempotent — safe
to re-run.

## Step 3 — Widen mobile validation for India

India mobile numbers are 10 digits starting 6-9 (`^[6-9][0-9]{9}$`), not
Kenya's 9-digit `^[17][0-9]{8}$` that `pg`/`ke` roots use. The employee
sample data in `Employee_Template.xlsx` uses 10-digit numbers starting with
`9800000...` — every employee create will fail until this is set.

```bash
ssh <alias> "curl -sS -X POST http://127.0.0.1:13101/v1/tools/mdms_update \
  -H 'Content-Type: application/json' -d '{
    \"tenant_id\": \"in\",
    \"schema_code\": \"common-masters.UserValidation\",
    \"unique_identifier\": \"mobile\",
    \"patch\": {
      \"rules\": {
        \"pattern\": \"^[6-9][0-9]{9}$\",
        \"minLength\": 10,
        \"maxLength\": 10,
        \"allowedStartingCharacters\": [\"6\",\"7\",\"8\",\"9\"],
        \"errorMessage\": \"CORE_COMMON_MOBILE_ERROR\"
      }
    },
    \"is_active\": true
  }'"
ssh <alias> "docker exec digit-redis redis-cli DEL validationRules"
```

(If the redis container has a different name on this host, `docker ps | grep redis` first.)

## Step 4 — Stage files and run the wizard

```bash
scp -r "docs/onboarding-samples/india-demo/"*.xlsx <alias>:/tmp/onboarding-india/
ssh <alias> "docker exec digit-mcp mkdir -p /tmp/onboarding-india && \
             docker cp /tmp/onboarding-india/. digit-mcp:/tmp/onboarding-india/"

ssh <alias> "curl -sS -X POST http://127.0.0.1:13101/v1/tools/city_setup_from_xlsx \
  -H 'Content-Type: application/json' -d '{
    \"tenant_id\": \"in.pune\",
    \"tenant_file\":   \"/tmp/onboarding-india/Tenant And Branding Master.xlsx\",
    \"boundary_file\": \"/tmp/onboarding-india/Boundary_Master.xlsx\",
    \"masters_file\":  \"/tmp/onboarding-india/Common and Complaint Master.xlsx\",
    \"employee_file\": \"/tmp/onboarding-india/Employee_Template.xlsx\"
  }'" | tee /tmp/onboard-result-india.json | python3 -m json.tool
```

Synchronous, ~60-90s. Read `phases.{tenant,boundaries,masters,employees}.status`
— flag anything `failed` with its specific error before continuing.

## Step 5 — Localization (Hindi)

Base Hindi translations for the platform's generic UI strings already exist
in this repo at `utilities/default-data-handler/src/main/resources/localisations-dev/hi_IN/`
(rainmaker-common, rainmaker-pgr, egov-hrms, egov-user, etc.) — no need to
re-translate generic labels. Two things do need adding, since they're
demo-specific content the base files don't cover:

1. **Enable `hi_IN` as a selectable language** for `in`/`in.pune` — add it to
   `common-masters.StateInfo.languages` for tenant `in` (currently only set
   during `tenant_bootstrap`'s clone from `pg`, which may only carry `en_IN`).
2. **India-specific labels in Hindi** — department names, designations, and
   complaint type labels created in Step 4 (`PUBLIC WORKS DEPARTMENT`,
   `Pipeline Leakage`, etc.) have no Hindi translation yet since they're new
   codes. Push these via the localization upload API
   (`/localization/messages/v1/_upsert`) with `locale=hi_IN`,
   `module=rainmaker-common` (departments/designations) and
   `module=rainmaker-pgr` (complaint types), keyed the same way the base
   files key theirs (e.g. `COMMON_MASTERS_DEPARTMENT_<CODE>`,
   `CS_COMPLAINT_TYPE_<CODE>`) — check `hi_IN/rainmaker-common.json` for the
   exact key pattern already in use before writing new ones, so they resolve
   the same way in the UI.

## Step 6 — Seed sample complaints

Not covered by `city_setup_from_xlsx` — the wizard onboards masters and
employees, not transactional PGR data. Seed a handful across departments and
statuses so the demo inbox shows real variety instead of an empty list.

Suggested spread (repeat the `_create` + workflow-action pattern established
earlier in this project — see any `pgr-services/v2/request/_create` call
plus `/user/oauth/token` for a citizen login):

| Complaint | Department | Target status | How |
|---|---|---|---|
| Pipeline leakage, Kasba Peth | Water Supply | `PENDINGFORASSIGNMENT` | `_create` only |
| Garbage not collected, Shukrawar Peth | Health & Sanitation | `PENDINGATLME` | `_create` + `ASSIGN` to `PMC-LME-HEALTH-W1` |
| Pothole, Sahakarnagar | Public Works | `PENDINGATLME` | `_create` + `ASSIGN` to a PWD employee |
| Streetlight not working, Kasba Peth | Electrical | `RESOLVE`d | `_create` + `ASSIGN` + `RESOLVE` |
| Bin overflow, Kasba Peth | Solid Waste Mgmt | `CLOSEDAFTERRESOLUTION` | full lifecycle |
| Water quality issue, Sahakarnagar | Water Supply | `PENDINGFORREASSIGNMENT` | `_create` + `ASSIGN` + `REJECT` |

Use the citizen test pattern already established for this project (create a
citizen user under `in.pune` with a valid 10-digit mobile, or reuse the ADMIN
employee token for citizen-role complaint creation as done elsewhere in this
repo's test specs) and the boundary/department codes from this package.

## Step 7 — Verify (read-backs, not the wizard's word)

```bash
# Tenant record at root
curl -sS -X POST http://127.0.0.1:13101/v1/tools/mdms_search -d '{"tenant_id":"in","schema_code":"tenant.tenants","unique_identifier":"pune"}'

# Boundary hierarchy at city
curl -sS -X POST http://127.0.0.1:13101/v1/tools/validate_boundary_hierarchy \
  -d '{"tenant_id":"in.pune","hierarchy_type":"PUNE_ADMIN","expected_levels":["State","District","City","Zone","Ward"]}'

# Departments / designations / complaint types at root
curl -sS -X POST http://127.0.0.1:13101/v1/tools/mdms_search -d '{"tenant_id":"in","schema_code":"common-masters.Department","limit":500}'

# Employees at city, by mobile (HRMS uses employeeCode as userName, not the file's userName column)
curl -sS -X POST http://127.0.0.1:13101/v1/tools/user_search -d '{"tenant_id":"in.pune","mobile_number":"9800000001"}'
```

Then log in for real:
- UI: `<scheme>://<host>/digit-ui/employee`, tenant `in.pune`
- First login: `userName: PMC-CSR-01`, `password: eGov@123`
- Confirm: employee login works, inbox shows the seeded complaints, citizen
  complaint creation flow works end-to-end, Hindi language toggle renders
  (at minimum generic UI chrome; India-specific labels once Step 5 lands).

## Teardown (if this was a rehearsal run)

```bash
curl -sS -X POST http://127.0.0.1:13101/v1/tools/tenant_destroy -d '{
  "tenant_id": "in.pune",
  "department_codes": ["PUBLIC WORKS DEPARTMENT","HEALTH AND SANITATION DEPARTMENT","WATER SUPPLY DEPARTMENT","ELECTRICAL DEPARTMENT","TOWN PLANNING DEPARTMENT","REVENUE AND TAX DEPARTMENT","SOLID WASTE MANAGEMENT DEPARTMENT","FIRE AND EMERGENCY SERVICES DEPARTMENT"],
  "designation_codes": ["Junior Engineer","Municipal Commissioner","Health Officer","Sanitary Inspector","Junior Engineer (Water)","Deputy Commissioner","Junior Engineer (Electrical)","Town Planner","Assistant Commissioner","Revenue Inspector","Ward Officer","Fire Officer"],
  "complaint_type_codes": ["No Water Supply","Garbage Collection","Road Damage","Streetlight Issue","Waste Management"]
}'
```

Re-running Step 4's `city_setup_from_xlsx` call afterward is safe and
idempotent (`tenant_destroy` doesn't remove boundary entities — recreating
under the same hierarchy type is a no-op for those).
