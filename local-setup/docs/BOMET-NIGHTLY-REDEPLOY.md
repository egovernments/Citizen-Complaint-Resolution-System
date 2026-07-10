# Bomet Nightly Redeploy — Operations Runbook

How the **bomet** reference box tracks `develop`: a self-healing wrapper that
reconverges the whole stack from the latest `develop` every night, plus the
overlay/heal machinery that keeps a long-lived box healthy across upstream
changes. This documents the *operational* behaviour so an on-call can read a run,
re-run it by hand, and tell real failures from expected noise.

> The wrapper script itself (`/usr/local/bin/bomet-redeploy.sh`) lives **on the
> box**, not in this repo — it encodes box-specific self-healing that a plain
> `./deploy.sh bomet` doesn't do. This runbook is the repo-side reference for it.

## TL;DR

| | |
|---|---|
| **What runs** | `/usr/local/bin/bomet-redeploy.sh` (on-box) |
| **When** | `/etc/cron.d/bomet-redeploy` → `30 15 * * *` (15:30 UTC / 21:00 IST) |
| **Log** | `/var/log/bomet-deploy/cron-<TS>.log` (the wrapper `exec`s its own stdout here) |
| **Source** | `git reset --hard origin/develop` in `/opt/ccrs` (origin = egovernments) |
| **Tenant** | `ke` (state root) / `ke.bomet` (city) |
| **Run by hand** | `setsid bash -c /usr/local/bin/bomet-redeploy.sh </dev/null &` then `tail -f` the newest `cron-*.log` |

> **Gotcha:** the wrapper does `exec >"$LOG" 2>&1` at start, so if you launch it
> with your own `> mylog` redirect that file stays **empty** — always read the
> `cron-<TS>.log` it opens.

## Phases (in order)

1. **`pre_backup`** — `pg_dump` to `/opt/digit/nightly-backups/<TS>/`. The wrapper
   **never** runs `docker compose down -v` / volume prune: the encryption key
   lives in a named volume and wiping it breaks every login.
2. **`sync_develop`** — `git fetch origin develop && git reset --hard
   origin/develop` in `/opt/ccrs`. **This discards any on-box edits under
   `/opt/ccrs`** (nginx template, compose overlays) — durable fixes must land in
   `develop`, not on the box.
3. **`build_and_push`** — builds every service image from the fresh `develop` and
   pushes `:nightly-develop` (+ dated) to the VPC registry. **Non-fatal**: if an
   image fails to build the wrapper logs it and continues the converge on the
   *previous* tag.
4. **`ensure_overlay_fixes`** — see below.
5. **`unseal_bao`** / **`prime_kc_db`** — OpenBao unseal + align the keycloak DB
   user so the converge's first `compose up` passes.
6. **`CONVERGE`** — `./deploy.sh bomet` (the Ansible play).
7. **`heal`** — up to 6× `compose up -d`, waiting for all containers healthy.
8. **`ensure_ke_tenant`** — re-assert the `ke` tenant context (rewrite any
   `pg`→`ke` that a converge reintroduced).
9. **`SMOKE`** — logins, enc-key, PGR system user, complaint count, UI 200s,
   container health.

## Compose file layout (important)

- **Runtime converge / wrapper**: base `= /opt/digit/docker-compose.egov-digit.yaml`
  + `docker-compose.fast-path.yml` + **overlay `/opt/ccrs/local-setup/docker-compose.bomet.yml`**.
- **CI** (`Local Setup CI`, `Tilt CI`): a *different* file —
  `local-setup/docker-compose.yml`. Don't confuse the two when debugging.

### `ensure_overlay_fixes`

Injects three things develop's base compose doesn't provide for bomet:

1. `egov-enc-service` image → the `generatekey-endpoint` build (develop's stock
   enc-service crashes on init against bomet's pre-existing keys).
2. `pgr-services` → `EGOV_INTERNAL_MICROSERVICE_USER_UUID` (the system user the
   PGR **EscalationScheduler** runs as).
3. `novu-worker` → `API_ROOT_URL` (now also in develop's base compose; redundant
   but harmless).

> **Overlay-collision trap (fixed):** once `develop`'s `bomet.yml` shipped its own
> `pgr-services` block (config-driven notifications), a wrapper that *appends* a
> second `pgr-services` block produces a **duplicate YAML key** →
> `docker compose config` fails → the wrapper aborts before the converge. Fix:
> inject the UUID into the *existing* block, and land the UUID in `develop`'s
> `bomet.yml` so no injection is needed (CCRS #1131/#1132).

## Reading a run — expected noise vs real failure

A run can log `FATAL` and still have deployed a healthy stack. Check the **SMOKE**
block, not just the exit status.

| Symptom in the log | Meaning |
|---|---|
| `FAILED: novu-bridge` in `build_and_push` | **Non-fatal.** Converge continues on the prior novu-bridge tag; notifications keep working, but that image's newest merged fixes aren't live until it builds. |
| `FATAL: stack did not reach healthy after 6 passes` | Usually **just `baileys-send-service`** (the WhatsApp sender) being chronically unhealthy. Confirm with `docker ps | grep unhealthy`. Everything else can be green. |
| SMOKE `enc-key id=1 -> ke:true OK` | Logins work — the encryption key survived the converge (the main risk). |
| SMOKE `pgr system UUID present OK` | The escalation overlay applied (auto-escalation will run). |
| SMOKE `... 200 OK` for citizen/digit-ui/configurator | UIs are serving. |

If SMOKE passes those and only `baileys` is unhealthy, **the deploy succeeded**.

## Landing fixes so they survive the nightly

`sync_develop` wipes on-box changes, so anything you hot-patch on the box is
temporary. To make a fix durable, PR it into `develop`. Note on the CCRS merge
gate: `develop` is governed by a **ruleset** (1 approving review + Copilot review
+ **all review conversations resolved**), **not** required status checks — so the
`Local Setup CI` / `Tilt CI` checks are *advisory* (a red run shows `UNSTABLE`,
not `BLOCKED`). `BLOCKED` almost always means unresolved review threads.

## Manual re-run / rollback

- **Re-run**: `setsid bash -c /usr/local/bin/bomet-redeploy.sh </dev/null &`, then
  `tail -f "$(ls -1t /var/log/bomet-deploy/cron-*.log | head -1)"`.
- **Pause the cron**: move `/etc/cron.d/bomet-redeploy` aside (it was parked as
  `/root/bomet-redeploy.PAUSED-*` during notif testing).
- **Rollback**: the wrapper keeps DB dumps under `/opt/digit/nightly-backups/`;
  it does **not** auto-rollback on `FATAL` (it runs SMOKE and reports).
