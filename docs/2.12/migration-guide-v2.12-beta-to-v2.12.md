# Upgrade Guide — v2.12-beta → v2.12

For a deployment already running **v2.12-beta**. Follow the steps in order.

Coming from v2.11 or earlier? Use
[migration-guide-v2.11-to-v2.12.md](migration-guide-v2.11-to-v2.12.md) instead.

> ### Substitute your own values first
>
> Every command below uses placeholders. **Replace them before running
> anything** — nothing here is copy-paste ready as written.
>
> | Placeholder | Meaning |
> |---|---|
> | `<tenant_id>` | your state-level tenant id, and the `host_vars` file name |
> | `<city_tenant_id>` | your city-level tenant id, usually `<tenant_id>.<city>` |
> | `<postgres>` | your Postgres container name |
> | `<user_id>` | numeric id of the admin user, found in step 8.1 |
>
> Find them with:
>
> ```bash
> ls local-setup/ansible/inventory/host_vars/*.yml               # your tenants
> grep -E '^(state_root|state_tenant_id|tenant_id):' \
>   local-setup/ansible/inventory/host_vars/<tenant_id>.yml      # the tenant ids
> docker ps --format '{{.Names}}' | grep -i postgres             # the container
> ```

---

## What you need to do

| | Step |
|---|---|
| 1 | Turn **off** the DB fast-path flags |
| 2 | Back up |
| 3 | Check out `v2.12` |
| 4 | Deploy |
| 5 | Confirm the two schema migrations |
| 6 | Load the seed data with Postman *(not automatic)* |
| 7 | Apply the JBAC policy *(one SQL statement)* |
| 8 | Map admin roles, restart accesscontrol, flush Redis, re-login, refresh Grafana |
| 9 | Verify |

Most of the upgrade is automatic. **Steps 6–8 are the parts nothing does for
you** — and skipping step 8 is why a correct data load still shows no change
in the UI.

---

## 1. Turn off the DB fast-path flags

In `host_vars/<tenant_id>.yml`:

```yaml
db_fast_path: false          # MUST be false for an upgrade
# db_fast_path_ack_data_wipe:  ← delete this line
```

These are **first-deploy-only**. Left on, the overlay corrects the Postgres
volume path, forces the container to be recreated into an empty PGDATA, and
`initdb` replays the seed dump *over your data*. With them off the overlay is
never layered and the migrators run against your existing database.

`db_fast_path` defaults to false, so a tenant that never opted in needs no
change — but a tenant first stood up with the fast-path still has `true` in its
`host_vars`.

---

## 2. Back up

```bash
docker exec <postgres> pg_dump -U egov -d egov | gzip > egov-preupgrade.sql.gz
cp /opt/digit/.env .env.preupgrade
```

Optional tripwire — if this row is gone afterwards, the database was
reinitialised:

```sql
create table if not exists zz_sentinel(id int primary key, note text);
insert into zz_sentinel values (1,'pre-upgrade') on conflict do nothing;
```

---

## 3. Check out v2.12

```bash
git fetch --tags
sudo find . -user root -exec chown -h $(id -u):$(id -g) {} +   # deploys leave root-owned build output
git checkout -- digit-ui-esbuild/node_modules                  # npm replaces a tracked symlink
git checkout v2.12
git submodule update --init --recursive local-setup/ansible/nairobi-mdms
```

The `chown` / `checkout --` lines are only needed if a previous deploy ran on
this checkout; without them `git checkout` aborts.

---

## 4. Deploy

```bash
cd local-setup/ansible
./deploy.sh <tenant_id>
```

**Check the PLAY RECAP for `failed=0` — `deploy.sh` exits 0 even when a task
fails.**

You will most likely see `failed=1` on `mcp-bootstrap — fail if any seed step
reported failures`. That is a re-deploy issue, not something this upgrade
introduces: the tenant is already bootstrapped, re-creating its encryption key
returns 401, and MDMS writes are then denied. A GA→GA re-deploy fails
identically. Setting `tolerate_bootstrap_failures: true` moves the failure to
`post-bootstrap — re-provision ADMIN…` rather than removing it.

Everything that matters still completes — images, migrations, `.env`, Grafana —
because the failing task is at the end of the play.

