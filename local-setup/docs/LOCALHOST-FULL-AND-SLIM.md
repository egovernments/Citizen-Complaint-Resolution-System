# Localhost deployments — full and slim

The Ansible path (`local-setup/ansible/`) is normally used to deploy DIGIT to a *remote*
server. It can also target **the machine you are sitting at**: set `ansible_host: localhost`
and `ansible_connection: local`, and `./deploy.sh` converges this box instead of SSHing
anywhere. No SSH keys, no DNS, no TLS certificate.

Two ready-made presets ship for that, and this page is about choosing between them and
running one.

| | **full** | **slim** |
|---|---|---|
| Preset | `inventory/host_vars/localhost-full.yml.example` | `inventory/host_vars/localhost-slim.yml.example` |
| Container footprint | ~16 GB | ~16 GB minus the ~1.5–2 GB Novu stack |
| Suitable host | 32 GB, or 16 GB with nothing else running | 16 GB, incl. WSL2 with ~12 GB for the VM |
| Notifications (Novu) | **yes** — 8 extra containers | **no** |
| Everything else | identical | identical |

---

## What "full" and "slim" actually mean here

They are **not** two different stacks. Slim is full with the notification subsystem turned
off, and that is the entire difference — two flags:

```yaml
enable_novu: false                  # full: true
pgr_notification_config_driven: false   # full: true
```

`enable_novu: false` drops the whole `notifications` compose profile: `novu-api`,
`novu-worker`, `novu-ws`, `novu-dashboard`, `novu-mongo`, `novu-bridge`,
`digit-config-service` and `digit-user-preferences-service` — roughly 1.5–2 GB resident.
`pgr_notification_config_driven: false` follows from it: leaving it on would point PGR at a
delivery path that is not running.

Everything else is byte-identical between the two files. Both give you:

- all core DIGIT services and `pgr-services`
- the employee UI at `/digit-ui/` and the citizen SPA at `/citizen/`
- the configurator wizard at `/configurator/`
- MCP, so the wizard's tenant bootstrap works
- Kong, and the Gatus health dashboard at `/status/`
- the dump-seeded `pg` / `pg.citya` tenants — a working city, boundary hierarchy, complaint
  types and an `ADMIN` login, with no onboarding step needed

**What you give up on slim:** no SMS, email or WhatsApp is sent. The complaint lifecycle —
file, assign, resolve, rate, close — is unaffected. Choose slim unless you are specifically
working on notifications.

> **Why the notification stack is the thing that gets cut.** It is the largest optional
> block by memory, and it is the one that tips a 12 GB VM into swapping. The JVM services
> declare far more heap than a small box has and there is usually no swap, so memory
> pressure shows up as OOM kills rather than slowness.

---

## Before you start

On the machine you are deploying to (which is also the controller):

| Need | Why | Check |
|---|---|---|
| **Ansible** on `PATH` | runs the deploy | `ansible-playbook --version` |
| **Python 3** | `scripts/preflight.py` runs before every deploy | `python3 --version` |
| **Node.js 20+** | the citizen SPA (`enable_digit_ui_v2`) is built on the target | `node --version` |
| **Docker + Compose v2** | the playbook installs Docker if it is missing | `docker compose version` |
| **Root, or sudo** | almost every task uses `become` | see below |
| RAM | see the table above | `free -h` |
| Disk | ~50 GB for images and volumes | `df -h /` |

Collections, once:

```bash
cd local-setup/ansible
ansible-galaxy install -r requirements.yml
```

The linters are optional — `deploy.sh` runs both before touching anything and just warns
if they are absent — but `pip3 install ansible-lint yamllint` fails on Ubuntu 24.04 and
every other PEP 668 Python. Use
[`local-setup/scripts/install-prereqs.sh`](../scripts/install-prereqs.sh) instead: it puts
them, and a compatible `ansible-core`, in a virtualenv on your PATH.

### The become-password gotcha

`deploy.sh` calls `ansible-playbook` **without `-K`**. Deploying to a remote box that is
normally fine, because the generated inventory connects as `root`. Running against
`localhost` as an ordinary user, it is not: the first `become` task fails with
`Missing sudo password`.

`deploy.sh` forwards every extra argument to `ansible-playbook`, so add it yourself:

```bash
./deploy.sh mybox -K                                   # prompt for the sudo password
./deploy.sh mybox --become-password-file ~/.sudo-pass  # or read it from a file (chmod 600)
```

Running the whole deploy as root avoids the question entirely.

---

## Running one

### 1. Copy the preset

Real `host_vars` files are gitignored — only the `.example` files are tracked. Name the copy
whatever you want the deployment to be called; that name is the argument to `deploy.sh`.

```bash
cd local-setup/ansible

# slim (recommended on 16 GB)
cp inventory/host_vars/localhost-slim.yml.example inventory/host_vars/mybox.yml

# or full
cp inventory/host_vars/localhost-full.yml.example inventory/host_vars/mybox.yml
```

