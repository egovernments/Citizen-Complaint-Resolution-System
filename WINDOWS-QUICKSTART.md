# Windows Quickstart — DIGIT via WSL2 in one session

Re-validated **2026-08-31** on Windows 11 (build 26200), 16 GB / i7-1255U,
WSL 2.7.11 + Ubuntu 24.04, from a wiped Docker state. Brings up the full DIGIT
stack with `./deploy.sh <name>` — the playbook self-heals every WSL-specific
quirk (memory caps, mount propagation, Node toolchain), so the happy path is
short. The same steps work on any Linux machine or VM; only the WSL2 sections
are Windows-specific.

## What you get

38 containers: all DIGIT core services, PGR, the employee UI, citizen SPA,
configurator (DIGIT Studio), Kong, host nginx on port 80, Gatus health board,
Grafana/Prometheus/Loki/Tempo observability, OpenBao — on the dump-seeded
`pg` / `pg.citya` tenants. Login works immediately.

Two sizing profiles (see step 4):

| Template | Fits | Difference |
|----------|------|------------|
| `localhost-slim.yml.example` | **16 GB machine** (12 GB WSL VM) | No Novu notifications stack (~2 GB). Everything else identical. |
| `localhost-full.yml.example` | 32 GB machine | Adds Novu (SMS/WhatsApp delivery pipeline). |

## Prerequisites

- **Windows 11.** Step 0's `vmIdleTimeout` fix does not work on Windows 10 —
  see the note there for the Windows 10 workaround.
- Hardware virtualization enabled (Intel VT-x / AMD SVM — usually on by
  default; enable in BIOS if step 1 errors with `0x80370102`).
- ≥ 16 GB RAM and ~60 GB free disk. (Measured: the WSL disk grew to 38 GB
  with the slim profile and a full image set.)
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
uname -a                      # must contain "microsoft ... WSL2"
systemctl is-system-running   # "running" or "degraded" (Ubuntu 24.04 default)
```

If systemd reports `offline`, add to `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

then `wsl --shutdown` in PowerShell and relaunch Ubuntu.

## 2. Stop the WSL VM from shutting itself down  ← do this before deploying

**This is the single most disruptive Windows-only behaviour, and it is not
obvious.** WSL has **two** independent idle timers, and you must disable both:

| Setting | Section | Default | What it stops |
|---|---|---|---|
| `instanceIdleTimeout` | `[general]` | **15000 ms** | the **distro** — systemd runs a full shutdown, taking docker and every container with it. Fires **first**. |
| `vmIdleTimeout` | `[wsl2]` | **60000 ms** | the **VM**, once all distros have stopped. |

Either one kills the stack, because **45 of the stack's 57 containers are
declared `restart: no`** — the next start brings back only the 12
`unless-stopped` ones. The result is a stack that looks alive but 502s on
every URL, with no error anywhere to explain it.

Both were observed on this machine. First `vmIdleTimeout`, via
`journalctl --list-boots`:

```
-3  Mon 2026-08-31 08:58:22 UTC  →  Mon 2026-08-31 10:02:41 UTC
-2  Mon 2026-08-31 10:35:02 UTC  →  Mon 2026-08-31 10:36:09 UTC   (67 s)
-1  Mon 2026-08-31 10:38:28 UTC  →  Mon 2026-08-31 10:38:59 UTC   (31 s)
```

Then, with only `vmIdleTimeout=-1` set, `instanceIdleTimeout` still fired —
note the **kernel boot ID never changed**, so `--list-boots` shows nothing,
and only the journal reveals it:

```
Aug 31 11:20:33 systemd[1]: Stopped target multi-user.target - Multi-User System.
Aug 31 11:20:33 systemd[1]: Stopping docker.service - Docker Application Container Engine...
```

That is the trap: the VM is up, `wsl -l -v` says `Running`, `uptime` shows no
reboot — and the stack is gone anyway.

Put **both** in `%UserProfile%\.wslconfig`:

```ini
[general]
instanceIdleTimeout=-1

[wsl2]
vmIdleTimeout=-1
```

then `wsl --shutdown` from PowerShell and reopen Ubuntu.

> The deploy manages the `memory` / `swap` / `processors` keys in this same
> file (step 5) using `ini_file`, which edits only its own keys — your
> `vmIdleTimeout` line is preserved across deploys. Verified.