Images you should see afterwards:

| tag | images |
|---|---|
| `2.12-5137119` | `pgr-services`, `digit-config-service`, `digit-user-preferences-service`, `novu-bridge`, `xstate-chatbot`, `configurator`, `digit-ui-esbuild` (+ each `-db`) |
| `2.12-81fc6be` | `digit-ui-v2`, `otp-publisher`, `digit-mcp` |
| — | `egov-accesscontrol:abac-changes-cb6a372` ← new, required by jurisdiction scoping |

---

## 5. Confirm the two schema migrations

```sql
select version, description from pgr_services_schema      where version='20260810000000';
select version, description from egov_mdms_schema_version where version='20260827000000';
```

```
20260810000000 | tenant business calendar grains        -- per-tenant report time zones
20260827000000 | uiconstants recode from reopensla key  -- makes the reopen window editable
```

History tables are **per service** (`<service>_schema`); there is no single
`flyway_schema_history`.

The timezone migration falls back to `Africa/Nairobi` where no
`dss.DashboardConfig.timeZone` is set, so an unconfigured tenant's reports are
unchanged. Set `timeZone` *before* upgrading if you want per-city grouping.

---

## 6. Load the seed data (Postman)

**This is the step people miss.** `full-dump.sql` only loads at Postgres
`initdb`, so an upgrade never replays it. Your tenant keeps beta's data, and a
city tenant — populated by copying *from* the state root — inherits the same
stale set. Re-running the bootstrap cannot fix it.

Verified on an upgraded box: **0 of the 729 new access-control rows were
present.**

The delta is **742 records**, taken row-by-row from `full-dump.sql` at
`v2.12-beta` vs `v2.12`:

| master | records |
|---|---|
| `ACCESSCONTROL-ROLEACTIONS.roleactions` | 582 |
| `ACCESSCONTROL-ACTIONS-TEST.actions-test` | 147 |
| `RAINMAKER-PGR.RejectionReasons` | 5 *(absent entirely on an upgraded box)* |
| `ACCESSCONTROL-ROLES.roles` | 3 |
| `common-masters.Department` | 2 |
| `common-masters.MobileNumberValidation` | 1 *(absent entirely)* |
| `RAINMAKER-PGR.UIConstants` | 1 |
| `tenant.citymodule` | 1 |

Within those sit the nine `/pgr-services/v2/analytics/*` actions (`2640`–`2648`)
and their grants across 11 roles — which is why reporting stays invisible until
you run this.

**Generate the data file for your tenant first.** Several masters carry their
own `tenantId` *inside* the record, so a file built for one tenant cannot be
loaded into another — the generator rewrites those references:

```bash
cd local-setup/postman
python3 generate-seed-data.py --tenant <tenant_id>
# -> ga-upgrade-seed-load.data.<tenant_id>.json
```

Then run the collection, **in folder order**:

```bash
newman run ga-upgrade-seed-load.postman_collection.json \
  -d ga-upgrade-seed-load.data.<tenant_id>.json \
  --env-var url=http://localhost:18000 \
  --env-var mdmsUrl=http://localhost:18094 \
  --env-var username=ADMIN --env-var password='eGov@123' \
  --env-var stateTenant=<tenant_id> --env-var cityTenant=<city_tenant_id>
```

`npm i -g newman` if needed, or import both files into the Postman GUI and
attach the data file under **Runner → Data**.

| folder | what it does |
|---|---|
| **00** | Counts what you have before loading, via `/mdms-v2/v2/_count` |
| **05** | Creates the one new schema definition. **Must run before 10** |
| **10** | Loads all 742 records. Re-running is safe; duplicates pass |
| **20** | Re-counts to confirm |
| **30** | **Expected to fail** — see step 7 |

Folder 05 is not optional: GA adds one schema definition
(`RAINMAKER-PGR.RejectionReasons`), and mdms-v2 rejects data for a schema it
does not know with `400 SCHEMA_DEFINITION_NOT_FOUND_ERR`. Skip it and five
records fail.

