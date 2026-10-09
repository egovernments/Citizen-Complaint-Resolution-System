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
