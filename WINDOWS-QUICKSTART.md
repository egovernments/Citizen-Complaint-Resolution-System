# Windows Quickstart — DIGIT via WSL2 in one session

Brings up the full DIGIT stack on Windows with `./deploy.sh <name>`. The
playbook self-heals the WSL-specific quirks (memory caps, mount propagation,
Node toolchain), so the happy path is short. Only the WSL2 bits below are
Windows-specific; the rest works on any Linux box.

Last validated on Windows 11 + WSL2 Ubuntu 24.04, from a freshly installed
distro.

## What you get

~39 containers on the dump-seeded `pg` / `pg.citya` tenants — DIGIT core
services, PGR, employee UI, citizen SPA, configurator (DIGIT Studio), Kong,
host nginx on port 80, and the Grafana/Prometheus/Loki/Tempo stack. Login
works immediately.

| Template | Fits | Difference |
|----------|------|------------|
| `localhost-slim.yml.example` | **16 GB machine** (12 GB WSL VM) | No Novu notifications (~2 GB). Everything else identical. |
| `localhost-full.yml.example` | 32 GB machine | Adds Novu (SMS/WhatsApp delivery). |

## Prerequisites

- Windows 10/11, hardware virtualization enabled (usually on; enable in BIOS
  if step 1 errors with `0x80370102`).
- ≥ 16 GB RAM and ~40 GB free disk (a cold build lands ~22 GB of images).
- **Do NOT install Docker Desktop**, or disable its WSL integration for this
  distro. The playbook installs Docker Engine natively inside WSL; Docker
  Desktop's injected `docker` conflicts with it.

## 1. Install WSL2 + Ubuntu (PowerShell as Administrator)

```powershell
wsl --update
wsl --install -d Ubuntu-24.04
```

`wsl --update` needs an elevated shell — un-elevated it blocks on a UAC prompt
with no output. Reboot if Windows asks, re-run if the distro isn't there yet,
then create your Linux user on first launch. Confirm:

```bash
uname -a                      # must contain "microsoft ... WSL2"
systemctl is-system-running   # "running" or "degraded"
```

Ubuntu 24.04 already ships `/etc/wsl.conf` with `[boot] systemd=true`. If
systemd reports `offline`, add that stanza yourself, then `wsl --shutdown`.

### Configure the VM before deploying

Create `%UserProfile%\.wslconfig` with all five keys now. The deploy writes the
three `[wsl2]` caps itself and then stops to make you apply them (step 5), so
setting them here means **one** `wsl --shutdown` instead of two:

```ini
[general]
instanceIdleTimeout=-1

[wsl2]
vmIdleTimeout=-1
memory=12GB      # 16 GB host. On 32 GB use 20GB and set wsl_memory_gb: 20
swap=16GB        # in host_vars so the deploy agrees with this file.
processors=6
```

The two `-1` timeouts matter more than they look. WSL stops the **distro**
~15 s after your last terminal closes, and the **VM** 60 s later. systemd shuts
down with them, and since most of the stack is `restart: no`, only a handful of
containers return — every URL 502s with nothing in the logs to explain it.
Neither `uptime` nor `wsl -l -v` shows anything wrong, because the kernel boot
ID doesn't change.

Then `wsl --shutdown`, reopen Ubuntu, and check it took:

```bash
free -h   # ~11Gi total for memory=12GB, not ~7.6Gi
nproc     # 6
```

## 2. Install the deploy tooling (inside WSL)

```bash
sudo apt update && sudo apt install -y git ansible python3 python3-pip rsync curl
sudo apt install -y ansible-lint yamllint   # optional; deploy.sh WARNs without them
```

Ubuntu 24.04's apt ships ansible-core 2.16.3 — the recommended, best-tested
version for this playbook.

## 3. Clone INSIDE the WSL filesystem

```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System
```

This lands you on the default branch (`master`). If you're tracking current
work, `git checkout develop` before continuing.

> **Never run the stack from a Windows-side clone** (`/mnt/c/...`). Git for
> Windows sets `core.autocrlf=true` in its *system* config, so checkouts get
> CRLF endings even if you've configured nothing — every shell script then
> fails with `cannot execute: required file not found` or `$'\r': command not
> found`. `/mnt/c` bind mounts are also slow.

## 4. Create your host_vars from a template

```bash
cd local-setup/ansible
cp inventory/host_vars/localhost-slim.yml.example inventory/host_vars/mybox.yml
# 32 GB machine? use localhost-full.yml.example instead
```

The defaults are validated — one line needs setting for a local bring-up, and the
first `./deploy.sh` stops in about two seconds to tell you so:

```
[FAIL] fastpath-data-wipe-ack: db_fast_path: true requires db_fast_path_ack_data_wipe: true
```

Set `db_fast_path_ack_data_wipe: true` in your file and re-run. That gate exists because
enabling the DB fast path on a machine that already holds a database replaces it with the
shipped snapshot — on a laptop doing a first bring-up there is nothing to lose, so this is
a one-line confirmation.

If you have run DIGIT on this machine before and the postgres container is
currently stopped, the deploy may stop with "Could not determine where this box
keeps its PostgreSQL data" — Docker Desktop keeps volume data inside a VM, so
the check cannot see it while nothing is running. Start the stack first, or set
`pg_allow_data_loss: true` once you are sure there is nothing here to keep.

The filename (`mybox`) is just your tenant handle for `deploy.sh`.

## 5. Deploy (as root)

Root is required: the play installs Docker, writes system config, and
regenerates `inventory/hosts.yml`.

