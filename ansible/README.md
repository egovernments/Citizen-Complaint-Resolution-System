# DIGIT/CCRS Ansible

Single-playbook, config-driven deploy for DIGIT tenants. Each tenant is a
fully independent stack (~35 containers) on its own machine — same
playbook, different `host_vars/<tenant>.yml`. Today: `nairobi`, `bomet`,
plus `mh-iterations` (sandbox).

## Layout

```
ansible/
├── deploy.sh                  # Single entrypoint — `./deploy.sh <tenant> [extra args]`
├── deploy-bomet.sh            # Deprecated shim → calls deploy.sh
├── deploy-nairobi.sh          # Deprecated shim → calls deploy.sh
├── playbook-deploy.yml        # The playbook (~107 tasks)
├── inventory/
│   ├── hosts.yml              # Group memberships + ansible_user
│   ├── group_vars/
│   │   ├── all.yml            # Globals (Python interp, etc.)
│   │   └── digit.yml          # Defaults inherited by every tenant
│   └── host_vars/
│       ├── nairobi.yml        # Nairobi overrides + bootstrap secrets
│       ├── bomet.yml          # Bomet overrides + bootstrap secrets
│       └── mh-iterations.yml  # Sandbox / iteration target
├── templates/                 # Jinja2 — globalConfigs.js.j2, nginx-site.conf.j2, digit.env.j2
├── runbooks/
│   └── 01-openbao.md          # OpenBao secrets backend
└── inventory.ini              # Legacy — kept for backwards compat
```

## Quick start

```bash
cd ansible

# Full deploy
./deploy.sh nairobi

# Dry-run first (no changes, show diff of every templated file)
./deploy.sh nairobi --check --diff

# Subset — only re-render nginx + reload it
./deploy.sh nairobi --tags nginx

# Verbose for debugging a failing task
./deploy.sh nairobi -vvv
```

`./deploy.sh` is intentionally tenant-agnostic — it forwards every flag
after the tenant name to `ansible-playbook`. So `--tags`, `--start-at-task`,
`--check`, `--limit`, `--skip-tags`, etc. all work.

## Adding a new tenant

1. Copy a host_vars file:
   ```bash
   cp inventory/host_vars/nairobi.yml inventory/host_vars/<tenant>.yml
   ```
2. Edit it — the keys you'll likely change:
   - `ansible_host` — IP/hostname Ansible SSHes into
   - `domain` — public hostname (used in nginx server_name + Grafana root URL)
   - `state_tenant_id` / `boot_tenant` / `tenant_id` — DIGIT tenancy slug
   - `map_center` — UI's default map centre
   - `digit_ui_mode` — `static` (host-nginx serves pre-built bundle) or
     `hmr` (esbuild dev server in tmux)
   - `enable_search_stack` — `true` to bring up Elasticsearch + indexer + inbox-v2
   - `nginx_features` — toggle individual location blocks
   - `bootstrap_secrets` — initial values seeded into OpenBao on first deploy
3. Add the host under `digit:` in `inventory/hosts.yml`:
   ```yaml
   all:
     children:
       digit:
         hosts:
           nairobi:
           bomet:
           <tenant>:           # ← here
   ```
4. Make sure the controller can SSH to it as `root` (no password, key-based).
5. Run:
   ```bash
   ./deploy.sh <tenant>
   ```

The first deploy:
- installs Docker + Compose
- writes `/etc/docker/daemon.json` with the VPC registry as insecure-registries
- creates `/opt/digit/`, syncs configs (`otel/`, `nginx/`, `kong/`, `db/`,
  `seeds/`, `gatus/`, `jupyter/`, `configs/`, `docker/`)
- writes per-tenant `.env` with `GF_SERVER_DOMAIN`, secrets pulled from OpenBao
- pulls all images from `10.0.0.4:5000` (Hetzner VPC registry)
- starts the stack
- runs CI tests + Playwright suite at the end (gates the deploy)

Subsequent deploys are idempotent — only changed configs / templated
files trigger restarts.

## Subset deploys (cheat sheet)

The playbook isn't heavily tagged today (only `mcp-publish` exists — see
below). Use `--start-at-task` and `--list-tasks` to slice work instead.

| Goal | Command |
|---|---|
| See what would change without applying | `./deploy.sh <tenant> --check --diff` |
| List every task name (so you can pick one to start from) | `./deploy.sh <tenant> --list-tasks` |
| Resume from a specific task | `./deploy.sh <tenant> --start-at-task "Pull all images from VPC registry"` |
| Pause after each task to review | `./deploy.sh <tenant> --step` |
| Verbose output for a failing task | `./deploy.sh <tenant> -vvv` |
| Limit to one host when looping | already implicit — `./deploy.sh <tenant>` runs `--limit <tenant>` |