Two more things worth knowing: writes go **direct to mdms-v2** (`18094`), not
Kong, because mdms-v2 authorises per schema and Kong returns `403` for schemas
with no matching action — the same approach `enable-dashboard.sh` takes. And the
data file is ordered actions → roles → grants, since a grant referencing a
missing action is inert.

Measured on a test tenant: folder 05 one request, folder 10 **742/742**,
folder 20 nine checks, all passing. Counts moved `actions-test` 246 → 392, `roleactions`
368 → 945, `roles` 22 → 25, `RejectionReasons` 0 → 5.

---

## 7. Apply the JBAC policy

GA seeds a working jurisdiction-based access control policy; beta has none. It
lives on the action whose `id` is `2008` (`/pgr-services/v2/request/_search`),
and **cannot be added through the API** — `actions-test` declares
`x-unique: ["id"]` and mdms-v2 rejects any update touching a unique field
(`400 UNIQUE_KEY_UPDATE_ERR`).

Apply it with SQL. mdms-v2 reads live, so no restart is needed:

```sql
update eg_mdms_data
   set data = jsonb_set(data::jsonb, '{resource}',
         '{"complaint":{"scope":{
             "axes":["department","jurisdiction"],
             "roleScopes":{
               "GRO":        {"department":"OWN","jurisdiction":"OWN"},
               "PGR_LME":    {"department":"OWN","jurisdiction":"OWN"},
               "SUPERVISOR": {"department":"OWN","jurisdiction":"ALL"}},
             "default":{"department":"ALL","jurisdiction":"OWN"}}}}'::jsonb, true)
 where schemacode='ACCESSCONTROL-ACTIONS-TEST.actions-test'
   and data->>'id'='2008'
   and tenantid='<tenant_id>';          -- ← CHANGE THIS to your tenant
```

Run it inside the container, substituting your own values:

```bash
docker exec -i <postgres> psql -U egov -d egov <<'SQL'
-- paste the update above, with tenantid set to YOUR state root
SQL
```

Check it landed — `has_scope` should be `t` for your tenant:

```sql
select tenantid, data ? 'resource' as has_scope
  from eg_mdms_data
 where schemacode='ACCESSCONTROL-ACTIONS-TEST.actions-test'
   and data->>'id'='2008';
```

Then mirror it into your fork's
`ansible/nairobi-mdms/mdms/ACCESSCONTROL-ACTIONS-TEST/actions-test.json`, or the
next deploy drifts back.

JBAC is **safe-by-default**: skip this step and every role keeps seeing
everything, exactly as on beta. Nothing breaks — you just don't get the feature.
Scoping reads from each employee's HRMS jurisdiction and department assignments,
so both must be set for it to do anything.

> `nairobi-mdms` and `full-dump.sql` disagree on one value — `GRO` is
> `department: OWN` in the former, `ALL` in the latter. The SQL above uses the
> `nairobi-mdms` value. Pick one deliberately.

---

## 8. Make the changes take effect

Loading data is not enough — several caches hold the old picture. This is why
the UI still looks unchanged after step 6.

### 8.1 Map the admin's roles

Roles live in MDMS, but the **user→role mapping** lives in `eg_userrole_v1`, and
a failed bootstrap can leave the admin short of roles it should have. The
configurator needs **`ACCOUNT_ADMIN`**; without it the admin logs in but the
console's own screens 403.

Check what your admin actually holds:

```sql
select r.role_code
  from eg_userrole_v1 r
 where r.user_tenantid='<tenant_id>'          -- ← your tenant
 order by r.role_code;
```

The playbook's bootstrap admin is meant to hold `SUPERUSER`, `EMPLOYEE`,
`ACCOUNT_ADMIN`, `LOC_ADMIN` and `MDMS_ADMIN`. Add any that are missing — find
the user id first, then insert:

```sql
-- the bootstrap admin is the user holding SUPERUSER on your tenant
select u.id, u.uuid from eg_user u
  join eg_userrole_v1 r on r.user_id = u.id
 where u.tenantid='<tenant_id>' and r.role_code='SUPERUSER';

insert into eg_userrole_v1 (role_code, role_tenantid, user_id, user_tenantid, lastmodifieddate)
select 'ACCOUNT_ADMIN', '<tenant_id>', <user_id>, '<tenant_id>', now()
 where not exists (select 1 from eg_userrole_v1
                    where user_id=<user_id> and role_code='ACCOUNT_ADMIN'
                      and role_tenantid='<tenant_id>');
```

