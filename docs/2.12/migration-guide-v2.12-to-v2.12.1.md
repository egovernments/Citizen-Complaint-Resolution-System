# Migration Guide: v2.12 → v2.12.1

**For:** servers deployed with Ansible (`local-setup/ansible`, stack under `/opt/digit`).
**Downtime:** all services restart during the redeploy, about 10–20 minutes.
**Release notes:** [release-notes-v2.12.1.md](release-notes-v2.12.1.md)

The security fixes are applied by **redeploying** with `./deploy.sh`. There are no manual, file-by-file steps. Run all server commands as root.

---

## 1. Before you start

### 1.1 Back up the database

```bash
docker exec docker-postgres pg_dumpall -U egov | gzip > /root/pg-backup-$(date +%F).sql.gz
ls -lh /root/pg-backup-*.sql.gz   # must not be empty
```

### 1.2 Back up the deployed configuration

The deploy **regenerates** the configuration files under `/opt/digit` and the host nginx and Docker settings. Any change made by hand on the server is overwritten.

```bash
BK=/root/config-backup-$(date +%F); mkdir -p $BK
cd /opt/digit && tar czf $BK/opt-digit-config.tgz --ignore-failed-read \
  --exclude=./.build --exclude=./ci-tests --exclude=./e2e-tests \
  .env docker-compose*.y*ml kong nginx configs otel gatus keycloak
for f in /etc/nginx/sites-available /etc/nginx/conf.d /etc/docker/daemon.json; do
  [ -e "$f" ] && cp -a "$f" $BK/
done
```

A `Cannot stat` warning for a directory the server does not have (for example `keycloak`) is expected; the backup still completes. `/etc/docker/daemon.json` exists only if the Docker data-root was relocated.

Find the hand-made changes by comparing the server files with the `v2.12` templates, for example:

```bash
diff /opt/digit/kong/kong.yml <your fork, before pulling v2.12.1>/local-setup/kong/kong.yml
```

Move each change into `inventory/host_vars/<tenant>.yml` if a setting exists for it. Otherwise note it down and re-apply it after the deploy (step 3).

### 1.3 Check image overrides

The 2.12.1 images are the defaults: pgr-services and its migrations, digit-mcp and digit-ui at `2.12.1-7a38661`, configurator at `2.12.1-6e8adb3`. Remove these from `inventory/host_vars/<tenant>.yml` if present, so the defaults apply:

`pgr_services_image`, `mcp_image`, `build_mcp: true`, `digit_ui_bundle_image`, `digit_ui_image`, `configurator_image`

`digit_ui_bundle_image` is the one that matters on most servers: it is the bundle served in the default `digit_ui_mode: static`. `digit_ui_image` is used only in container mode.

Also check the tenant's compose overlay, `local-setup/docker-compose.<tenant>.yml`, if it exists. The deploy applies it last, so an `image:` line there overrides the new default:

```bash
grep -n "image:" local-setup/docker-compose.<tenant>.yml
```

Remove any `image:` pin for pgr-services, pgr-services-db, digit-ui, configurator or digit-mcp.

### 1.4 Check where Postgres keeps its data

Only needed if host_vars has `db_fast_path: true`:

```bash
docker inspect docker-postgres --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
```

| Result | Action |
|---|---|
| `digit_postgres_data -> /var/lib/postgresql/data` | Set `db_fast_path_ack_data_wipe: true`. The deploy refuses to run without it; nothing is wiped. |
| A long 64-hex volume name on `/var/lib/postgresql/data` | **Stop.** Set `db_fast_path: false`, or first follow [postgres-volume-migration.md](operations/postgres-volume-migration.md). |

Never run `docker compose down -v`, `docker volume rm` or `docker volume prune`, and never use `force_clean: true` on a live server.

### 1.5 Keep automatic escalation off until step 6a

The new escalation scheduler must not run until the migration in step 6a is done. Check whether the tenant overlay turns it on:

```bash
grep -n "PGR_ESCALATION_ENABLED" local-setup/docker-compose.<tenant>.yml
```

If it shows `"true"` (the tracked `docker-compose.bomet.yml` does), change it to `"false"` in that file before redeploying. Edit only that line; the file holds other tenant fixes. Turn it back on in step 6b.

### 1.6 Disable legacy PGR escalation rows

2.12.1 refuses to escalate (manual or automatic) while an active PGR row remains in the generic `Workflow.AutoEscalation` or `Workflow.AutoEscalationStatesToIgnore` masters; it fails with `PGR_ESCALATION_CONFIG_CONFLICT`. Check for them:

```bash
docker exec docker-postgres psql -U egov -c "select tenantid, schemacode, uniqueidentifier from eg_mdms_data where schemacode in ('Workflow.AutoEscalation','Workflow.AutoEscalationStatesToIgnore') and isactive and (data->>'businessService' ilike 'PGR%' or data->>'module' ilike 'PGR%')"
```

If rows are returned, disable them through MDMS administration before the redeploy (preflight step 2 of the [escalation rollout guide](../migration/pgr-escalation-self-loop.md#preflight)). Non-PGR rows are not affected.

---

## 2. Redeploy

Deploy from your fork of the repository, after pulling the `v2.12.1` tag from upstream into it. On the controller, in your fork's checkout of the branch you deploy from:

```bash
git remote add upstream https://github.com/egovernments/Citizen-Complaint-Resolution-System.git   # once; skip if it exists
git fetch upstream --tags
git pull upstream v2.12.1
```

If the merge conflicts, keep your own version of tenant files (`inventory/host_vars/<tenant>.yml`, `docker-compose.<tenant>.yml`) and take upstream's version of everything else. Then check that the new defaults came in, and deploy:

```bash
grep -n "2.12.1-" local-setup/docker-compose.egov-digit.yaml   # pgr-services, digit-ui, configurator, digit-mcp
cd local-setup/ansible
./deploy.sh <tenant>
```

Optional settings in host_vars:

| Setting | Use it when |
|---|---|
| `manage_host_firewall: false` | A cloud security group or another firewall already manages incoming traffic. |
| `ufw_extra_allow_ports: [...]` | The server runs other inbound services (VPN, monitoring agent, extra SSH port). |
| `kong_cors_origins: [...]` | A browser app on another domain calls the API. |

What changes:
- The `ufw` firewall is switched on.
- Internal ports listen on `127.0.0.1` only. Reach them through an SSH tunnel, for example `ssh -L 15432:127.0.0.1:15432 <server>`.
- Calls without a token to the APIs and `/user/_search` return `401`. `/status/` and, where enabled, `/mcp` require a login.
- **Automatic escalation is switched off** (it was on in v2.12), provided step 1.5 was done. Turn it back on in step 6b.

> **Novu:** sign-up is now disabled. If `enable_novu: true` and Novu has no admin account yet, the deploy fails with `Account creation is disabled`. Set an existing key in `novu_api_key`, or set `enable_novu: false` for now.

---

## 3. Re-apply local changes

Re-apply only the changes from step 1.2 that could not go into host_vars. **Edit the new files; do not copy the old files back**, as that undoes the security fixes.

- Kong: edit `/opt/digit/kong/kong.yml` in place, for example with `nano`, then `docker exec kong-gateway kong reload`. It is a single-file mount, so don't use `sed -i` or `mv`: they replace the file, and the container keeps reading the old one.
- nginx: `nginx -t && systemctl reload nginx`.
- compose or `.env`: `docker compose up -d <service>`.

Do not bind ports to `0.0.0.0` again, set Kong `origins: '*'`, or remove login from Kong, `/mcp` or `/status/`.

---

## 4. Verify

Use `http://` if the server has no TLS.

| Check | Command | Expected |
|---|---|---|
| No public ports | `ss -tlnp \| grep docker-proxy \| grep -v 127.0.0.1` | no output |
| Kong admin closed | From another machine: `curl -m3 http://<server-ip>:18001/` | connection fails |
| Login required | `for p in pgr-services/v2/request/_search user/_search; do curl -s -o /dev/null -w "$p %{http_code}\n" -X POST https://<domain>/$p; done` | all `401` |
| Status board and MCP locked | `for p in status/ mcp; do curl -s -o /dev/null -w "$p %{http_code}\n" https://<domain>/$p; done` | `401` for each one enabled in `nginx_features` (`status` is on by default; `mcp` and `mcp_readonly` are off). A disabled path returns `404`, which is also fine. Anything else, such as `200`, is a failure. |
| Security headers | `curl -sI https://<domain>/digit-ui/ \| grep -iE 'x-frame\|x-content\|referrer'` | headers present |
| Containers hardened | `docker ps -q \| xargs docker inspect --format '{{.Name}} {{.HostConfig.CapDrop}}' \| grep -v ALL` | no output |
| Firewall on | `ufw status` | `Status: active` |
| App works | Log in as an employee and a citizen; file a complaint with a photo. | works |

---

## 5. Rotate leaked credentials

Code cannot do these:
1. Revoke the RSA deploy key that was in `devops/deploy-as-code/charts/environments/env-secrets.yaml`.
2. Revoke and reissue both Google Maps API keys; set the new key in `gmaps_api_key`.
3. Rotate the credentials from the old `bomet.yml.example` and `maputo.yml.example`.
4. Rotate any secret the deploy output warns still has a default value.

---

## 6. Escalation

### 6a. Migrate escalation (required on every upgraded tenant)

Until this is done, the new roles do not apply, and manual **Escalate** still moves complaints to the old `PENDINGATSUPERVISOR` state. Do it straight after the redeploy. Steps 1.5 and 1.6 must already be done.

1. **Update the `EscalationConfig` schema.** Check which shape the tenant has:

   ```bash
   docker exec docker-postgres psql -U egov -tAc "select tenantid, definition->'properties' ? 'eligibleStatuses' from eg_mdms_schema_definition where code='RAINMAKER-PGR.EscalationConfig'"
   ```

   | Result | Action |
   |---|---|
   | `<state>\|t` | Nothing to do. |
   | `<state>\|f` (v2.12 shape) | Configurator cannot save the new policy. Update the schema in place, as below. |
   | no row | Create the schema with `POST /mdms-v2/schema/v1/_create`, using the definition from the file below. |

   The schema API cannot update, so update the row directly:

   ```bash
   # On the controller, in your fork after step 2
   jq -c '.[] | select(.code=="RAINMAKER-PGR.EscalationConfig") | .definition' \
     utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json > esc-schema.json
   scp esc-schema.json <server>:/tmp/

   # On the server
   docker exec -i docker-postgres psql -U egov -v def="$(cat /tmp/esc-schema.json)" <<'EOF'
   UPDATE eg_mdms_schema_definition
      SET definition = :'def'::jsonb,
          lastmodifiedtime = (extract(epoch from now())*1000)::bigint
    WHERE code = 'RAINMAKER-PGR.EscalationConfig' AND tenantid = '<state tenant>';
   EOF
   docker restart digit-mdms-backend-1
   ```

2. **Follow the [escalation rollout guide](../migration/pgr-escalation-self-loop.md):** preflight, the workflow-role and data migration, and validation.
3. **Retire v2.12 policy records.** The v2.12 schema keyed records by `maxDepth` and had no `code`. pgr-services uses a tenant's policy only if there is **exactly one** active record; with two, it logs `Expected exactly one` and silently falls back to the built-in defaults. List the active records:

   ```bash
   docker exec docker-postgres psql -U egov -c "select tenantid, uniqueidentifier, data->>'code' as code from eg_mdms_data where schemacode='RAINMAKER-PGR.EscalationConfig' and isactive"
   ```

   Rows with an empty `code` are v2.12 records. They no longer match the schema, so the MDMS API cannot update them. Note their settings (`select data ...`), then disable them:

   ```bash
   docker exec docker-postgres psql -U egov -c "update eg_mdms_data set isactive=false, lastmodifiedtime=(extract(epoch from now())*1000)::bigint where schemacode='RAINMAKER-PGR.EscalationConfig' and isactive and coalesce(data->>'code','')=''"
   docker restart digit-mdms-backend-1
   ```

4. **Set the policy** in Configurator → PGR **Escalation policy**, re-entering any settings noted in step 3. Each tenant must end with one active record, coded `DEFAULT`; re-run the query in step 3 to confirm. See [escalation setup and configuration](../escalation.md).

### 6b. Turn on automatic escalation (optional)

Do this after 6a. Do not edit `/opt/digit/docker-compose.egov-digit.yaml` on the server, because the next deploy overwrites it. Instead, set it in `local-setup/docker-compose.<tenant>.yml` on the controller. The deploy applies it last, on every run.

If the file already exists (for example `docker-compose.bomet.yml`), **edit it**: set `PGR_ESCALATION_ENABLED: "true"` under its existing `pgr-services` → `environment` block. Do not overwrite the file, because it holds other tenant fixes. If it does not exist, create it with:

```yaml
services:
  pgr-services:
    environment:
      PGR_ESCALATION_ENABLED: "true"
```

Then run `./deploy.sh <tenant>`.

---

## Rollback

| Area | How |
|---|---|
| Security | Check out the `v2.12` tag (`git checkout v2.12`) and redeploy. Before redeploying: if you completed step 6a, set `PGR_ESCALATION_ENABLED: "false"` in `docker-compose.<tenant>.yml`, because v2.12 turns its old scheduler on, and that scheduler mis-times the new workflow. v2.12 uses the unpinned `openbao/openbao:latest`, which no longer starts; pin it first by adding `openbao:` → `image: openbao/openbao:latest@sha256:11fd73a2102cda9c55d5d881a8c3210303146a7ec1e8ac76f526e175c6d24641` under `services:` in the same file (the digest used in v2.12.1). Firewall rules stay until `ufw disable`. |
| Escalation | Set `PGR_ESCALATION_ENABLED: "false"` in the step 6b overlay and redeploy. Do not give GRO the escalation roles back. |
| Database | Restore the step 1.1 backup, only if data was damaged. |