If you find yourself needing to run a specific subset often (e.g. just
nginx, just config sync), add a `tags:` entry to those tasks in the
playbook and document it in the table above.

## Special-case: rebuilding `digit-mcp`

`digit-mcp` is built locally from `/root/DIGIT-MCP/` on the controller and
pushed to `10.0.0.4:5000/digit-mcp:latest`. Tenants pull from there.
Rebuild + republish is opt-in via the `mcp-publish` tag (otherwise skipped):

```bash
./deploy.sh nairobi --tags mcp-publish    # build + push only
./deploy.sh nairobi                        # pull-and-restart on the tenant
```

To iterate locally without pushing, set `MCP_IMAGE` in `/opt/digit/.env`:
```
MCP_IMAGE=digit-mcp:dev
```

## Secrets

Per-tenant secrets live in OpenBao on each target (`kv/digit/<tenant>`).
The first deploy seeds OpenBao with `bootstrap_secrets` from
`host_vars/<tenant>.yml`. Subsequent edits go through `bao kv put` (UI or
CLI) — re-deploys do **not** overwrite OpenBao with the YAML defaults
(seed runs with `cas=0`).

To rotate a secret:
```bash
ssh -L 18200:127.0.0.1:18200 egov-<tenant>
# Then in the browser at http://localhost:18200/ui, or:
bao kv put kv/digit/<tenant> postgres_password='new-strong-value'
# Re-render /opt/digit/.env from OpenBao:
./deploy.sh <tenant> --start-at-task "OpenBao — write secrets into compose .env (idempotent block)"
```

Full details in [`runbooks/01-openbao.md`](runbooks/01-openbao.md).

## Domain & TLS — what the playbook does, what you do

The `domain:` key in `host_vars/<tenant>.yml` is the public hostname.
The playbook uses it in three places:

1. **Host nginx server_name** — `templates/nginx-site.conf.j2` renders
   `server_name {{ domain }};` so the host nginx site responds to that
   hostname.
2. **Grafana root URL** — `/opt/digit/.env` gets `GF_SERVER_DOMAIN={{ domain }}`
   and `GF_SERVER_ROOT_URL=https://{{ domain }}/grafana/` so Grafana
   generates correct absolute URLs (login redirects, asset paths,
   share links).
3. **Anywhere the playbook bakes a hostname into config** (notification
   links, brand asset URLs in `globalConfigs.js`, …) — pulls from the
   same `{{ domain }}`.

That's all the playbook does. The hostname becoming a real,
browser-resolvable URL is **not** automated. Two manual steps:

### 1. DNS A record

Point your hostname at the server's public IP. At your DNS provider
(Cloudflare / Route53 / DigitalOcean / …):

```
your-domain.example.   A   203.0.113.42
```

Verify resolution before running the deploy:
```bash
dig +short your-domain.example
# → 203.0.113.42
```

### 2. TLS certificate (certbot)

The playbook does NOT install certbot or fetch a cert. On Nairobi /
Bomet this was a one-time manual step. After the first deploy:

```bash
ssh root@your-server
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.example
```

Certbot interactively edits the nginx site that Ansible templated to
add `listen 443 ssl;` + `ssl_certificate ...`, sets up an HTTP→HTTPS
301 redirect, and registers a systemd timer for auto-renewal. From
this point `https://your-domain.example/` works.

For a wildcard cert (e.g. `*.preview.example.com`) use the DNS-01
challenge — the playbook can't help with this, but the DigitalOcean
DNS plugin pattern documented in `~/server.md` works.

### 3. Firewall

Make sure the server allows inbound 80 + 443:
- On the host: `ufw allow 80,443/tcp` (or equivalent)
- On the cloud: VPC security group / firewall rule inbound from `0.0.0.0/0`

### Verify after setup

```bash
curl -sI https://your-domain.example/grafana/api/health  # → 200
curl -sI https://your-domain.example/status/             # → 200
```

If you get connection-refused → DNS or firewall. If TLS handshake
fails → certbot didn't run / cert expired. If 502/504 → upstream
container isn't healthy (`docker ps | grep -v healthy` on the host).

## Common operations

### Switch digit-ui between HMR and static

```bash
# In host_vars/<tenant>.yml:
digit_ui_mode: hmr      # live-reload from /opt/digit-ui-esbuild
# OR
digit_ui_mode: static   # host nginx serves pre-built bundle from build/

./deploy.sh <tenant>
```

