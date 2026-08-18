# DIGIT/CCRS Ansible deploy

One playbook, one command, one tenant per machine. You fill in
`inventory/host_vars/<tenant>.yml`, run `./deploy.sh <tenant>`, and get a
full DIGIT stack (~35 containers): core services, PGR complaints, host
nginx, OpenBao secrets, observability, and smoke-testable fixtures.

This README is written to be followed top-to-bottom by a human with no
prior DIGIT knowledge. Every command in it has been executed as written
against a real deploy. Sections:

1. [Prerequisites](#1-prerequisites)
2. [Configure your tenant](#2-configure-your-tenant)
3. [Deploy](#3-deploy)
4. [Verify the deploy](#4-verify-the-deploy)
5. [When something fails](#5-when-something-fails)
6. [Day-2 operations](#6-day-2-operations) (secrets, TLS, UI modes, overlays, MCP)
7. [Reference](#7-reference) (layout, inventory model, playbook structure)

> **Windows?** Follow the [Windows Quickstart (WSL2)](../../WINDOWS-QUICKSTART.md).
> **macOS?** The [macOS Quickstart (OrbStack)](../../MAC-QUICKSTART.md).
> Both walk this same `./deploy.sh` flow.

---

## 1. Prerequisites

There are two machines in the mental model — the **controller** (where you
clone this repo and run `./deploy.sh`) and the **target** (where the stack
runs). They can be the same machine: set `ansible_host: localhost` +
`ansible_connection: local` in your host_vars (the `_example.yml` template
and the `localhost-*.yml.example` sizing templates already do this) and
skip everything SSH-related below.

### On the controller

| Tool | How to install |
|------|----------------|
| Ansible ≥ 2.14 | `pipx install --include-deps ansible` or `sudo apt install ansible`. **Do not use `pip3 install --user ansible`** — on Ubuntu 23.04+/Debian 12+ it fails with a PEP 668 "externally-managed-environment" error. A venv also works. |
| Galaxy collections | From `local-setup/`: `ansible-galaxy install -r ansible/requirements.yml` |
| Node.js 20 | The digit-ui and configurator builds run on the controller. |
| SSH to the target | **Remote targets only.** Key-based `root` login, no password. Localhost targets don't use SSH at all. |

### The target

- Ubuntu (fresh install is fine — the playbook installs Docker + Compose),
  8 vCPU / 16 GB RAM / 50 GB disk minimum.
- Remote targets: reachable as `root` over SSH.

### Repos

Only this repo (CCRS) is required on the controller. Everything else is
pulled by the playbook or optional:

| What | When you need it | Default if missing |
|---|---|---|
| `digit-ui-esbuild` | auto-cloned on the target | playbook handles it |
| `digit-ui-fix` (sibling clone next to CCRS) | only `run_ci_tests: true` (Playwright + XLSX dataloader suite) | task block skipped |
| `digit-configurator` | `nginx_features.configurator: true` + `build_configurator: true` clones and `vite build`s it | nginx renders without `/configurator/` |
| `DIGIT-MCP` | `enable_mcp: true` + `build_mcp: true` builds the image locally | pulls `{{ docker_registry }}/digit-mcp:latest` |
| `nairobi-mdms/` submodule | only `requires_nairobi_mdms: true` | empty dir, unused |

```bash
# only if your tenant sets requires_nairobi_mdms: true
git submodule update --init --recursive local-setup/ansible/nairobi-mdms
```

---

## 2. Configure your tenant

The only host_vars file tracked in git is `_example.yml`. Copy it, then
edit — every field has an inline comment:

```bash
cd local-setup/ansible
cp inventory/host_vars/_example.yml inventory/host_vars/mytenant.yml
```

The non-negotiable fields:

- `ansible_host` — target IP/hostname. For a localhost deploy keep
  `localhost` + `ansible_connection: local`.
- `domain` — public hostname (nginx `server_name`, Grafana root URL,
  citizen-facing links).
- `state_tenant_id` / `boot_tenant` / `tenant_id` — DIGIT tenancy slugs.
- `secrets_path` — OpenBao path, convention `kv/digit/<tenant>`.
- `bootstrap_secrets.*` — initial secrets seeded into OpenBao on the FIRST
  deploy only. Rotate later via `bao kv put`; edits to this file after the
  first deploy are ignored (the seed writes with `cas=0`).
- `db_fast_path: true` **and** `db_fast_path_ack_data_wipe: true` — a fresh
  install effectively requires the fast path (there is no SQL slow path any
  more; without it the DB comes up empty), and preflight refuses to run
  without the explicit wipe acknowledgement.

**No inventory edit is needed.** `deploy.sh` regenerates
`inventory/hosts.yml` from `host_vars/*.yml` on every run — creating the
file is enough. (`inventory/hosts.yml.example` shows the generated shape.)

Real tenant files are **gitignored on purpose**: they hold
`bootstrap_secrets`, target IPs, and production domains. Share them with a
teammate directly, never via a commit.

Sizing templates: `localhost-slim.yml.example` (16 GB machines) and
`localhost-full.yml.example` (32 GB) are pre-tuned localhost configs — copy
one of those instead of `_example.yml` if that's your case.

---

## 3. Deploy

```bash
cd local-setup/ansible
./deploy.sh mytenant
```

That's the whole interface. `deploy.sh` forwards any extra flags to
`ansible-playbook`, so `--tags`, `--start-at-task`, `--check`, `--step`,
`-vvv` all work.

### What the first deploy does (expect 20–60 min on a fresh box)

1. Installs Docker + Compose, configures insecure-registries if needed.
2. Creates `/opt/digit/`, syncs configs (`otel/`, `nginx/`, `kong/`, `db/`,
   `seeds/`, `gatus/`, `jupyter/`, `configs/`, `docker/`, compose files).
3. Initialises + unseals OpenBao, seeds `bootstrap_secrets` (once), writes
   `/opt/digit/.env` from OpenBao.
4. Pulls/builds images, starts the stack, waits on health gates
   (kong, persister, hrms, UI, MCP).
5. `db_fast_path: true`: pre-loads `db/full-dump.sql` into a fresh
   Postgres — 54 tables + Flyway history + 20K localization rows in seconds.
6. Runs `seeds/user-seed.sh` so ADMIN / GRO / INTERNAL_USER exist with the
   right encryption, then bootstraps your tenant from the MCP and re-keys
   ADMIN + the pg.citest CI fixtures under your tenant's encryption key.
7. Renders and reloads the host nginx vhost.
8. Only when `run_ci_tests: true`: runs the Postman smoke + lifecycle
   collections, the XLSX DataLoader and Playwright suites as deploy gates.
   **With the default `run_ci_tests: false` a green deploy has NOT been
   smoke-tested — run the collections yourself (next section).**

Subsequent deploys are idempotent — a full re-run is always safe and is
also the recommended way to recover from a failed deploy (see
[When something fails](#5-when-something-fails)).

### Dry-run

```bash
./deploy.sh mytenant --check --diff                       # against an already-deployed stack
./deploy.sh mytenant --check --diff --tags compose-config # config-only slice, fastest
```

`--check` runs read-only probes for real (health gates, OpenBao status) and
diffs everything else, so it needs a running stack to probe — on a box that
has never been deployed the health gates will (correctly) fail.

### Useful invocations

| Goal | Command |
|---|---|
| List every task name | `./deploy.sh mytenant --list-tasks` |
| Resume from a specific task | `./deploy.sh mytenant --start-at-task "<task name>"` |
| Pause after each task | `./deploy.sh mytenant --step` |
| Verbose failing task | `./deploy.sh mytenant -vvv` |

`--start-at-task` works for compose/config-derived variables (they are
play-level vars, computed on demand). Tasks that consume *registered
results* of skipped tasks (e.g. the Grafana password alignment) skip
themselves gracefully and re-apply on the next full run. When in doubt,
just re-run the full deploy — idempotence makes it cheap.

---

## 4. Verify the deploy

`db/full-dump.sql` ships a fully-bootstrapped test tenant **`pg.citest`**
(CI-ADMIN / `eGov@123`, PGR workflow, MDMS complaint types), and the deploy
re-seeds its fixtures (user encryption key, HRMS links, departments, the
JLC477 test locality) so the bundled collections genuinely work
out-of-the-box on any tenant. Newman is installed on the target by the
playbook (`npm i -g newman` anywhere else).

Run both collections from the **repo root**:

```bash
# 1. Health checks — 13 requests, each asserts a 2xx
newman run local-setup/postman/digit-core-validation.postman_collection.json \
  --env-var "baseUrl=http://localhost:18000"

# 2. Full PGR lifecycle on pg.citest:
#    auth → MDMS → create → assign → resolve → rate&close → search
newman run local-setup/postman/complaints-demo.postman_collection.json \
  --env-var "url=http://localhost:18000"
```

Both must exit 0. Point `--env-var url=...` at a Tailscale IP or
`https://your-domain` for remote runs.

### Testing against your own tenant

Credentials, tenants, complaint type and locality are all variables:

```bash
newman run local-setup/postman/complaints-demo.postman_collection.json \
  --env-var "url=https://my-tenant.example.com" \
  --env-var "username=ADMIN" \
  --env-var "password=eGov@123" \
  --env-var "stateTenant=ke" \
  --env-var "cityTenant=ke.nairobi" \
  --env-var "userType=EMPLOYEE" \
  --env-var "localityCode=SUN01_LOCALITY"   # a boundary code that exists on YOUR tenant
```

For an MCP-bootstrapped tenant the do-it-all admin is `ADMIN` with the
deploy's `egov_hrms_default_password` (default `eGov@123`).

Prerequisites for the lifecycle to pass on your tenant:

- An EMPLOYEE-type user with `EMPLOYEE`, `GRO`, `PGR_LME`, `CITIZEN`, `CSR`
  roles, an HRMS employee record whose **department matches the complaint
  type's department** (workflow ASSIGN validates this).
- PGR business-service workflow loaded for the root tenant.
- Complaint types present as **leaf nodes of
  `RAINMAKER-PGR.ComplaintHierarchy`** — pgr-services validates against the
  hierarchy, not `ServiceDefs`; the collection automatically samples from
  the intersection of the two.
- A boundary (locality) on the city tenant — pass its code as
  `localityCode`.

### Browser check

- `http://<host>:18080/digit-ui/` (or `https://<domain>/digit-ui/`) — login
  page renders, tenant dropdown populated.
- `https://<domain>/grafana/api/health` → 200, `/status/` → 200 (when the
  gatus feature is on).

---

## 5. When something fails

**First move: read the failed task name, then just re-run
`./deploy.sh <tenant>`.** The playbook is idempotent; most transient
failures (a service that took too long to warm up) clear on the second
pass. `--start-at-task "<failed task>"` is faster but see the caveats in
[Deploy](#3-deploy).

### A task fails with `"censored": … no_log: true`

Secret-touching tasks (OpenBao seeding, the ADMIN re-key calls) hide their
output. Reproduce the call by hand to see the real error — e.g. for the
ADMIN re-key:

```bash
curl -s -X POST http://127.0.0.1:13101/v1/tenant/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"target_tenant":"<state_root>","source_tenant":"pg","user_only":true}'
# success = .summary.admin_user_provisioned == true
```

Don't remove `no_log` permanently — responses can embed credentials.

### `http: server gave HTTP response to HTTPS client` on docker pull

The daemon is missing `10.0.0.4:5000` in insecure-registries. Re-run from
the config task, or fix directly:

```bash
./deploy.sh <tenant> --start-at-task "Configure Docker insecure-registries for VPC registry"
```

### Sync task fails with `rsync: (l)stat: No such file or directory`

A source dir in the config-sync map doesn't exist on the controller.
`ls <repo-root>/<dirname>/` to confirm; update the src path in the playbook
if it moved.

### `digit-ui` container won't start

Usually a port-18080 conflict with the esbuild HMR runner. Either kill it
(`tmux kill-session -t esbuild` on the target) or set
`digit_ui_mode: hmr` in host_vars and re-deploy — the playbook's pre_tasks
kill whichever runner is wrong for the configured mode.

### A JVM service is stuck restarting

```bash
docker logs <container> --tail 100
```

Heap sizes live in `JAVA_OPTS` per service in
`docker-compose.egov-digit.yaml` — tune and re-deploy.

### Postman lifecycle fails at ASSIGN with `INVALID_ASSIGNMENT`

The assignee's HRMS department doesn't match the complaint type's
department (a ComplaintHierarchy leaf field). Either pick a matching
`serviceCode` via `--env-var`, or give the employee an assignment in that
department.

### OpenBao sealed / unreachable

See [`runbooks/01-openbao.md`](runbooks/01-openbao.md).

---

## 6. Day-2 operations

### Secrets (OpenBao)

Per-tenant secrets live in OpenBao **on each target** at
`kv/digit/<tenant>`. First deploy seeds them from `bootstrap_secrets`;
after that the YAML is ignored and `bao kv put` is the write path:

```bash
ssh -L 18200:127.0.0.1:18200 egov-<tenant>     # or run directly on the box
bao kv put kv/digit/<tenant> postgres_password='new-strong-value'
# re-render /opt/digit/.env from OpenBao:
./deploy.sh <tenant> --start-at-task "OpenBao — write secrets into compose .env (idempotent block)"
```

Grafana's admin password is auto-generated on first deploy and stored at
the same path (`bao kv get -field=grafana_admin_password kv/digit/<tenant>`).
Full details: [`runbooks/01-openbao.md`](runbooks/01-openbao.md).

### Domain, DNS and TLS

The playbook renders `domain` into the nginx vhost, Grafana URLs and every
baked hostname. Making it a real URL is manual, in this order:

1. **DNS A record** at your provider pointing to the target's public IP.
   Verify with `dig +short your-domain.example` before deploying.
2. **Run the playbook** so the HTTP vhost exists. The vhost is
   Ansible-managed — never hand-edit `/etc/nginx/sites-*`; change host_vars
   and re-run instead. (Exception: `nginx_preserve_vhost: true` tenants,
   below.)
3. **Certbot**:

   ```bash
   sudo apt install -y nginx certbot python3-certbot-nginx
   sudo certbot --nginx -d <your-domain> \
       --agree-tos -m <ops-email> --no-eff-email --redirect
   ```

4. **Firewall**: inbound 80 + 443 open (`ufw allow 80,443/tcp` + your cloud
   security group).
5. **Verify**:

   ```bash
   sudo nginx -t && systemctl status nginx
   curl -sI https://your-domain.example/grafana/api/health   # → 200
   systemctl list-timers certbot.timer                       # renewal timer active
   ```

   Connection refused → DNS/firewall. TLS handshake failure → certbot never
   ran or cert expired. 502/504 → an upstream container is unhealthy
   (`docker ps | grep -v healthy` on the target).

   If nginx fails with `options-ssl-nginx.conf not found`, **don't re-run
   certbot** (rate limits, vhost edits) — restore the two helper files from
   package data:

   ```bash
   sudo install -m 644 \
       /usr/lib/python3/dist-packages/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
       /etc/letsencrypt/options-ssl-nginx.conf
   sudo install -m 644 \
       /usr/lib/python3/dist-packages/certbot/ssl-dhparams.pem \
       /etc/letsencrypt/ssl-dhparams.pem
   sudo nginx -t && sudo systemctl start nginx
   ```

### Switch digit-ui between HMR and static

```yaml
# host_vars/<tenant>.yml
digit_ui_mode: hmr      # live-reload from /opt/digit-ui-esbuild
digit_ui_mode: static   # host nginx serves the pre-built bundle
```

Then `./deploy.sh <tenant>`. Both modes bind 18080; pre_tasks kill the
wrong runner automatically.

### Toggle the search stack (Elasticsearch + indexer + inbox-v2)

```yaml
enable_search_stack: true   # ~2 GB RAM extra
```

Re-deploy; the playbook resolves this into `docker compose --profile
search` flags. Setting it back to `false` sweeps the search containers.

### Per-tenant compose overlay

If `local-setup/docker-compose.<tenant>.yml` exists on the controller, it
is copied to the target and appended (`-f`) to every compose invocation.
Use it for tenant-local env overrides without touching the base compose —
e.g. Bomet ships Flyway and `STATE_LEVEL_TENANT_ID` overrides this way.
Missing file = no-op.

### Preserve a hand-crafted nginx vhost

`nginx_preserve_vhost: true` in host_vars makes the playbook install nginx
but skip templating/symlinking the site file — for tenants whose
`/etc/nginx/sites-enabled/<domain>` has routing the template doesn't render
(Bomet's `/novu/` routing, host aliases). Default `false`.

### `digit-mcp` image

Default (recommended) — build locally at deploy:

```yaml
enable_mcp: true
build_mcp: true
# mcp_repo_url / mcp_ref override the default GitHub source
nginx_features: { mcp: true }
```

The deploy clones DIGIT-MCP, builds `digit-mcp:local` on the target and
points `MCP_IMAGE` at it — no registry needed (this is the path for Macs
and any box outside the VPC). Legacy VPC-registry flow: leave `build_mcp`
off to pull, and publish with `./deploy.sh <tenant> --tags mcp-publish`.

### Relocating Docker storage — `docker_data_root`

Only takes effect on a box where Docker/containerd have **never started** —
the playbook refuses to relocate a populated `/var/lib/docker` (it would
orphan every image and volume, including the complaint database). To move
an already-populated box by hand first:

```bash
systemctl stop docker.socket docker.service containerd   # socket too — a stray `docker ps` restarts dockerd mid-copy
mkdir -p /opt/docker /opt/containerd
rsync -aHAX --info=progress2 /var/lib/docker/  /opt/docker/
rsync -aHAX --info=progress2 /var/lib/containerd/ /opt/containerd/
# RHEL/SELinux only:
semanage fcontext -a -e /var/lib/docker /opt/docker
semanage fcontext -a -e /var/lib/containerd /opt/containerd
restorecon -RF /opt/docker /opt/containerd
# remove the DIRECTORIES, not their contents — a bare * glob leaves dotfiles
# that make the playbook's emptiness guard think the path is still populated
rm -rf /var/lib/docker /var/lib/containerd
```

Then set `docker_data_root: "/opt/docker"` and deploy as usual.

---

## 7. Reference

### Directory layout

```
ansible/
├── deploy.sh                  # single entrypoint — ./deploy.sh <tenant> [extra args]
├── playbook-deploy.yml        # the playbook (~110 tasks)
├── inventory/
│   ├── hosts.yml.example      # reference; real hosts.yml is generated + gitignored
│   ├── group_vars/
│   │   ├── all.yml            # globals (python interpreter, digit_dir, …)
│   │   └── digit.yml          # defaults inherited by every tenant
│   └── host_vars/
│       ├── README.md          # host_vars nuances + gotchas
│       ├── _example.yml       # ← the ONLY tracked yaml; copy per tenant
│       └── localhost-*.yml.example  # 16 GB / 32 GB localhost sizing templates
├── templates/                 # globalConfigs.js.j2, nginx-site.conf.j2, digit.env.j2
├── runbooks/01-openbao.md     # OpenBao secrets runbook
└── files/                     # build scripts (mcp-build.sh, configurator-build.sh, …)
```

### Inventory model

```yaml
# group_vars/digit.yml — defaults for every tenant
state_tenant_id: ke
digit_ui_mode: static
enable_search_stack: false
core_mobile_configs: { countryCode: "+254", mobileNumberRegex: "^[17][0-9]{8}$" }

# host_vars/<tenant>.yml — per-tenant values + secrets
ansible_host: 10.0.0.5
domain: naipepea.digit.org
state_tenant_id: ke.nairobi
nginx_features: { brand_assets: true, configurator: true }
secrets_path: kv/digit/nairobi
bootstrap_secrets: { postgres_password: "…", … }
```

A key belongs in `host_vars/` only if it differs per tenant; anything
shared goes in `group_vars/digit.yml`.

Derived compose variables (`compose_profiles`, `compose_files`) are defined
as **play-level vars** in the playbook, computed lazily from inventory — so
they exist no matter where a run starts. Don't convert them back to
`set_fact`: that breaks `--start-at-task` resumes.

### Playbook structure (top to bottom)

1. **pre_tasks** — digit-ui mode reconciliation (kill the wrong runner)
2. **Docker install** + insecure-registries config
3. **`/opt/digit/` setup** — compose files, config sync, `.env`
4. **digit-ui** — `globalConfigs.js`, nginx config, optional esbuild HMR
5. **OpenBao** — init/unseal (first run), secret pull (every run)
6. **Compose pull + up** (with profiles)
7. **Health gates** — kong / persister / hrms / ui / mcp; only loki among
   the observability services, and non-fatally. grafana, prometheus, tempo,
   otel-collector, node-exporter are not gated or Gatus-checked (#1613,
   #1657 — see `docs/observability/enabling-monitoring.md`)
8. **Tenant bootstrap + post-bootstrap** — MCP bootstrap, STATE_LEVEL
   switch, ADMIN re-key, pg.citest CI-fixture re-seed
9. **Host nginx vhost** — render, validate, reload
10. **CI gates** (`run_ci_tests: true` only) — Postman, DataLoader, Playwright

### Conventions for new tasks

Wrap config-touching tasks in handlers so they stay idempotent:

```yaml
- name: Render <thing>
  template: { src: <thing>.j2, dest: <path> }
  notify: Reload <service>
```

Ops-only tasks get `tags: ['<name>-publish', 'never']` so they're opt-in
via `--tags`. Read-only probes that later tasks' conditionals depend on
need `check_mode: false`, or a bare `--check` run dies dereferencing a
skipped register. Tasks that consume registered secrets must guard with
`is defined` so `--start-at-task` resumes skip them instead of exploding.

### Testing the test tenant (what's in the dump)

- `pg` root tenant with the PGR workflow business-service
- `pg.citest` city tenant, `CI-ADMIN` (password `eGov@123`) with the full
  PGR role set + HRMS employee record
- 33 `RAINMAKER-PGR.ServiceDefs`, 8 `ComplaintHierarchy` leaves
  (departments DEPT_3 / DEPT_1)
- The deploy's post-bootstrap fixture task re-keys CI-ADMIN under your
  tenant's encryption key, repoints its HRMS rows, aligns departments and
  seeds the `JLC477` locality — that is what keeps the bundled Postman
  collections green after tenant onboarding.
