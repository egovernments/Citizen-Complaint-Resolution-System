# test-runner — the RUN button backend

The dashboards (`dashboard/`, `dashboard-react-admin/`) are **static files** served
by nginx. Nothing in the browser can start Playwright or write into the webroot.
This tiny daemon does — and nothing else. It is what the **"Run tests"** button on
the v2 dashboard talks to.

```
browser ── /integration-tests/api/run ──▶ nginx (basic-auth) ──▶ 127.0.0.1:8181 (this daemon)
                                                                        │ spawns
                                                                        ▼
                                                                 run-cycle.sh
                                              playwright test → build-catalog.ts → copy into /var/www
```

## Why a daemon (and not "just write the results file")

A run takes ~1h, so the button can't be a synchronous request, and *something*
server-side has to actually run Playwright and regenerate `catalog.json` + `runs/`.
This is the smallest thing that can: Node core only, no extra deps.

## Pieces

- **`server.mjs`** — loopback-only HTTP service. nginx is the auth front (same
  `digit-tests` / `.htpasswd-tests` basic-auth as the dashboards), so the daemon
  re-implements no auth; it just refuses any non-loopback client as defense in depth.
  - `POST /run` → `202 {run_id}` or `409 {running}` (single-flight)
  - `GET /run/current` → `{state, run_id, started_at, phase}`
  - `GET /run/:id/log` → live `run.log`
  - `GET /health`
