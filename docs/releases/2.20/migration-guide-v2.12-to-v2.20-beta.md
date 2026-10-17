# Migration Guide: v2.12 → v2.20-beta (identity and Keycloak)

> **Status: DRAFT, not yet rehearsed.** It was written from the 2.20 code and from
> the one live migration done so far (a develop test server, 2026-10-06). Nobody
> has run it end to end on a v2.12.1 county install yet. Steps marked
> **(unverified)** are inferred from the code, not proven on a server. The first
> rehearsal on a copy of a county install will correct this guide, and then the
> supervised production upgrade will. Record what you find in the
> [journey log](#9-journey-log) and fix the steps it disproves.

**For:** an existing v2.12.x install deployed with Ansible (`local-setup/ansible`,
stack under `/opt/digit`), whose staff and citizens sign in today through the
legacy DIGIT login pages (and, on some installs, citizen Google sign-in through
Keycloak 24 and `token-exchange-svc`).

**Scope:** the **identity** move, which is the part of 2.20 that changes who can
sign in and how. Other 2.20 changes have their own guides; this one links to
them in [step 5](#5-deploy-order) instead of repeating them.

**Downtime:** the redeploy itself is about 20–40 minutes. **Staff sign-in stays
unavailable after that until each employee is linked to a Keycloak identity and
has set a password** ([step 4](#4-existing-users)). Plan that window with the
county before you start.

**See also:** [identity BFF deployment](../../setup/deployment/identity-bff.md) ·
[notifications migration](notifications/migration.md) ·
[v2.12 → v2.12.1](../2.12/migration-guide-v2.12-to-v2.12.1.md) (do that first if
you are still on 2.12.0) · the release PR, egovernments/Citizen-Complaint-Resolution-System#2557.

---

## 0. What changes, and for whom

| Who | v2.12 | v2.20-beta |
|---|---|---|
| **Staff (employees)** | Legacy `/digit-ui/employee/user/login`: pick a city, username + password, checked by egov-user | Keycloak login page (`digit-ui-employee` client, `digit-employee` theme). The person signs in with their **email and a password held in Keycloak**. The Identity BFF then issues their own DIGIT token. Only employees **linked** to a Keycloak identity can sign in. |
| **Staff password reset** | SMS OTP through `/user/password/nologin/_update` | Email only: "Forgot password?" or Account → set password, through the realm's SMTP. **A mobile-only employee cannot reset their own password** until they have an email address. |
| **Citizens** | Legacy OTP page (`/user-otp/v1/_send`, often the fixed code on test installs). Some installs also had "Continue with Google" on the separate `/citizen` app. | Phone number + one-time code, verified by the Identity BFF. **There is no citizen Google sign-in in 2.20.** The `/citizen` app (digit-ui-v2) is retired. |
| **Admins / founders** | Configurator with a DIGIT login | Configurator signs in through Keycloak (password, magic link, Google or GitHub, as configured) and then picks a workspace. |
| **URLs** | `/digit-ui/employee/…`, `/digit-ui/citizen/…` | **Tenant routes only:** `/<slug>/digit-ui/employee/…`, `/<slug>/digit-ui/citizen/…`. For a deploy-seeded root the slug is the tenant id (e.g. `/ke/digit-ui/…`). A tenantless `/digit-ui/<page>` returns **404**, or redirects to `digit_ui_default_tenant_slug` if you set it. |
| **Keycloak** | 24.0, a realm named after the state tenant (e.g. `ke`) with a `digit-ui` client, plus `token-exchange-svc` and the `/kc` route | **26.7.3** (`identity-keycloak` image), one shared Organizations realm (`digit` by default). Each root tenant maps to a Keycloak Organization. `token-exchange-svc` and `/kc` are gone. |
| **Kong** | Native user endpoints open | With Keycloak on, `/user/citizen/_create`, `/user/password/nologin/_update` and `/user-otp/v1/_send` return `404 IDENTITY_LEGACY_ENDPOINT_REMOVED`. `/user/oauth/token` stays open for service accounts. `identity_legacy_user_endpoints: true` reopens them (an API rollback switch only: the old UI pages are gone either way). |

**Not supported in 2.20: staff whose home tenant is a city tenant** (`<root>.<city>`).
The Identity BFF links staff only at a root tenant (decision D16; staff at a city
tenant were never re-homed in the general product). Count these before you start
([step 1.1](#11-inventory)); they cannot sign in after the upgrade unless they are
re-created at the root.

---

## 1. Before you start

### 1.1 Inventory

Run these on the server as root and keep the output with your upgrade notes. None
of them change anything. Never paste the output anywhere public: it describes your
users.

```bash
cd /opt/ccrs && git log --oneline -1                      # the version you are leaving
docker ps --format '{{.Names}} {{.Image}}' | sort         # every running image
HV=/opt/ccrs/local-setup/ansible/inventory/host_vars/<tenant>.yml
grep -oE '^[A-Za-z_][A-Za-z0-9_]*:' "$HV" | tr -d ':'     # host_vars KEY NAMES (no values)
```

**Keycloak today** (database user and name are usually `keycloak`):

```bash
KQ() { docker exec keycloak-postgres psql -U keycloak -d keycloak -tAF'|' -c "$1"; }
KQ "select version from migration_model order by update_time desc limit 1"   # 24.0.x expected
KQ "select name from realm order by 1"
KQ "select r.name, count(u.id) from realm r left join user_entity u on u.realm_id=r.id group by 1"
KQ "select r.name, i.provider_alias, i.enabled from identity_provider i join realm r on r.id=i.realm_id"
KQ "select r.name, f.identity_provider, count(*) from federated_identity f join realm r on r.id=f.realm_id group by 1,2"
```

The last two tell you how many citizens use Google sign-in today. They will have to
use phone sign-in after the upgrade ([step 4.3](#43-citizens-who-used-google)).

**DIGIT users** (`docker-postgres`, db/user `egov`):

```bash
PQ() { docker exec docker-postgres psql -U egov -d egov -tAF'|' -c "$1"; }
# Accounts per tenant and type
PQ "select tenantid, type, active, count(*) from eg_user group by 1,2,3 order by 1,2,3"
# Active employees with and without an email address, per tenant
PQ "select tenantid, count(*) filter (where emailid is not null and emailid<>'') with_email, count(*) total
    from eg_user where type='EMPLOYEE' and active group by 1 order by 1"
# Active citizens sharing one (encrypted) mobile number: these can hit CITIZEN_ACCOUNT_AMBIGUOUS
PQ "select count(*) from (select mobilenumber from eg_user where type='CITIZEN' and active
    group by mobilenumber having count(*)>1) d"
# Which encryption key each tenant's user rows were written under (see step 4.4)
PQ "select tenantid, type, split_part(username,'|',1) key_id, count(*) from eg_user group by 1,2,3 order by 1,2,3"
PQ "select tenant_id, key_id, active from eg_enc_symmetric_keys where tenant_id not like '%.%' order by 1"
# Roles the identity stack needs at the root tenant
PQ "select uniqueidentifier from eg_mdms_data where schemacode='ACCESSCONTROL-ROLES.roles'
    and tenantid='<root>' and uniqueidentifier in ('ACCOUNT_ADMIN','TENANT_ADMIN','HRMS_ADMIN','LOC_ADMIN','MDMS_ADMIN')"
PQ "select role_code, count(distinct user_id) from eg_userrole_v1 where role_tenantid='<root>'
    and role_code in ('ACCOUNT_ADMIN','HRMS_ADMIN','SUPERUSER') group by 1"
```

Write down:

- **N employees without email** at the root. Each needs an address before they can be linked.
- **City-tenant employees** (`<root>.<city>` rows of type `EMPLOYEE`). They are not supported (see §0).
- **Google-linked citizens** (from Keycloak, above).
- **Duplicate citizen phones** and **users under another tenant's key id** (step 4.4).
- Whether `ACCOUNT_ADMIN` and `TENANT_ADMIN` exist in `ACCESSCONTROL-ROLES.roles` at the root. If not, add them before the deploy (step 2.3).

**Secrets present in OpenBao** (names only, never print values):

```bash
T=$(python3 -c "import json;print(json.load(open('/opt/digit/.openbao/init.json'))['root_token'])")
docker exec -e BAO_TOKEN="$T" -e BAO_ADDR=http://127.0.0.1:8200 openbao \
  bao kv get -format=json kv/digit/<tenant> | python3 -c "import json,sys;print(sorted(json.load(sys.stdin)['data']['data']))"
```

**nginx:** check whether host_vars has `nginx_preserve_vhost: true`. If it does, the
deploy will **not** write the 2.20 routes into your vhost ([step 2.4](#24-nginx-on-a-hand-maintained-vhost)).

### 1.2 Freeze automatic deploys

If a cron or wrapper redeploys this server on a schedule, hold it on the current
version for the whole upgrade. Otherwise it can redeploy halfway through and leave
a mixed state. Keep a note of how to release it afterwards.

```bash
cat /etc/cron.d/*redeploy* 2>/dev/null          # find the schedule
# Either comment the line out, or pin the wrapper to the current commit. Log it.
```

### 1.3 Back up

Take all four before you change anything, and copy them off the server.

```bash
TS=$(date -u +%Y%m%dT%H%MZ); BK=/opt/digit/predeploy-backups/$TS-v220; mkdir -p $BK
# 1. Main Postgres (complaints, users, MDMS, localisation, onboarding tables)
docker exec docker-postgres pg_dumpall -U egov | gzip > $BK/egov-pg_dumpall.sql.gz
# 2. Keycloak's own database. The Keycloak 26 upgrade is ONE-WAY (see below).
docker exec keycloak-postgres pg_dump -U keycloak -Fc keycloak > $BK/keycloak-24.dump
# 3. OpenBao: the unseal file and the data volume
cp -a /opt/digit/.openbao $BK/openbao-dir
docker run --rm -v digit_openbao_data:/d -v $BK:/b alpine tar czf /b/openbao-data.tgz -C /d .
# 4. Configuration: host_vars, compose overlay, nginx vhost, .env
cp -a /opt/ccrs/local-setup/ansible/inventory/host_vars/<tenant>.yml $BK/
cp -a /opt/ccrs/local-setup/docker-compose.<tenant>.yml $BK/ 2>/dev/null
cp -a /etc/nginx/sites-available $BK/nginx-sites-available
cp -a /opt/digit/.env $BK/digit.env
ls -lh $BK        # none of the files may be empty
```

The volume name `digit_openbao_data` and the tar-while-running copy are
**(unverified)**: check `docker volume ls`, and stop `openbao` for the copy if your
storage backend needs it.

**Why Keycloak is one-way.** Keycloak 26 migrates the database schema in place the
first time it starts. Keycloak 24 cannot start on a 26 schema. One county install
that was moved to 26 and then redeployed with the old 24 image broke citizen Google
sign-in (`Unable to find factory for AuthenticatorFactory: organization`) until
the 24 dump was restored. **The only way back is restoring the 24 dump (backup 2)
together with the 24 image.** Never point an old image at the upgraded database.

---

## 2. Configuration changes

Edit `inventory/host_vars/<tenant>.yml`. The deploy, and `scripts/preflight.py`
before it, refuse the old settings, so a missed one stops the deploy early rather
than half-applying it.

### 2.1 Remove

| Key | Why | If you leave it |
|---|---|---|
| `auth_provider: keycloak`, `citizen_auth_provider`, `employee_auth_provider` | The browser Keycloak adapter they selected was removed (#2088, D26) | The deploy fails: "selects Keycloak login on: …". Delete them, or set `digit`. |
| `keycloak_client_id` | The per-tenant realm's `digit-ui` client is no longer used | Ignored (retired). Delete it. |
| `enable_digit_ui_v2: true` and `nginx_features.digit_ui_v2: true` | The `/citizen` app is retired | The deploy fails: "enable_digit_ui_v2 is no longer supported". |
| `digit_ui_v2_branch`; `digit_ui_esbuild_branch` set to an old feature branch | The citizen v2 app is gone; digit-ui builds from the vendored source | `digit_ui_esbuild_branch` is still read (group default `main`) by the static/hmr checkout and the build script. Delete it so the default applies. Whether container mode is affected is **(unverified)**. |
| `login_tenant_allowlist`, `build_otp_publisher`, `build_default_data_handler` | Not read by 2.20 | Ignored. Delete them to avoid confusion. |
| `pgr_services_image`, `configurator_image` and any other image pin | 2.20 images must come from one build ([step 5](#5-deploy-order)) | The deploy keeps your old pin and runs a 2.12-era app on a 2.20 schema. |
| `token_exchange_system_password` (in OpenBao) | `token-exchange-svc` is gone | Still used as a **fallback** for `identity_digit_admin_password` if that is absent. Set the real one (2.2) before you delete it. |

### 2.2 Add

```yaml
enable_keycloak: true              # required; the deploy refuses false
nginx_features:
  keycloak: true
  digit_ui_v2: false
keycloak_organization_realm: digit # the new shared realm; leave the default
digit_ui_default_tenant_slug: <root>   # so old /digit-ui/... bookmarks redirect instead of 404
identity_digit_admin_username: <ACCOUNT_ADMIN employee code>  # dedicated account, see below
identity_digit_admin_tenant_id: <root> # defaults to state_tenant_id when unset
identity_smtp_host: <smtp host>    # REQUIRED: password setup, invitations and resets are email
identity_smtp_from: <no-reply address>
identity_smtp_user: <smtp user>
identity_signin_methods: [password]          # add google only if 2.3 is done
identity_signup_methods: [magic_link]
identity_citizen_signin_methods: [phone_otp] # needs an OTP channel, see 2.5
```

Secrets go **into OpenBao**, not `bootstrap_secrets`. On an existing install
`bootstrap_secrets` is only read on the tenant's first deploy (`cas=0`), so editing
it now changes nothing:

```bash
docker exec -e BAO_TOKEN="$T" -e BAO_ADDR=http://127.0.0.1:8200 openbao \
  bao kv patch kv/digit/<tenant> identity_digit_admin_password='<value>' identity_smtp_password='<value>'
```

- `keycloak_admin_password` and `keycloak_db_password` must already be there, since
  Keycloak 24 used them. The deploy fails closed if the admin password is empty.
- The deploy **generates** the rest on its first 2.20 run and writes them back to
  OpenBao: the BFF, magic-link, admin, employee and citizen client secrets, the
  control-plane, introspection and onboarding tokens, the citizen OTP secret and the
  PGR provisioner password.
- **`identity_digit_admin_*`** is the DIGIT employee the BFF uses for its admin
  calls. Use a dedicated employee holding only `ACCOUNT_ADMIN` at the root, not
  `ADMIN`. Never link it to a person later ([step 4.1](#41-staff)).
- The **PGR provisioner** (`pgr_digit_provisioner_username`, default
  `PGR_PROVISIONER` on the root) is created by the deploy if absent. The deploy
  fails if an existing account of that name cannot sign in with `MDMS_ADMIN`,
  `ACCOUNT_ADMIN`, `LOC_ADMIN` and `HRMS_ADMIN`.

### 2.3 Data the identity stack needs at the root tenant

- **Roles:** `ACCOUNT_ADMIN` and `TENANT_ADMIN` must exist in
  `ACCESSCONTROL-ROLES.roles` at the root. Without them egov-user rejects every
  account that carries them, and the only trace is in the egov-user log
  (`Role(... code=ACCOUNT_ADMIN ...) is invalid`). Add them through the MDMS v2
  `_create` API before the deploy, copying the record shape of the same codes at
  `pg` (`ACCESSCONTROL-ROLES.roles`). Whether the 2.20 deploy adds them to an
  existing root itself is **(unverified)**.
- **Mobile number rule:** citizen phone sign-in validates the number against the
  root's `MobileNumberValidation` rule. The deploy also refuses an old
  `core_mobile_configs` schema. Make sure exactly one current rule is the default.
- **Google for staff/founders (optional):** if `keycloak_google_client_id` is set,
  the new realm gets its own Google provider. Add
  `https://<domain>/auth/realms/digit/broker/google/endpoint` to the Google OAuth
  client's **authorized redirect URIs** before the deploy. The old
  `/realms/<state-tenant>/…` entry can stay until rollback is no longer possible.

### 2.4 nginx on a hand-maintained vhost

With `nginx_preserve_vhost: true` the deploy does not touch the site file, so none
of the 2.20 routes reach it:

- the tenant-route rewrite `^/<slug>/digit-ui/(.*)$ → /digit-ui/$1`;
- the tenantless `/digit-ui/<page>` guard (302 to the default slug, or 404);
- `/auth/realms/` and `/auth/resources/` ahead of a Novu dashboard's `/auth/` paths;
- `/identity/v1/`, which reaches Kong through a catch-all `location /` if you have one.

Pick one before the deploy:

1. **Switch to the template (preferred).** Render it to a scratch file, diff it
   against the live vhost, and move every custom route you still need into
   host_vars or a documented addition. Then set `nginx_preserve_vhost: false`. You
   can render it with
   `ansible <tenant> -m template -a "src=templates/nginx-site.conf.j2 dest=/tmp/site.conf"`
   from `local-setup/ansible` **(unverified invocation)**.
2. **Hand-edit the vhost.** Add the four items above from
   `templates/nginx-site.conf.j2`, and **remove the dead identity routes**:
   `/citizen` (the v2 app still calls `token-exchange-svc` and bypasses the BFF),
   `/token-exchange/`, and any `/auth/sign-in`, `/auth/sign-up` or
   `/auth/organization-list` leftovers from an earlier experiment.

### 2.5 Choose how citizens get their one-time code

`identity_citizen_signin_methods: [phone_otp]` needs exactly one way to deliver a
code. Without one, citizen sign-in is unavailable: the deploy warns but does not
fail.

| Setting | What it does | When |
|---|---|---|
| `identity_dev_fixed_otp: true` | Accepts the fixed development code (`123456`) for any number; the BFF writes codes to its log | Demo or test servers only: anyone can sign in as any citizen. It matches what many 2.12 test installs do today. |
| `identity_citizen_otp_sender: http` | The BFF POSTs `{phone, code, purpose, tenantId, locale, expiresIn}` to `IDENTITY_OTP_SENDER_URL` | When you have an SMS gateway endpoint. host_vars does not render the URL yet, so it needs a compose overlay **(unverified)**. |
| `enable_otp_services: true` | Starts DIGIT's older OTP services; their SMS goes through novu-bridge | Needs `enable_novu: true` and an SMS provider. The preflight counts it as a channel, but the BFF's own sender stays unset, and 2.20 notes that BFF codes do not go through notifications yet. Whether citizens actually receive a code this way is **(TO CONFIRM)**. |

This is a product decision for the county, not a technical default.

---

## 3. Keycloak 24 → 26.7.3

The deploy does this; there is no separate command. What happens:

1. The `keycloak` service switches from `quay.io/keycloak/keycloak:24.0` to the
   `identity-keycloak` image (26.7.3, with the login themes built in). It reuses the
   **same** `keycloak-postgres` container and `keycloak_postgres_data` volume, so
   the first start migrates the schema **in place**. This is the one-way step
   ([1.3](#13-back-up)).
2. `configure-identity-keycloak.sh` runs once Keycloak is healthy. It creates the
   `digit` realm with Organizations on, its clients (`digit-identity-bff`, admin,
   magic link, `digit-ui-employee`, `digit-ui-citizen`), themes, flows and SMTP. It
   also sets the user profile's `unmanagedAttributePolicy` to `ADMIN_EDIT`.
   Without that policy, Keycloak 24+ silently drops the BFF's `digit.*` user
   attributes, and repeat signups appear to send no mail. The script is
   idempotent; re-running the deploy re-applies it.
3. The **old per-tenant realm is left as it is**, including its users, Google links
   and `digit-ui` client. Nothing in 2.20 reads it. Keep it until the upgrade is
   signed off and rollback is no longer needed, then decide whether to delete it.
   Stray realms from old imports (for example one literally named
   `__REALM_NAME__`) can go at the same time.
4. `token-exchange-svc` is no longer in the compose files, so `up -d` leaves its
   container running as an **orphan** **(unverified)**. Stop and remove it once
   step 6 passes, together with its nginx route (2.4).

Check:

```bash
curl -fsS https://<domain>/auth/realms/digit/.well-known/openid-configuration >/dev/null && echo realm-ok
curl -fsS 'https://<domain>/identity/v1/auth-methods?intent=signin'
docker exec identity-bff wget -qO- http://127.0.0.1:3000/readyz
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/auth/admin/    # must be 404
```

---

## 4. Existing users

### 4.1 Staff

Nothing moves automatically. After the deploy, **an employee can sign in only once
they are linked**: a Keycloak user with their email, a membership in the root's
Organization, and a binding to their existing DIGIT account (same uuid, roles,
complaint history).

- **Who links:** a person with live `ACCOUNT_ADMIN` at the root, from the
  configurator (Members / Employees), or with `POST /identity/v1/workspace-members/_link {tenantId, digitUuid, email}`.
  See the [BFF contract](../../../backend/identity-bff/docs/identity-bff.md) §3.3.6.
- **What the employee gets:** a password-setup email through the realm SMTP. They
  choose a Keycloak password and then sign in at `/<slug>/digit-ui/employee`.
- **Before the deploy:** collect a real email address for every active employee
  who has none (inventory 1.1). Without an address they cannot be linked.
- **Do not link service accounts.** Linking replaces the account's DIGIT password
  with one that only the BFF knows. Leave unlinked: the account in
  `identity_digit_admin_username`, the PGR provisioner, the deploy's own bootstrap
  user (usually `ADMIN`), and any account scripts, MCP or integration tests sign in
  with.
- **City-tenant staff** cannot be linked (§0). Re-create them at the root, or accept
  that they lose access. Their complaints stay where they are.
- **One founder Organization per root.** For a deploy-seeded root, the deploy
  creates the Organization route itself (alias and slug = tenant id) through
  `identity_tenant_route_backfill_roots`, which defaults to `state_root`. If it
  reports `SLUG_TAKEN` or `ALIAS_TAKEN`, a test signup already holds that slug; fix
  that before linking anyone.

The one live migration so far linked 49 of 53 staff with a script calling `_link`
in a loop. It used throwaway test addresses that went to a mail catcher. **A county
needs real addresses and real SMTP.** No bulk-link tool ships in the repo
**(TO CONFIRM)**.

### 4.2 Citizens

Nothing to migrate in advance. At a citizen's first phone sign-in, the BFF finds
their DIGIT account by verified phone number, after its own records:

- **Found** → same account and history.
- **Two active accounts share the number** → `CITIZEN_ACCOUNT_AMBIGUOUS`, and that
  citizen cannot sign in until one account is deactivated. Resolve the duplicates
  from inventory 1.1 first.
- **Not found** → a new citizen account. Old complaints are not shown to it.
  This can happen when a stored phone was encrypted under another tenant's key
  (4.4) **(unverified)**.

### 4.3 Citizens who used Google

2.20 has no citizen Google sign-in. Those citizens sign in with their phone number
instead. If their DIGIT account has that number, 4.2 applies. If it was created
through Google with no number, or with a placeholder, they get a new account
**(TO CONFIRM in rehearsal: what phone the old Google flow stored)**. Tell these
citizens before the change. The inventory count says how many there are.

### 4.4 Encryption keys

2.20 does not change egov-user's encryption, but it reads users the same way 2.12
does: by the **request tenant's** key. Before you upgrade, confirm every active
tenant has an active key, and look at the key-id prefixes from inventory 1.1:

- Every root and city tenant needs a row in `eg_enc_symmetric_keys` with
  `active = true`. A tenant without one fails every user and HRMS write with
  "Unknown error occurred in encryption process". `POST /egov-enc-service/crypto/v1/_generatekey {"tenantId": "<t>"}`
  is create-if-missing and safe to repeat.
- Rows whose `username` prefix is **another tenant's** key id are unfindable by
  login and by the BFF's phone search. The fix is re-encrypting those fields under
  the right tenant's key (decrypt with the old key, encrypt with the new, update),
  as done in the v2.12 upgrade. Count them; do not rotate keys.

---

## 5. Deploy order

One `./deploy.sh <tenant>` does the whole upgrade, in this order inside the
playbook: preflight → secrets → Keycloak (realm configure) → stack → identity
bootstrap (Organization route) → validation. What you control:

1. **One build for the PGR and notification images.** pgr-services,
   pgr-services-db, novu-bridge, novu-bridge-db and user-preferences (+db) must
   share one tag (`notification_stack_tag`). See the
   [notifications migration, step 1](notifications/migration.md#1-take-all-four-images-from-one-build).
2. **pgr-services with or before the configurator.** A 2.20 configurator served
   with an older pgr-services cannot resume onboarding drafts (#2515). A single
   deploy from one commit ships both; only a hand-pinned upgrade can get this wrong.
3. **identity-bff and identity-keycloak from the same commit.**
4. **Workspace seed upgrade (platform baseline v8):** runs in the background for
   **self-serve workspaces only** (rows in `eg_pgr_onboarding_signup`). It is
   create-if-absent and never overwrites a founder's edits. A deploy-seeded root
   has no workspace row and reads as onboarded already.
5. **Notifications:** the deploy upgrades the software only. Moving each tenant's
   notification configuration to the `NOTIFICATIONS.*` masters is a separate,
   reviewed step (`migrate-notifications.py plan` / `apply`). See
   [notifications/migration.md](notifications/migration.md). Book it per tenant.
6. **New 2.20 masters and labels at an existing root** (identity labels, new UI
   text, French and Portuguese): how a deploy-seeded root receives them on upgrade
   is **(TO CONFIRM)**.

```bash
cd /opt/ccrs && git fetch origin && git checkout <v2.20-beta tag or commit>
cd local-setup/ansible && ./deploy.sh <tenant> 2>&1 | tee /var/log/deploy-v220-$(date -u +%Y%m%dT%H%MZ).log
```

Read the end of the log for `ACTION:` lines (for example "a deploy-seeded root has
no Organization route"). They are not failures, but each one needs action.

---

## 6. After the deploy: verify by role

| Role | Check | Expected |
|---|---|---|
| Platform | `/auth/realms/digit/.well-known/openid-configuration`, `/identity/v1/auth-methods`, BFF `/readyz` | 200 / methods listed / ready |
| Platform | `/auth/admin/`, `/auth/realms/master/protocol/openid-connect/token` | 404 (privileged Keycloak paths are not public) |
| Platform | `/digit-ui/employee` | 302 to `/<slug>/digit-ui/employee` (or 404 without a default slug) |
| Admin | Configurator sign-in, then pick the root workspace | Lands on the management console |
| Admin | Members → link one test employee with a real mailbox | Password-setup email arrives |
| Employee | That employee sets a password, then signs in at `/<slug>/digit-ui/employee` | Inbox loads with their roles and old complaints |
| Employee | "Forgot password?" | Reset email arrives |
| Citizen (OTP) | `/<slug>/digit-ui/citizen`, phone + code | Signs in to the **existing** account and sees their complaints |
| Citizen | File, assign and resolve a complaint end to end | Each step works, and notifications go out on the configured channels |
| Founder | New signup through the configurator | Workspace reaches ACTIVE; the five onboarding steps work |
| Service accounts | Integration tests / MCP / scripts that use `/user/oauth/token` | Still sign in (their accounts are not linked) |

Then:

- **Gatus:** a check that 2.20 switches off keeps its last red result forever.
  Clear switched-off endpoints from `gatus.db` once, with a backup, as in
  [#2549](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2549).
  The "Kong Admin API" tile (#2511) is the known one.
- **Remove orphans:** `token-exchange-svc` and any old identity-bff container that
  `docker ps` still shows, plus their nginx routes (2.4).
- **Release the deploy freeze** (1.2) only after the above passes.

---

## 7. Rollback

Decide in advance who calls it and by when. After real users have linked accounts
or filed complaints, rolling back loses that work.

1. Re-freeze automatic deploys.
2. Stop the stack: `cd /opt/digit && docker compose … down --remove-orphans`.
   **Never** use `-v`.
3. Put `/opt/ccrs` back on the old commit, and restore host_vars, the compose
   overlay, the nginx vhost and `.env` from backup 4. Reload nginx.
4. **Keycloak:** drop and recreate the `keycloak` database, `pg_restore` backup 2,
   and start the **24** image. Do not start 24 before the restore.
5. **Main database:** restore backup 1 **only if** a 2.20 migration left the 2.12
   services unable to start. 2.20 adds tables and columns (onboarding, notification
   delivery log, user-preferences), and whether 2.12 tolerates them is
   **(TO CONFIRM)**. A restore discards every complaint, user and edit made since
   the backup.
6. OpenBao: the deploy only **added** keys, so the 2.12 stack ignores them. Restore
   backup 3 only if something else changed.
7. Redeploy the old version with `./deploy.sh <tenant>`. Check legacy staff and
   citizen sign-in, then release the freeze.

**Limits.**
- Emails already sent (password setup, invitations) cannot be recalled. Their
  links stop working after a Keycloak restore.
- A linked employee's DIGIT password was replaced. Without a main-database restore
  they cannot sign in on 2.12 with their old password; reset it in egov-user.
- Anything created on 2.20 that exists only in 2.20 tables is lost on a restore.

---

## 8. Known gaps: confirm in rehearsal

| # | Question | Why it matters |
|---|---|---|
| 1 | Does Keycloak 26.7.3 migrate a real 24.0.5 database with an old realm, Google links and stray realms cleanly? How long does the first start take? | One-way step; a Keycloak timeout aborts the deploy |
| 2 | How do we bulk-link staff with real emails, and how fast can a county collect them? Who sends the emails? | Staff cannot sign in until linked |
| 3 | What phone number did the old citizen Google flow store, and do Google citizens find their account by phone? | They may get a new, empty account |
| 4 | Which OTP delivery (2.5) does the county accept for citizens, and does the chosen one actually deliver a code to a real phone? | Without one, citizens cannot sign in |
| 5 | Does a hand-maintained vhost carry everything 2.20 needs, or can it move to the template? | Tenant routes 404 and sign-in breaks |
| 6 | Is `token-exchange-svc` really left as an orphan? What else (the old `/citizen` bundle) still calls it? | A path around the BFF stays open |
| 7 | How does an existing root get 2.20's new MDMS masters and localisation? | Raw keys or missing screens in the UI |
| 8 | Do 2.12 services start on a database 2.20 has migrated (rollback without a restore)? | Decides whether rollback costs data |
| 9 | Does the WhatsApp chatbot's citizen creation (`user/citizen/_create`) go to egov-user directly or through Kong, where 2.20 closes it? | Chatbot complaints may stop |
| 10 | Do users under another tenant's key (4.4) need re-encryption first? How many are there? | They cannot sign in or be found by phone |
| 11 | Do integration tests, MCP and other scripts still sign in with service accounts after the upgrade? | Nightly runs and bootstrap break |
| 12 | Does the OpenBao backup command in 1.3 match the install's storage backend? | A backup that cannot be restored is no backup |
| 13 | Does the deploy's Organization backfill for the root succeed when a test signup used the same slug? | No staff sign-in at that root |

---

## 9. Journey log

Fill one row per meaningful step, during the rehearsal and during the production
upgrade. Fix this guide wherever a row disproves it, and drop the **(unverified)**
marks once a step is proven.

| Date (UTC) | Environment | Step | Result | Gotcha / follow-up |
|---|---|---|---|---|
| | | | | |