Every setting in both files is commented in place — what it does, and what values it
accepts. **The presets run as-is**; you do not have to edit anything to get a working stack.
Read the comments before changing values: several are pinned by the database dump and will
break the deploy if you "harden" them, notably `elasticsearch_master_password`.

No inventory edit is needed. `deploy.sh` regenerates `inventory/hosts.yml` from whatever
`host_vars/*.yml` exist on every run.

### 2. Deploy

```bash
./deploy.sh mybox -K
```

The first run installs Docker and Compose, creates `/opt/digit/`, syncs configs, initialises
and unseals OpenBao and seeds secrets, loads `db/full-dump.sql` into Postgres, pulls or
builds images, starts the stack, and waits on health gates. Later runs are idempotent — only
changed config triggers a restart.

**It looks like it hangs.** Ansible buffers a task's output until the task ends, and the
image pull and stack-up steps are long. Watch progress from a second terminal:

```bash
tail -f /opt/digit/digit-stack-up.mybox.progress
watch -n5 "docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'healthy|Exited|Restart'"
```

### 3. Open it

`tls_enabled: false` and `domain: localhost`, so everything is plain HTTP on port 80:

| What | URL |
|---|---|
| Employee UI | http://localhost/digit-ui/employee |
| Citizen SPA | http://localhost/citizen/ |
| Configurator wizard | http://localhost/configurator/ |
| Gatus health dashboard | http://localhost/status/ |
| Grafana | http://localhost/grafana/ |
| Novu dashboard (**full only**) | http://localhost/novu/ |

Log in as `ADMIN` / `eGov@123`. That account belongs to the **state** tenant `pg` — it does
not authenticate against `pg.citya` or any other city tenant.

---

## Expected warnings

**`preflight` warns about the configurator build path.** Both presets produce:

```
[WARN] configurator-build-path: nginx_features.configurator: true but configurator_build is unset
```

Harmless here. It is aimed at the `build_configurator: true` path, where nginx serves a dist
rsynced from the controller. These presets use `build_configurator: false`, where nginx
proxies `/configurator/` to the CI-built `egovio/configurator` container instead — nothing is
built on the box and no dist needs to exist. Preflight exits 0.

**`insecure_registries` names a registry nothing pulls from.** Both presets still carry
`registry.preview.egov.theflywheel.in`, from a time when that registry's certificate had
expired. Every image in `docker-compose.egov-digit.yaml` now comes from Docker Hub
(`egovio/*`) or ghcr.io over valid TLS, so the entry is inert. Leaving it costs nothing;
just don't read it as a dependency.

---

## Switching between the two

Slim → full is the two flags at the top of this page. Edit them in your `host_vars/mybox.yml`
and redeploy:

```yaml
enable_novu: true
pgr_notification_config_driven: true
```

```bash
./deploy.sh mybox -K
```

Novu comes up unconfigured. To actually send anything: open http://localhost/novu/, sign up
(this creates the first organization, environment and API key), paste that key into
`novu_api_key` along with your Twilio credentials, and deploy once more — the second run
registers the Twilio integration and the workflow inside Novu.

Full → slim is the same edit in reverse. The Novu containers are removed on the next deploy;
Postgres and MinIO volumes are untouched.

---

## Turning off more

If slim is still too heavy, the next things to look at, in order of what they cost:

| Setting | Frees | What stops working |
|---|---|---|
| `enable_search_stack: false` | ~2–3 GB | Already off in both presets. The inbox and search screens — pair it with `employee_module_denylist: ["IM"]` to hide the tab |
| `observability_level: metrics` | ~1 GB | Loki logs and Tempo traces. Gatus and the OTel collector run at every level |
| `enable_mcp: false` | two containers | The configurator wizard's tenant bootstrap. The rest of the wizard still loads |
| `enable_digit_ui_v2: false` | build time, not RAM | The `/citizen/` SPA. The legacy citizen flow under `/digit-ui/` is unaffected |

`observability_level` is cumulative — `metrics`, then `logs`, then `traces` (the default,
meaning everything), each level including the ones before it. The budgeted footprints in
`group_vars/digit.yml` are ~1.2 GB at `metrics`, ~1.8 GB at `logs` and ~2.2 GB at `traces`.
See [Enabling monitoring](../../docs/observability/enabling-monitoring.md).

---

## Related

- [`local-setup/README.md`](../README.md) — the Docker Compose and Tilt paths, which need no Ansible
- [`local-setup/ansible/README.md`](../ansible/README.md) — the authoritative Ansible reference
- [`inventory/host_vars/_example.yml`](../ansible/inventory/host_vars/_example.yml) — the exhaustive template every setting is documented in
- [`docs/deployment-modes.md`](../../docs/deployment-modes.md) — how this compares to the Kubernetes and Helm paths
- [WINDOWS-QUICKSTART.md](../../WINDOWS-QUICKSTART.md) — the WSL2 walkthrough slim was sized for