Repeat for `LOC_ADMIN` / `MDMS_ADMIN` if absent. `MDMS_ADMIN` in particular is
what lets the admin write MDMS *through Kong* — without it you are stuck going
direct to `18094` as in step 6.

> `eg_role` is empty on these deployments; role *definitions* come from the
> `ACCESSCONTROL-ROLES.roles` MDMS master, which step 6 loads. Confirm the role
> exists there before mapping it.

### 8.2 Restart accesscontrol, then FLUSH Redis

```bash
cd /opt/digit
# 1. clear the in-process action cache   (compose SERVICE name, not container name)
sudo docker compose <your -f flags> restart egov-accesscontrol

# 2. invalidate every existing session token
docker exec digit-redis redis-cli FLUSHALL
```

Two different caches, and they need two different actions:

- **`egov-accesscontrol`** caches role-actions in-process with **cache2k**
  (`cache2k starting` appears in its startup log). There is no external
  invalidation endpoint, so newly loaded actions and grants are not picked up
  until the JVM restarts. This is what makes step 6's data visible at all.
- **Redis** is the oauth token store (`access:<token>`,
  `access_to_refresh:*`, `uname_to_access:egov-user-client:<USER>`). A token
  resolves to the permission snapshot from when it was minted, so sessions keep
  their old rights until it is gone.

> **Restarting Redis is not enough — it does not clear the tokens.** Redis runs
> with RDB snapshotting on (`save 3600 1 300 100 60 10000`), so a `restart`
> reloads the same keys from disk: verified, 18 keys before and 18 after, the
> same `access:*` entries. You need `FLUSHALL` (or the narrower
> `enable-dashboard.sh --only step6`, which clears just the token store).

Verified on a live box: after `FLUSHALL` the old token returns **401**, a freshly
minted one returns **200**, and it carries the newly mapped role —
`['ACCOUNT_ADMIN', 'CITIZEN', 'CSR', 'DGRO', 'EMPLOYEE', 'GRO', …]`.

Note the compose **service** names differ from container names: the service is
`redis`, the container is `digit-redis`. `restart digit-redis` fails with
`no such service`.

### 8.3 Have users log out and back in

Even after both restarts, a browser session holds its own copy of the action
list. A logged-in user keeps the old menu and the old 403s until they
re-authenticate. Tell them explicitly — this is the most common reason a
correct load looks broken.

For localisation changes, a Redis `DEL` is not enough; the service holds its own
cache. Use `POST /localization/messages/cache-bust`.

---

### 8.4 Pick up the new Grafana dashboards

GA adds five dashboards — `kong-gateway`, `postgres`, `redpanda-broker`,
`kafka-consumer-lag`, `pgr-analytics` — for **9** in total.

They arrive automatically in the normal case. The chain is:

```
local-setup/otel/grafana/provisioning     (repo)
   → rsync by the deploy →  /opt/digit/otel/grafana/provisioning
   → bind mount →           /etc/grafana/provisioning   (in the container)
   → re-scanned every 30s   (updateIntervalSeconds: 30)
```

So a deploy plus 30 seconds is usually enough. Confirm with:

```bash
curl -s -u admin:<grafana_password> \
  'http://127.0.0.1:13000/api/search?type=dash-db&limit=50' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d),"dashboards"); [print(" -",x["title"]) for x in d]'
```

If fewer than 9 appear:

1. **Check the deployed copy matches the repo** — the rsync is the step that
   usually hasn't happened:
   ```bash
   diff -rq local-setup/otel/grafana/provisioning/dashboards \
            /opt/digit/otel/grafana/provisioning/dashboards
   ```
2. **Force an immediate provisioning pass** by restarting Grafana (the service
   is `grafana`, the container is `digit-grafana`):
   ```bash
   cd /opt/digit && sudo docker compose <your -f flags> restart grafana
   ```
   Verified: after a restart all 9 are present and the log shows a second
   `starting to provision dashboards`.

Two things that surprise people here:

- **You cannot delete these in the UI.** They are provisioning-managed, so the
  API answers `"provisioned dashboard cannot be deleted"`. To genuinely reset
  one, fix the file and let provisioning re-apply. To reset *everything*, remove
  the `digit_grafana_data` volume — which also discards any dashboards your team
  created by hand, so take them out first.
- **`allowUiUpdates: true` is set**, so a dashboard edited in the Grafana UI
  keeps those edits and Grafana will not clobber them from the file. That is the
  usual reason a dashboard "won't take the latest" on a long-lived box. Note
  `pgr-analytics.json` ships with **no `version` field** at all, which makes its
  update behaviour the least predictable of the nine — worth raising upstream.

> **The Grafana admin password may not be what your `.env` says.**
> `GF_SECURITY_ADMIN_PASSWORD` is applied only when Grafana **initialises its
> database**. On an upgraded box the volume already exists, so changing it in
> `.env` has no effect and the original password stays in force. Measured here:
> the container had `GF_SECURITY_ADMIN_PASSWORD` set to a strong value, yet
> `admin:admin` authenticated and the configured value returned 401. Check
> before assuming it is set, and reset it explicitly if it matters:
> ```bash
> docker exec -it digit-grafana grafana-cli admin reset-admin-password '<new>'
> ```

---

## 9. Verify

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep egovio     # GA tags
docker exec <postgres> psql -U egov -d egov -c "select count(*) from zz_sentinel;"
```

1. Migrations from step 5 both present.
2. Postman folder 20 shows the counts grew (e.g. actions-test 246 → 393).
3. Log in **fresh** as a reporting role; the dashboard appears.
4. Editing the reopen window no longer returns `400 UNIQUE_KEY_UPDATE_ERR`.
5. Grafana provisions 9 dashboards, including `kong-gateway`, `postgres`,
   `redpanda-broker`, `kafka-consumer-lag`, `pgr-analytics`. A new
   `postgres-exporter` container feeds the Postgres one.

---

## Rolling back

Images are easy — repin the beta tags and redeploy. The two migrations are
**not** reversible, and the loaded MDMS rows persist. Rolling back properly
means restoring the step 2 dump, which is why step 2 is not optional.

---

## Configuration

`_example.yml` gained 62 optional settings since beta, all defaulting, so a
`host_vars` carried over unchanged still deploys. Diff yours against
`local-setup/ansible/inventory/host_vars/_example.yml` when you want a new knob.

Two settings were **removed** — delete them if present, as they now do nothing:

```
build_novu_bridge
build_pgr_services      # use pgr_services_image / novu_bridge_image instead
```

Worth setting deliberately: `bootstrap_user` / `bootstrap_password` (defaults
`ADMIN` / `eGov@123`), and `observability_level` (`metrics` | `logs` | `traces`,
cumulative, default `traces`).

---

## Known issues on an upgraded box

| Symptom | Cause |
|---|---|
| `failed=1` on `mcp-bootstrap` gate | Tenant already bootstrapped; see step 4. Not migration-specific |
| `tolerate_bootstrap_failures: true` still fails, on `post-bootstrap — re-provision ADMIN` | Flag suppresses the gate only. This failure is `no_log: true`, so its message is censored |
| `seed-tenant-city-data.py` → `403` on all `ComplaintHierarchy` writes | Writes via Kong; no action defined for those schemas anywhere in the repo |
| `enable-dashboard.sh` preflight → `analytics/catalog/_search 401`, then `preflight failed` | **False negative — the route is fine.** The probe runs before the script authenticates, so it is sent unauthenticated; Kong only whitelists `/v2/analytics/public/*`, so a healthy box answers 401. Confirm with `docker exec <pgr> sh -c 'unzip -l /opt/egov/*.jar \| grep -c analytics'` — non-zero means the route exists. Re-adding the token makes the same call return 200. Skip the check with `--from step1`, or patch the probe to accept 401/403 |

---

## Related

- [Release Notes v2.12](release-notes-v2.12.md) · [Known Issues](known_issues_2.12.md)
- [Jurisdiction-Based Access Control](jurisdiction-access-control.md) — what step 7 configures
- [Enabling Monitoring](../observability/enabling-monitoring.md) · [Operations Runbooks](operations/README.md)