- **`run-cycle.sh`** — one cycle: `playwright test` (nice'd) → `build-catalog.ts`
  → **local** copy of `catalog.json`/`history.json`/`runs/<id>/` into the webroot
  (this is `scripts/publish.sh` with the ssh/rsync swapped for a local copy, since
  serving and running are the same host now) → prune `runs/` (see Retention).
  `flock` on the webroot directory and on the checkout is the cross-process
  lock: one cycle at a time per webroot and per checkout, whether the RUN-button
  daemon (user `digit-tests`, private `/tmp`) or a nightly wrapper (root) starts
  it. A second cycle exits 1 and leaves `runs/` alone. `RUN_LOCK` names another
  file or directory to lock instead of the webroot.
  Run as root (the nightly wrappers, which also create `runs/<id>/` and its
  `run.log` as root), a cycle hands everything it leaves in the webroot (`runs/`,
  including older root-owned run folders, `catalog.json`, `history.json`) to the
  webroot's owner when it exits, and its artifacts in the checkout to the
  checkout's owner, so the daemon (`digit-tests`) can prune and rerun after it.
  A folder a prune cannot delete is named in `run.log`
  (`[run-cycle] could not prune runs/<id> …`).

## Retention

Two tiers, so the dashboards can show 30 runs of results without keeping 30
runs of videos. How long 30 runs last depends on how often the box runs the
suite: about a week at naipepea's four runs a day, about a month on a box that
runs it once a night (bomet).

| What | Kept for | Set by |
|------|----------|--------|
| Run summaries + each test's per-run result (`history.json`, `catalog.json`) | newest **30** runs | `DEFAULT_HISTORY_LIMIT` in `scripts/build-catalog.ts` (env `HISTORY_LIMIT` overrides) |
| Full report — `runs/<id>/`: Playwright HTML report, videos, traces, `run.log` | newest **`RUN_LIMIT`** runs | `RUN_LIMIT` (`RUNNER_RUN_LIMIT` for button runs; the nightly wrappers pass their own) |

`build-catalog.ts` marks every run summary `hasReport: true|false` from what is
on disk and `RUN_LIMIT`; `run-cycle.sh` then deletes exactly the folders marked
false, so disk and catalog always agree. A run that lost its report keeps its
counts and per-test results in both dashboards, but nothing links into it
("report pruned"). Once pruned, a run stays pruned even if `RUN_LIMIT` is raised
later.

Button runs and scheduled runs on one box may pass different limits (naipepea's
nightly wrapper passes `RUN_LIMIT=12`, the button `integration_tests_runner_run_limit`,
default 5). Each run summary records the `RUN_LIMIT` it was built with, and while
any run that still has its report was built with a larger one, every run keeps
that many reports, so a button run no longer cuts the nightly's 12 down to 5.
Lowering the limit everywhere takes effect once the runs built with the old one
have lost their reports, i.e. after at most the old limit's number of runs.
(`publish.sh` prunes its remote host to exactly its own `RUN_LIMIT`, so there
build-catalog follows that.)

## Dashboards and the run window

Both dashboards show the runs **five at a time, newest first**, with
**‹ Newer / Older ›** and a "runs 6–10 of 30" indicator: the run chips (v1 top
bar), the per-test dots and the per-test run history follow the window, and so
does the v2 home page's run trend.

- **v1** names any window but the newest in the URL by its newest run,
  `?runs=2026-10-07_1020_bcf55fd61`, so a refresh or a shared link shows the
  same runs after newer runs arrive (the window then reads e.g. "runs 7–11").
  A link to a run that has aged out of the 30 opens the oldest runs; the old
  `?runs=<page>` form still works and is rewritten to a run id. Without the
  parameter the dashboard shows the newest runs.
- **v2** keeps the page for the browser tab (sessionStorage), shared by its
  list, test and home views, together with the newest run at the time. Once a
  newer run is in the catalog, or in a new tab, it starts on the newest runs
  again: the dots and run history never stay on old runs while the status
  column next to them already shows a newer one.

What each summary covers:

- **Latest run** — the headline counts, the status column/filter, "trend vs
  prior run", pass rate by area/persona: only the newest run's verdicts.
- **Visible window** — dots, run chips, the test page's run history, the v2 run
  trend.
- **Every run kept (up to 30)** — the test page's "Last N runs: x passed · y
  failed …" line and the v2 "Top failing tests (last N runs)" card. These need
  the long window to show flakiness; their labels say how many runs they cover.

## Config (env, set by the systemd unit)

| Var | Default | Meaning |
|-----|---------|---------|
| `RUNNER_PORT` | `8181` | loopback listen port |
| `RUNNER_REPO_DIR` | `..` | vendored `tests/integration-tests` |
| `RUNNER_WEBROOT` | `/var/www/integration-tests` | served dir (catalog.json/runs live here) |
| `RUNNER_TENANT_ENV` | — | env file sourced by the run (BASE_URL/DIGIT_TENANT/…) |
| `RUNNER_RUN_LIMIT` | `5` | keep the full report (`runs/<id>/`) for the newest N runs; results stay for 30 (see Retention) |
| `RUNNER_BRANCH` | `deployed` | branch label recorded in the catalog |
| `RUNNER_JOB` | `run-cycle.sh` | the cycle script (override for tests/custom cycles) |

## Deploy

Opt-in via ansible: `enable_integration_tests_runner: true` +
`nginx_features.integration_tests_runner: true` (and `enable_integration_tests: true`,
since it serves on the same vhost). The playbook installs Playwright browsers,
the `integration-tests-runner.service` systemd unit, and the nginx proxy block.
On `nginx_preserve_vhost` hosts (e.g. Bomet), add the `/integration-tests/api/`
block by hand from `../deploy/nginx-integration-tests.conf`.

## Regression email alerts

`../scripts/regression-alert.mjs` mails the team when a new run regressed. A
systemd timer (`ccrs-test-alerts.timer`) runs it every 5 minutes. Each poll
reads the published `catalog.json`. If a run has appeared since the last poll,
it compares every test with the run before it and sends one mail listing the
tests that:

| Group | Meaning | Mails? |
|---|---|---|
| Regressed | failed or timed out now; passed the last time it ran (a skip in between doesn't count) | yes |
| Now skipped | skipped now; passed the last time it ran | yes |
| Stopped running | passed in the previous run; no result now (cut off by the global timeout, setup failed, …) | yes |
| Fixed | passed now; failed the last time it ran (a skip in between doesn't count) | listed only |

The mail carries the run and previous-run summaries, the "cut short" message,
a GitHub compare link between the two runs' commits, and a dashboard link per
test. A regressed test that had already failed in its recent history is
labelled flaky ("failed 2 of the last 4 runs", counting the runs before this
one in which it ran).

How it behaves:

- **Change-only.** Each run is compared once, so a test that stays red is not
  mailed again, and a run with only fixes sends nothing. A problem that persists
  (say, every run executing nothing) is reported once, on the run where it began.
- **First poll on a box** only records the newest run as the baseline, so
  enabling alerts doesn't mail old news. The same goes for turning them back
  on: turning alerts off (`test_alerts_enabled: false`, or settings the deploy
  refuses) deletes their state along with the timer, units, script copy and
  env file.
- **One mail per poll, so one SMTP login.** Several new runs (RUN-button runs
  between polls, or runs that piled up while sending failed) are each compared
  with their own predecessor, oldest first; the ones with something to report go
  out together as one digest, a section per run.
- **Nothing is sent twice.** The poll writes "sending" to its state file before
  it hands the mail to curl, and sends nothing if it cannot write it (a mail it
  could not record would go out again on every poll). It records the result
  right after. If a poll dies in between (power cut, killed, the second write
  failing), the next one logs a `WARNING ... did not record the result` and does
  not resend: that mail may or may not have arrived.
- **A failed send** (SMTP down, bad password) leaves the runs unhandled, so a
  later poll retries them. Retries back off: 5, 10, 20, 40 minutes, then hourly.
  Each kind of failure below counts on its own, so the schedule starts over
  when the kind changes. A poll that is waiting out the pause logs
  `holding off until …` and exits 0 (the unit is not "failed"); a poll whose
  send failed exits 1. The journal shows each attempt and the relay's reply
  code (`SMTP 250` once it accepted the message). These failures get their own
  message:
  - **`login throttled`** (a 4xx to AUTH, e.g. Gmail's `454 4.7.0 Too many
    login attempts`): the relay has locked logins to the sender account for a
    while. That is not necessarily a wrong password, and every attempt can
    extend the lock, so retries wait 1, 2, then 4 hours. Check the sender
    account for a security alert or lock, and don't retry by hand (each
    `curl`/probe is another attempt).
  - **`login rejected`** (a 5xx to AUTH, e.g. `535 5.7.8`): the user or password
    is wrong, or the account needs an app password (Gmail/Workspace: 2-Step
    Verification on, then an app password). Fix the setting and redeploy.
  - **`STARTTLS or login required`** (a `530`, e.g. `530 5.7.0 Must issue a
    STARTTLS command first` or `530 5.7.0 Authentication required`): not a
    wrong password. Set `test_alerts_smtp_starttls: true` (or
    `test_alerts_smtp_tls: true` on port 465); if the relay needs a login, set
    `test_alerts_smtp_user` and the password.
  - **`sender or recipient refused`** (a 5xx to `MAIL FROM` or `RCPT TO`, e.g.
    `553` for a sender the account may not use, `550` for an unknown
    recipient): fix `test_alerts_from` / `test_alerts_to` and redeploy. Retries
    cannot succeed until then.
- **Longer gaps than the catalog keeps.** The catalog holds the last few runs
  (5, or more if the dashboard's window is raised). When the last run the alerts
  handled has dropped out of it (alerts were off, or sends kept failing), every
  run still in the catalog is compared. The oldest of them has no predecessor
  left, so it is compared with each test's last result at or before the last
  handled run (or the earliest result the test's history still has), and its
  section says so (`Folded: …`, with how many runs in between test histories
  still show). A test that broke in a run that has since dropped out is still
  reported, folded into that oldest run.
- **A catalog older than the state** (restored from a backup, or rebuilt): the
  poll logs a `WARNING`, re-baselines on the catalog's newest run and mails
  nothing.
- **The state file** (`/var/lib/ccrs-test-alerts/state.json`) is replaced in
  one step (written to a temp file, flushed to disk, renamed). If it exists but
  can't be read, is empty or isn't JSON, the poll logs `ERROR: the state file
  … can't be used`, sends nothing and exits 1 until someone deletes it
  (re-baseline on the newest run, mailing nothing) or restores it. Silently
  starting over would skip every run since the last one handled.
- **Optional watchdog:** with `test_alerts_stale_after_hours` > 0 it also mails
  once when no new run has appeared for that long, e.g. because the nightly
  redeploy failed its smoke check and never started the tests.
- Plain Node with no npm dependencies, and curl does the SMTP. A broken
  `npm install` of the suite can't silence its own alerts.

**Limitation: a test that moves to another line.** Test ids are
`file:line:title` (`scripts/build-catalog.ts`), and the catalog drops the
history of an id that no longer exists. An edit that shifts a test to another
line (code added above it, in the same spec file) gives it a new id with no
history. On that run the alert sees a new test with no earlier result, and the
old id is simply gone. So if the moved test fails in that same run, it is
reported neither as regressed nor as stopped running; from the next run on its
last result is already that failure, so it stays unreported until it passes
and breaks again. The dashboard shows it red as usual. The alerter can't fix
this: the history it would need is no longer in the catalog.

### Enable it

The `test_alerts_*` variables, documented in
`local-setup/ansible/inventory/host_vars/_example.yml`, go in that box's
host_vars. The minimum:

```yaml
test_alerts_enabled: true
test_alerts_smtp_host: "smtp.example.org"
test_alerts_smtp_user: "test-alerts@example.org"
test_alerts_from: "CCRS test alerts <test-alerts@example.org>"
test_alerts_to: ["ccrs-test-alerts@example.org"]
```

Put the SMTP password in OpenBao (`bao kv patch <secrets_path>
test_alerts_smtp_password=<value>`), or set `test_alerts_smtp_password` in
host_vars. Then redeploy. The deploy writes `/etc/ccrs-test-alerts.env`
(root-only), copies the script to `/usr/local/lib/ccrs-test-alerts/`
(root-owned) and enables the timer. If anything required is missing or
malformed (for example a recipient that is not one `addr@domain` or
`Name <addr@domain>`) it prints a WARNING and leaves alerts off, so the
deploy itself never fails because of mail settings.

The timer runs that root-owned copy, not the script in the checkout. The
checkout belongs to the test-runner account (`digit-tests`), which also runs
the Playwright suite and the RUN-button daemon, and each poll has the SMTP
password in its environment: a script that account could edit would hand it
the password. A change to the script therefore reaches the box with the next
deploy.

| Variable | Default | Meaning |
|---|---|---|
| `test_alerts_enabled` | `false` | turn the timer on |
| `test_alerts_smtp_host` | — | SMTP server (required) |
| `test_alerts_smtp_port` | `587`, or `465` with `test_alerts_smtp_tls` | SMTP port (465 is blocked outbound on the Hetzner boxes) |
| `test_alerts_smtp_starttls` | `true` | on `smtp://`: `true` requires STARTTLS; `false` uses it only when the relay offers it, which anyone on the path can strip, and the login then goes unencrypted |
| `test_alerts_smtp_tls` | `false` | implicit TLS (`smtps://`) instead; the port then defaults to 465 |
| `test_alerts_smtp_user` | — | SMTP login; omit for an unauthenticated relay |
| `test_alerts_smtp_password` | OpenBao | host_vars value wins over the OpenBao key of the same name |
| `test_alerts_from` | — | sender, `Name <addr>` (required) |
| `test_alerts_to` | — | recipients (required): a list, or one address as a string; each `addr` or `Name <addr>`; a group address is easiest |
| `test_alerts_box_name` | inventory host | label in the subject |
| `test_alerts_dashboard_url` | `https://<domain>/tests/` | base for the per-test links |
| `test_alerts_poll_minutes` | `5` | timer interval, a whole number of minutes, 1 or more |
| `test_alerts_max_list` | `40` | max tests listed per group |
| `test_alerts_stale_after_hours` | `0` (off) | mail once when no new run appears for this long |

### Operate it (on the box)

```bash
systemctl list-timers ccrs-test-alerts.timer        # next / last poll
journalctl -u ccrs-test-alerts.service -n 50        # what each poll compared and sent
cat /var/lib/ccrs-test-alerts/state.json            # last handled run

# Preview the mail for the newest run without sending or touching state:
set -a; . /etc/ccrs-test-alerts.env; set +a
node /usr/local/lib/ccrs-test-alerts/regression-alert.mjs --dry-run --since <previous-run-id>
```

To resend a run's mail, edit `lastRunId` in the state file back to the run
before it. Deleting the state file re-baselines without mailing.
