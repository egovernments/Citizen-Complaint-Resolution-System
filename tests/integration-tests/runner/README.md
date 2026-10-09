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
  serving and running are the same host now). `flock` is the cross-process lock.

## Config (env, set by the systemd unit)

| Var | Default | Meaning |
|-----|---------|---------|
| `RUNNER_PORT` | `8181` | loopback listen port |
| `RUNNER_REPO_DIR` | `..` | vendored `tests/integration-tests` |
| `RUNNER_WEBROOT` | `/var/www/integration-tests` | served dir (catalog.json/runs live here) |
| `RUNNER_TENANT_ENV` | — | env file sourced by the run (BASE_URL/DIGIT_TENANT/…) |
| `RUNNER_RUN_LIMIT` | `5` | keep at most N runs on disk |
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
| Regressed | failed or timed out now; passed the last time it ran | yes |
| Now skipped | skipped now; passed the last time it ran | yes |
| Stopped running | passed in the previous run; no result now (cut off by the global timeout, setup failed, …) | yes |
| Fixed | passed now; failed the last time it ran | listed only |

The mail carries the run and previous-run summaries, the "cut short" message,
a GitHub compare link between the two runs' commits, and a dashboard link per
test. Tests whose 5-run history already had failures are labelled flaky.

How it behaves:

- **Change-only.** Each run is compared once, so a test that stays red is not
  mailed again, and a run with only fixes sends nothing. A problem that persists
  (say, every run executing nothing) is reported once, on the run where it began.
- **First poll on a box** only records the newest run as the baseline, so
  enabling alerts doesn't mail old news.
- **Several runs between polls** (RUN-button runs) are each compared with their
  own predecessor, oldest first.
- **A failed send** (SMTP down, bad password) leaves the run unhandled, so a
  later poll retries it. Nothing is lost, and nothing is sent twice. Retries
  back off (5, 10, 20, 40 minutes, then hourly), because a relay that throttles
  logins, like Gmail's `454 4.7.0 Too many login attempts`, stays throttled
  when it is retried every poll. The journal shows each attempt and the relay's
  reply code (`SMTP 250` once it accepted the message).
- **Optional watchdog:** with `test_alerts_stale_after_hours` > 0 it also mails
  once when no new run has appeared for that long, e.g. because the nightly
  redeploy failed its smoke check and never started the tests.
- Plain Node with no npm dependencies, and curl does the SMTP. A broken
  `npm install` of the suite can't silence its own alerts.

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
(root-only) and enables the timer. If anything required is missing it prints
a WARNING and leaves alerts off, so the deploy itself never fails because of
mail settings.

| Variable | Default | Meaning |
|---|---|---|
| `test_alerts_enabled` | `false` | turn the timer on |
| `test_alerts_smtp_host` | — | SMTP server (required) |
| `test_alerts_smtp_port` | `587` | SMTP port (465 is blocked outbound on the Hetzner boxes) |
| `test_alerts_smtp_starttls` | `true` | require STARTTLS on `smtp://` |
| `test_alerts_smtp_tls` | `false` | implicit TLS (`smtps://`) instead |
| `test_alerts_smtp_user` | — | SMTP login; omit for an unauthenticated relay |
| `test_alerts_smtp_password` | OpenBao | host_vars value wins over the OpenBao key of the same name |
| `test_alerts_from` | — | sender, `Name <addr>` (required) |
| `test_alerts_to` | — | list of recipients (required); a group address is easiest |
| `test_alerts_box_name` | inventory host | label in the subject |
| `test_alerts_dashboard_url` | `https://<domain>/tests/` | base for the per-test links |
| `test_alerts_poll_minutes` | `5` | timer interval |
| `test_alerts_max_list` | `40` | max tests listed per group |
| `test_alerts_stale_after_hours` | `0` (off) | mail once when no new run appears for this long |

### Operate it (on the box)

```bash
systemctl list-timers ccrs-test-alerts.timer        # next / last poll
journalctl -u ccrs-test-alerts.service -n 50        # what each poll compared and sent
cat /var/lib/ccrs-test-alerts/state.json            # last handled run

# Preview the mail for the newest run without sending or touching state:
set -a; . /etc/ccrs-test-alerts.env; set +a
node <tests checkout>/scripts/regression-alert.mjs --dry-run --since <previous-run-id>
```

To resend a run's mail, edit `lastRunId` in the state file back to the run
before it. Deleting the state file re-baselines without mailing.