```bash
sudo -i
cd /home/<you>/projects/Citizen-Complaint-Resolution-System/local-setup/ansible
./deploy.sh mybox
```

Don't know your WSL sudo password? Windows can give you a passwordless root
shell in the distro, which works just as well:

```powershell
wsl -d Ubuntu-24.04 -u root
```

**If you skipped the `.wslconfig` step**, the first run stops early on purpose:
the play writes the memory caps and fails fast, because Ansible can't restart
the VM it runs inside. Run `wsl --shutdown` from PowerShell, reopen Ubuntu, and
re-run the same command.

From there it runs Docker Engine install, the mount-propagation fix, image
pull, Node 20 install, UI builds, stack up, health waits, and validation
probes. Watch it live from a second terminal:

```bash
tail -f /opt/digit/digit-stack-up.mybox.progress
```

A cold first run is ~30 min, mostly image pull and the UI builds — it's
bandwidth-bound. Re-runs into a healthy stack are idempotent, 5–7 min.

### What success looks like

```
TASK [validate — summary]
    "===== INFRA VALIDATION RESULTS =====",
    "All containers:        HEALTHY",
    "Public UI:             200 OK",
    "Configurator:          200 OK",
    "Gatus /status/:        SKIPPED (disabled)",
    "MCP /mcp:              200 OK",
    "Auth flow:             access_token minted",
    "MDMS StateInfo:        non-empty",
    "OpenBao:               unsealed + initialized",
    "===================================="

PLAY RECAP
mybox : ok=144  changed=34  unreachable=0  failed=0  skipped=240
```

`failed=0` is the thing to check.

## 6. Verify + log in (from your Windows browser)

| What | URL |
|------|-----|
| Employee UI | http://localhost/digit-ui/ — `ADMIN` / `eGov@123`, select **City A** |
| Citizen SPA | http://localhost/citizen/ |
| Configurator (DIGIT Studio) | http://localhost/configurator/ |
| Grafana | http://localhost/**grafana**/ |

```powershell
foreach ($u in 'digit-ui','citizen','configurator','grafana') {
  $url = "http://localhost/$u/"
  try   { "{0,-14} {1}" -f $u, (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 20).StatusCode }
  catch { "{0,-14} {1}" -f $u, $_.Exception.Response.StatusCode.value__ }
}
```

All four return `200`.

> **The Gatus health board is off by default.** `nginx_features.status` is
> `false` in both localhost templates — the board maps every internal component
> and its health, so it is no longer published without a password. To enable
> it, set `nginx_features.status: true` **and** `status_basic_auth_password`
> in your host_vars (the deploy asserts on the second), then browse
> `/status/` and authenticate.

> **Grafana is at `/grafana/`, not `localhost:13000`.** Docker publishes
> Grafana and OpenBao to the WSL VM's loopback only, and WSL2's NAT-mode relay
> doesn't forward those to Windows. Everything you need is proxied through
> nginx on port 80. If you want the raw ports, add `networkingMode=mirrored`
> to `[wsl2]`, or curl them from inside WSL.

## Day-to-day

```bash
wsl -d Ubuntu-24.04 -u root
cd /home/<you>/projects/Citizen-Complaint-Resolution-System/local-setup/ansible
./deploy.sh mybox        # idempotent — also the "bring it back" command
```

Container data persists in Docker volumes; the stack directory is `/opt/digit`.
Keep `/opt/digit/.openbao/init.json` safe — it holds the OpenBao unseal key and
root token for re-deploys.

Stop without losing data:

```bash
docker compose -f /opt/digit/docker-compose.egov-digit.yaml \
               -f /opt/digit/docker-compose.fast-path.yml down
```

A Windows reboot or an explicit `wsl --shutdown` still needs a `./deploy.sh`
re-run to bring the stack back.

## If something breaks

| Symptom | Cause / fix |
|---------|-------------|
| Every URL 502s, `docker ps` shows a fraction of the stack | WSL idled the distro or VM down. Set both timeouts in `.wslconfig` (step 1), `wsl --shutdown`, then `./deploy.sh mybox`. |
| Deploy hangs or fails at the NodeSource GPG key task | You're on a playbook predating the `gpg --batch --yes` fix. Update. |
| Deploy fails on the **last** task: `OpenBao ... 503`, `"sealed": true` | Playbook predating the re-unseal fix. Update, or re-run to work around it. |
| `cannot execute: required file not found` / `$'\r'` errors | You're in a Windows-side clone. Re-clone inside WSL (step 3). |
| `Permission denied: inventory/hosts.yml` | Run `deploy.sh` as root (step 5). |
| Deploy frozen AND new WSL windows won't open | VM memory starvation — the `.wslconfig` caps aren't applied. `wsl --shutdown`, reopen, re-run. |
| `x509: certificate has expired` on image pull | The preview registry's cert lapsed; the templates ship an `insecure_registries` workaround. |
| `path / is mounted on / but it is not a shared or slave mount` | Handled automatically (`make-rshared-root.service`); seeing it means you're on a branch without the fix. |
| Containers OOM-killed / restart-looping | `free -h` inside WSL. Slim sits at ~7.5 GiB of the 11 GiB VM — use slim on 16 GB and close heavy Windows apps. |
| Port 80 already in use | Something on Windows owns it: `netstat -ano \| findstr :80`. |

Note: Kong is not published on `localhost:18000` in this profile, so the
`newman ... baseUrl=http://localhost:18000` snippets in
`local-setup/ansible/README.md` don't apply here — go through nginx on port 80.
