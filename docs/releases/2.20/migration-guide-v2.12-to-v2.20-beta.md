# Migration Guide: v2.12 → v2.20-beta (identity and Keycloak)

> **Status: proven once in production.** Written from the 2.20 code and the
> develop test-server migration (2026-10-06), then corrected by the first
> supervised production upgrade of a v2.12.1 county install on 2026-10-19
> (master `4c554468a`, the #2557 merge; no separate rehearsal). That upgrade hit
> four deploy blockers that this guide now covers in
> [step 5.1](#51-blockers-seen-on-an-existing-install). Steps still marked
> **(unverified)** were not exercised there. Record what you find in the
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
# Comment the line out for the whole upgrade, and log it.
```

**Pinning the wrapper to the old commit is not enough.** Once Keycloak has moved
to 26, a scheduled run of the old commit starts Keycloak 24 on the migrated
database (see "Why Keycloak is one-way" below). Stop the schedule itself, and
re-enable it only after the wrapper points at the 2.20 commit.

**Do not run the upgrade through a self-healing wrapper** that smoke-tests 2.12
URLs and restores the database when the smoke test fails. A 2.12 smoke test fails
on 2.20 by design (`/citizen/login` and the tenantless `/digit-ui/` are gone), and
a database restore under a migrated Keycloak leaves a mixed state. Run
`./deploy.sh <tenant>` by hand ([step 5](#5-deploy-order)), then update the
wrapper's smoke checks, compose file list and profiles before re-enabling it.

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
docker run --rm -v digit_openbao_data:/d:ro -v $BK:/b alpine tar czf /b/openbao-data.tgz -C /d .
# 4. Configuration: host_vars, compose overlay, nginx vhost, .env
cp -a /opt/ccrs/local-setup/ansible/inventory/host_vars/<tenant>.yml $BK/
cp -a /opt/ccrs/local-setup/docker-compose.<tenant>.yml $BK/ 2>/dev/null
cp -a /etc/nginx/sites-available /etc/nginx/sites-enabled $BK/
cp -a /opt/digit/.env $BK/digit.env
# 5. Optional: the filestore objects (2.20 does not touch them)
docker run --rm -v digit_minio_data:/d:ro -v $BK:/b alpine tar czf /b/minio-data.tgz -C /d .
(cd $BK && sha256sum *.gz *.tgz *.dump > SHA256SUMS)
gzip -t $BK/egov-pg_dumpall.sql.gz && ls -lh $BK   # none of the files may be empty
```

Proven on 2026-10-19: the whole backup took about 20 seconds on a county install
(a 1 GB `egov` database dumps to under 30 MB gzipped, mostly localisation), and
the OpenBao file-storage volume (`digit_openbao_data`) copies safely while
running. `sites-enabled` matters: a vhost can be a plain file there rather than a
link into `sites-available`. Check that `pg_dumpall` covered every table:
`zcat egov-pg_dumpall.sql.gz | grep -c '^COPY '` should match the table count of all
databases in that Postgres.

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
| `digit_ui_v2_branch`; `digit_ui_esbuild_branch` set to an old feature branch | The citizen v2 app is gone; digit-ui builds from the vendored source | `digit_ui_esbuild_branch` is still read (group default `main`) by the static/hmr checkout and the build script. Delete it so the default applies. |
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
identity_magic_link_enabled: true            # default false; without it the configurator's signup
                                             # page offers no method ("No sign-in method is enabled")
identity_citizen_signin_methods: [phone_otp] # needs an OTP channel, see 2.5
# One immutable CI build for every CI-built image (see below)
image_tag: "develop-<sha8>"                  # or the release tag once one is published
image_tag_services: [pgr-services, novu-bridge, digit-config-service, digit-user-preferences-service,
                     digit-ui-esbuild, identity-bff, identity-keycloak]
```

**Images.** Until the release pins its images, the 2.20 compose defaults the new
services (identity-bff, identity-keycloak, pgr-services, novu-bridge,
user-preferences) to the rolling `:nightly-develop` tag, and that tag can point at
a build of a different commit than the one you check out. Set `image_tag` to the
`develop-<sha8>` tag of the commit you deploy (`git rev-parse --short=8 HEAD`;
check that the tag exists on Docker Hub for every image first), and scope it with
`image_tag_services` to the images your stack runs. The `-db` migration images
follow their service. Leave out images you build on the box (for example the
configurator with `build_configurator: true`): CI does not publish a tag for every
image on every commit, and the deploy's registry check fails on a missing one.
Docker Hub keeps only the five newest `develop-<sha8>` tags per image, so pull them
during the upgrade. Images already pulled stay on the box.

**digit-ui.** Find out how the vhost serves `/digit-ui/`. If it aliases a host
directory (for example `/opt/ccrs/digit-ui-esbuild/build/`), set
`build_digit_ui: true` so the deploy rebuilds that bundle from the 2.20 source.
Otherwise the box keeps serving the 2.12 bundle: the compose default for the
digit-ui container is still a 2.12.1 image.

**SMTP.** The deploy **refuses to run** without `identity_smtp_host` and
`identity_smtp_from`, and without an OpenBao `identity_smtp_password` when
`identity_smtp_auth` is true (the default). Keycloak sends every identity email
through this one setting, on the BFF's behalf: password setup and reset, address
verification, and magic links. Complaint notifications do not use it; email
notifications, if you send any, are a separate Novu integration.

Every full deploy rewrites the realm's mail settings from host_vars and OpenBao,
so change them there, never in the Keycloak console. A `--tags` run skips the
identity tasks, so a change takes effect on the next full `./deploy.sh <tenant>`.

**Real mail server.** Use any SMTP relay that will send as your domain: your mail
provider, Amazon SES, SendGrid, Mailgun, Microsoft 365 and so on.

```yaml
identity_smtp_host: smtp.example.org
identity_smtp_port: 587                  # default
identity_smtp_starttls: true             # default; implicit TLS on 465 = ssl true, starttls false
identity_smtp_ssl: false                 # default
identity_smtp_auth: true                 # default; the password goes into OpenBao (below)
identity_smtp_user: <relay username>
identity_smtp_from: no-reply@<domain>
identity_smtp_from_display_name: "<a name staff will recognise>"  # default "DIGIT Identity"
```

- **Sending domain.** Verify the `identity_smtp_from` domain with the relay and
  publish its SPF and DKIM records, plus a DMARC policy. Without them the relay
  rejects the mail or it lands in spam, and to the employee a setup link in spam
  looks like no email at all.
- **Reachability.** Many cloud hosts block outbound port 25, and some block 465 and
  587 until asked. Check from the Keycloak container, since that is what sends:

  ```bash
  docker exec keycloak timeout 10 bash -c 'exec 3<>/dev/tcp/smtp.example.org/587 && head -1 <&3'
  # a "220 ..." greeting is good; a timeout or "Connection refused" means the port is blocked
  ```

- **Password.** Put `identity_smtp_password` into OpenBao with the command below.
- **After the deploy**, check delivery with the "real mailbox" rows in
  [step 6](#6-after-the-deploy-verify-by-role). A failed send shows in
  `docker logs keycloak 2>&1 | grep -iE 'smtp|mail'`.

**Mail catcher.** An install whose staff have no usable mailboxes can point the
realm at a mail catcher and hand each person their setup link by hand. That is
what the first production upgrade did. [Step 4.5](#45-from-a-mail-catcher-to-real-email)
moves such an install to real email later, without re-linking anyone.

```yaml
identity_smtp_host: "mailpit"      # container name on the DIGIT network
identity_smtp_port: 1025
identity_smtp_from: "no-reply@<domain>"
identity_smtp_auth: false
identity_smtp_ssl: false
identity_smtp_starttls: false
```

Run Mailpit as its own Compose project joined to the external network
`digit_egov-network`, so the CCRS deploy and a nightly `git reset` never touch it.
Pin an image tag, give it a volume plus `MP_DATABASE` (a recreate of an unpinned
`:latest` without a volume wipes the inbox), set `MP_WEBROOT=/mailpit`, bind the UI
to loopback and publish it only through an nginx `location /mailpit` with its own
basic-auth file. The inbox holds working account-setup links, so treat its
password like an admin credential.

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
  `ADMIN`. Never link it to a person later ([step 4.1](#41-staff)). Without
  `identity_digit_admin_password` in OpenBao the deploy falls back to
  `token_exchange_system_password`, then to `eGov@123`. Create the account before
  the deploy, once the roles in 2.3 exist, with an `ADMIN` token through Kong:

  ```bash
  curl -s -X POST http://127.0.0.1:18000/user/users/_createnovalidate -H 'Content-Type: application/json' -d '{
    "RequestInfo": {"apiId": "Rainmaker", "authToken": "<ADMIN token>"},
    "user": {"userName": "IDENTITY_ADMIN", "name": "Identity BFF service account", "mobileNumber": "<valid for the root rule>",
             "active": true, "type": "EMPLOYEE", "tenantId": "<root>", "password": "<value also written to OpenBao>",
             "roles": [{"code": "ACCOUNT_ADMIN", "name": "Account Admin", "tenantId": "<root>"}]}}'
  ```

  Leave `gender` out: egov-user has no `OTHER` value and rejects the request with
  `No enum constant ... Gender.OTHER`. Check that the account signs in through
  `/user/oauth/token` before you store its password.
- The **PGR provisioner** (`pgr_digit_provisioner_username`, default
  `PGR_PROVISIONER` on the root) is created by the deploy if absent. The deploy
  fails if an existing account of that name cannot sign in with `MDMS_ADMIN`,
  `ACCOUNT_ADMIN`, `LOC_ADMIN` and `HRMS_ADMIN`.

### 2.3 Data the identity stack needs at the root tenant

- **Roles:** `ACCOUNT_ADMIN` and `TENANT_ADMIN` must exist in
  `ACCESSCONTROL-ROLES.roles` at the root. Without them egov-user rejects every
  account that carries them, and the only trace is in the egov-user log
  (`Role(... code=ACCOUNT_ADMIN ...) is invalid`). Add them through the MDMS v2
  `_create` API before the deploy. They may be missing at `pg` too (they were on
  the first production install), so use these record shapes:
  `{"code": "ACCOUNT_ADMIN", "name": "Account Admin", "description": "Tenant account administrator — owns onboarding and managed-account lifecycle"}`
  and
  `{"code": "TENANT_ADMIN", "name": "Tenant Admin", "description": "Organization administrator projected from Keycloak by the Identity BFF"}`,
  each with `uniqueIdentifier` = the code. The 2.20 deploy did not add them on that
  install.
- **`ACCOUNT_ADMIN` role-actions on the user endpoints.** When a linked employee
  picks the workspace (`/identity/v1/contexts/_select`), the BFF updates their DIGIT
  credential through Kong as the `identity_digit_admin_username` account. If
  `ACCOUNT_ADMIN` has no role-action at the root for those endpoints, every staff
  sign-in ends in `503 DIGIT_UNAVAILABLE`, and the BFF log says
  `DIGIT identifier update returned 403`. Compare the root with `pg`:

  ```bash
  for t in pg <root>; do echo "== $t"; PQ "select a.data->>'url' from eg_mdms_data ra
    join eg_mdms_data a on a.schemacode='ACCESSCONTROL-ACTIONS-TEST.actions-test' and a.tenantid='$t' and a.isactive
     and a.data->>'id'=ra.data->>'actionid'
   where ra.schemacode='ACCESSCONTROL-ROLEACTIONS.roleactions' and ra.tenantid='$t' and ra.isactive
     and ra.data->>'rolecode'='ACCOUNT_ADMIN' and a.data->>'url' like '/user/%' order by 1"; done
  ```

  At minimum the root needs `/user/_search`, `/user/v1/_search`, `/user/_details`,
  `/user/users/_createnovalidate`, `/user/users/_updatenovalidate`,
  `/user/users/{id}/_updatenovalidate` and `/user/profile/_update` for
  `ACCOUNT_ADMIN`. Create the missing `ACCESSCONTROL-ROLEACTIONS.roleactions` rows
  with the root's **own** action ids for those URLs (look them up by URL; ids differ
  between installs), with a fresh role-action `id` above the root's maximum, then
  restart `egov-accesscontrol`. A root that is missing many role-actions shows up in
  the deploy log as "<root> looks like a truncated bootstrap"; the deploy's
  `-e repair_tenant_masters=true --tags master-repair` restores all of them from
  `pg`. Review that list first if the root has deliberate RBAC changes.
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
2. **Hand-edit the vhost** (what the first production upgrade did). Add the four
   items above from `templates/nginx-site.conf.j2`:

   ```nginx
   location ^~ /auth/realms/    { proxy_pass http://127.0.0.1:18000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; proxy_buffer_size 64k; proxy_buffers 8 64k; }
   location ^~ /auth/resources/ { proxy_pass http://127.0.0.1:18000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; proxy_buffer_size 64k; proxy_buffers 8 64k; }
   location = /digit-ui { return 302 /<slug>/digit-ui/; }
   location ~ "^/([a-z0-9-]{2,63})/digit-ui$" { return 302 /$1/digit-ui/; }
   location ~ "^/[a-z0-9-]{2,63}/digit-ui/(.*)$" { rewrite "^/[a-z0-9-]{2,63}/digit-ui/(.*)$" /digit-ui/$1 last; }
   # first line inside location /digit-ui/ (and location = /digit-ui/public-dashboard):
   if ($request_uri ~ "^/digit-ui/(?![^?]*[.](?:js|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|eot)(?:[?]|$))") { return 302 /<slug>$request_uri; }
   ```

   Then **remove the dead identity routes**:

   - `/citizen` and `/citizen/assets/` (the v2 app still calls
     `token-exchange-svc` and bypasses the BFF), and `/token-exchange/`;
   - any include of an older Identity BFF snippet (a `location /identity/` pointing
     straight at the BFF port): `/identity/v1/` must go through Kong;
   - a generic `location /auth/` that proxies straight to Keycloak's port, and the
     root-level Keycloak 24 paths `^~ /realms/`, `^~ /resources/` and
     **`^~ /admin/`**. On the first production install `^~ /admin/` made the
     Keycloak admin console public. With them gone, the rest of `/auth/` falls to
     `location /` and Kong, which refuses the privileged paths.

   **Keep** `^~ /auth/sign-in`, `^~ /auth/sign-up` and `^~ /auth/organization-list`
   if they proxy to a Novu dashboard: they are Novu's auth shim (the template has
   them too), not identity leftovers.

   Stage the new file next to the old one, and swap it in right before the deploy
   (`nginx -t` first, then reload). Removing the old Keycloak routes earlier breaks
   2.12 sign-in. Look at the server's **other** vhosts too: sites left over from
   earlier Keycloak work can still proxy to Keycloak's port or to
   `token-exchange-svc`. Disable them.

### 2.5 Choose how citizens get their one-time code

`identity_citizen_signin_methods: [phone_otp]` needs exactly one way to deliver a
code. Without one, citizen sign-in is unavailable: the deploy warns but does not
fail.

| Setting | What it does | When |
|---|---|---|
| `identity_dev_fixed_otp: true` | Accepts the fixed development code (`123456`) for any number; the BFF writes codes to its log | Demo or test servers only: anyone can sign in as any citizen. It matches what many 2.12 test installs do today. Proven on the first production upgrade, where the county kept the fixed code it already used. |
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
   container running as an **orphan** (confirmed: compose reports it, with
   `otp-publisher`, as an orphan of the project). Stop and remove it once step 6
   passes, together with its nginx route (2.4). An older identity-bff container
   from an earlier experiment is replaced by the 2.20 `identity-bff` service
   automatically when its compose service name is also `identity-bff`.

On the first production upgrade, Keycloak 26.7.3 migrated a 24.0.5 database (an
old realm with Google links and a stray `__REALM_NAME__` realm) in place without a
problem and came up healthy within the deploy's normal wait.

Inside the container Keycloak serves at the **root** path; `/auth` exists only at
Kong. For `kcadm.sh` use `--server http://127.0.0.1:8180` from inside the
`keycloak` container, not `…:8180/auth` (that gives
`Unable to find matching target resource method`).

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

**The first admin.** `_link` needs a caller who is already linked and holds live
`ACCOUNT_ADMIN` at the root, and no deploy setting links one on a deploy-seeded
root. Bootstrap the first one through the BFF's operator API, which is reachable
only on the BFF's loopback port with the control-plane token:

1. Create a **person** account at the root (not the service account from 2.2), for
   example with `ACCOUNT_ADMIN`, `HRMS_ADMIN`, `MDMS_ADMIN`, `LOC_ADMIN`, `EMPLOYEE`
   and `SUPERUSER`.
2. Create its Keycloak user in realm `digit` with `kcadm.sh` (see step 3 for the
   server URL), with `emailVerified=true`, and set a password, or leave the
   required actions and send a setup email.
3. Link it:

   ```bash
   CP=$(docker exec identity-bff printenv IDENTITY_CONTROL_PLANE_TOKEN)
   curl -s -X POST http://127.0.0.1:18400/internal/identity/v1/account-links/_link \
     -H "Authorization: Bearer $CP" -H 'Content-Type: application/json' \
     -d '{"actor":"v220-migration","links":[{"email":"<admin email>","tenantId":"<root>","digitUserName":"<code>","userType":"EMPLOYEE"}]}'
   ```

4. Turn that link into an active binding plus Organization membership:
   `docker exec identity-bff node dist/modules/jobs/convert-account-links.js`
   (expect `"converted":1`).

**Bulk-linking the rest.** Sign in to the configurator as that admin and call
`POST /identity/v1/workspace-members/_link {tenantId, digitUuid, email}` once per
active HRMS employee at the root, from a script that keeps the BFF session cookie.
The first production upgrade linked 61 of 61 staff this way in under a minute,
every one `201` with an active binding and a setup email. Exclude every account that
something signs in to with a DIGIT password: the BFF's service account, the PGR
provisioner, `ADMIN` and other bootstrap or MCP accounts, smoke-test logins, and
integration-test personas.

**Addresses.** Use the employee's own address where it is valid and unique. Where
there is none, a common synthetic scheme such as `<code-lowercased>@staff.<domain>`
works when realm mail goes to a mail catcher (2.2): an admin reads the setup link
there and hands it to the person. Keycloak usernames are the addresses, so pick a
scheme you will keep: a later change of address (4.5) leaves the username as it was.

**Setup links expire after 15 minutes** (`IDENTITY_PASSWORD_SETUP_TTL_SECONDS`,
default 900). Links sent during the bulk run are dead by the time an admin hands
them out, so send a fresh one at hand-out time ("Resend" in the console, or
`_link` with `resend: true`), or have the person use "Set up or reset your password"
on the configurator sign-in page. Open a link in a private window: a browser that
is signed in to Keycloak as someone else gets `different_user_authenticated`.

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

Proven on the first production upgrade: phone + fixed code at
`/<slug>/digit-ui/citizen` → `_send` 202, `_verify` 200, citizen context at the
root, "My complaints" and PGR search 200.

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

### 4.5 From a mail catcher to real email

An install that went live with a mail catcher and synthetic addresses (4.1) can
move to real email at any time. Nobody is re-linked. Passwords, roles, bindings and
complaint history stay as they are.

1. **Switch the realm to the real relay** (2.2) and run a full deploy. From then on,
   all identity mail goes out for real, including mail to synthetic addresses,
   which bounces. Do not link, resend or reset anyone at a synthetic address after
   this point.
2. **Give each employee their real address.** As a linked `ACCOUNT_ADMIN`, use
   Configurator → Employees → edit the email (for an Active member this changes
   their sign-in email), or Members → Change email. A script can use the session
   that bulk-linked staff (4.1):
   `POST /identity/v1/workspace-members/_updateEmail {tenantId, digitUuid, email}`
   → `202 {status: "verification_sent"}`. Keycloak emails a verification link to
   the new address.
   - Keycloak's email changes at once. DIGIT's (`eg_user.emailid`) changes only once
     the person clicks the link.
   - The Keycloak **username** stays the synthetic address. The person can sign in
     with either.
   - `403 ADMIN_EMAIL_CHANGE_NOT_ALLOWED`: the target is you, holds an
     administrative role you don't hold, has a citizen account or a verified phone,
     or belongs to another workspace. That person changes it themselves:
     Configurator → Account → Change email (Keycloak's `UPDATE_EMAIL`). For your
     own address, a second admin can also do it.
   - `409 IDENTITY_EMAIL_CHANGED`: another Keycloak user already has that address.
3. **Staff who never set a password** (their handed-out link expired, or was never
   handed out): once the address has changed, send setup with Employees →
   "Resend email", or `_link` with `resend: true` and the **new** address. Wait at
   least 60 s after the change (`429 RESEND_TOO_SOON`). That email covers both
   verification and the password, so the person can ignore the first one.
4. **Check** that `GET /identity/v1/workspace-members?tenantId=<root>&state=active`
   (`max` up to 500) lists no email at the synthetic domain. As people verify,
   their `eg_user.emailid` follows.
5. **Retire the catcher** once no synthetic address is left: stop its Compose
   project, and remove the `/mailpit` nginx location and its basic-auth file.

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

Run the deploy detached (`setsid`, output to a log file) and let it finish. Every
task is idempotent, so after fixing a blocker you simply run it again. On the first
production upgrade it took four runs of 2 to 15 minutes each.

### 5.1 Blockers seen on an existing install

Each of these stopped the first production upgrade. None modified data before it
stopped.

1. **`db-history-normalize` ABORT: `digit-user-preferences-service: user_preference has N rows, but no Flyway history table exists`.**
   The 2.12 user-preferences service was a Go program that created its table
   without Flyway history. The guard refuses to run the 2.20 migrators, and the
   deploy stops at "novu-bridge ordering" with novu-bridge, config-service and
   user-preferences left created but stopped (**notifications are down until this is
   fixed**). The 2.20 migration `V20260205120000__create_user_preference.sql` was
   written for exactly this table (`CREATE TABLE IF NOT EXISTS`, a de-duplication,
   `CREATE INDEX IF NOT EXISTS`), and the migrator runs Flyway with
   `baselineOnMigrate=true`. So dump the table, then run that one migrator without
   the guard:

   ```bash
   docker exec docker-postgres pg_dump -U egov -d egov -t user_preference > $BK/user_preference.sql
   cd /opt/digit && COMPOSE_PROFILES=<the deploy's profiles> docker compose <the deploy's -f files> \
     run --rm --no-deps digit-user-preferences-service-migration
   ```

   Expect a BASELINE row at version 1 and `V20260205120000` applied, with the rows
   kept. The guard then finds a canonical history table. Re-run the deploy.

2. **"novu tenant accounts — move the Novu admin off the legacy password" fails
   with `FAILED 422`.** Per-tenant Novu accounts default to on with Keycloak. On an
   existing Novu the task signs in as `admin@digit.local` with the legacy password
   and calls `/v1/auth/update-password`, which Novu 2.3.0 rejects with
   `environmentId should not be empty`: the login token carries no environment. An
   install that pins `novu_api_key` (its own Novu organisation with its providers)
   keeps the 2.12 behaviour with `novu_tenant_accounts: false`.

3. **"validate — no container is restarting / unhealthy / crash-looping" fails on
   `digit-tempo`.** A Tempo that never becomes ready (check its restart count and
   `/ready`) trips the gate, and every task after it is skipped, **including the
   Keycloak realm configuration**. Fix Tempo, or drop the trace tier with
   `observability_level: logs` (metrics and logs stay; the deploy removes the tempo
   container and keeps its volume).

4. **The notification seed fails at the root with
   `RAINMAKER-PGR.NotificationChannel row FORBIDDEN (403)` and exit 3, and it grants
   permissions on the wrong endpoints.** `seed-notifications.py` uses fixed action
   ids (4623–4639) and treats an action as present when the id exists at the
   tenant, without comparing the URL. On an install whose own actions already use
   those ids, it creates its role-actions on **unrelated endpoints** (on the first
   production install, 23 rows: for example CSR, GRO and PGR_LME on
   `/mdms-v2/v2/_update/common-masters.UserValidation`, and MDMS_ADMIN on PGR
   migration and analytics endpoints). Check right after every 2.20 deploy until the
   seed is fixed:

   ```bash
   PQ "select a.data->>'id', a.data->>'url' from eg_mdms_data a where a.schemacode='ACCESSCONTROL-ACTIONS-TEST.actions-test'
       and a.tenantid='<root>' and a.isactive and (a.data->>'id')::int between 4623 and 4639 order by 1"
   ```

   If those ids are not the `/mdms-v2/v2/_create|_update/RAINMAKER-PGR.NotificationChannel`,
   `NOTIFICATIONS.*` and `/novu-bridge/novu-adapter/v1/…` actions the seed lists,
   save and **deactivate** (`isactive=false`; deactivated rows still hold their
   unique key, so the next seed run does not recreate them) the role-actions the
   seed created in this deploy, restart `egov-accesscontrol`, and confirm that an
   affected role now gets 403. The root then stays on its 2.12 notification
   configuration, which keeps delivering. Everything after the seed in the
   playbook is CI test tasks, so the identity upgrade itself is complete at this
   point.

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
| Platform | Escalation system user env on pgr-services, `eg_enc_symmetric_keys` for the root, novu-bridge `NOVU_API_KEY` not `changeme` | Unchanged from 2.12 |

To script the employee check, follow the browser flow:
`GET /identity/v1/authorize?surface=employee&method=password&intent=signin&tenantSlug=<slug>`,
post the Keycloak login form, then `POST /identity/v1/contexts/_select
{tenantId, surface: "employee"}`, which returns the DIGIT token and roles. On the
first production upgrade the admin, GRO, LME and CSR all landed on
`/<slug>/digit-ui/employee/` with their own roles and a working PGR inbox.

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

## 8. Known gaps

Answered by the first production upgrade (2026-10-19): **1** yes, cleanly, within
the normal wait; **2** a script over `_link` (step 4.1), with a mail catcher where
there are no mailboxes; **5** a hand-edited vhost works (2.4); **6** yes, an orphan,
and no 2.20 path calls it; **11** yes, unlinked service accounts still sign in;
**12** yes, for OpenBao file storage. The rest are still open.

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
| 14 | When are the four blockers in 5.1 fixed in the code (seed action ids, Novu admin rotation, the user-preferences history guard)? | Every existing install hits them |
| 15 | How does a nightly wrapper's integration-test run sign in after the upgrade? Linked test personas need Keycloak passwords. | Nightly results go red for the wrong reason |

---

## 9. Journey log

Fill one row per meaningful step, during the rehearsal and during the production
upgrade. Fix this guide wherever a row disproves it, and drop the **(unverified)**
marks once a step is proven.

| Date (UTC) | Environment | Step | Result | Gotcha / follow-up |
|---|---|---|---|---|
| 2026-10-19 04:05 | — | #2557 merged | master `4c554468a` (same tree as develop `a5877085`) | Release test-plan items still open. |
| 05:15 | County production (v2.12.1) | Backup (1.3) | Done in 20 s, checksums verified, copied off the server | `sites-enabled` held a real file, not a link. |
| 05:20 | same | Freeze (1.2) | Cron line commented out | The wrapper pin alone would have restarted Keycloak 24 on the migrated DB. |
| 05:20 | same | Roles + service account (2.2, 2.3) | `ACCOUNT_ADMIN`/`TENANT_ADMIN` created; `IDENTITY_ADMIN` signs in | Roles were absent at `pg` too; egov-user rejects `gender: OTHER`. |
| 05:22 | same | host_vars (2.1, 2.2) | Preflight passes | `build_digit_ui: true` needed: the vhost served a host-built bundle. |
| 05:24 | same | Mail catcher, vhost staged (2.2, 2.4) | Mailpit up on the DIGIT network | The old vhost made the Keycloak admin console public through `^~ /admin/`. |
| 06:10 | same | Deploy run 1 | Stopped in 2 min | 5.1 #1 (user-preferences history guard). Notifications down until fixed (3 min). |
| 06:14 | same | Deploy run 2 | Stopped after 10 min; Keycloak 26 healthy | 5.1 #2 (Novu admin rotation, 422). |
| 06:25 | same | Deploy run 3 | Stopped after 6 min | 5.1 #3 (Tempo unhealthy; realm not configured yet). |
| 06:33 | same | Deploy run 4 | Realm `digit`, BFF ready; stopped at the notification seed | 5.1 #4: 23 role-actions on the wrong endpoints, deactivated and verified 403. |
| 06:50 | same | First admin + staff (4.1) | 61 of 61 linked | Staff sign-in returned 503 until `ACCOUNT_ADMIN` got its `/user/*` role-actions (2.3). |
| 06:58 | same | Verify by role (6) | Admin, GRO, LME, CSR, citizen OTP and service accounts all pass | Orphan cleanup and re-enabling the nightly still to do. |
| later | same | Configurator signup reported broken | Sign-in works; the signup page says "No sign-in method is enabled" | `identity_signup_methods: [magic_link]` was set without `identity_magic_link_enabled: true` (2.2). The founder signup row of step 6 was not run. |