> **Windows 10:** `vmIdleTimeout` is Windows-11-only. There, keep an
> interactive Ubuntu terminal open for as long as you need the stack, and
> re-run `./deploy.sh <name>` after it closes.

Either way, **`./deploy.sh <name>` is always the recovery command** — it
brought a fully collapsed stack back green in 5 min 10 s (measured).

## 3. Install the deploy tooling (inside WSL)

```bash
sudo apt update && sudo apt install -y git ansible python3 python3-pip rsync curl
ansible --version    # Ubuntu 24.04's apt ships ansible-core 2.16.3
```

Optional, but `deploy.sh` prints a `WARN` for each if missing — it runs
ansible-lint + yamllint as a static gate before touching anything:

```bash
sudo apt install -y ansible-lint yamllint
```

> **On ansible-core versions.** Earlier revisions of this guide said the
> playbook breaks on ansible-core ≥ 2.19 and told you to pin to apt's. The
> underlying defect — a bare dict used as a `when:` conditional in the
> `core_mobile_configs` preflight — was fixed in `1442b194` (PR #1545).
> Verified on this machine: the pre-fix expression still fails on 2.21.3 with
> `Conditional result (True) was derived from value of type 'dict'.
> Conditionals must have a boolean result`, while the current expression
> evaluates cleanly on both 2.16.3 and 2.21.3.
> See the version-matrix note at the bottom for the full-deploy result.
> The apt package remains the recommended, best-tested path.

## 4. Clone INSIDE the WSL filesystem

```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System
```

> **Never run the stack from a Windows-side clone** (`/mnt/c/...`). This is not
> a style preference — Git for Windows sets `core.autocrlf=true` in its
> **system** config, so it applies even when you've set nothing yourself.
> Measured on this machine, same file in both clones:
>
> ```
> /mnt/c/.../deploy.sh:  Bourne-Again shell script, ..., with CRLF line terminators   (8200 bytes)
> ~/projects/.../deploy.sh: Bourne-Again shell script, ... (no CRLF)                  (8028 bytes)
> ```
>
> Those 172 stray `\r` bytes produce `cannot execute: required file not found`
> and `$'\r': command not found`. `/mnt/c` bind mounts are also slow. Clone
> under your Linux home.

## 5. Create your host_vars from a template

```bash
cd local-setup/ansible
cp inventory/host_vars/localhost-slim.yml.example inventory/host_vars/mybox.yml
# 32 GB machine? use localhost-full.yml.example instead
```

The defaults are validated — nothing needs editing for a local bring-up. The
filename (`mybox`) is just your tenant handle for `deploy.sh`.

## 6. Deploy (as root)

Root is required: the play installs Docker, writes system config, and
regenerates `inventory/hosts.yml`.

```bash
sudo -i
cd /home/<you>/projects/Citizen-Complaint-Resolution-System/local-setup/ansible
./deploy.sh mybox
```

**If you don't know your WSL sudo password**, Windows can hand you a root
shell in the distro with no password at all — this is the more Windows-native
route and is what this guide was validated with:

```powershell
wsl -d Ubuntu-24.04 -u root
```

(Verified: the play's Windows-interop tasks — `cmd.exe /c echo %UserProfile%`
and `wslpath` — work correctly under this root shell.)

### Expect the first run to stop early, once, on purpose

The play writes the WSL memory caps into your Windows-side `.wslconfig`
(12 GB VM / 16 GB swap / 6 CPUs by default) and then fails fast telling you to
apply them — Ansible cannot restart the VM it runs inside:

```powershell
wsl --shutdown        # from PowerShell
```

Reopen Ubuntu and re-run the same `./deploy.sh mybox`. From here it runs
through: Docker Engine install, WSL mount-propagation fix (automatic), image
pull, Node 20 install, UI builds, ~38-container stack up, health waits, and
end-to-end validation probes.

**Watch it live** from a second WSL terminal (the deploy banner prints this):

```bash
tail -f /opt/digit/digit-stack-up.mybox.progress
```

Measured on this machine: a from-scratch run with a warm Docker image cache
took **40 min** (the long poles are the image pull, the `digit-ui-v2` npm
install + vite build, and the local `digit-mcp` image build). From a genuinely
empty image cache, budget longer — the image set is ~29 GB. Re-runs into a
healthy stack are idempotent: **5–6 min** measured across three runs.

### What success looks like

```
TASK [validate — summary]
    "===== INFRA VALIDATION RESULTS =====",
    "All containers:        HEALTHY",
    "Public UI:             200 OK",
    "Configurator:          200 OK",
    "Gatus /status/:        200 OK",
    "MCP /mcp:              200 OK",
    "Auth flow:             access_token minted",
    "MDMS StateInfo:        non-empty",
    "OpenBao:               unsealed + initialized",
    "===================================="

PLAY RECAP
mybox : ok=133  changed=40  unreachable=0  failed=0  skipped=206
```

`failed=0` is the thing to check.

## 7. Verify + log in (from your Windows browser)

| What | URL |
|------|-----|
| Employee UI | http://localhost/digit-ui/ — `ADMIN` / `eGov@123`, select **City A** |
| Citizen SPA | http://localhost/citizen/ |
| Configurator (DIGIT Studio) | http://localhost/configurator/ |
| Health dashboard (Gatus) | http://localhost/status/ |
| Grafana | http://localhost/**grafana**/ |

Check them all from PowerShell in one go:

```powershell
foreach ($u in 'digit-ui','citizen','configurator','status','grafana') {
  $url = "http://localhost/$u/"
  try   { "{0,-14} {1}" -f $u, (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 20).StatusCode }
  catch { "{0,-14} {1}" -f $u, $_.Exception.Response.StatusCode.value__ }
}
```

All five return `200`. Verified from Windows on 2026-08-31.

### Browser end-to-end (verified)

Beyond HTTP 200s, the full employee login was driven through a real headless
Chromium against this deployment — actual form submission, no token injection:

| Check | Result |
|---|---|
| Employee UI loads, redirects to `/employee/user/login` | PASS |
| City dropdown populated | PASS — `CI Test \| PG \| City A \| City B` |
| Login submit enables once username + password + city + privacy are set | PASS |
| `ADMIN` / `eGov@123` / **City A** logs in | PASS — lands on `/digit-ui/employee`, `Employee.token` written to localStorage |
| PGR inbox `/digit-ui/employee/pgr/inbox` renders | PASS |
| Citizen SPA `/citizen/` | PASS — "Citizen sign in" |
| Configurator `/configurator/` | PASS — DIGIT Studio sign-in, Onboarding/Management modes |
| Gatus `/status/` | PASS — every endpoint card green |
| Grafana `/grafana/` | PASS |

Two form details worth knowing if you script this yourself: the city field is a
`button[role="combobox"]`, not a `<select>`; and the privacy checkbox has
`pointer-events: none` on the real input, so you must click
`label[for="privacy-component-check"]` — the Login button stays `disabled`
until both are satisfied.

> **Grafana is at `/grafana/`, NOT `localhost:13000`.** Earlier revisions of
> this guide listed `http://localhost:13000`, which does not work from a
> Windows browser. Docker publishes Grafana and OpenBao to the WSL VM's
> **loopback only** —
>
> ```
> LISTEN  0  511         0.0.0.0:80        <- nginx: reachable from Windows
> LISTEN  0  4096      127.0.0.1:13000     <- grafana: NOT reachable from Windows
> LISTEN  0  4096      127.0.0.1:18200     <- openbao: NOT reachable from Windows
> ```
>
> — and WSL2's NAT-mode localhost relay does not forward those. Everything you
> need is proxied through nginx on port 80, which binds `0.0.0.0` and does
> work. If you specifically need the raw ports from Windows, add
> `networkingMode=mirrored` to `[wsl2]` in `.wslconfig` (WSL ≥ 2.0), or reach
> them from inside WSL with `curl`.
>
> Beware a stale-relay false positive: `Get-NetTCPConnection` can still show
> `wslrelay` listening on a port whose backend is long gone, and a probe
> against it may briefly succeed. Confirm from inside WSL before believing it.

## Day-to-day

```bash
wsl -d Ubuntu-24.04 -u root
cd /home/<you>/projects/Citizen-Complaint-Resolution-System/local-setup/ansible
./deploy.sh mybox        # idempotent — also the "bring it back" command after
                         # a reboot, a wsl --shutdown, or an idle VM shutdown
```

Container data persists in Docker volumes; the stack directory is
`/opt/digit`. Keep `/opt/digit/.openbao/init.json` safe — it holds the
OpenBao unseal key and root token for re-deploys.

Stop without losing data:

```bash
docker compose -f /opt/digit/docker-compose.egov-digit.yaml \
               -f /opt/digit/docker-compose.fast-path.yml down
```

## If something breaks

| Symptom | Cause / fix |
|---------|-------------|
| Every URL 502s, `docker ps` shows ~12 containers instead of 38 | The WSL VM idle-shut-down and only the `restart: unless-stopped` containers came back. Apply step 2, then `./deploy.sh mybox`. |
| Deploy fails on the **last** task: `OpenBao ... Status code was 503`, `"sealed": true` | Fixed — see "Step 6 troubleshooting" below. If you hit it, you're on a playbook without the fix; `./deploy.sh mybox` a second time works around it. |
| `cannot execute: required file not found` / `$'\r'` errors | You're in a Windows-side clone. Re-clone inside WSL (step 4). |
| `Permission denied: inventory/hosts.yml` | Run `deploy.sh` as root (step 6). |
| Deploy frozen AND new WSL windows won't open | VM memory starvation — the `.wslconfig` caps aren't applied. `wsl --shutdown` from PowerShell, reopen, re-run. |
| `x509: certificate has expired` on image pull | `registry.preview.egov.theflywheel.in`'s cert lapsed. The templates ship an `insecure_registries` workaround already. |
| `path / is mounted on / but it is not a shared or slave mount` | Handled automatically (`make-rshared-root.service`) — seeing it means you're on a branch without the fix. |
| Containers OOM-killed / restart-looping | `free -h` inside WSL. At steady state the slim profile sits at ~7.5 GiB of the 11 GiB VM. On 16 GB machines use the **slim** template and close heavy Windows apps. |
| Port 80 already in use | Something on Windows (IIS?) owns it: `netstat -ano \| findstr :80` in PowerShell. |
| `Conditional result was ...` errors at play start | You're on a playbook predating `1442b194`. Update, or use apt's ansible-core. |

## Step 6 troubleshooting — the OpenBao "sealed" failure (root cause + fix)

This is the defect that made earlier Windows attempts fail repeatedly at step 6.

**Symptom.** Everything deploys, all 38 containers go healthy, and then the
very last validation task fails:

```
fatal: [mybox]: FAILED! => {"json": {"initialized": true, "sealed": true, "standby": true},
 "msg": "Status code was 503 and not [200]: HTTP Error 503: Service Unavailable"}
PLAY RECAP
mybox : ok=122  changed=39  unreachable=0  failed=1
```

**Root cause.** Task ordering, not anything Windows-specific — though Windows
users hit it most because they deploy onto a machine whose cached images are
weeks old:

1. `Secrets prep — bring up OpenBao first` starts openbao alone.
2. `OpenBao — unseal if sealed` unseals it. ✅
3. `OpenBao — write secrets into compose .env` changes `.env`.
4. `Pull all images` fetches a **newer openbao image**.
5. `Start DIGIT stack` (`docker compose up -d`) therefore **recreates the
   openbao container** — and OpenBao always comes back **sealed**.
6. `validate — OpenBao /v1/sys/health is unsealed` → 503 → deploy fails.

The playbook *had* re-unseal tasks for exactly this, but they were gated
`when: ansible_system == "Darwin"`, on this stated reasoning:

> *"Darwin only: on Linux the post-OpenBao recreate is a plain up -d that
> doesn't recreate openbao."*

That is true of the **post-secrets** recreate it sits next to — but that isn't
the task that recreates openbao on Linux. `Start DIGIT stack` is, because it
runs after the secrets are written. So **Linux and WSL2 had no re-unseal at
all**, and every first deploy whose openbao image moved failed on its last task.

**Fix.** Remove the Darwin gate so the re-unseal runs on every platform. It is
a no-op when openbao is already unsealed:

```diff
-    - name: "OpenBao — wait for API again after converge#2 (Darwin)"
+    - name: "OpenBao — wait for API again after stack start"
       ansible.builtin.uri:
         url: http://127.0.0.1:18200/v1/sys/seal-status
         status_code: [200]
       register: bao_seal_status_post
       retries: 24
       delay: 5
       until: bao_seal_status_post.status == 200
-      when: ansible_system == "Darwin"

-    - name: "OpenBao — re-unseal after converge#2 if sealed (Darwin)"
+    - name: "OpenBao — re-unseal after stack start if sealed"
       when:
-        - ansible_system == "Darwin"
         - bao_seal_status_post.json.sealed | default(true)
```

`bao_unseal_key` is set unconditionally by `OpenBao — parse init state`
earlier in the play, so it is always available here.

**Verification.** Because the bug only reproduces when the openbao image
happens to change, the fix was verified by fault injection — a temporary task
that seals OpenBao at exactly the point the recreate would:

| | unpatched (run 1) | patched + injected seal (run 4) |
|---|---|---|
| `re-unseal after stack start if sealed` | task didn't exist on Linux | **`ok` — fired** |
| `validate — OpenBao unsealed` | **`fatal` 503 sealed** | **passed** |
| PLAY RECAP | `failed=1` | **`failed=0`** |

**Workaround if you're on an unpatched playbook:** run `./deploy.sh mybox` a
second time. The early `OpenBao — unseal if sealed` task will unseal it, and
`.env` no longer changes, so openbao isn't recreated.

## Known limitations / caveats

- **Grafana and OpenBao are not reachable on their raw ports from Windows.**
  Use `/grafana/` through nginx; use `curl` inside WSL for OpenBao's API.
  `networkingMode=mirrored` lifts this if you need it.
- **The stack does not survive a WSL VM stop.** Step 2 prevents the idle case;
  a Windows reboot or explicit `wsl --shutdown` still needs a re-run of
  `./deploy.sh`. Making the JVM services `restart: unless-stopped` in compose
  would fix this properly and is worth raising separately.
- **Slim profile has no Novu notifications** (SMS/WhatsApp delivery). Use
  `localhost-full.yml.example` on a 32 GB machine.
- **Headroom is tight on 16 GB.** Steady state is ~7.5 GiB used of an 11 GiB
  VM with ~4.2 GiB available. Heavy Windows apps alongside will hurt.
- **Kong is not published on `localhost:18000`** in this profile. The
  `newman ... baseUrl=http://localhost:18000` snippets in
  `local-setup/ansible/README.md` do not apply here — go through nginx on
  port 80.
- **ansible-core version matrix** — apt's 2.16.3 is the recommended path.
  A full deploy on **2.21.3** also completed `failed=0` with zero fatals
  (5 m 58 s), so the old "< 2.19" pin is no longer required.

### Three cosmetic defects you will see in a demo

None break the deploy — all three pass validation — but all three are visible
on screen, so know about them before you present. **None are Windows-specific**;
they affect the `localhost-slim` / `localhost-full` profiles on any OS.

1. **Broken logo in the employee UI header.** The header `<img>` resolves to
   `https://s3.ap-south-1.amazonaws.com/pg-egov-assets/pg.citya/logo.png`,
   from `asset_s3_bucket: "pg-egov-assets"` in the template. That object is not
   public/present, so the request fails and the browser renders the `Logo` alt
   text. It is the only failed request on the page.

2. **Raw localization keys in the header** — `TENANT_TENANTS_PG_CITYA` and
   `ULBGRADE_MUNICIPAL_CORPORATION` render instead of readable names.
   Confirmed against the API: `rainmaker-common` returns 730 messages for
   `pg`/`en_IN` and **neither code is among them**. The dump seeds the
   `pg.citya` tenant but not its display-name localizations.

3. **Citizen portal shows the wrong country code.** The sign-in screen shows
   `+254` (Kenya) with a `700000000` placeholder even though the template sets
   `core_mobile_configs.countryCode: "+91"`. Root cause is not config leakage —
   `group_vars/digit.yml` has `core_mobile_configs: {}`, and the built bundle
   contains `+254` hardcoded. `digit-ui-v2/src/pages/CitizenLoginPage.tsx:45`
   reads `gc?.countryCode ?? '+254'`, and `/var/www/citizen/index.html` never
   references `globalConfigs.js` — so the SPA has no way to receive the
   tenant's mobile config and the fallback always wins.
   (`CitizenLayout.tsx:40` additionally hardcodes `+254` unconditionally.)
   On a `+91` tenant this means the citizen portal will validate the wrong
   number format. Worth a separate issue.

## Not included in the slim profile

Novu notifications (SMS/WhatsApp delivery). Everything else — including the
configurator's tenant-onboarding wizard (MCP) — is in. To add Novu you need
~2 GB more headroom: use `localhost-full.yml.example` on a bigger machine.
