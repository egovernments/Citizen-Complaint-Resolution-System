# Enable a New Tenant & Load Master Data

Operator how-to for standing up a new city (tenant) on a running DIGIT CRS
stack and loading everything a PGR complaint needs: the tenant record and
branding, the boundary hierarchy, common masters (departments, designations,
complaint types), and employees.

There are three ways to do this. They all create the same data — pick the one
that matches how your stack is deployed:

| Path | Interface | Best for | Where it's available |
|------|-----------|----------|----------------------|
| **[Configurator wizard](#a-configurator-wizard-browser)** | Browser (upload XLSX) | Non-technical operators onboarding a real city | Ansible deploys with `nginx_features.configurator: true` |
| **[Jupyter DataLoader](#b-jupyter-dataloader-scripted)** | Jupyter notebook (Python) | Developers, scripted/local setups | Any stack (Docker Compose, Tilt, Ansible) |
| **[MCP `city_setup_from_xlsx`](#c-mcp-automation)** | REST / MCP tool | CI, fully-automated onboarding | Deploys with `enable_mcp: true` |

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

```
http://<domain>/configurator/
```

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

### Phase 4 — Employees

Template columns:

```
employeeCode | name | userName | mobileNumber | emailId | gender | dob |
department | designation | roles | jurisdictions | dateOfAppointment
```

- `mobileNumber` — must satisfy the tenant's mobile regex (Kenya:
  `^[17][0-9]{8}$`, i.e. exactly 9 digits).
- `roles` — validated against `ACCESSCONTROL-ROLES`. Use `EMPLOYEE` plus a
  workflow role: **GRO** (receives/assigns), **DGRO** (department/subcounty
  assigner), **PGR_LME** (resolver).
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
ui_state_tenant_id: ke.bomet     # SPA boots on the wizard-created city
boot_tenant: ke.bomet
hierarchy_type: BOMET-Hierarchy  # MUST match the Phase 2 hierarchy name
```

Leave `state_root` / `state_tenant_id` / `tenant_id` at the **root** (`ke`) —
those drive the JVM `STATE_LEVEL_TENANT_ID` pins. Re-run `./deploy.sh <tenant>`.

---

## B. Jupyter DataLoader (scripted)

Available on every stack (Docker Compose, Tilt, Ansible). The `DataLoader_v2`
notebook runs the same phases in Python, driven by the XLSX templates bundled
under `jupyter/dataloader/templates/`.

### 1. Open Jupyter Lab

```
http://localhost:18000/jupyter/lab?token=digit-crs-local
```

The default token is `digit-crs-local` (override via `JUPYTER_TOKEN` in
`docker-compose.yml`). In the file browser, open **DataLoader_v2.ipynb**.

### 2. Configure + create the tenant (Phase 1)

The first configuration cell logs in **and** creates the tenant — there is no
separate "run Phase 1" cell. Edit the values, then run it:

```python
URL          = "http://kong:8000"   # Kong gateway inside the Docker network — leave as-is
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

| Cell | Call | What it does |
|------|------|--------------|
| Phase 2a | `loader.load_hierarchy(name, levels, target_tenant, output_dir="upload")` | Defines the boundary hierarchy and writes an Excel template to `upload/` |
| Phase 2b | `loader.load_boundaries(<file>, target_tenant, hierarchy_type)` | Uploads the filled boundary sheet; creates entities + parent/child relationships |
| Phase 3  | `loader.load_common_masters(<file>, target_tenant)` | Departments, designations, complaint types |
| Phase 4  | `loader.load_employees(<file>, target_tenant)` | HRMS employees with roles, departments, jurisdictions |
| Phase 5  | `loader.load_localizations(<file>, target_tenant)` | *Optional* — bulk translation messages (and, optionally, a new UI language) |
| Phase 6  | `loader.load_workflow("templates/PgrWorkflowConfig.json", target_tenant)` | The PGR complaint-workflow state machine |

The bundled templates live in `jupyter/dataloader/templates/`
(`Boundary_Master.xlsx`, `Common and Complaint Master.xlsx`, the employee
master, `localization.xlsx`, `PgrWorkflowConfig.json`). Copy and edit them for
your city.

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
Requires a deploy with `enable_mcp: true`. See the step-by-step
[City Setup Guide](../../digit-mcp/docs/guides/city-setup.md) in the digit-mcp
package.

---

## After onboarding — verify

A successful onboarding should leave you able to:

1. Open the employee login page and see the new tenant in the **City** dropdown.
2. Log in as `ADMIN` / `eGov@123` against the new tenant.
3. See the tenant in the HRMS / PGR / Workbench module switchers after login.
4. See departments, designations, and complaint types populated for the tenant.
5. See boundaries populate the location dropdowns in the complaint form.

Quick API check that the tenant record landed:

```bash
curl -s -X POST "http://localhost:18000/mdms-v2/v1/_search" \
  -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker"},"MdmsCriteria":{"tenantId":"<root>","moduleDetails":[{"moduleName":"tenant","masterDetails":[{"name":"tenants"}]}]}}' \
  | grep -o '"code":"[^"]*"'
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
