# Runbook 03 — Bomet onboarding: deploy + wizard, end to end

| Field | Value |
|---|---|
| When to use | Standing up a Bomet (or any new county) stack from `git clone` and onboarding it through the configurator wizard |
| Validated on | 2026-06-10/11, local Ubuntu 20.04 box, CCRS `develop` + the fixes in PR `feat/bomet-local-onboarding` |
| Companion docs | `01-openbao.md`, `02-tenant-onboarding-status.md`, the Bomet replication kit (`docs/GAPS-AND-DECISIONS.md`) |

This runbook records the **first cold-start Bomet bring-up** — every fix in the
accompanying PR exists because this path had never been walked end-to-end on a
machine whose state didn't already contain the answers (pre-built images,
grown `.env` files, restored `ke` databases).

---

## Part 1 — Deploy the stack

### 1.1 Controller prerequisites (one-time per box)

```bash
# Docker CE (official repo) + your user in the docker group
# Ansible (pip --user is fine):
sudo apt-get install -y python3-pip && pip3 install --user ansible
export PATH="$HOME/.local/bin:$PATH"
# Node 20 — digit-ui/configurator builds run on the CONTROLLER and need it
# BEFORE the playbook's own Node install task (which runs in a later block):
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
```

### 1.2 host_vars

```bash
cp inventory/host_vars/_example.yml inventory/host_vars/bomet.yml
```

Key values for a local/sandbox Bomet (kit values, locally adapted):

```yaml
ansible_host: localhost
ansible_connection: local
deploy_become: true            # kit: false; local apt/nginx need root
domain: localhost
tls_enabled: false

# Tenancy — see Part 2.4 for why the UI keys point at ke.bomet:
state_root: ke
state_tenant_id: ke            # JVM STATE_LEVEL pins stay at the root
tenant_id: ke
boot_tenant: ke.bomet          # the SPA lands on the wizard-created city
ui_state_tenant_id: ke.bomet
hierarchy_type: BOMET-Hierarchy  # MUST match the wizard's hierarchy name
auth_provider: ""              # keep '' unless enable_keycloak: true

enable_mcp: true               # REQUIRED on a cold box — bootstraps ke.
build_mcp: true                #   (kit has false because the real Bomet DB
                               #    already contains ke; a pg-dump box doesn't)
build_otp_publisher: true      # local-only image; notifications profile
                               # validates it even on boxes that had it cached
db_fast_path: true
```

### 1.3 Deploy

```bash
cd local-setup/ansible
./deploy.sh bomet
```

What the current playbook guarantees / known issues:

1. **Post-bootstrap env rewrite actually lands** — `docker compose restart`
   never re-reads the compose file; the rewrite tasks use
   `up -d --force-recreate` (landed independently on develop via #830), so
   `STATE_LEVEL_TENANT_ID` etc. genuinely reach egov-user / enc-service /
   workflow / pgr / hrms. (Before: services stayed on `pg`, enc-service had
   no `ke` keys, every `ke` login 500'd, and the ADMIN probe killed the play
   with the evidence hidden behind `no_log`.)
2. **Keycloak password ping-pong — KNOWN, not yet fixed in the playbook**
   (only bites when `enable_keycloak: true`): `.env` is re-rendered each
   deploy, wiping `KC_DB_PASSWORD` until the OpenBao block re-appends it
   after the first `up -d` — so keycloak-postgres and the keycloak container
   disagree on the password in one direction on first enable (dies at the
   post-secrets recreate) and the other on every redeploy (dies at stack
   start). Manual recovery:
   `echo "ALTER ROLE keycloak WITH PASSWORD '<value in .env>';" | docker exec -i keycloak-postgres psql -U keycloak -d keycloak`
   then restart keycloak. A two-phase sync task (mirroring the existing
   postgres/mcp-postgres pattern) was prototyped and validated on this box —
   re-propose it when a keycloak-enabled tenant deploys.
3. **novu-worker boots** (when `enable_novu: true`) — the worker requires
   `API_ROOT_URL` in production mode; compose now passes the internal
   `http://novu-api:3000`.

Known ordering quirk that may still need one re-run on a *brand-new* root
tenant: the MCP bootstrap executes *before* the env rewrite, so
`admin_user_provisioned` can be `false` on the very first pass and HRMS may
crash-loop until ADMIN exists. Re-run `./deploy.sh bomet` (or re-POST
`/v1/tenant/bootstrap`) once — the second pass provisions ADMIN and HRMS
settles. Restructuring the play to avoid this is an open item.

### 1.4 Post-deploy verification

```bash
# ADMIN can mint a token on ke:
curl -s -X POST 'http://127.0.0.1/user/oauth/token' -H 'Host: localhost' \
  -H 'Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode grant_type=password --data-urlencode username=ADMIN \
  --data-urlencode password=eGov@123 --data-urlencode scope=read \
  --data-urlencode tenantId=ke --data-urlencode userType=EMPLOYEE
# UIs:
#   http://localhost/configurator/   (ADMIN / eGov@123 @ ke)
#   http://localhost/digit-ui/       (employee)
#   http://localhost/digit-ui/citizen  (citizen: any 7XXXXXXXX mobile, OTP 123456
#                                       when CITIZEN_LOGIN_PASSWORD_OTP_FIXED_ENABLED=true)
```

---

## Part 2 — Onboard via the configurator wizard

Order matters: **Phase 1 tenant → Phase 2 boundaries → Phase 3 masters →
Phase 4 employees** (later phases validate codes created by earlier ones).

### 2.1 Phase 1 — tenant

The wizard creates the city tenant (`ke.bomet`). Everything you upload in
later phases lives on this tenant, *not* on the root.

### 2.2 Phase 2 — boundaries

Download Template gives one sample row per hierarchy level. Rules:

- one row per place; parents before children
- `boundaryType` = the hierarchy level name, exact spelling
- `code` unique (`WARD_001`…); `parentCode` = the parent's code; root's empty
- delete the `Sample_*` rows

Bomet shape: 1 Country + 1 County + 5 Subcounties + 25 Wards = 32 rows.

> **Known bug (open):** the wizard's relationship creation leaves
> `boundary_relationship.ancestralmaterializedpath` empty, so
> `boundary-relationships/_search?includeChildren=true` returns only the root
> and every boundary dropdown stays empty. Until fixed, backfill after upload:
>
> ```sql
> WITH RECURSIVE tree AS (
>   SELECT code, parent, ''::text AS path FROM boundary_relationship
>   WHERE tenantid='ke.bomet' AND hierarchytype='BOMET-Hierarchy' AND (parent IS NULL OR parent='')
>   UNION ALL
>   SELECT br.code, br.parent,
>          CASE WHEN t.path='' THEN t.code ELSE t.path || '|' || t.code END
>   FROM boundary_relationship br JOIN tree t ON br.parent = t.code
>   WHERE br.tenantid='ke.bomet' AND br.hierarchytype='BOMET-Hierarchy'
> )
> UPDATE boundary_relationship br SET ancestralmaterializedpath = tree.path
> FROM tree WHERE br.tenantid='ke.bomet' AND br.hierarchytype='BOMET-Hierarchy'
>   AND br.code = tree.code AND tree.path <> '';
> ```
> then `docker restart boundary-service`.

### 2.3 Phase 3 — departments, designations, complaint types

**The ComplaintType sheet format changed in this PR** to the county-tracker
vocabulary — sheet authors never see API field names:

| Complaint Type* | Complaint sub type* | department | slaHours | keywords | active |
|---|---|---|---|---|---|
| Water Pipes | Pipe leakage or damage | WaterandSewage | 48 | leak, damage | true |
| Water Pipes | Low pressure | WaterandSewage | 48 | low pressure | true |

Derivation (both upload paths — configurator browser parser and MCP
`xlsx-reader`):

- `menuPath`   = PascalCase(Complaint Type*)        → `WaterPipes`
- `serviceCode`= PascalCase(Type + sub type)        → `WaterPipesLowPressure`
- group label localization `SERVICEDEFS.WATERPIPES` = "Water Pipes"
- punctuation (`& / ' ( ) . ,`) is stripped from codes
- rows sharing a Complaint Type land under ONE citizen-menu entry
  (`ServiceDefinitions.js` builds the menu from distinct menuPath values)
- legacy files with explicit `serviceCode`/`menuPath` columns still win

`department` must match the Department sheet's `code` column
(`HealthServices`, `WaterandSewage`).

### 2.4 Phase 4 — employees

Template columns:

```
employeeCode | name | userName | mobileNumber | emailId | gender | dob |
department | designation | roles | jurisdictions | dateOfAppointment
```

- `mobileNumber`: Kenya rule `^[17][0-9]{8}$` — exactly 9 digits
- `roles` (validated against ACCESSCONTROL-ROLES): `EMPLOYEE` + workflow role —
  GRO (receives/assigns), DGRO (dept/subcounty assigner), PGR_LME (resolver)
- `jurisdictions`: boundary codes from Phase 2 (`WARD_001`, `SUBCOUNTY_001`, …)
- **`department` accepts a comma-separated list** (new in this PR):
  `HealthServices,WaterandSewage` → first = current HRMS assignment, each
  extra = a 1-day historical assignment (the tenant-bootstrap ADMIN pattern);
  PGR accepts an assignee when ANY assignment matches the complaint's
  department, so one person can resolve complaints of all listed departments.
- dates: text `YYYY-MM-DD` *or* spreadsheet date cells — both parse now
  (date cells arrive as Excel serials; previously `new Date("46023")` parsed
  as the year 46023 and HRMS rejected with
  `ERR_HRMS_INVALID_DATE_OF_APPOINTMENT`).

### 2.5 Pointing the SPA at the wizard tenant

Because the wizard puts everything on `ke.bomet`, the SPA must land there:

```yaml
ui_state_tenant_id: ke.bomet
boot_tenant: ke.bomet
hierarchy_type: BOMET-Hierarchy
```

Leave `state_root` / `state_tenant_id` / `tenant_id` at `ke` — those drive the
JVM `STATE_LEVEL_TENANT_ID` pins, which must stay at the root. (Same split as
the documented mz / mz.maputo deployment.)

---

## Open items

1. **slaHours** — all 82 Bomet complaint types default to 48h; the county
   tracker only says "x days". Get real values, re-upload.
2. **Wizard Phase 2 materialized-path bug** — fix in configurator/boundary
   service; the SQL above is a workaround.
3. **Bootstrap-before-env-rewrite ordering** — first cold deploy of a new
   root needs a second pass for ADMIN provisioning.
4. Employees uploaded before these fixes may carry `hierarchy: ADMIN`
   jurisdictions or single departments — adjust via `employees/_update`.
