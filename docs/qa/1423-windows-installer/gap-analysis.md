# #1423 — Windows one-click installer: gap analysis

What the existing `WINDOWS-QUICKSTART.md` (validated 2026-07-29 on Ubuntu-in-WSL)
got wrong or left out, found by running it from scratch on a real Windows 11
machine on 2026-08-31.

**Test machine.** Windows 11 Home 26200, i7-1255U (12 threads), 15.7 GB RAM,
864 GB free, VT-x on, no Docker Desktop. WSL 2.7.11 + Ubuntu 24.04, systemd
`running`, ansible-core 2.16.3 (apt). Profile: `localhost-slim.yml.example`.

**Method.** Wiped all containers, volumes, `/opt/digit`, `/var/www`,
`/etc/nginx` and the stale clone; kept the Docker image cache by agreement.
Fresh `git clone` of `master` (16efd35a) inside WSL. 7 deploy runs.

## Result summary

| Run | What | Duration | Result |
|---|---|---|---|
| 1 | from scratch, **unpatched** master | 7 m 59 s | **`failed=1`** — OpenBao 503 sealed |
| 2 | from scratch, patched | 40 m 05 s | `failed=0` |
| 3 | re-run onto a collapsed stack | 5 m 10 s | `failed=0` |
| 4 | patched + fault-injected seal | 5 m 28 s | `failed=0`, re-unseal fired |
| 5 | idempotent re-run (2.16.3) | 6 m 09 s | `failed=0` |
| 6 | full deploy on **ansible-core 2.21.3** | 5 m 58 s | `failed=0`, 0 fatals |
| 7 | restore after `.wslconfig` change | 4 m 49 s | `failed=0` |

Browser E2E (headless Chromium, real form login): 8/8 PASS.

## Gaps, most severe first

### 1. Step 5 fails on its last task — OpenBao left sealed  (CODE BUG)

* **What's wrong.** The doc says the only expected first-run stop is the
  `.wslconfig` fail-fast. In reality a from-scratch run also dies at the final
  validation with `Status code was 503`, `"sealed": true`.
* **Why.** `Start DIGIT stack` runs *after* `OpenBao — write secrets into
  compose .env` and *after* `Pull all images`. A newer openbao image makes
  `up -d` recreate the container, which returns **sealed**. The re-unseal
  tasks existed but were gated `when: ansible_system == "Darwin"` on the
  incorrect premise that Linux's `up -d` never recreates openbao.
* **Fix.** Remove the Darwin gate (committed). No-op when already unsealed.
* **Operator workaround on an unpatched playbook.** Run `./deploy.sh` twice.
  This is almost certainly why the previous attempt shows ~10 repeated
  `./deploy.sh karun-slim` invocations in `/root/.bash_history`.

### 2. Nothing about WSL idle timeouts — the stack silently dies  (DOC GAP, severe)

* **What's wrong.** Completely absent from the guide. Minutes after a green
  deploy every URL 502s, with no error to explain it.
* **Why.** Two independent timers, **both** must be disabled:
  * `instanceIdleTimeout` (`[general]`, default **15000 ms**) stops the
    *distro* — systemd runs a full shutdown, taking docker with it. Fires
    first. **The kernel boot ID does not change**, so `--list-boots` and
    `uptime` show nothing; only the journal reveals it.
  * `vmIdleTimeout` (`[wsl2]`, default **60000 ms**) stops the VM afterwards.
  45 of 57 containers are `restart: no`, so only 12 return.
* **Add to the doc**, before the deploy step:
  ```ini
  [general]
  instanceIdleTimeout=-1

  [wsl2]
  vmIdleTimeout=-1
  ```
  then `wsl --shutdown`. (`vmIdleTimeout` is Windows-11 only.)
* **Worth fixing properly**: make the JVM services `restart: unless-stopped`
  in compose so the stack survives a VM stop at all. Separate issue.

### 3. Grafana URL is wrong for Windows  (DOC GAP)

* **What's wrong.** Step 6 lists `Grafana http://localhost:13000`. Not
  reachable from a Windows browser.
