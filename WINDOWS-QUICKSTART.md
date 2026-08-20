# Windows Quickstart — DIGIT via WSL2 in one session

Validated 2026-07-29 on a 16 GB Windows machine / WSL2 Ubuntu 24.04. Brings up
the full DIGIT stack with `./deploy.sh <name>` — the playbook self-heals every
WSL-specific quirk (memory caps, mount propagation, Node toolchain), so the
happy path is short. The same steps work on any Linux machine or VM; only the
WSL2 sections are Windows-specific.

## What you get

~40 containers: all DIGIT core services, PGR, the employee UI, citizen SPA,
configurator (DIGIT Studio), Kong, host nginx on port 80, Gatus health board,
Grafana/Prometheus/Loki/Tempo observability, OpenBao —
on the dump-seeded `pg` / `pg.citya` tenants. Login works immediately.

Two sizing profiles (see step 4):

| Template | Fits | Difference |
|----------|------|------------|
| `localhost-slim.yml.example` | **16 GB machine** (12 GB WSL VM) | No Novu notifications stack (~2 GB). Everything else identical. |
| `localhost-full.yml.example` | 32 GB machine | Adds Novu (SMS/WhatsApp delivery pipeline). |

## Prerequisites

- Windows 10/11 with hardware virtualization enabled (Intel VT-x / AMD SVM —
  usually on by default; enable in BIOS if step 1 errors with `0x80370102`).
- ≥ 16 GB RAM and ~60 GB free disk.
- **Do NOT install Docker Desktop** (or disable its WSL integration for this
  distro). The playbook installs Docker Engine natively inside WSL and manages
  its daemon; Docker Desktop's injected `docker` conflicts with it.

## 1. Install WSL2 + Ubuntu (PowerShell as Administrator)

```powershell
wsl --update
wsl --install -d Ubuntu-24.04
```

Reboot if Windows asks, run the install command again if the distro isn't
there yet, then create your Linux user on first launch. Confirm you're in:

```bash
uname -a          # must contain "microsoft ... WSL2"
systemctl is-system-running   # "running" or "degraded" (Ubuntu 24.04 default)
```

If systemd reports `offline`, add to `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

then `wsl --shutdown` in PowerShell and relaunch Ubuntu.

## 2. Install the deploy tooling (inside WSL)

```bash
sudo apt update && sudo apt install -y git ansible python3 python3-pip rsync curl
ansible --version    # ansible-core must be < 2.19 — Ubuntu 24.04's apt (2.16.x) is correct
```

> **Version matters.** The playbook breaks on ansible-core ≥ 2.19. Use the apt
> package; don't pip-install a newer one.

## 3. Clone INSIDE the WSL filesystem

```bash
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System
```

> **Never run the stack from a Windows-side clone** (`/mnt/c/...`). Windows
> git checks out CRLF line endings, which break every shell script with
> errors like `cannot execute: required file not found` or
> `$'\r': command not found`, and `/mnt/c` bind mounts are slow. Clone under
> your Linux home.

## 4. Create your host_vars from a template

```bash
cd local-setup/ansible
cp inventory/host_vars/localhost-slim.yml.example inventory/host_vars/mybox.yml
# 32 GB machine? use localhost-full.yml.example instead
```

The defaults are validated — nothing needs editing for a local bring-up. The
filename (`mybox`) is just your tenant handle for `deploy.sh`.

## 5. Deploy (as root)

```bash
sudo -i
cd /home/<you>/Citizen-Complaint-Resolution-System/local-setup/ansible
./deploy.sh mybox
```

Root is required: the play installs Docker, writes system config, and
regenerates `inventory/hosts.yml`.

**Expect the first run to stop early, once, on purpose.** The play writes the
WSL memory caps into your Windows-side `.wslconfig` (12 GB VM / 16 GB swap /
6 CPUs by default) and then fails fast telling you to apply them — Ansible
cannot restart the VM it runs inside:

```powershell
wsl --shutdown        # from PowerShell
```

Reopen Ubuntu, re-run the same `./deploy.sh mybox`. From here it runs through:
Docker Engine install, WSL mount-propagation fix (automatic), image pull
(tens of GB — the long pole on a first run), Node 20 install, UI builds,
~40-container stack up, health waits, and end-to-end validation probes.

**Watch it live** from a second WSL terminal (the deploy banner prints this):

```bash
tail -f /opt/digit/digit-stack-up.mybox.progress
```

First run from a blank machine: expect 30–60 min depending on bandwidth.
Re-runs into a healthy stack are idempotent and take ~1–2 min.

## 6. Verify + log in (from your Windows browser)

| What | URL |
|------|-----|
| Employee UI | http://localhost/digit-ui/ — `ADMIN` / `eGov@123`, select **City A** |
| Citizen SPA | http://localhost/citizen/ |
| Configurator (DIGIT Studio) | http://localhost/configurator/ |
| Health dashboard (Gatus) | http://localhost/status/ |
| Grafana | http://localhost:13000 |

The play's final `INFRA VALIDATION RESULTS` summary should show every row
green before you ever open a browser.

## Day-to-day

```bash
sudo -i && cd .../local-setup/ansible
./deploy.sh mybox        # idempotent — also the "bring it back" command after
                         # a reboot or wsl --shutdown
```

Container data persists in Docker volumes; the stack directory is
`/opt/digit`. Keep `/opt/digit/.openbao/init.json` safe — it holds the
OpenBao unseal key for re-deploys.

## If something breaks

| Symptom | Cause / fix |
|---------|-------------|
| `x509: certificate has expired` on image pull | `registry.preview.egov.theflywheel.in`'s cert lapsed. The templates ship an `insecure_registries` workaround already; if you removed it, put it back or get the cert renewed. |
| `cannot execute: required file not found` / `$'\r'` errors | You're in a Windows-side clone. Re-clone inside WSL (step 3). |
| `Permission denied: inventory/hosts.yml` | Run `deploy.sh` as root (step 5). |
| Deploy frozen AND new WSL windows won't open | VM memory starvation — the `.wslconfig` caps aren't applied. `wsl --shutdown` from PowerShell, reopen, re-run the deploy (it verifies the caps before doing anything heavy). |
| `path / is mounted on / but it is not a shared or slave mount` | Handled automatically (`make-rshared-root.service`) — seeing it means you're on a branch without the fix. |
| Containers OOM-killed / restart-looping | `free -h` inside WSL; check `dmesg \| grep -i oom`. On 16 GB machines use the **slim** template and close heavy Windows apps. |
| Port 80 already in use | Something on Windows (IIS?) owns it: `netstat -ano \| findstr :80` in PowerShell. |
| `Conditional result was ...` errors at play start | ansible-core ≥ 2.19 — install the apt version (step 2). |

## Not included in the slim profile

Novu notifications (SMS/WhatsApp delivery). Everything else — including the
configurator's tenant-onboarding wizard (MCP) — is in. To add Novu you need
~2 GB more headroom: use `localhost-full.yml.example` on a bigger machine.
