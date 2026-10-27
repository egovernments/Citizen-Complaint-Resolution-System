# Migration Guide: v2.12 → v2.20-beta (identity and Keycloak)

**For:** an existing v2.12.x install deployed with Ansible (`local-setup/ansible`,
stack under `/opt/digit`). If you are still on 2.12.0, do
[v2.12 → v2.12.1](../2.12/migration-guide-v2.12-to-v2.12.1.md) first.

**Covers:** sign-in for staff, citizens and admins, and the Keycloak upgrade.
Notifications have their own [migration guide](notifications/migration.md).

**Downtime:** the deploy takes 20–40 minutes. After it, **each employee can sign
in only once they are linked to a Keycloak account and have set a password**
([5.1](#51-staff)). Agree that window with the people who use the system.

**See also:** [Identity BFF deployment](../../setup/deployment/identity-bff.md).

---

## 0. What changes

| Who | v2.12 | v2.20-beta |
|---|---|---|
| **Staff** | `/digit-ui/employee/user/login`: city, username, password, checked by egov-user | Keycloak login page. Staff sign in with their **email** (not their employee code) and a password held in Keycloak. Only **linked** employees can sign in. |
| **Staff password reset** | SMS OTP | Email only. An employee without an email address cannot reset their password. |
| **Citizens** | Legacy OTP page; on some installs "Continue with Google" on the `/citizen` app | Phone number + one-time code. **No citizen Google sign-in.** The `/citizen` app is removed. |
| **Admins** | Configurator with a DIGIT login | Configurator signs in through Keycloak, then the admin picks a workspace. Only accounts with an admin role (`SUPERUSER`, `ACCOUNT_ADMIN`, `MDMS_ADMIN`, `LOC_ADMIN`, `HRMS_ADMIN`, `WORKFLOW_ADMIN`) can enter it. |
| **URLs** | `/digit-ui/employee/…`, `/digit-ui/citizen/…` | `/<slug>/digit-ui/employee/…`, `/<slug>/digit-ui/citizen/…`. For a deploy-seeded root the slug is the tenant id (e.g. `/ke/digit-ui/…`). `/digit-ui/<page>` returns 404, or redirects if `digit_ui_default_tenant_slug` is set. |
| **Keycloak** | 24.0, one realm per state tenant, plus `token-exchange-svc` | 26.7.3 (`identity-keycloak` image), one shared realm (`digit`). Each root tenant is a Keycloak Organization. `token-exchange-svc` is removed. Keycloak is mandatory. |
| **Kong** | User endpoints open | `/user/citizen/_create`, `/user/password/nologin/_update` and `/user-otp/v1/_send` return `404 IDENTITY_LEGACY_ENDPOINT_REMOVED`. `/user/oauth/token` stays open for service accounts. |

**Staff whose home tenant is a city tenant** (`<root>.<city>`) cannot be linked:
2.20 links staff only at a root tenant. Count them first ([1.1](#11-inventory)).
They lose sign-in unless you re-create them at the root.

---

## 1. Before you start

### 1.1 Inventory

Run on the server as root. Nothing here changes anything. Keep the output
private: it describes your users.

```bash
cd /opt/ccrs && git log --oneline -1                      # the version you are leaving
docker ps --format '{{.Names}} {{.Image}}' | sort
HV=/opt/ccrs/local-setup/ansible/inventory/host_vars/<tenant>.yml
grep -oE '^[A-Za-z_][A-Za-z0-9_]*:' "$HV" | tr -d ':'     # host_vars key names only
```

**Keycloak**, if `keycloak-postgres` is running:

```bash
KQ() { docker exec keycloak-postgres psql -U keycloak -d keycloak -tAF'|' -c "$1"; }
KQ "select version from migration_model order by update_time desc limit 1"   # 24.0.x expected
KQ "select r.name, count(u.id) from realm r left join user_entity u on u.realm_id=r.id group by 1"
KQ "select r.name, f.identity_provider, count(*) from federated_identity f join realm r on r.id=f.realm_id group by 1,2"
```

The last query counts citizens who use Google today ([5.3](#53-citizens-who-used-google)).
Without `keycloak-postgres` (v2.12 shipped with Keycloak off), skip these, backup 2
and rollback step 4: the deploy starts Keycloak 26 on a new database.

**DIGIT users:**

```bash
PQ() { docker exec docker-postgres psql -U egov -d egov -tAF'|' -c "$1"; }
PQ "select tenantid, type, active, count(*) from eg_user group by 1,2,3 order by 1,2,3"
# Employees with an email, per tenant
PQ "select tenantid, count(*) filter (where emailid<>'') with_email, count(*) total
    from eg_user where type='EMPLOYEE' and active group by 1 order by 1"
# Citizens sharing one mobile number (they hit CITIZEN_ACCOUNT_AMBIGUOUS)
PQ "select count(*) from (select mobilenumber from eg_user where type='CITIZEN' and active
    group by mobilenumber having count(*)>1) d"
# Encryption key id per tenant's rows (5.4)
PQ "select tenantid, type, split_part(username,'|',1) key_id, count(*) from eg_user group by 1,2,3 order by 1,2,3"
PQ "select tenant_id, key_id, active from eg_enc_symmetric_keys where tenant_id not like '%.%' order by 1"
# Roles the identity stack needs at the root
PQ "select uniqueidentifier from eg_mdms_data where schemacode='ACCESSCONTROL-ROLES.roles'
    and tenantid='<root>' and uniqueidentifier in ('ACCOUNT_ADMIN','TENANT_ADMIN','HRMS_ADMIN','LOC_ADMIN','MDMS_ADMIN')"
```

Write down: employees without email at the root, city-tenant employees,
Google-linked citizens, duplicate citizen phones, rows under another tenant's key
id, and whether `ACCOUNT_ADMIN` and `TENANT_ADMIN` exist at the root.

**Collect an email for every active employee now.** Linking (5.1) needs one, and
it happens after the deploy.

**OpenBao key names** (never print values):

```bash
T=$(python3 -c "import json;print(json.load(open('/opt/digit/.openbao/init.json'))['root_token'])")
BAO() { docker exec -e BAO_TOKEN="$T" -e BAO_ADDR=http://127.0.0.1:8200 openbao bao "$@"; }
BAO kv get -format=json kv/digit/<tenant> | python3 -c "import json,sys;print(sorted(json.load(sys.stdin)['data']['data']))"
```

**Novu, from 2.12.0.** 2.12.0 never applied OpenBao's `novu_mongo_password` and
`novu_store_encryption_key`, so Novu may be running on the compose defaults. The
next deploy writes the OpenBao values, and Novu then fails Mongo auth and can't
decrypt its stored keys. Compare by hash:

```bash
h() { tr -d '\n' | sha256sum | cut -c1-12; }
echo "store key: $(docker exec novu-api printenv STORE_ENCRYPTION_KEY | h) vs $(BAO kv get -field=novu_store_encryption_key kv/digit/<tenant> | h)"
echo "mongo:     $(docker exec novu-api printenv MONGO_URL | sed -E 's#^[^/]*//[^:]*:([^@]*)@.*#\1#' | h) vs $(BAO kv get -field=novu_mongo_password kv/digit/<tenant> | h)"
```

If they differ, write the running values into OpenBao before the deploy
([#2619](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2619)).

**nginx:** if host_vars has `nginx_preserve_vhost: true`, the deploy will not add
the 2.20 routes; see [2.4](#24-nginx-on-a-hand-maintained-vhost).

### 1.2 Stop scheduled deploys

Comment out any cron job or wrapper that redeploys this server
(`cat /etc/cron.d/*redeploy*`) for the whole upgrade. Pinning it to the old commit
is not enough: once Keycloak is on 26, an old-commit run starts Keycloak 24 on the
migrated database and breaks it.

Run the upgrade with `./deploy.sh <tenant>` by hand, not through a wrapper that
smoke-tests 2.12 URLs and restores the database on failure. 2.12 smoke tests fail
on 2.20 by design. Update the wrapper's smoke checks before you re-enable it.

### 1.3 Back up

Copy the backups off the server when done.

```bash
TS=$(date -u +%Y%m%dT%H%MZ); BK=/opt/digit/predeploy-backups/$TS-v220; mkdir -p $BK
# 1. Main Postgres
docker exec docker-postgres pg_dumpall -U egov | gzip > $BK/egov-pg_dumpall.sql.gz
# 2. Keycloak database (only if keycloak-postgres exists). The upgrade is one-way.
docker exec keycloak-postgres pg_dump -U keycloak -Fc keycloak > $BK/keycloak-24.dump
# 3. OpenBao
cp -a /opt/digit/.openbao $BK/openbao-dir
docker run --rm -v digit_openbao_data:/d:ro -v $BK:/b alpine tar czf /b/openbao-data.tgz -C /d .
# 4. Configuration
cp -a /opt/ccrs/local-setup/ansible/inventory/host_vars/<tenant>.yml $BK/
cp -a /opt/ccrs/local-setup/docker-compose.<tenant>.yml $BK/ 2>/dev/null
cp -a /etc/nginx/sites-available /etc/nginx/sites-enabled $BK/   # sites-enabled may hold real files
cp -a /opt/digit/.env $BK/digit.env
# 5. Optional: filestore (2.20 does not touch it)
docker run --rm -v digit_minio_data:/d:ro -v $BK:/b alpine tar czf /b/minio-data.tgz -C /d .
# 6. Novu, if enable_novu is on (notifications pause meanwhile)
docker stop novu-api novu-worker novu-ws novu-mongo
docker run --rm -v digit_novu_mongo_data:/d:ro -v $BK:/b alpine tar czf /b/novu-mongo-data.tgz -C /d .
docker start novu-mongo novu-api novu-worker novu-ws
(cd $BK && sha256sum *.gz *.tgz *.dump > SHA256SUMS)
gzip -t $BK/egov-pg_dumpall.sql.gz && ls -lh $BK   # no file may be empty
```

**Keycloak is one-way.** Keycloak 26 migrates its schema in place on first start,
and Keycloak 24 cannot run on the result. The only way back is restoring backup 2
**and** going back to the 24 image. Never start the old image on the upgraded
database.

---

## 2. Configuration

Edit `inventory/host_vars/<tenant>.yml`. The settings in 2.1 stop the deploy before
it changes anything. A missing SMTP setting (2.2) stops it only **after** Keycloak
has migrated, so check those by hand.

### 2.1 Remove

| Key | If you leave it |
|---|---|
| `auth_provider`, `citizen_auth_provider`, `employee_auth_provider` set to `keycloak` | Deploy fails ("selects Keycloak login on: …"). Delete them. |
| `enable_keycloak: false` | Deploy fails. Set it to `true` (2.2); don't delete it. |
| `keycloak_google_client_id` left from 2.12 citizen Google | The deploy creates a Google provider in realm `digit`, and the default signup list includes `google` (2.2). Delete it, and the secret, unless you set up Configurator Google (2.3). |
| `enable_digit_ui_v2`, `nginx_features.digit_ui_v2` | Deploy fails if true. Delete them. |
| `digit_ui_v2_branch`, `digit_ui_esbuild_branch` set to an old feature branch | The old branch is still checked out. Delete them. |
| `keycloak_client_id`, `login_tenant_allowlist`, `build_otp_publisher`, `build_default_data_handler` | Ignored. Delete them. |
| `pgr_services_image`, `configurator_image` and other image pins | The old image runs on the 2.20 schema. Delete them. |

Keep `token_exchange_system_password` in OpenBao until `identity_digit_admin_password`
is set (2.2): the deploy falls back to it.

### 2.2 Add

```yaml
nginx_features:                    # add to your existing block; don't paste a second one
  keycloak: true                   # the deploy then checks /auth/ serves the realm
digit_ui_default_tenant_slug: <root>   # old /digit-ui/... links redirect instead of 404
enable_keycloak: true              # keep it: master still gates Keycloak metrics on it
identity_digit_admin_username: <service account code, see below>
identity_smtp_host: <smtp host>
identity_smtp_from: <no-reply address>
identity_smtp_user: <smtp user>
identity_signin_methods: [password]          # Configurator only; add google only after 2.3
identity_signup_methods: [magic_link]        # no self-signup until 2.6; [] does NOT turn it off
identity_citizen_signin_methods: [phone_otp] # needs an OTP channel, 2.5
image_tag: "master-<sha7>"                   # see Images
image_tag_services: [pgr-services, novu-bridge, digit-config-service, digit-user-preferences-service,
                     digit-ui-esbuild, identity-bff, identity-keycloak]
```

A second `nginx_features:` key replaces the first, which drops `configurator`,
`mcp` and the other routes.

**`enable_keycloak`.** Keycloak always runs on 2.20, and only `false` fails the
deploy. On master the key also decides whether Prometheus scrapes Keycloak
(`otel/targets/keycloak.json`): without it, Keycloak's metrics, dashboards and
alerts go blank. develop doesn't have this gate yet, so it may move: keep the
key while the commit you deploy still reads it
(`grep -n keycloak.json local-setup/ansible/playbook-deploy.yml`).

**Self-signup is on by default.** Without `identity_signup_methods` the deploy
offers `[magic_link, google, github]`. If `keycloak_google_client_id` is set, any
Google account can then sign up, and each signup creates a new root workspace. An
empty list falls back to that same default, so use `[magic_link]`: with
`identity_magic_link_enabled` off (the default) nothing is offered. Check after
the deploy that `/identity/v1/auth-methods?intent=signup` returns no methods.

**Images.** Deploy a commit on `master` and set `image_tag` to that commit's
`master-<sha7>` tag (`git rev-parse --short=7 HEAD`). Check the tag exists on
Docker Hub for each image in `image_tag_services` first. Leave out images built
on the box, such as the configurator with `build_configurator: true`. `master-*`
tags are kept; `develop-<sha8>` tags are pruned after about five builds, and every
deploy then refuses the missing tag (`image_tag_verify`).

**digit-ui.** If the vhost serves `/digit-ui/` from a host directory (for example
`/opt/ccrs/digit-ui-esbuild/build/`), set `build_digit_ui: true`. Otherwise the
box keeps serving the 2.12 bundle.

**SMTP.** All identity email (password setup and reset, verification, magic links)
goes through the realm's SMTP. Complaint notifications don't. The deploy needs
`identity_smtp_host`, `identity_smtp_from` and, unless `identity_smtp_auth: false`,
`identity_smtp_password` in OpenBao. It checks them only after the stack is up, by
which time Keycloak has migrated and the old login pages are gone
([#2618](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2618)).
Check first:

```bash
grep -E '^identity_smtp_(host|from|auth):' "$HV"
BAO kv get -field=identity_smtp_password kv/digit/<tenant> | grep -q . && echo smtp-password-present
```

A real relay:

```yaml
identity_smtp_host: smtp.example.org
identity_smtp_port: 587                  # default; for 465 set ssl true, starttls false
identity_smtp_starttls: true             # default
identity_smtp_user: <relay username>
identity_smtp_from: no-reply@<domain>
identity_smtp_from_display_name: "<name staff will recognise>"
```

- Publish SPF, DKIM and DMARC for the `from` domain, or setup links land in spam.
- Check the port is open from the Keycloak container:
  `docker exec keycloak timeout 10 bash -c 'exec 3<>/dev/tcp/smtp.example.org/587 && head -1 <&3'`
  should print `220 …`.
- Every full deploy rewrites the realm's mail settings from host_vars and OpenBao.
  Change them there, not in the Keycloak console.

**No mailboxes yet?** Point the realm at a mail catcher such as Mailpit
(`identity_smtp_host: mailpit`, port `1025`, `identity_smtp_auth/ssl/starttls: false`)
and hand each person their setup link. Run it as its own Compose project on the
`digit_egov-network` network, with a pinned image and a volume. Protect its UI with
basic auth: the inbox holds working setup links. [5.5](#55-from-a-mail-catcher-to-real-email)
moves to real email later.

**Secrets go into OpenBao.** `bootstrap_secrets` is read only on a tenant's first
deploy.

```bash
BAO kv patch kv/digit/<tenant> identity_digit_admin_password='<value>' identity_smtp_password='<value>'
```

- **No `$` in `identity_digit_admin_password`, `keycloak_admin_password` or
  `keycloak_db_password`.** The deploy writes them unquoted to `/opt/digit/.env`,
  and Compose expands `$`: `Idm$ecret9` reaches the BFF as `Idm`, and staff
  linking fails with `DIGIT_UNAVAILABLE`. egov-user wants one of `@#$%`; use `@`,
  `#` or `%`.
- If the install never ran Keycloak, also add `keycloak_admin_password` and
  `keycloak_db_password`. The deploy refuses to run without the admin password.
- **If Keycloak 24 already runs**, the deploy signs in to it as the master `admin`
  with OpenBao's `keycloak_admin_password`. A mismatch stops the realm setup
  (`kcadm could not sign in`) after Keycloak has migrated to 26, so nobody can
  sign in. 2.12.1's `_example` left that value empty, which gave `admin/admin`,
  and 2.20 refuses an empty value. Before the deploy, check the OpenBao value
  works, and if not, change the admin password in Keycloak 24 to it:

  ```bash
  P=$(BAO kv get -field=keycloak_admin_password kv/digit/<tenant>)
  KC='/opt/keycloak/bin/kcadm.sh config credentials --config /tmp/kcadm.cfg --server http://127.0.0.1:8180 --realm master --user admin'
  docker exec -e P="$P" keycloak sh -c "$KC --password \"\$P\"" >/dev/null && echo kc-admin-ok
  # if that fails, sign in with the current password and set the OpenBao one
  docker exec -e OLD='<current admin password>' -e P="$P" keycloak sh -c "$KC --password \"\$OLD\" &&
    /opt/keycloak/bin/kcadm.sh set-password --config /tmp/kcadm.cfg -r master --username admin --new-password \"\$P\""
  ```

  Run the first command again; it must print `kc-admin-ok`.
- The deploy generates the remaining identity secrets on its first 2.20 run.
- **`identity_digit_admin_*`** is the DIGIT account the BFF uses for admin calls.
  Create a dedicated one holding only `ACCOUNT_ADMIN` at the root (after 2.3), and
  never link it to a person:

  ```bash
  curl -s -X POST http://127.0.0.1:18000/user/users/_createnovalidate -H 'Content-Type: application/json' -d '{
    "RequestInfo": {"apiId": "Rainmaker", "authToken": "<ADMIN token>"},
    "user": {"userName": "IDENTITY_ADMIN", "name": "Identity BFF service account", "mobileNumber": "<valid for the root>",
             "active": true, "type": "EMPLOYEE", "tenantId": "<root>", "password": "<same value as in OpenBao>",
             "roles": [{"code": "ACCOUNT_ADMIN", "name": "Account Admin", "tenantId": "<root>"}]}}'
  ```

  Leave out `gender` (egov-user rejects `OTHER`). Check it signs in through
  `/user/oauth/token`.
- **PGR provisioner** (`PGR_PROVISIONER` at the root): the deploy creates it, and
  fails if an existing one lacks `MDMS_ADMIN`, `ACCOUNT_ADMIN`, `LOC_ADMIN` or
  `HRMS_ADMIN`. After you add roles, egov-user may still return the old token and
  its old roles, and a refresh hands out a new token with them too. Point
  `pgr_digit_provisioner_username` at a new account instead, or delete all of that
  user's cached token keys in `digit-redis` in one command. Never delete
  `client_id_to_access:*`.

  ```bash
  RC() { docker exec digit-redis redis-cli "$@"; }
  U=PGR_PROVISIONER
  # Signing in returns the cached access and refresh tokens
  read A R < <(curl -s -u egov-user-client: http://127.0.0.1:18000/user/oauth/token \
    -d grant_type=password -d scope=read -d username=$U -d password='<password>' \
    -d tenantId=<root> -d userType=EMPLOYEE |
    python3 -c "import json,sys;d=json.load(sys.stdin);print(d['access_token'],d['refresh_token'])")
  AA=$(RC --scan --pattern 'auth_to_access:*' | while read -r k; do RC --no-raw get "$k" | grep -q "$A" && echo "$k"; done)
  RC del "access:$A" "auth:$A" "access_to_refresh:$A" $AA "uname_to_access:egov-user-client:$U" \
    "refresh:$R" "refresh_auth:$R" "refresh_to_access:$R"
  ```

  Sign in again: the token is new and carries the new roles.

### 2.3 Data at the root tenant

- **Roles.** `ACCOUNT_ADMIN` and `TENANT_ADMIN` must exist in
  `ACCESSCONTROL-ROLES.roles` at the root, or egov-user rejects every account that
  holds them (`Role(... code=ACCOUNT_ADMIN ...) is invalid`, in its log only). The
  deploy doesn't add them. Create them with MDMS v2 `_create`, `uniqueIdentifier`
  = the code:
  `{"code": "ACCOUNT_ADMIN", "name": "Account Admin", "description": "Tenant account administrator"}`,
  `{"code": "TENANT_ADMIN", "name": "Tenant Admin", "description": "Organization administrator projected from Keycloak"}`.
- **`ACCOUNT_ADMIN` on the `/user/*` endpoints.** Without these role-actions every
  staff sign-in ends in `503 DIGIT_UNAVAILABLE` (BFF log:
  `DIGIT identifier update returned 403`). Compare the root with `pg`:

  ```bash
  for t in pg <root>; do echo "== $t"; PQ "select a.data->>'url' from eg_mdms_data ra
    join eg_mdms_data a on a.schemacode='ACCESSCONTROL-ACTIONS-TEST.actions-test' and a.tenantid='$t' and a.isactive
     and a.data->>'id'=ra.data->>'actionid'
   where ra.schemacode='ACCESSCONTROL-ROLEACTIONS.roleactions' and ra.tenantid='$t' and ra.isactive
     and ra.data->>'rolecode'='ACCOUNT_ADMIN' and a.data->>'url' like '/user/%' order by 1"; done
  ```

  The root needs at least `/user/_search`, `/user/v1/_search`, `/user/_details`,
  `/user/users/_createnovalidate`, `/user/users/_updatenovalidate`,
  `/user/users/{id}/_updatenovalidate` and `/user/profile/_update`. Add missing
  role-actions using the root's **own** action id for each URL (ids differ between
  installs) and a new role-action id above the root's maximum. If the deploy log
  says the root "looks like a truncated bootstrap",
  `./deploy.sh <tenant> -e repair_tenant_masters=true --tags master-repair,notifications`
  copies all missing role-actions from `pg` and re-runs the notification seed, which
  failed on the truncated root; review the list first.
- **Configurator workspace routes.** The migration
  `V20261022000000__workspace_route_grants.sql` grants `ACCOUNT_ADMIN`
  `/pgr-services/v2/onboarding/workspaces/_search`, `_update` and `_rename`.
  Without them the admin gets `AccessDeniedException` after picking the workspace.
  It runs only once the `db-migrations` image is rebuilt (§4). If an unrelated
  action already holds id 900000, 900001 or 901000 at the root, it skips that route;
  add it by hand from `backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json`.
  Don't add an `eg_pgr_onboarding_workspace` row for the root.
- **Role-action cache.** `egov-accesscontrol` caches role-actions for 15 minutes.
  Wait, or restart it, after any change above.
- **Mobile number rule.** Citizen sign-in checks numbers against the root's
  `MobileNumberValidation` rule. Exactly one current rule must be the default.
- **Google for Configurator admins (optional).** `identity_signin_methods` sets the
  Configurator's methods only. The employee app stays on email and password: the
  deploy doesn't set its methods. To offer Google in the Configurator, set
  `keycloak_google_client_id` in host_vars, `keycloak_google_client_secret` in
  OpenBao, add `google` to `identity_signin_methods`, and add
  `https://<domain>/auth/realms/digit/broker/google/endpoint` to the Google OAuth
  client's redirect URIs before the deploy (the deploy prints this URI). Keycloak
  hides or shows a provider for the whole realm, so the Keycloak-hosted employee
  login page can then show a Google button that the employee app doesn't support.

### 2.4 nginx on a hand-maintained vhost

With `nginx_preserve_vhost: true` the deploy leaves the site file alone, so you
must add:

- the tenant rewrite `^/<slug>/digit-ui/(.*)$ → /digit-ui/$1`;
- the guard that redirects or 404s a tenantless `/digit-ui/<page>`;
- `/auth/realms/` and `/auth/resources/` to Kong, ahead of any Novu `/auth/` paths;
- `/identity/v1/` to Kong (a catch-all `location /` to Kong covers it).

Either switch to the template (`templates/nginx-site.conf.j2`): render it, diff it
against the live vhost, move custom routes into host_vars, and set
`nginx_preserve_vhost: false`. Or hand-edit:

```nginx
location ^~ /auth/realms/    { proxy_pass http://127.0.0.1:18000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; proxy_buffer_size 64k; proxy_buffers 8 64k; }
location ^~ /auth/resources/ { proxy_pass http://127.0.0.1:18000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; proxy_buffer_size 64k; proxy_buffers 8 64k; }
location = /digit-ui { return 302 /<slug>/digit-ui/; }
location ~ "^/([a-z0-9-]{2,63})/digit-ui$" { return 302 /$1/digit-ui/; }
location ~ "^/[a-z0-9-]{2,63}/digit-ui/(.*)$" { rewrite "^/[a-z0-9-]{2,63}/digit-ui/(.*)$" /digit-ui/$1 last; }
# first line inside location /digit-ui/ (and location = /digit-ui/public-dashboard):
if ($request_uri ~ "^/digit-ui/(?![^?]*[.](?:js|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|eot)(?:[?]|$))") { return 302 /<slug>$request_uri; }
```

Then remove:

- `/citizen`, `/citizen/assets/` and `/token-exchange/`;
- any `location /identity/` that goes straight to the BFF port;
- a `location /auth/` that goes straight to Keycloak, and root-level `^~ /realms/`,
  `^~ /resources/` and **`^~ /admin/`** (that last one exposes the Keycloak admin
  console).

Keep `^~ /auth/sign-in`, `/auth/sign-up` and `/auth/organization-list` if they go
to a Novu dashboard.

Stage the new file and swap it in just before the deploy (`nginx -t`, then
reload); removing the old routes earlier breaks 2.12 sign-in. Disable other vhosts
on the server that still proxy to Keycloak or `token-exchange-svc`.

### 2.5 Citizen one-time codes

`phone_otp` needs one delivery channel. Without one, the citizen login offers no
phone sign-in, so citizens can't sign in, and the deploy only warns.

| Setting | What it does | Use |
|---|---|---|
| `identity_dev_fixed_otp: true` | Accepts `123456` for any number | Demo and test only: anyone can sign in as any citizen. **Never on production.** |
| `identity_citizen_otp_sender: http` | The BFF POSTs `{phone, code, purpose, tenantId, locale, expiresIn}` to `IDENTITY_OTP_SENDER_URL` | With an SMS gateway. The URL needs a compose overlay; host_vars doesn't set it yet. |

`enable_otp_services: true` is **not** a channel for these codes. It starts
DIGIT's older OTP services, which the BFF never calls, and it hides the deploy's
"no OTP channel" warning.

On production, test the chosen channel with a real phone before the cutover.

### 2.6 Configurator signup (optional)

Signup lets a new organisation create its own workspace. Existing staff and admins
don't need it. It stays off only if you set `identity_signup_methods` as in 2.2;
the deploy's default turns it on. To turn it on with email links:

```yaml
identity_signup_methods: [magic_link]
identity_magic_link_enabled: true     # both lines are needed
```

Run a full `./deploy.sh <tenant>` (a `--tags` run skips the identity tasks). Check
`curl -s 'https://<domain>/identity/v1/auth-methods?intent=signup'` lists
`magic_link` and nothing you didn't intend. Adding `google` or `github` lets any
account at that provider sign up. Each completed signup creates a new root
workspace, so decide whether you want that on this install.

---

## 3. Keycloak 24 → 26.7.3

The deploy does this:

1. The `keycloak` service moves to the `identity-keycloak` image on the **same**
   `keycloak-postgres` database, which is migrated in place (one-way, 1.3).
2. Once Keycloak is healthy, the deploy creates the `digit` realm, its clients,
   themes and SMTP. Re-running the deploy re-applies it.
3. The old realm stays as it was. Nothing reads it. Delete it once rollback is no
   longer needed.
4. `token-exchange-svc` keeps running as an orphan. Remove it after step 6.

Inside the container Keycloak serves at the root path. For `kcadm.sh` use
`--server http://127.0.0.1:8180` from inside `keycloak`, not `…/auth`.

Check, once the deploy (§4) has run:

```bash
curl -fsS https://<domain>/auth/realms/digit/.well-known/openid-configuration >/dev/null && echo realm-ok
curl -fsS 'https://<domain>/identity/v1/auth-methods?intent=signin'
docker exec identity-bff wget -qO- http://127.0.0.1:3000/readyz
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: <domain>' http://127.0.0.1:18000/auth/admin/   # must be 404
```

---

## 4. Deploy

```bash
cd /opt/ccrs && git fetch origin && git checkout <master commit>
cd local-setup/ansible && setsid ./deploy.sh <tenant> > /var/log/deploy-v220-$(date -u +%Y%m%dT%H%MZ).log 2>&1 &
```

Order inside the deploy: preflight → secrets → stack up (Keycloak migrates here) →
container-health check → identity setup (SMTP check, realm, Organization) →
validation → notification seed. Every task is idempotent: fix a blocker (4.1) and
run it again. Read the end of the log for `ACTION:` lines; each needs follow-up.

Then **rebuild the MDMS migrations image**. The deploy reuses the image built on
the box, so the 2.20 `egov-mdms` migrations (including the workspace routes in
2.3) don't run until it is rebuilt:

```bash
cd /opt/digit
COMPOSE_PROFILES=<profiles> docker compose <-f files> build db-migrations
COMPOSE_PROFILES=<profiles> docker compose <-f files> up --no-deps db-migrations
```

Use the profiles and `-f` files the deploy uses (`docker-compose.egov-digit.yaml`,
`docker-compose.migrations.yml`, your overlay, and any others in host_vars). Link
users (§5) only after this: without the workspace routes, an admin who picks the
workspace in the Configurator gets `AccessDeniedException`.

Also:

- **One build for the PGR and notification images**: pgr-services, novu-bridge and
  user-preferences, with their `-db` images, share one tag. `image_tag` covers this.
  See the [notifications migration](notifications/migration.md#1-take-all-four-images-from-one-build).
- **Notification configuration** moves to the `NOTIFICATIONS.*` masters in a
  separate, per-tenant step (`migrate-notifications.py plan` / `apply`). The 2.12
  configuration keeps working until then.

### 4.1 Known blockers on an existing install

Master handles the three that earlier upgrades hit
([#2703](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/2703),
merged as `57951804f2`). Deploy a commit that includes it.

1. **The 2.12 `user_preference` table.** The 2.12 service created it without
   Flyway. `db-history-normalize` now adopts it instead of aborting (log:
   `adopted digit-user-preferences-service`), and the migrator then baselines and
   applies `V20260205120000`, which keeps the rows and removes duplicates. A
   populated table of any other service without Flyway history still aborts the
   deploy.
2. **"novu tenant accounts — move the Novu admin off the legacy password"** no
   longer fails with `422` (`environmentId should not be empty`). If it still
   fails, `novu_tenant_accounts: false` skips it; per-tenant Novu organisations
   then stay off.
3. **The container-health check** reports an unhealthy observability container
   (`validate_health_warn_only`: Tempo, Loki, Promtail, Prometheus, Grafana, the
   OTel collector and the node and Postgres exporters) as an `ACTION:` line and
   carries on. Any other unhealthy container still fails it, and everything after
   it is skipped, including the Keycloak realm setup.

The notification seed no longer grants permissions on unrelated endpoints when an
install's action ids differ (fixed in
[#2603](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/2603)).
It now places colliding actions at new ids and prints `ACL-ID-COLLISION` lines;
these are informational.

---

## 5. Existing users

Everything here needs the 2.20 stack: the BFF on `:18400`, its jobs and the
Configurator's employee screens don't exist on 2.12. Do it after §4, including the
`db-migrations` rebuild. Only collecting emails comes earlier (1.1).

### 5.1 Staff

An employee can sign in once linked: a Keycloak user with their email, a
membership in the root's Organization, and a binding to their existing DIGIT
account (same uuid, roles and complaints).

- **Every active employee needs an email** (collected in 1.1). Without one they
  can't be linked.
- **Don't link service accounts.** Linking replaces the DIGIT password with one
  only the BFF knows. Leave out `identity_digit_admin_username`, the PGR
  provisioner, `ADMIN`, and any account that scripts, MCP or integration tests use.
- **City-tenant staff** can't be linked (§0).
- If the deploy reports `SLUG_TAKEN` or `ALIAS_TAKEN` for the root's Organization,
  a test signup already holds that slug. Fix it before linking anyone.

**First admin.** Linking needs an admin who is already linked, so link the first
one through the BFF's internal API (loopback only):

1. Create a person's account at the root with `ACCOUNT_ADMIN`, `HRMS_ADMIN`,
   `MDMS_ADMIN`, `LOC_ADMIN`, `EMPLOYEE` and `SUPERUSER`.
2. Create their Keycloak user in realm `digit` with `kcadm.sh`
   (`emailVerified=true`) and set a password.
3. Link and activate:

   ```bash
   CP=$(docker exec identity-bff printenv IDENTITY_CONTROL_PLANE_TOKEN)
   curl -s -X POST http://127.0.0.1:18400/internal/identity/v1/account-links/_link \
     -H "Authorization: Bearer $CP" -H 'Content-Type: application/json' \
     -d '{"actor":"v220-migration","links":[{"email":"<admin email>","tenantId":"<root>","digitUserName":"<code>","userType":"EMPLOYEE"}]}'
   docker exec identity-bff node dist/modules/jobs/convert-account-links.js   # expect "converted":1
   ```

**Everyone else.** Signed in to the Configurator as that admin, link each employee
from People › Employees, or script
`POST /identity/v1/workspace-members/_link {tenantId, digitUuid, email}` with the
session cookie. Each person gets a password-setup email.

- **Tell staff where to sign in:** `/<slug>/digit-ui/employee`, with their email.
  The setup email returns to the Configurator sign-in, which refuses staff
  without an admin role and links them to the employee app
  ([#2611](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2611)).
- **Setup links expire after 15 minutes.** If you hand them out from a mail
  catcher, resend at hand-out time ("Resend email", or `_link` with
  `resend: true`), or have the person use "Forgot password?". Open links in a
  private window: a browser signed in as someone else gets
  `different_user_authenticated`.
- **No email?** A synthetic address such as `<code>@staff.<domain>` works with a
  mail catcher. The Keycloak username stays that address even after a later email
  change (5.5), so pick a scheme you will keep.

### 5.2 Citizens

Nothing to do in advance. At first phone sign-in the BFF finds the DIGIT account by
phone number:

- **one match:** same account and complaints;
- **two active accounts:** `CITIZEN_ACCOUNT_AMBIGUOUS` until one is deactivated
  (fix the duplicates from 1.1 first);
- **no match:** a new account, without the old complaints. This can also happen
  when the stored phone is under another tenant's key (5.4).

### 5.3 Citizens who used Google

They sign in with their phone number instead. If their DIGIT account has that
number, 5.2 applies; if not, they get a new account. Tell them before the change.

### 5.4 Encryption keys

egov-user reads users with the **request tenant's** key, as in 2.12.

- Every tenant needs an active row in `eg_enc_symmetric_keys`, or user and HRMS
  writes fail with "Unknown error occurred in encryption process".
  `POST /egov-enc-service/crypto/v1/_generatekey {"tenantId": "<t>"}` creates a
  missing one and is safe to repeat.
- Rows whose `username` prefix is another tenant's key id can't be found by login
  or by phone. Re-encrypt them under the right key; don't rotate keys.

### 5.5 From a mail catcher to real email

Nobody is re-linked; passwords, roles and history stay.

1. Point the realm at a real relay (2.2) and run a full deploy. From now on mail
   to synthetic addresses bounces, so don't link or reset anyone at one.
2. Change each employee's address: Configurator › Employees › edit, or
   `POST /identity/v1/workspace-members/_updateEmail {tenantId, digitUuid, email}`
   (`202`). Keycloak emails a verification link; DIGIT's `emailid` updates when
   it's clicked.
   - `403 ADMIN_EMAIL_CHANGE_NOT_ALLOWED`: the person is you, holds an admin role
     you don't, has a citizen account or verified phone, or is in another
     workspace. They change it themselves under Account › Change email.
   - `409 IDENTITY_EMAIL_CHANGED`: another user has that address.
3. For staff who never set a password, resend setup to the new address at least
   60 seconds after the change.
4. Check `GET /identity/v1/workspace-members?tenantId=<root>&state=active` lists no
   synthetic addresses, then remove the catcher and its nginx route.

---

## 6. Verify

| Who | Check | Expected |
|---|---|---|
| Platform | Realm well-known, `/identity/v1/auth-methods`, BFF `/readyz` | OK |
| Platform | `/auth/admin/` and `/auth/realms/master/protocol/openid-connect/token` through Kong (step 3) | 404 |
| Platform | `/identity/v1/auth-methods?intent=signup` | No methods, unless you turned signup on (2.6) |
| Platform | `/digit-ui/employee` | 302 to `/<slug>/digit-ui/employee` |
| Admin | Configurator sign-in, pick the root workspace | Management console |
| Admin | Link a test employee with a real mailbox | Setup email arrives |
| Employee | Set password, sign in at `/<slug>/digit-ui/employee` | Inbox with their roles and old complaints |
| Employee | "Forgot password?" | Reset email arrives |
| Citizen | Phone + code at `/<slug>/digit-ui/citizen` | Existing account and complaints |
| Citizen | File, assign and resolve a complaint | Each step works; notifications go out |
| Service accounts | Integration tests, MCP, scripts using `/user/oauth/token` | Still sign in |

Then:

- Remove `token-exchange-svc`, any old identity-bff container, and their nginx routes.
- Clear Gatus checks that 2.20 switched off: they keep their last red result
  ([#2549](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2549)).
- Re-enable scheduled deploys (1.2), pointed at the 2.20 commit.

---

## 7. Rollback

Decide in advance who calls it. Once users have linked accounts or filed
complaints, rolling back loses that work.

1. Stop scheduled deploys.
2. `cd /opt/digit && docker compose … down --remove-orphans`. **Never** `-v`.
3. Check out the old commit in `/opt/ccrs`; restore host_vars, the compose overlay,
   the vhost and `.env` from backup 4; reload nginx.
4. **Keycloak:** restore backup 2 with only `keycloak-postgres` running. Keycloak
   itself stays stopped until step 8 starts the 24 image; never start 24 on the
   migrated database.

   ```bash
   cd /opt/digit && docker compose -f docker-compose.egov-digit.yaml up -d --no-deps keycloak-postgres
   until docker exec keycloak-postgres pg_isready -U keycloak -q; do sleep 2; done
   docker exec keycloak-postgres psql -U keycloak -d postgres -v ON_ERROR_STOP=1 \
     -c 'DROP DATABASE keycloak' -c 'CREATE DATABASE keycloak OWNER keycloak'
   docker exec -i keycloak-postgres pg_restore -U keycloak -d keycloak --exit-on-error < $BK/keycloak-24.dump
   KQ "select version from migration_model order by update_time desc limit 1"   # KQ from 1.1; 24.0.x again
   ```
5. **Main database:** restore backup 1 only if the 2.12 services won't start on the
   2.20 schema. It discards everything since the backup.
6. **OpenBao:** the deploy only added keys. Restore backup 3 only if something else
   changed.
7. **Novu:** if the deploy rotated the Novu admin, 2.12.1 can't sign in to Novu
   unless host_vars pins `novu_api_key` or sets `novu_admin_password` to the value
   now in OpenBao. Or restore backup 6 with Novu stopped. Then follow the
   [notifications rollback](notifications/migration.md#rollback).
8. `./deploy.sh <tenant>` on the old commit. Check staff and citizen sign-in.

Linked employees' DIGIT passwords were replaced; without a main-database restore,
reset them in egov-user. Emails already sent can't be recalled.

---

## 8. Open questions

| Question | Why it matters |
|---|---|
| What phone number did the old citizen Google flow store? | Google citizens may get a new, empty account |
| Is there an SMS gateway endpoint for the `http` sender, and does it deliver to a real phone? | Without one, citizens can't sign in |
| How does an existing root get 2.20's new masters and labels? | Raw keys or missing screens |
| Do 2.12 services start on a database 2.20 has migrated? | Decides whether rollback needs a restore |
| Does the WhatsApp chatbot create citizens through Kong, where `/user/citizen/_create` is closed? | Chatbot complaints may stop |
| How do scheduled integration-test runs sign in after the upgrade? | Nightly results fail for the wrong reason |