The playbook's `pre_tasks` kill whichever runner is wrong for the new
mode and start the right one — both bind port 18080 so only one can
be live at a time.

### Toggle the search stack (Elasticsearch + indexer + inbox-v2)

```bash
# In host_vars/<tenant>.yml:
enable_search_stack: true   # ~2 GB RAM extra
./deploy.sh <tenant>
```

The playbook resolves this into `docker compose --profile search …`
flags. Setting back to `false` sweeps the running search containers.

### Just check that everything's wired up correctly

```bash
./deploy.sh <tenant> --check --diff --tags compose-config
```

## Troubleshooting

### `http: server gave HTTP response to HTTPS client` on docker pull

Docker daemon doesn't have `10.0.0.4:5000` in `insecure-registries`.
The playbook's `Configure Docker insecure-registries for VPC registry`
task writes `/etc/docker/daemon.json` and restarts docker on first
run. To force it on an already-deployed host:

```bash
./deploy.sh <tenant> --start-at-task "Configure Docker insecure-registries for VPC registry"
```

Or fix it directly:
```bash
ssh root@<tenant> "cat > /etc/docker/daemon.json <<EOF
{ \"insecure-registries\": [\"10.0.0.4:5000\"] }
EOF
systemctl restart docker"
```

### Sync task fails with `rsync: (l)stat: No such file or directory`

A source dir under `digit_config_dirs` (in playbook line ~165) doesn't
exist. Confirm with `ls <repo-root>/<dirname>/`. If it moved, update the
src path in the map.

### `digit-ui` container won't start

Likely port 18080 conflict because `esbuild` HMR is also bound. Either:
- Kill esbuild: `ssh root@<tenant> "tmux kill-session -t esbuild"`
- Or flip `digit_ui_mode: hmr` in host_vars and re-deploy

### Service stuck in restart loop

```bash
ssh root@<tenant>
docker logs <container-name> --tail 100
```
JVM services are heap-sized via `JAVA_OPTS` env in compose. Tune the
`<service>` block's `JAVA_OPTS:` if it's OOM'ing — see
`docker-compose.egov-digit.yaml` for current values.

### OpenBao sealed / unreachable

See [`runbooks/01-openbao.md`](runbooks/01-openbao.md).

## Inventory cheat sheet

```yaml
# inventory/group_vars/digit.yml — defaults for every tenant
state_tenant_id: ke                   # root tenant
digit_ui_mode: static                 # default UI serving mode
enable_search_stack: false            # search stack opt-in per host
core_mobile_configs:                  # Kenya mobile validation defaults
  mobilePrefix: "+254"
  mobileNumberPattern: "^[17][0-9]{8}$"
  mobileNumberLength: 9
# … plus auth, locale, boundary taxonomy, etc.

# inventory/host_vars/<tenant>.yml — overrides + per-tenant data
ansible_host: 10.0.0.5                # SSH target
domain: naipepea.digit.org            # public hostname
state_tenant_id: ke.nairobi           # override the root default
nginx_features: { brand_assets: true, configurator: true, ... }
secrets_path: kv/digit/nairobi        # OpenBao path
bootstrap_secrets: { postgres_password: …, … }
```

A new key only needs `host_vars/` if it differs per tenant. Anything
shared belongs in `group_vars/digit.yml`.

## Playbook structure

107 tasks, organised top-to-bottom:

1. **pre_tasks** (digit-ui mode reconciliation) — kill the wrong runner before main play
2. **Docker install + insecure-registries config**
3. **`/opt/digit/` setup** — copy compose, sync config dirs, write `.env`
4. **digit-ui** — render `globalConfigs.js`, ship nginx config, optional `npm install` + esbuild rebuild for HMR
5. **OpenBao bootstrap** (first run) + secret-pull for every run
6. **Compose pull + start** (with profiles)
7. **Health gates** — wait for kong / persister / hrms / ui / mcp / loki / grafana
8. **Host nginx site** — render `nginx-site.conf.j2`, validate, reload
9. **CC + DataLoader + Playwright tests** — gates the deploy

## Adding a new task

Most config-touching tasks should be wrapped in a registered handler so
they're idempotent. Pattern:

```yaml
- name: Render <thing>
  template:
    src: <thing>.j2
    dest: <path>
  notify: Reload <service>
```

Then add the matching handler at the bottom of the playbook (existing
example: `Reload nginx`). Ansible only fires the handler if the task
reports `changed: yes`.

For ops-only tasks (build something on the controller, push, etc.), tag
them `'never'` so they're opt-in:
```yaml
- name: Build + push some-image
  shell: …
  tags: ['some-image-publish', 'never']
```
Run with `--tags some-image-publish` to opt in.