* **Why.** Docker publishes Grafana and OpenBao to the **WSL VM's loopback**
  (`127.0.0.1:13000`, `127.0.0.1:18200`); WSL2's NAT-mode relay does not
  forward those. nginx binds `0.0.0.0:80` and does work.
* **Change to** `http://localhost/grafana/` (verified 200). For raw ports, add
  `networkingMode=mirrored` to `[wsl2]`, or curl from inside WSL.
* **Trap:** `Get-NetTCPConnection` can still show `wslrelay` on a dead port and
  a probe may briefly succeed — a stale-relay false positive. We hit exactly
  this and briefly believed Kong was up on `:18000` when nothing was listening.

### 4. The `ansible-core < 2.19` pin is stale  (DOC GAP)

* **What's wrong.** Step 2 says "The playbook breaks on ansible-core ≥ 2.19 …
  don't pip-install a newer one."
* **Why it's obsolete.** Fixed by `1442b194` (PR #1545). Verified both ways:
  the pre-fix expression still fails on 2.21.3 (`Conditional result (True) was
  derived from value of type 'dict'`), the current one passes on 2.16.3 and
  2.21.3 — and a **full deploy on 2.21.3 completed `failed=0`**.
* **Change to:** apt's version is recommended and best-tested; ≥ 2.19 is no
  longer known-broken.

### 5. Missing / imprecise setup details  (DOC GAPS, minor)

| Gap | Fix |
|---|---|
| `sudo -i` assumes you know the WSL password | Document `wsl -d Ubuntu-24.04 -u root` — no password, and the play's `cmd.exe`/`wslpath` interop tasks work fine under it (verified) |
| No `mkdir -p ~/projects` before `git clone` | Add it |
| CRLF warning asserted but unexplained | Cite the cause: Git for Windows ships `core.autocrlf=true` in **system** config. Evidence: same file, 8200 bytes w/ CRLF on `/mnt/c` vs 8028 bytes LF in WSL |
| `ansible-lint` / `yamllint` unmentioned | `deploy.sh` WARNs for each; add `sudo apt install -y ansible-lint yamllint` as optional |
| "~40 containers" | Actual: **38** running, 30 healthy |
| No `curl`/PowerShell verification block, no stop/restart section | Added (macOS quickstart has both; Windows didn't) |
| Re-run time "~1–2 min" | Measured **4 m 49 s – 6 m 09 s** across four runs |
| Disk "~60 GB" | WSL disk reached 38 GB used; image set ~29 GB. Figure is fine, now evidenced |

## Non-blocking defects found (not Windows-specific, not fixed here)

All three pass validation but are visible on screen in a demo.

1. **Broken header logo** — resolves to
   `https://s3.ap-south-1.amazonaws.com/pg-egov-assets/pg.citya/logo.png`
   (from `asset_s3_bucket`), which fails. Only failed request on the page.
2. **Raw localization keys** — `TENANT_TENANTS_PG_CITYA`,
   `ULBGRADE_MUNICIPAL_CORPORATION`. `rainmaker-common` returns 730 messages
   for `pg`/`en_IN`; neither code is among them. Seed-data gap in the dump.
3. **Citizen portal shows `+254`** though the template sets `+91`.
   `digit-ui-v2/src/pages/CitizenLoginPage.tsx:45` is
   `gc?.countryCode ?? '+254'`, and `/var/www/citizen/index.html` never
   references `globalConfigs.js` — the SPA cannot receive `core_mobile_configs`,
   so the fallback always wins. `CitizenLayout.tsx:40` hardcodes `+254` outright.
   On a `+91` tenant this validates the wrong number format.

## Checked and found correct (no change needed)

* `build_configurator: false` in the localhost templates is **right** — the
  configurator is served by the `egovio/configurator` container via
  `proxy_pass` to `:18890`, not from `/var/www/configurator`. Verified by
  deleting that directory: `/configurator/` still returned 200.
* The `.wslconfig` memory/swap/processors management and its fail-fast gate
  work exactly as documented, including under `wsl -u root`.
* `make-rshared-root.service` mount-propagation self-heal works.
* The playbook's `ini_file` management preserves hand-added `.wslconfig` keys
  (`vmIdleTimeout` survived a deploy).

---

# Addendum — cold validation on a virgin distro (2026-09-01)

The runs above kept the Docker image cache and an already-installed WSL distro
by agreement, so Steps 1/3 and the Docker install were **asserted, not tested**.
This addendum closes that. A second distro (`digit-fresh`) was installed
alongside the working one and the guide followed verbatim.

## Steps that had never been executed — now verified

| Step | Result on virgin Ubuntu-24.04 |
|---|---|
| `wsl --install Ubuntu-24.04 --name digit-fresh --no-launch` | 108 s |
| `uname -a` contains `microsoft…WSL2` | pass |
| `systemctl is-system-running` | `running` — and `/etc/wsl.conf` **already ships `[boot] systemd=true`**, so the guide's "if systemd reports offline" fallback is dead code on 24.04 |
| Step 3 apt tooling | 2 m 14 s, ansible-core 2.16.3 |
| `git clone` (full, not shallow) | 201 MB, LF endings confirmed |
| Playbook's Docker Engine install (GPG key + apt repo) | Docker 29.7.2, `active` |

**Latent dependency, now confirmed satisfied.** The playbook needs
`community.general.ini_file` and `ansible.posix.synchronize`, but `deploy.sh`
only runs `ansible-galaxy collection install` inside the ansible-lint branch —
so a user without lint tools never installs them explicitly. Verified that
Ubuntu's apt `ansible` package bundles both (community.general 8.3.0,
ansible.posix 1.5.4), so the happy path works. This is load-bearing and
undocumented; worth stating in the guide.

