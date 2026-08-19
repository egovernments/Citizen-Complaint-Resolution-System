# Enable a New Tenant & Load Master Data

Operator how-to for standing up a new city (tenant) on a running DIGIT CRS
stack and loading everything a PGR complaint needs: the tenant record and
branding, the boundary hierarchy, common masters (departments, designations,
complaint types), and employees.

There are three ways to do this. They all create the same data — pick the one
that matches how your stack is deployed:

| Path | Interface | Best for | Where it's available |
|------|-----------|----------|----------------------|
| **[Configurator wizard](#a-configurator-wizard-browser)** | Browser (upload XLSX) | Non-technical operators onboarding a real city | Ansible deploys with `nginx_features.configurator: true` + `build_configurator: true` |
| **[Python DataLoader](#b-python-dataloader-scripted)** | `CRSLoader` Python library | Developers, scripted/local setups | Any stack (Docker Compose, Tilt, Ansible) |
| **[MCP `city_setup_from_xlsx`](#c-mcp-automation)** | REST / MCP tool | CI, fully-automated onboarding | Deploys with `enable_mcp: true` + `nginx_features.mcp: true` |

> **Order always matters:** Tenant → Boundaries → Masters → Employees. Each
> phase validates codes created by the previous one (an employee's jurisdiction
> must reference a boundary that already exists; a complaint type's department
> must already be in the Department master).

---

## A. Configurator wizard (browser)

The configurator (a.k.a. DIGIT Studio) is a browser SPA served at
`/configurator/`. An operator uploads four XLSX templates — one per phase — and
the wizard creates the tenant and loads all master data through the onboarding
API.

### Prerequisites

The configurator ships **only with the Ansible deploy**, and only when enabled
in the tenant's `host_vars`:

```yaml
# local-setup/ansible/inventory/host_vars/<tenant>.yml
nginx_features:
  configurator: true         # renders the /configurator/ nginx location
build_configurator: true     # clone + `vite build` the SPA at deploy time
```

Re-run `./deploy.sh <tenant>` after flipping these. See
[`../ansible/README.md`](../ansible/README.md) for the full deploy flow.

### Open it

```text
https://<domain>/configurator/
```

`tls_enabled` defaults to `true`, so HTTPS is the normal case; use
`http://<domain>/configurator/` only on a sandbox deploy with
`tls_enabled: false` (e.g. `domain: localhost`).

Log in as `ADMIN` / `eGov@123` against the **root** tenant (e.g. `ke`). The
wizard walks the four phases in order.

### Phase 1 — Tenant

The wizard creates the **city** tenant (e.g. `ke.bomet`). Everything you upload
in later phases lands on this city tenant, *not* on the root.

### Phase 2 — Boundaries

**Download Template** gives one sample row per hierarchy level. Fill it in and
re-upload. Rules:

- One row per place; **parents before children**.
- `boundaryType` = the hierarchy level name, spelled exactly.
- `code` unique (e.g. `WARD_001`); `parentCode` = the parent's `code`; the
  root row's `parentCode` is empty.
- Delete the `Sample_*` rows before uploading.

> Example shape (Bomet): 1 Country + 1 County + 5 Subcounties + 25 Wards = 32 rows.

> **Known issue — empty boundary dropdowns after upload.** On some versions the
> wizard leaves `boundary_relationship.ancestralmaterializedpath` empty, so
> boundary dropdowns render only the root. If you hit this, apply the SQL
> backfill + `docker restart boundary-service` documented in
> [`../ansible/runbooks/03-bomet-onboarding.md`](../ansible/runbooks/03-bomet-onboarding.md)
> (§2.2).

### Phase 3 — Departments, Designations & Complaint Types

Three sheets in one workbook.

- **Department** — each row has a `code` (e.g. `HealthServices`,
  `WaterandSewage`) plus a display name.
- **Designation** — designation codes + names.
- **ComplaintType** — authored in plain, human-readable terms; the codes are
  derived for you:

  | Complaint Type* | Complaint sub type* | department | slaHours | keywords | active |
  |---|---|---|---|---|---|
  | Water Pipes | Pipe leakage or damage | WaterandSewage | 48 | leak, damage | true |
  | Water Pipes | Low pressure | WaterandSewage | 48 | low pressure | true |

  - `menuPath` = PascalCase(Complaint Type*) → `WaterPipes`
  - `serviceCode` = PascalCase(Type + sub type) → `WaterPipesLowPressure`
  - Rows sharing a **Complaint Type** collapse into one citizen-menu entry.
  - Punctuation (`& / ' ( ) . ,`) is stripped from generated codes.
  - `department` **must match** a `code` in the Department sheet.
  - Leaving `department` blank is accepted and creates the type with
    `department: "NA"` — any department may handle it, but **department
    dashboard tiles stay empty for that type**. Fill it in unless the type is
    deliberately unassigned.

### Phase 4 — Employees

Template columns:

```text
employeeCode | name | userName | mobileNumber | emailId | gender | dob |
department | designation | roles | jurisdictions | dateOfAppointment
```

- `mobileNumber` — must satisfy the tenant's mobile regex (Kenya:
  `^[17][0-9]{8}$`, i.e. exactly 9 digits).
- `roles` — validated against `ACCESSCONTROL-ROLES`. Use `EMPLOYEE` plus a
  workflow role: **GRO** (receives/assigns), **DGRO** (department/subcounty
  assigner), **PGR_LME** (resolver). Add **CSR** for anyone who must *file* a
  complaint from the employee portal — the employee create-complaint screen is
  gated on that role, so a GRO/DGRO/PGR_LME-only employee can process complaints
  but cannot raise one. Give at least one employee `EMPLOYEE,CSR` if you want to
  test the create flow end to end.
- `jurisdictions` — boundary codes created in Phase 2 (`WARD_001`,
  `SUBCOUNTY_001`, …).
- `department` accepts a **comma-separated list** (`HealthServices,WaterandSewage`).
  The first is the current HRMS assignment; the rest are historical assignments.
  PGR lets a person be assigned a complaint when **any** of their departments
  matches the complaint's department.
- Dates (`dob`, `dateOfAppointment`) accept text `YYYY-MM-DD` or spreadsheet
  date cells.

### Point the UI at the new tenant

Because the wizard puts all data on the city tenant, the SPA must land there.
In `host_vars/<tenant>.yml`:

```yaml
ui_state_tenant_id: <root>.<city>   # SPA boots on the wizard-created city
boot_tenant: <root>.<city>          #   e.g. ke.bomet
hierarchy_type: <hierarchy-name>    # MUST match the Phase 2 hierarchy name
login_tenant_allowlist: [<root>, <root>.<city>]   # every tenant that must appear
                                                  # in the login City dropdown
```

Leave `state_root` / `state_tenant_id` / `tenant_id` at the **root** (`<root>`,
e.g. `ke`) — those drive the JVM `STATE_LEVEL_TENANT_ID` pins. Re-run
`./deploy.sh <tenant>`.

> **`hierarchy_type` is a single global value, not per-tenant.** The UI sends it
> on every boundary lookup regardless of which tenant is active, so **all tenants
> on one deployment must use the same hierarchy name**. Onboarding a second city
> under a differently-named hierarchy will silently blank the boundary dropdowns
> for one of them. If you plan to host more than one city, standardise on one
> name (`ADMIN` is the UI default) and create each tenant's hierarchy under it —
> see [§C step 1](#worked-headless-run-city_setup_from_xlsx-over-the-rest-shim).

---

## B. Python DataLoader (scripted)

Available on every stack (Docker Compose, Tilt, Ansible). `CRSLoader` runs the
same phases in Python, driven by the XLSX templates bundled under
`dataloader/templates/`.

> **The Jupyter Lab service was removed in #1743.** The library it hosted did
> not go anywhere — it moved from `local-setup/jupyter/dataloader/` to
> **`local-setup/dataloader/`** and is still the single source of truth for
> every dataloader path, including the CI scripts. What changed is that you
> drive it from a Python script instead of notebook cells; the calls below are
> unchanged.

### 1. Set up a Python environment

Run this from `local-setup/`, on any machine that can reach the deployment's
Kong endpoint — it does not have to be the server.

```bash
cd local-setup
python3 -m venv .venv && source .venv/bin/activate
pip install -r dataloader/requirements.txt
```

The virtualenv is not optional on Ubuntu 24.04, Debian 12+, Fedora 38+ or
Homebrew Python — a bare `pip install` there fails with PEP 668
`error: externally-managed-environment`.

**If you would rather work interactively**, everything below also works
line-by-line in `python3 -i`, or in your own Jupyter/IPython install pointed at
this virtualenv. Nothing about the loader required the bundled container.

### 2. Configure + create the tenant (Phase 1)

Start your script with the imports and the login. This both logs in **and**
creates the tenant:

```python
import sys
sys.path.insert(0, "dataloader")     # run from local-setup/
from crs_loader import CRSLoader
```

Then:

```python
URL          = "http://localhost:18000"  # Kong, from wherever you are running this
USERNAME     = "ADMIN"
PASSWORD     = "eGov@123"
TENANT_ID    = "pg"                  # root tenant you log in against
TARGET_TENANT = "pg.myorg"           # <-- your new tenant (pattern: <state>.<city>)

loader = CRSLoader(URL)
loader.login(username=USERNAME, password=PASSWORD, tenant_id=TENANT_ID)

# Creates the tenant (also enables PGR & HRMS) and its ADMIN user:
loader.create_tenant(TARGET_TENANT, "My Org", users=[
    {"username": "ADMIN", "password": "eGov@123", "name": "Admin",
     "roles": ["SUPERUSER", "EMPLOYEE", "CSR", "GRO", "DGRO", "PGR_LME", "PGR_VIEWER", "CITIZEN"]}
])
loader.login(username="ADMIN", password="eGov@123", tenant_id=TARGET_TENANT)
```

Creating a tenant under a brand-new root (e.g. `ethiopia.addis`) auto-bootstraps
that root — schemas and essential MDMS data are copied from `pg` first.

### 3. Run the remaining phases in order

Append these to the same script, in this order — each validates codes the
previous one created.

| Phase | Call | What it does |
|------|------|--------------|
| Phase 2a | `loader.load_hierarchy(name, levels, target_tenant, output_dir="upload")` | Defines the boundary hierarchy and writes an Excel template to `upload/` |
| Phase 2b | `loader.load_boundaries(<file>, target_tenant, hierarchy_type)` | Uploads the filled boundary sheet; creates entities + parent/child relationships |
| Phase 3  | `loader.load_common_masters(<file>, target_tenant)` | Departments, designations, complaint types |
| Phase 4  | `loader.load_employees(<file>, target_tenant)` | HRMS employees with roles, departments, jurisdictions |
| Phase 5  | `loader.load_localizations(<file>, target_tenant)` | *Optional* — bulk translation messages (and, optionally, a new UI language) |
| Phase 6  | `loader.load_workflow("dataloader/templates/PgrWorkflowConfig.json", target_tenant)` | The PGR complaint-workflow state machine |

The bundled templates live in `dataloader/templates/`
(`Boundary_Master.xlsx`, `Common and Complaint Master.xlsx`, the employee
master, `localization.xlsx`, `PgrWorkflowConfig.json`). Copy and edit them for
your city.

**Prefer a ready-made script?** `scripts/ci-dataloader-xlsx.py` already does all
nine steps — templates, tenant, boundaries, masters, employees, workflow,
localization and a create → assign → resolve verification — from one county
input spreadsheet. It is the closest thing to a one-command version of this
section:

```bash
DIGIT_URL=http://localhost:18000 \
BOOT_TENANT=pg.myorg \
INPUT_XLSX="data/Bomet county health common complains items - R.xlsx" \
python3 scripts/ci-dataloader-xlsx.py
```

`INPUT_XLSX` is **your** county spreadsheet. The only one in the repo is the
Bomet sample used above; there is no `county-data.xlsx`. Point it at your own
file once you have one — the script reads whatever path you give it, and
defaults to `county-data.xlsx` in the working directory if you omit the
variable entirely.

### Rollback

Each phase has an inverse. **Note the argument order** — `full_reset` takes the
boundary hierarchy type *first*, then the tenant:

```python
loader.delete_boundaries(TARGET_TENANT)          # Phase 2
loader.rollback_common_masters(TARGET_TENANT)    # Phase 3
loader.rollback_tenant(TARGET_TENANT)            # Phase 1 (tenant + branding)
loader.full_reset("REVENUE", TARGET_TENANT)      # everything (pass the hierarchy you used)
```

Employees (Phase 4) cannot be deleted via API — HRMS records are deactivated,
not removed.

---

## C. MCP automation

For CI or hands-off onboarding, the DIGIT-MCP server drives the same steps
through its tools — `tenant_bootstrap` (once per new root), then `city_setup`
and the masters/employees/localization tools, or the `city_setup_from_xlsx`
orchestrator that sequences the four phases from a folder of XLSX files.
Requires a deploy with `enable_mcp: true` — and, if you drive it over the REST
shim (`/v1/*`) as below rather than in-process, `nginx_features.mcp: true` as
well. See the step-by-step
[City Setup Guide](../../digit-mcp/docs/guides/city-setup.md) in the digit-mcp
package.

### Worked headless run (`city_setup_from_xlsx` over the REST shim)

The orchestrator is exposed on the shim at `POST /v1/tools/city_setup_from_xlsx`.
Files are read **inside** the MCP container, so stage them there first. Run the
steps in this order — each avoids a failure seen in practice.

**Prerequisites.** The REST shim needs **both** flags in `host_vars` — the
service *and* its nginx location:

```yaml
enable_mcp: true
nginx_features: { mcp: true }     # exposes /mcp + /v1/*
```

The target must also be able to **pull or build the MCP image**. Compose
validates every image before starting any service, so an unreachable registry
fails the whole `docker compose up`, not just MCP. Either:

- `build_mcp: true` — build from the vendored in-tree source (no registry
  needed); or
- leave it off and take the playbook's default, which resolves to the public
  `ghcr.io/subhashini-egov/digit-mcp:<pinned-tag>` (see "Resolve MCP image tag"
  in `playbook-deploy.yml`). `MCP_IMAGE` is passed through verbatim — no
  `docker_registry` prefix is applied.

If your `host_vars` pins `mcp_image` to the Hetzner VPC registry
(`10.0.0.4:5000`), the target must be VPC-internal.

> If in doubt, check what your checkout will actually pull:
> `grep -A4 'Resolve MCP image tag' local-setup/ansible/playbook-deploy.yml`
> (run from the repo root).

Confirm it's reachable: `curl -s $BASE/v1/healthz` → `{"status":"ok",…}`.

**Where to run these commands.** `curl` can run anywhere that can reach the
host; `docker …` and `psql` commands run **on the deployment target** (SSH in
first for a remote Option C deploy).

**Shell setup** — every snippet below assumes these two variables:

```bash
# Ansible deploy: the host nginx (add https:// + your domain if TLS is on).
# Docker Compose / Tilt stacks: http://localhost:18000 (Kong).
BASE=http://localhost

TOKEN=$(curl -s "$BASE/user/oauth/token" \
  -H 'Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=password&scope=read&username=ADMIN&password=eGov@123&tenantId=<root>&userType=EMPLOYEE' \
  | jq -r .access_token)
```

**1. Pre-create the boundary hierarchy at the tenant.** The loader auto-names a
fresh hierarchy per city (`<CITY>_ADMIN`), but the UI reads a **single global
`HIERARCHY_TYPE`** for every tenant. Create the hierarchy under that shared name
(`ADMIN`) with your exact levels first, so the loader reuses it:

```bash
curl -s "$BASE/boundary-service/boundary-hierarchy-definition/_create" \
  -H 'Content-Type: application/json' -d '{
    "RequestInfo":{"authToken":"'"$TOKEN"'","userInfo":{"userName":"ADMIN","tenantId":"<root>","type":"EMPLOYEE"}},
    "BoundaryHierarchy":{"tenantId":"<tenant>","hierarchyType":"ADMIN","boundaryHierarchy":[
      {"boundaryType":"<L1>","parentBoundaryType":null,"active":true},
      {"boundaryType":"<L2>","parentBoundaryType":"<L1>","active":true}]}}'
```

**2. Wait until the backend is healthy for ≥ 5 min.** After a fresh deploy the
JVM tier keeps warming/restarting; onboarding into that window causes transient
5xx that corrupt the load (and can make the loader auto-create the wrong-named
hierarchy from a swallowed error). Confirm `boundary-service` shows `healthy`.

**3. Run it:**

```bash
docker cp <files-dir> digit-mcp:/tmp/onboard
curl -s -m 900 "$BASE/v1/tools/city_setup_from_xlsx" -H 'Content-Type: application/json' -d '{
  "tenant_id":"<tenant>",
  "tenant_file":"/tmp/onboard/01-Tenant-And-Branding-Master.xlsx",
  "boundary_file":"/tmp/onboard/02-Boundaries.xlsx",
  "boundary_geojson_file":"/tmp/onboard/02-Boundaries-Polygons.geojson",
  "masters_file":"/tmp/onboard/03-Common-and-Complaint-Master.xlsx",
  "employee_file":"/tmp/onboard/04-Employees.xlsx",
  "auth":{"username":"ADMIN","password":"eGov@123","tenant_id":"<root>"}
}'
```

The optional GeoJSON sidecar attaches Polygon/MultiPolygon geometry to boundary
rows by `properties.code`; include only real geometry (a boundary with no polygon
still works in the dropdown, it just won't resolve map pins).

**Known phase failures on the headless path & recovery:**

- **Tenant phase** fails with a schema error on null `city.latitude/longitude`
  (surfaces as `ValidationException.getKeyword() is null` — mdms-v2's error
  formatter NPEs on the underlying schema violation) → register the tenant
  directly by cloning a known-good row, then re-run the remaining phases:
  ```bash
  docker exec -i docker-postgres psql -U egov -d egov <<'SQL'
  -- clone an existing city's tenant.tenants row, patching identity fields
  INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive,
                            createdby, lastmodifiedby, createdtime, lastmodifiedtime)
  SELECT md5(random()::text || clock_timestamp()::text), '<root>', '<tenant>', 'tenant.tenants',
         jsonb_set(jsonb_set(jsonb_set(jsonb_set(src.data::jsonb,
           '{code}', '"<tenant>"'), '{name}', '"<City Name>"'),
           '{tenantId}', '"<tenant>"'), '{city,code}', '"<TENANT-UPPER>"'),
         true, src.createdby, src.lastmodifiedby,
         (extract(epoch from now())*1000)::bigint, (extract(epoch from now())*1000)::bigint
  FROM (SELECT data, createdby, lastmodifiedby FROM eg_mdms_data
        WHERE schemacode='tenant.tenants' AND uniqueidentifier='<existing-city>') src;

  -- make the tenant visible to the modules (PGR / HRMS / Workbench)
  UPDATE eg_mdms_data SET data = jsonb_set(data::jsonb, '{tenants}',
           (data::jsonb->'tenants') || '[{"code":"<tenant>"}]'::jsonb)
  WHERE schemacode='tenant.citymodule' AND tenantid='<root>'
    AND NOT (data::jsonb->'tenants') @> '[{"code":"<tenant>"}]'::jsonb;
  SQL
  ```
- **Employee phase** fails with "encryption process" / "Tenant Id not found" →
  `egov-enc-service` has no key for a tenant that wasn't registered yet. After the
  tenant exists: `docker restart egov-enc-service`, then re-run with only
  `employee_file`.
- **Employee jurisdiction** lands on the wrong root (the loader scopes to the
  first boundary root) → fix directly (SQL runs on the target host; the DB
  container is `docker-postgres`, user/db `egov`):
  ```bash
  docker exec -i docker-postgres psql -U egov -d egov <<'SQL'
  UPDATE eg_hrms_jurisdiction j SET boundary='<intended-root-code>'
  FROM eg_hrms_employee e WHERE e.uuid = j.employeeid AND e.tenantid = '<tenant>';
  SQL
  ```
- **MapConfig not written.** Unlike the configurator wizard's Phase 2, the
  headless path does **not** write `RAINMAKER-PGR.MapConfig`, so the citizen map
  has no boundary source. Seed it (see the [map post-config](#after-onboarding--enable-the-map--boundaries) below).

---

## After onboarding — enable the map & boundaries

Two settings decide whether the map pin and boundary cascade actually work for
citizens (easy to miss, and not created by the headless path):

- **`RAINMAKER-PGR.MapConfig` per tenant.** The configurator wizard's Phase 2
  writes this; the headless path does not. Without it the citizen map has no
  boundary source. Seed one record per tenant (its `boundaryTenantId` = the
  tenant itself):

  ```bash
  curl -s "$BASE/mdms-v2/v2/_create/RAINMAKER-PGR.MapConfig" -H 'Content-Type: application/json' -d '{
    "RequestInfo":{"authToken":"'"$TOKEN"'","userInfo":{"userName":"ADMIN","tenantId":"<root>","type":"EMPLOYEE"}},
    "Mdms":{"tenantId":"<tenant>","schemaCode":"RAINMAKER-PGR.MapConfig","uniqueIdentifier":"DEFAULT",
      "data":{"code":"DEFAULT","boundaryTenantId":"<tenant>","center":{"lat":<lat>,"lng":<lng>},
              "defaultZoom":11,"baseMapTheme":"voyager","geocodeCountryCodes":"<cc>"},"isActive":true}}'
  ```

- **`pgr_boundary_lowest_level`** (host_vars → globalConfigs `PGR_BOUNDARY_LOWEST_LEVEL`)
  — set to the level that tiles your territory **with real geometry** (e.g.
  `Ward`), not a deeper level only some regions have. It caps *both* the map's
  pin-resolution level and the dropdown cascade so they agree; if the name isn't
  a level of the tree the map silently falls back to the deepest level (a
  `console.warn` names the levels it does have).

- **Citizen home city.** The citizen map and cascade resolve against
  `CITIZEN.COMMON.HOME.CITY`; ensure it's set on citizen login (SSO mapper /
  location picker), else citizens fall back to the state root (no city tree →
  blank map/cascade). As a deployment-wide fallback for citizens without a home
  city, globalConfigs `MAP_TENANT` (from `city_tenant`) can point at a tenant
  that has geometry.

## After onboarding — notifications & the supervisor dashboard

Two more features ship disabled/unseeded on a fresh tenant. Each has a
**resumable, idempotent installer** in `local-setup/scripts/` that flips it on
against a *running* stack (neither redeploys anything). Both support `--list`,
`--from stepN` / `--to stepN` / `--only stepN` for partial runs.

- **PGR notifications (SMS / Email / WhatsApp)** — `enable-notifications.sh`.
  Nine steps: switch PGR to the config-driven notification path, bring up the
  Novu stack + bridge, mint the Novu API key, open the channel gate, seed the
  four notification MDMS masters at the state root, take provider credentials,
  bootstrap the per-channel workflows (`complaints-sms`/`-email`/`-whatsapp`),
  then drive-and-verify a real dispatch (`SENT` in `nb_dispatch_log` = trigger
  accepted; confirm actual delivery against the provider). The **only
  credential input** is the three `TWILIO_*` env vars; the default run pauses
  at the showcase step (5), so add `--yes` for a fully non-interactive run:

  ```bash
  TWILIO_ACCOUNT_SID=AC… TWILIO_AUTH_TOKEN=… \
    TWILIO_WHATSAPP_FROM=whatsapp:+14155238886 \
    ./local-setup/scripts/enable-notifications.sh --yes
  ```

  WhatsApp specifics: Content templates must be authored and approved at the
  provider **first**, then synced to Content-SIDs (configurator UI or headless
  CLI). Full walkthrough:
  [`../../docs/notification-onboarding/RUNBOOK.md`](../../docs/notification-onboarding/RUNBOOK.md)
  (§5 covers templates → SIDs → test-send → drive a real complaint), with
  `TUTORIAL.md`, `install-fresh.md`, `install-upgrade.md` and the
  provider-onboarding runbook alongside it.

- **Supervisor dashboard (KPI catalog + packs)** — `enable-dashboard.sh`.
  Seven steps: register the `dss.*` schemas, seed the KPI definitions +
  dashboard pack **from the repo's own files** (not by copying another tenant),
  write `dss.DashboardConfig`, add the sidebar action, seed the localization
  packs, and verify end-to-end. Its preflight is read-only and **refuses to
  write** when it finds problems seeding can't fix (schema-as-data rows,
  role ceilings nobody holds) — use `--repair` where it tells you to. Seeding
  is `_create`-only, so re-runs skip records that already exist and never pick
  up an edited `KpiDefinition.json` / `DashboardPack.json` — use `--update`
  after a release changes them. If your deployment uses its own role taxonomy,
  remap the canonical roles:

  ```bash
  ROLE_MAP="PGR_SUPERVISOR=CMS_SUPERVISOR,PGR_LME=CMS_CASE_MANAGER" \
    ./local-setup/scripts/enable-dashboard.sh
  ```

  The dashboard's nav gate reads `dss.DashboardConfig.allowedRoles` (falling
  back to `SUPERVISOR`/`PGR_*`/`GRO`/`DGRO`/`SUPERUSER`), so at least one
  onboarded employee must hold one of those roles to see it.

  "Today" tiles resolve the calendar day in EAT (`Africa/Nairobi`), fixed in the
  analytics service rather than read from tenant config.

  **Department tiles also need department data**, which `enable-dashboard.sh`
  does not seed. Tiles group on each complaint type's `department` in
  `RAINMAKER-PGR.ComplaintHierarchy`; a type onboarded with the Department
  column blank carries `NA` — or no `department` key at all, on types brought
  over by the hierarchy migration — and produces no breakdown. Count leaf types
  only, the rows the tiles read:

  ```bash
  docker exec docker-postgres psql -U egov -d egov -tAc \
  "WITH leaf_levels AS (
     SELECT DISTINCT lvl->>'levelCode' AS level_code
       FROM eg_mdms_data d
       CROSS JOIN LATERAL jsonb_array_elements(d.data->'levels') lvl
      WHERE d.schemacode='RAINMAKER-PGR.ComplaintHierarchyDefinition' AND d.isactive
        AND (lvl->>'isLeafServiceCode')::boolean
   ), leaves AS (
     SELECT tenantid,
            btrim(coalesce(data->>'department', data->'departments'->>0)) AS dept
       FROM eg_mdms_data
      WHERE schemacode='RAINMAKER-PGR.ComplaintHierarchy' AND isactive
        AND data->>'levelCode' IN (SELECT level_code FROM leaf_levels)
   )
   SELECT tenantid,
          count(*) FILTER (WHERE upper(coalesce(dept,'')) NOT IN ('NA','')) AS usable,
          count(*) FILTER (WHERE upper(coalesce(dept,'')) IN ('NA',''))     AS unassigned,
          count(*) AS leaves
     FROM leaves GROUP BY 1;"
  ```

  `usable` should equal `leaves`. Fix `unassigned` types in the configurator, or
  re-run Phase 3 with the column filled. No rows at all means the tenant has no
  `ComplaintHierarchyDefinition`; install it first.

  Leave `dss.DashboardConfig.departmentScoping` unset or `disabled` while
  `unassigned` is above zero. Enforced scoping filters on
  `department_code IN (...)`, which never matches an unassigned type, so scoped
  employees get **zero rows on every tile** — not just the department ones.
  References:
  [`../../docs/migration/tenant-department-migration-guide.md`](../../docs/migration/tenant-department-migration-guide.md)
  (department preflight and back-fill) and
  [`../../docs/dashboard-configuration/README.md`](../../docs/dashboard-configuration/README.md)
  (KPI catalog, packs & RBAC, operations).

New state roots bootstrapped via `tenant_bootstrap` get the dashboard catalog
seeded from the repo automatically and warn when a `dss.*` master would land
empty — but tenants created before that, or via the paths above, need
`enable-dashboard.sh` run once.

### Other opt-in add-ons (deploy-time flags)

Beyond the two installers above, everything else the deployer supports is a
**host_vars flag**: set it in `host_vars/<tenant>.yml` and re-run
`./deploy.sh <tenant>` (idempotent). Where a `nginx_features.*` twin exists,
**both** flags are needed — the service flag runs it, the nginx flag makes it
reachable.

| Add-on | Flag(s) | What you get | Notes |
|---|---|---|---|
| **Configurator (DIGIT Studio)** | `nginx_features.configurator` + `build_configurator` | Browser onboarding wizard at `/configurator/` | See [§A](#a-configurator-wizard-browser) |
| **MCP server + REST shim** | `enable_mcp` (+ `nginx_features.mcp` for `/mcp` + `/v1/*`) | Automation/REST onboarding API, headless `city_setup_from_xlsx` | `build_mcp: true` builds from in-tree source; default is a pinned public image |
| **Search stack (employee inbox)** | `enable_search_stack` | Elasticsearch + egov-indexer + inbox-v2 | Heavy (~3 GB RAM extra); without it the employee inbox 503s |
| **Novu notification stack** | `enable_novu` (+ `build_novu_bridge`, `build_novu_dashboard`) | Notification infra only (no config) | `enable-notifications.sh` above is the full turn-key path |
| **Keycloak SSO** | `enable_keycloak` + `nginx_features.keycloak` | Keycloak at `/auth/` + token exchange; optional Google IdP via `keycloak_google_client_*` | SPA switch to OIDC is a separate `auth_provider` step |
| **Citizen UI v2** | `enable_digit_ui_v2` + `nginx_features.digit_ui_v2` | Vite + React 19 citizen SPA at `/citizen/` | Both flags, or the bundle sits on disk unreachable |
| **Turbopass (OSM autocomplete)** | `enable_turbopass` | Self-hosted location search from a prepared OSM extract | Prepare the data dir on the controller first |
| **Overpass (OSM queries)** | `enable_overpass` | Self-hosted Overpass API | Prepare the country extract first — see `overpass/README.md` |
| **Real OTP (production SMS)** | `enable_otp_services` | Real OTP delivery instead of the console mock | ALSO remove the Kong mock plugin + set a real `SMS_PROVIDER_CLASS` — see `kong/kong.yml` notes |
| **Integration-test dashboards** | `enable_integration_tests` + `nginx_features.integration_tests` (+ `_runner` pair for in-dashboard runs) | Published Playwright dashboards at `/tests/` | Runner is CPU/RAM heavy — shares the box with the live stack |
| **Brand assets** | `nginx_features.brand_assets` | Local logo/banner mirror at `/brand/` | |
| **CI test suites on deploy** | `run_ci_tests` | Newman + regression suites at the end of every deploy | Adds ~5–10 min per deploy |

Full inline documentation for every flag lives in
[`../ansible/inventory/host_vars/_example.yml`](../ansible/inventory/host_vars/_example.yml) —
each key carries its own comment block, defaults, and pairing requirements.

## After onboarding — verify

A successful onboarding should leave you able to:

1. Open the employee login page and see the new tenant in the **City** dropdown
   (the dropdown is gated by `login_tenant_allowlist` in `host_vars` — if the
   new tenant is missing there, add it and re-run the deploy before concluding
   onboarding failed).
2. Log in as `ADMIN` / `eGov@123` against the new tenant. *(Guaranteed on the
   wizard and DataLoader paths, which create that user. The headless XLSX path
   does not create a city ADMIN by itself — log in with an onboarded employee's
   `employeeCode` instead, or as `ADMIN` against the root.)*
3. See the tenant in the HRMS / PGR / Workbench module switchers after login.
4. See departments, designations, and complaint types populated for the tenant.
5. See boundaries populate the location dropdowns in the complaint form.

Quick API check that the tenant record landed:

```bash
# $BASE = http://<domain> on an Ansible deploy; http://localhost:18000 (Kong)
# on a Docker Compose / Tilt stack.
curl -s -X POST "$BASE/mdms-v2/v1/_search" \
  -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker"},"MdmsCriteria":{"tenantId":"<root>","moduleDetails":[{"moduleName":"tenant","masterDetails":[{"name":"tenants"}]}]}}' \
  | grep -o '"code":"[^"]*"'
```

Boundary sanity-check (counts per level, and that geometry actually landed):

```bash
curl -s -X POST "$BASE/boundary-service/boundary-relationships/_search?tenantId=<tenant>&hierarchyType=<hierarchy>&includeChildren=true" \
  -H 'Content-Type: application/json' -d '{"RequestInfo":{"authToken":"'"$TOKEN"'"}}' \
  | jq '[.TenantBoundary[0].boundary | .. | objects | select(has("boundaryType")).boundaryType] | group_by(.) | map({(.[0]): length}) | add'
```

Then run the PGR lifecycle Postman collection against the tenant to confirm the
full create → assign → resolve → close flow works — see the *Testing the deploy*
section of [`../ansible/README.md`](../ansible/README.md).

## Troubleshooting & known issues

Onboarding edge cases (empty boundary dropdowns, first-cold-deploy bootstrap
ordering, employee date/department parsing) and their workarounds are tracked in
the Ansible runbooks:

- [`../ansible/runbooks/02-tenant-onboarding-status.md`](../ansible/runbooks/02-tenant-onboarding-status.md) — what a correct onboarding must achieve, and resolved vs. open bugs.
- [`../ansible/runbooks/03-bomet-onboarding.md`](../ansible/runbooks/03-bomet-onboarding.md) — the end-to-end deploy + wizard walkthrough, per-phase template rules, and SQL workarounds.
