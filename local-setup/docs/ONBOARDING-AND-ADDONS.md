# Onboard a city and load its data

A freshly deployed stack knows how to handle complaints but knows nothing about
*your* city: no wards, no departments, no complaint types, no staff. This guide
fills that in.

You do not have to be an engineer to follow it. The recommended path is a
browser wizard where you upload one spreadsheet per step, and the spreadsheets
are the real work — the technical detail sits in collapsible **under the hood**
notes you can ignore.

Plan for **one to two hours** the first time, most of it spent filling in the
spreadsheets rather than clicking.

- [First, two words you need](#first-two-words-you-need)
- [What the configurator is](#what-the-configurator-is)
- [Which path to use](#which-path-to-use)
- [A. The configurator wizard](#a-the-configurator-wizard-browser) ← start here
- [B. Python DataLoader](#b-python-dataloader-scripted)
- [C. MCP automation](#c-mcp-automation)
- [After onboarding](#after-onboarding--enable-the-map--boundaries)

---

## First, two words you need

### Tenant

A **tenant** is one organisation's own copy of the system: its own data, its own
users, its own logo. Complaints filed in one city do not turn up in another's
inbox, and each city's staff list is its own.

Tenants come in two levels, and the difference matters constantly:

| | **Root tenant** | **City tenant** |
|---|---|---|
| Looks like | `mz` | `mz.maputo` |
| Represents | a country or state | a city, county or municipality |
| Who logs in there | administrators | everyone: staff and citizens |
| What lives there | shared settings, the master data every city inherits, the administrator account | boundaries, departments, complaint types, employees, and every complaint |
| How many | one per deployment, normally | one per city you serve |

The dot is not decoration: `mz.maputo` **is** a child of `mz`, and the system
uses that to decide what a city inherits.

**So which one do you put things in?** Almost always the city. The wizard
handles this for you — you pick the city tenant at the start and everything you
upload afterwards lands there. The one thing that happens at the root is
**logging in as the administrator**, because that is where the deploy created
the administrator account.

<details>
<summary><b>Under the hood — when a root actually needs onboarding</b></summary>

Roots are created by the deploy, not by this wizard. `./deploy.sh` runs a
tenant-bootstrap step that builds `state_root` and `tenant_id` from the shipped
demo tenant `pg`, copying the MDMS schemas, the PGR workflow state machine and
the base localisation, and creating an `ADMIN` user in each. That step only runs
when `state_root` is something other than `pg`.

So you onboard a **root** only when you are adding a second country to an
existing deployment, and then you do it with the MCP `tenant_bootstrap` tool
(§C) rather than the wizard. Everything else — a new city under a root that
already exists — is what the wizard is for.

One consequence worth knowing: the browser apps read a **single global
`HIERARCHY_TYPE`** for every tenant on the deployment. Two cities under
differently-named boundary hierarchies will leave one of them with empty
location dropdowns. Standardise on one name (`ADMIN` is the default) and create
each city's hierarchy under it.

</details>

### Master data

**Master data** is the reference information a complaint refers to: which wards
exist, which departments exist, which kinds of complaint a citizen may report,
and who works there. It has to exist before the first complaint can be filed,
and each kind depends on the one before it:

```text
Tenant  →  Boundaries  →  Departments & complaint types  →  Employees
(who)      (where)        (what)                            (who fixes it)
```

An employee's area has to be a boundary that already exists. A complaint type's
department has to be in the department list already. **This order is not
negotiable**, and it is why the wizard has four phases in this sequence.

---

## What the configurator is

The **configurator** — you will also see it called DIGIT Studio — is a web app
served at `/configurator/` alongside the citizen and employee apps. It is the
admin console: the place where a person with the right login sets the system up
and changes it afterwards, without a developer and without touching a server.

It has two modes, chosen on the login screen:

| Mode | What it is for |
|---|---|
| **Onboarding** | The four-phase wizard this guide describes. Use it once per new city. |
| **Management** | Day-to-day editing afterwards — add a department, correct a complaint type's response time, add an employee, edit the text of a screen. |

Behind the scenes it is an ordinary web app calling the same public APIs you
could call yourself; it has no special access. That also means **anything it
does can be done another way** — see [§B](#b-python-dataloader-scripted) and
[§C](#c-mcp-automation) — and that if a phase fails, nothing is corrupted at a
level you cannot reach.

**It only ships with the Ansible deployment** (Option C), and only when both of
these are set in the deployment's config:

```yaml
# local-setup/ansible/inventory/host_vars/<your-deployment>.yml
build_configurator: true     # builds the app during the deploy
nginx_features:
  configurator: true         # publishes it at /configurator/
```

Both are already on in `quickstart.yml.example`. If you flip them on later,
re-run `./deploy.sh <your-deployment>`.

---

## Which path to use

All three create exactly the same data. Pick by how your stack is deployed and
who is doing the work.

| Path | You interact with | Best for | Available on |
|------|-----------|----------|----------------------|
| **[A. Configurator wizard](#a-the-configurator-wizard-browser)** | a browser, uploading spreadsheets | anyone onboarding a real city | the Ansible deployment, with the two flags above |
| **[B. Python DataLoader](#b-python-dataloader-scripted)** | a Python script | developers, and local Compose or Tilt stacks that have no configurator | any stack |
| **[C. MCP automation](#c-mcp-automation)** | a REST call | CI, and repeatable unattended onboarding | deployments with `enable_mcp: true` + `nginx_features.mcp: true` |

---

## A. The configurator wizard (browser)

### Step 1 — Log in

Open it:

```text
http://<your-domain>/configurator/       # or https:// when tls_enabled is true
http://localhost/configurator/           # a deployment on this machine
```

| Field | What to enter |
|---|---|
| **Mode** | Onboarding |
| **Tenant code** | your **root** tenant — already filled in for you |
| **Username** | `ADMIN` |
| **Password** | `eGov@123` |

Those are the defaults. If whoever ran the deploy set `bootstrap_user` and
`bootstrap_password` in the deployment config, use those instead — and on any
deployment reachable by other people, they should have.

**Log in against the root, not the city.** The city does not exist yet in a
first-time onboarding, and the administrator account was created at the root.

<details>
<summary><b>Under the hood — where the login comes from, and why it fails</b></summary>

The tenant field is not typed by you: the value is baked into the app at build
time from the deployment's `state_tenant_id`, collapsed to its first segment
(`ke.nairobi` → `ke`). If the field is empty and shows a grey `tenant code`
placeholder, the build was not given one — the deploy prints a warning when
that happens.

The account is created by the deploy, as `bootstrap_user` with
`bootstrap_password` (defaults `ADMIN` / `eGov@123`), holding `SUPERUSER`,
`MDMS_ADMIN`, `LOC_ADMIN` and `EMPLOYEE`. The login screen accepts any one of
those four roles and rejects anything else with "User does not have required
roles".

Two ways it goes wrong:

- **"Invalid login credentials" on a tenant that should exist.** The root was
  never bootstrapped — this happens when `state_tenant_id` names a root that
  differs from `state_root`, because the bootstrap targets `state_root`. The
  deploy detects it and logs a line naming the fallback to `pg`. Fix the config
  so `state_tenant_id` and `state_root` agree, and redeploy.
- **Repeated failures can lock the account.** egov-user counts failed logins
  and sets `eg_user.accountlocked`. If a correct password suddenly stops
  working after a run of typos, that is why — slow down rather than retrying
  faster, and clear it in the database if you have locked yourself out.

</details>

### Step 2 — Get the example spreadsheets (optional, recommended)

Every phase has a **Download Template** button, which always gives you the right
columns for *your* deployment. What it does not give you is filled-in data to
copy the shape from. This repository can generate that:

```bash
cd local-setup/scripts
python3 -m venv .venv && source .venv/bin/activate   # PEP 668 — see note below
pip install openpyxl

python3 make-onboarding-examples.py --out-dir ~/example-onboarding \
    --root ke --city nairobi --city-name "Nairobi" --lat -1.2864 --lng 36.8172
```

You get five workbooks in upload order — a small but complete city with four
departments, seven boundaries, ten complaint types and six employees:

```text
01-tenant-and-branding.xlsx            Phase 1
02-boundaries.xlsx                     Phase 2
03-departments-and-designations.xlsx   Phase 3, step 3.1
04-complaint-hierarchy.xlsx            Phase 3, step 3.2
05-employees.xlsx                      Phase 4
```

They are examples to learn from and edit, not a template to upload unchanged:
the phone numbers, boundary names and complaint types all have to become yours.
Run the script with `--help` to see the options.

> The virtualenv is not optional on Ubuntu 24.04, Debian 12+, Fedora 38+ or
> Homebrew Python — a plain `pip install` there fails with PEP 668
> `error: externally-managed-environment`.

### Phase 1 — Tenant and branding

This creates your city and gives it a name and a logo. Everything you upload in
later phases lands on the city created here.

**Step 1.1 — upload the tenant sheet.** Sheet name: `Tenant Info`.

| Column | Required | What it means | Example |
|---|---|---|---|
| `Tenant Display Name*` | yes | The name people see in the app — the city council, not the city | `Nairobi City Council` |
| `Tenant Code*` | yes | The city tenant's id: `<root>.<city>`, lowercase, letters/digits/dots only. **Permanent** — it cannot be renamed later | `ke.nairobi` |
| `Tenant Type*` | yes | Free text describing the kind of body. Defaults to `ULB` if blank | `City` |
| `Logo File Path*` | no | Leave blank and upload the image in step 1.2 instead — that fills this in for you | *(blank)* |
| `Latitude` | no | City centre. `0` is a real value and is kept as one | `-1.2864` |
| `Longitude` | no | | `36.8172` |
| `City Name` | recommended | Display name of the city itself | `Nairobi` |
| `District Name` | recommended | The district or region it sits in | `Nairobi Central` |

A second sheet, `Tenant Branding Details`, has `Banner URL`, `Logo URL`,
`Logo URL (White)` and `State Logo`. **Leave it empty** unless you already host
those images somewhere public — step 1.2 is the better path.

**Step 1.2 — upload the branding images.** Drag in a logo, a white version for
dark backgrounds, and a banner. They go into the deployment's own file storage
and the ids are recorded against the tenant.

<details>
<summary><b>Under the hood — column matching, and the coordinates</b></summary>

Headers on **this sheet** are matched leniently: case-insensitive, ignoring
`*`, collapsing whitespace, and accepting a substring. `Tenant Code*`,
`Tenant Code`, `tenantCode` and `tenant_code` are all the same column. Only the
**first data row** is read — one tenant per file.

Do not generalise that to the later phases. The boundary, department,
designation and employee sheets each match a fixed list of spellings per field,
and the complaint-hierarchy level columns are matched **exactly** against the
level codes you defined (a `_` may be written as a space, and that is the only
latitude). Rename one of those headers and the column reads as empty.

`Tenant Code*` is validated against `^[A-Za-z][A-Za-z0-9.]*$`: it must start
with a letter, and dots are the only punctuation.

Latitude and longitude are parsed with an explicit not-a-number check rather
than the usual JavaScript truthiness test, specifically so that `0` — the
Equator and the Greenwich meridian — survives instead of being read as "not
provided".

Missing `City Name` or `District Name` produce warnings, not errors; the upload
proceeds.

</details>

### Phase 2 — Boundaries

Boundaries are the places a complaint can be reported against: the wards,
sub-counties and districts your city is divided into. They form a tree, and the
tree has a name — the **hierarchy**.

You choose one of two sources:

| | **Fetch from OpenStreetMap** | **Upload from Excel** |
|---|---|---|
| Effort | search for your city, click | fill in a spreadsheet |
| You get | real map polygons, so map pins resolve to the right ward | names and codes; polygons only if you also supply a GeoJSON file |
| Control | whatever OSM has | exactly your official list |
| Good for | a quick start, or a city OSM covers well | official boundaries that must match a government list |

Both then ask for the **hierarchy**: either create a new one — give it a name
(`ADMIN` unless you have a reason) and list your levels top to bottom — or
select one that already exists on this tenant.

**The Excel path.** Sheet name: `Boundary`.

| Column | Required | What it means | Example |
|---|---|---|---|
| `code` | yes | Unique id for this place. Uppercase with underscores by convention. **Permanent** | `WARD_001` |
| `name` | yes | What people call it | `Central Ward` |
| `boundaryType` | yes | Which level of the hierarchy this row is, spelled **exactly** as you defined it | `Ward` |
| `parentCode` | yes, except the top row | The `code` of the place this sits inside. Blank for the single top row | `SUBCOUNTY_001` |
| `latitude` | no | Centre point of this place | `-1.2864` |
| `longitude` | no | | `36.8172` |

Three rules that account for most failed uploads:

1. **Parents before children.** A row whose `parentCode` has not appeared yet in
   the `code` column above it cannot be linked up.
2. **Exactly one row has a blank `parentCode`** — the top of the tree.
3. **Delete the `Sample_*` rows** the downloaded template ships with.

A worked shape: 1 county + 2 sub-counties + 4 wards = 7 rows, which is the
example the generator script produces. Real cities are usually 30–200 rows.

<details>
<summary><b>Under the hood — geometry, the map, and a known bug</b></summary>

The hierarchy levels are inferred from the order `boundaryType` values first
appear in the sheet, so row order defines the tree's shape as well as its
parentage.

If your boundaries carry real geometry — the OSM path always, the Excel path
only when you attach a GeoJSON sidecar keyed on `properties.code` — Phase 2 also
writes a `RAINMAKER-PGR.MapConfig` record so the citizen map knows where to
open and which boundaries to resolve pins against. With no geometry it skips
that and leaves the map on its defaults; boundaries still work as dropdowns.

**Known issue — empty boundary dropdowns after upload.** On some versions the
wizard leaves `boundary_relationship.ancestralmaterializedpath` empty, so
dropdowns render only the root. The SQL backfill plus
`docker restart boundary-service` is in
[`../ansible/runbooks/03-bomet-onboarding.md`](../ansible/runbooks/03-bomet-onboarding.md)
(§2.2).

</details>

### Phase 3 — Departments, designations and complaint types

Two uploads, in this order. The second depends on the first.

#### Step 3.1 — departments and designations

One workbook, two sheets.

**Sheet `Department`** — the teams that fix things.

| Column | Required | What it means | Example |
|---|---|---|---|
| `code` | yes | Short unique id. **Permanent**, and referenced by both later sheets | `WATER` |
| `name` | yes | Full name shown in the app | `Water and Sanitation` |
| `active` | no | `true` / `yes` / `1` for active; anything else is inactive. Defaults to active | `true` |

**Sheet `Designation`** — job titles, used when you create staff.

| Column | Required | What it means | Example |
|---|---|---|---|
| `code` | yes | Short unique id | `SUPERVISOR` |
| `name` | yes | Job title | `Supervisor` |
| `description` | no | Free text; falls back to `name` | `Assigns work and reviews resolutions` |
| `department` | no | Which departments this title exists in — **comma-separated** for several | `WATER,ROADS` |
| `active` | no | as above | `true` |

#### Step 3.2 — complaint types

This is where you say what a citizen may report. Complaint types are a tree, and
**you define its levels here in the wizard first** — two or more, from broadest
to most specific — before downloading the template. Three is typical:

```text
Category  →  Sub Category  →  Complaint Type
Water        Supply           No water supply
```

The downloaded template then has **one column per level you defined**, plus
three fixed columns. Sheet name: `ComplaintHierarchy`. One row per complaint
type, carrying its full path:

| Category | Sub Category | Complaint Type | Department Name* | Resolution Time (Hours)* | Search Words* |
|---|---|---|---|---|---|
| Water | Supply | No water supply | `WATER` | 24 | no water, dry tap |
| Water | Supply | Low water pressure | `WATER` | 48 | low pressure |
| Water | Leaks | Burst pipe | `WATER` | 8 | burst, leak, pipe |
| Roads | Surface | Pothole | `ROADS` | 72 | pothole, road damage |

| Column | Required | What it means |
|---|---|---|
| the level columns | yes, **all of them on every row** | The full path to this complaint type. Rows sharing the earlier columns fold into one branch of the citizen's menu — the four rows above give the citizen *Water* → {*Supply*, *Leaks*} and *Roads* → *Surface* |
| `Department Name*` | yes in practice | The `code` from the Department sheet that owns this. Comma-separate for several: the first is primary, and staff in **any** of them can be assigned the complaint |
| `Resolution Time (Hours)*` | yes | How long the city commits to taking. Drives the overdue indicators. Defaults to 24 if blank or unreadable |
| `Search Words*` | recommended | Comma-separated words a citizen might type instead of the official name |

> **Leaving `Department Name*` blank is accepted** and the type is created
> unowned. It then never appears in any per-department breakdown on the
> supervisor dashboard. Fill it in unless the type is deliberately unassigned.

<details>
<summary><b>Under the hood — codes, and why complaint types moved out of 3.1</b></summary>

Codes are generated, not typed. Each cell's text is PascalCased with
punctuation (`& / ' ( ) . ,`) stripped, and each interior node's code is
prefixed by its parent's, so the same label under two different parents stays
two distinct nodes instead of colliding. The leaf's code — parent plus leaf,
PascalCased — becomes the **`serviceCode` stored on every complaint of this
type**: `Supply No water supply` → `SupplyNoWaterSupply`. Two rows that generate
the same `serviceCode` are a duplicate; the second is skipped with a warning.

Older documentation describes a flat `ComplaintType` sheet inside the
common-masters workbook, with `menuPath` and explicit `serviceCode` columns.
That was replaced by the configurable-levels flow described here: the
common-masters template no longer contains that sheet at all. The parser for the
old shape still exists for legacy files, which is why a very old workbook may
still import.

Everything lands in one adjacency list under `RAINMAKER-PGR.ComplaintHierarchy`,
with the level definitions in `RAINMAKER-PGR.ComplaintHierarchyDefinition`.

</details>

### Phase 4 — Employees

Staff who receive, assign and resolve complaints. Sheet name: `Employee`.

| Column | Required | What it means | Example |
|---|---|---|---|
| `employeeCode` | yes | Staff id. **This is what they log in with** — see the note below | `EMP001` |
| `name` | yes | Full name | `Amina Otieno` |
| `userName` | no | Derived as `firstname.lastname` when blank | `amina.otieno` |
| `mobileNumber` | yes | Must satisfy your deployment's phone rule (`core_mobile_configs.mobileNumberRegex`) | `712345001` |
| `emailId` | no | | `amina@example.com` |
| `gender` | no | `MALE` / `FEMALE` / … | `FEMALE` |
| `dob` | **yes** | Date of birth, `YYYY-MM-DD`. Must make them at least 18 | `1988-04-12` |
| `department` | yes | `code` from the Department sheet. **Comma-separated** for several — the first is current, the rest historical, and they can be assigned complaints in any of them | `WATER,ROADS` |
| `designation` | yes | `code` from the Designation sheet | `SUPERVISOR` |
| `roles` | in practice, yes | What they are allowed to do — see below. Defaults to just `EMPLOYEE`, which cannot do anything useful on its own | `EMPLOYEE,GRO` |
| `jurisdictions` | recommended | Boundary `code`s from Phase 2. Empty means access to nothing | `WARD_001` |
| `dateOfAppointment` | no | `YYYY-MM-DD` | `2024-01-15` |

**Roles.** Everyone needs `EMPLOYEE`. Add at least one job role:

| Role | What it lets them do |
|---|---|
| `GRO` | Receive incoming complaints and assign them |
| `DGRO` | Assign within a department or area |
| `PGR_LME` | Do the work and mark a complaint resolved |
| `CSR` | **File** a complaint on a citizen's behalf, from the staff app |
| `PGR_VIEWER` | Read-only |
| `PGR_SUPERVISOR` | See the supervisor dashboard |

`CSR` is the one people forget. Without it the "create complaint" screen is
hidden, so a `GRO`-only employee can process complaints but cannot raise one.
Give at least one person `EMPLOYEE,CSR` if you want to test the whole flow.

> **How they log in:** username = the **employee code** (`EMP001`), password =
> `eGov@123` by default. HRMS overwrites whatever `userName` you supplied with
> the employee code when it creates the record, and that is the value that
> actually authenticates. Tell staff to change it on first login. The default
> comes from `bootstrap_secrets.egov_hrms_default_password` in the deployment
> config, and can only be set before the first deploy.

<details>
<summary><b>Under the hood — dates and phone numbers</b></summary>

Dates accept three shapes, because spreadsheet apps disagree about what a date
is: text `YYYY-MM-DD`, a real date cell, or Excel's internal serial number.
Serials are converted rather than stringified — feeding `46023` straight to a
date parser reads it as the year 46023 and HRMS rejects it with
`ERR_HRMS_INVALID_DATE_OF_APPOINTMENT`.

`dob` is stricter than the others: it must parse, and the year must be between
1920 and eighteen years ago.

Phone numbers are checked twice. The spreadsheet parser accepts 9 or 10 digits
— loose enough for 9-digit national formats — and then the tenant's own rule
from MDMS is applied before submission, which is the one that actually decides.
A number that passes the first and fails the second is reported per row.

Employees cannot be deleted through the API afterwards; HRMS deactivates
records rather than removing them.

</details>

### After the wizard — point the apps at the new tenant

Data now exists but the apps may still be looking at the tenant they were
deployed with. In the deployment's config:

```yaml
# local-setup/ansible/inventory/host_vars/<your-deployment>.yml
ui_state_tenant_id: <root>.<city>          # the apps land on the new city
boot_tenant: <root>.<city>
hierarchy_type: <the Phase 2 hierarchy name>
login_tenant_allowlist: [<root>, <root>.<city>]   # every tenant that must
                                                  # appear in the City dropdown
```

Leave `state_root`, `state_tenant_id` and `tenant_id` alone — those are the boot
pins the backend services read at startup. Then re-run `./deploy.sh <name>`.

> **`hierarchy_type` is one value for the whole deployment, not per tenant.**
> The apps send it on every boundary lookup regardless of which tenant is
> active, so every city on one deployment must use the same hierarchy name.
> Onboarding a second city under a different name silently blanks the location
> dropdowns for one of them.

Then jump to [After onboarding — verify](#after-onboarding--verify).

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
# Where the deployment answers, from wherever you are running this script:
#   Ansible deploy  http://<your-domain>       (or https:// when tls_enabled)
#   Compose / Tilt  http://localhost:18000     (Kong)
# On a separate machine, localhost is YOUR machine — use the deployment's
# hostname, or the loader will quietly find nothing to talk to.
URL          = "http://<your-domain>"
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

  The employee dashboard asks `/pgr-services/v2/analytics/_access`; there is no
  browser or DashboardConfig role fallback. `dashboard_allowed_roles` controls
  which fresh-install roles receive navigation action 4557 and capabilities
  2640–2644 together.

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
  [`../../docs/dashboard-configuration.md`](../../docs/dashboard-configuration.md)
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
| **Configurator (DIGIT Studio)** | `nginx_features.configurator` + `build_configurator` | Browser onboarding wizard at `/configurator/` | See [§A](#a-the-configurator-wizard-browser) |
| **MCP server + REST shim** | `enable_mcp` (+ `nginx_features.mcp` for `/mcp` + `/v1/*`) | Automation/REST onboarding API, headless `city_setup_from_xlsx` | `build_mcp: true` builds from in-tree source; default is a pinned public image |
| **Search stack (employee inbox)** | `enable_search_stack` | Elasticsearch + egov-indexer + inbox-v2 | Heavy (~3 GB RAM extra); without it the employee inbox 503s |
| **Novu notification stack** | `enable_novu` (+ `build_novu_dashboard`) | Notification infra only (no config) | `enable-notifications.sh` above is the full turn-key path |
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
[`quickstart.yml.example`](../ansible/inventory/host_vars/quickstart.yml.example)
next to it is the short version: a complete single-machine config with only
the settings a first deployment needs.

## After onboarding — verify

A successful onboarding should leave you able to:

1. Open the employee login page and see the new tenant in the **City** dropdown
   (the dropdown is gated by `login_tenant_allowlist` in `host_vars` — if the
   new tenant is missing there, add it and re-run the deploy before concluding
   onboarding failed).
2. Log in as the administrator against the new tenant — `ADMIN` / `eGov@123`
   unless the deploy set `bootstrap_user` / `bootstrap_password` to something
   else. *(Guaranteed on the wizard and DataLoader paths, which create that
   user. The headless XLSX path does not create a city administrator by
   itself — log in with an onboarded employee's `employeeCode` instead, or as
   the administrator against the root.)*
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
