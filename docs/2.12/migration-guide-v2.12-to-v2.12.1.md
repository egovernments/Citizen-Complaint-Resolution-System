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
cd /opt/digit && tar czf $BK/opt-digit-config.tgz \
  --exclude=./.build --exclude=./ci-tests --exclude=./e2e-tests \
  .env docker-compose*.y*ml kong nginx configs otel gatus keycloak configurator-runtime
cp -a /etc/nginx/sites-available /etc/nginx/conf.d /etc/docker/daemon.json $BK/
```

Find the hand-made changes by comparing the server files with the `v2.12` templates, for example:

```bash
diff /opt/digit/kong/kong.yml <v2.12 checkout>/local-setup/kong/kong.yml
```

Move each change into `inventory/host_vars/<tenant>.yml` if a setting exists for it. Otherwise note it down and re-apply it after the deploy (step 3).

### 1.3 Check image overrides

The 2.12.1 images are the defaults: pgr-services and its migrations, digit-mcp and digit-ui at `2.12.1-7a38661`, configurator at `2.12.1-6e8adb3`. Remove these from `inventory/host_vars/<tenant>.yml` if present, so the defaults apply:

`pgr_services_image`, `mcp_image`, `build_mcp: true`, `digit_ui_image`, `configurator_image`

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

---

## 2. Redeploy

```bash
git fetch && git checkout 2.12.1
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
- Calls without a token to the APIs, `/user/_search`, `/mcp` and `/status/` return `401`.

> **Novu:** sign-up is now disabled. If `enable_novu: true` and Novu has no admin account yet, the deploy fails with `Account creation is disabled`. Set an existing key in `novu_api_key`, or set `enable_novu: false` for now.

---

## 3. Re-apply local changes

Re-apply only the changes from step 1.2 that could not go into host_vars. **Edit the new files; do not copy the old files back**, as that undoes the security fixes.

- Kong: edit `/opt/digit/kong/kong.yml` in place (it is a single-file mount, so don't replace it with `cp` or `sed -i`), then `docker exec kong-gateway kong reload`.
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
| Login required | `for p in pgr-services/v2/request/_search user/_search mcp status/; do curl -s -o /dev/null -w "$p %{http_code}\n" -X POST https://<domain>/$p; done` | all `401` |
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

Keep automatic escalation off (`PGR_ESCALATION_ENABLED=false`, the default) until the checks below pass. Then follow:

1. [Escalation rollout guide](https://github.com/egovernments/Citizen-Complaint-Resolution-System/blob/master/docs/migration/pgr-escalation-self-loop.md): preflight, the **mandatory** workflow-role fix for existing tenants, and validation.
2. [Escalation setup and configuration](https://github.com/egovernments/Citizen-Complaint-Resolution-System/blob/master/docs/escalation.md): the `EscalationConfig` policy, edited in DIGIT Studio → PGR **Escalation policy**.

If **Escalation policy** is missing in DIGIT Studio, the tenant predates v2.12.1. Create the `RAINMAKER-PGR.EscalationConfig` schema from `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json` first.

---

## Rollback

| Area | How |
|---|---|
| Security | Check out `v2.12` and redeploy. v2.12 uses the unpinned `openbao/openbao:latest`, which no longer starts; pin it first to the digest used in v2.12.1's `docker-compose.egov-digit.yaml`. Firewall rules stay until `ufw disable`. |
| Escalation | Set `PGR_ESCALATION_ENABLED=false` and restart pgr-services. Do not give GRO the escalation roles back. |
| Database | Restore the step 1.1 backup, only if data was damaged. |