## Lint gate — tested, safe

The guide now suggests `apt install ansible-lint yamllint`. In `deploy.sh`
these are a **hard gate** (`exit 1`), not advice, so recommending them blind was
a risk. Verified against the current playbook:
`yamllint` → line-length warnings only, `exit 0`;
`ansible-lint` → `0 failure(s), 0 warning(s)`, `exit 0`.

## The `.wslconfig` fail-fast — reproduced

Never fired in the earlier runs because the caps were already applied. Removing
them reproduced a virgin machine (VM came up at **7.6 GiB / 12 CPUs**, WSL2's
uncapped default on a 16 GB host). The deploy then failed in **16 seconds**:

```
fatal: [mybox]: FAILED! => {"msg": "This WSL VM is running with 7.6 GB but
.wslconfig now requests 12 GB. ... run `wsl --shutdown`, reopen this distro,
and re-run ./deploy.sh"}
PLAY RECAP: ok=10 changed=1 failed=1     EXIT=2
```

`wsl --shutdown` → re-run → `failed=0`, all validation green (6 m 55 s). The
documented recovery works exactly as written. Also confirmed `ini_file`
appended `memory`/`swap`/`processors` under `[wsl2]` while preserving a
hand-added `[general]` section and all comments.

**Doc flow defect this exposed (fixed):** step 2 (idle timeouts) and the step-6
fail-fast were two unconnected `wsl --shutdown` cycles. Step 2 now sets the
memory caps too, so a first-timer reboots once, not twice.

## Correction to the severity claim on the OpenBao bug

Run 1 failed with a **stale July image cache**. The cold run shows why that
matters: the image is `openbao/openbao:latest` — a **mutable tag**. The
sequence needs the tag to move *between* `Secrets prep — bring up OpenBao
first` and `Pull all images`:

* **Truly cold machine** — openbao is pulled at "Secrets prep", so the later
  `pull` fetches nothing new, `up -d` does not recreate it, and it stays
  unsealed. A genuine first-timer likely does **not** hit this.
* **Any later deploy after `openbao:latest` moves upstream** — the pull swaps
  the image, `up -d` recreates the container, it returns sealed, and the deploy
  dies on its last task.

So this is a **re-deploy / long-lived-box bug**, not a first-install bug — which
matches the previous operator's history exactly: ~10 `./deploy.sh karun-slim`
attempts spread over weeks. The fix and its verification are unchanged; only
the "who hits it" claim needed correcting.
