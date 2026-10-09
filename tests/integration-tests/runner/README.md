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
  `flock` is the cross-process lock.

## Retention

Two tiers, so the dashboards can show a month of results without keeping a
month of videos:

| What | Kept for | Set by |
|------|----------|--------|
| Run summaries + each test's per-run result (`history.json`, `catalog.json`) | newest **30** runs | `HISTORY_LIMIT` in `scripts/build-catalog.ts` (env `HISTORY_LIMIT` overrides) |
| Full report — `runs/<id>/`: Playwright HTML report, videos, traces, `run.log` | newest **`RUN_LIMIT`** runs | `RUN_LIMIT` (`RUNNER_RUN_LIMIT` for button runs; the nightly wrappers pass their own) |

`build-catalog.ts` marks every run summary `hasReport: true|false` from what is
on disk and `RUN_LIMIT`; `run-cycle.sh` then deletes exactly the folders marked
false, so disk and catalog always agree. A run that lost its report keeps its
counts and per-test results in both dashboards, but nothing links into it
("report pruned"). Once pruned, a run stays pruned even if `RUN_LIMIT` is raised
later. Give button runs and scheduled runs on the same box the same `RUN_LIMIT`,
or each kind prunes to its own.

## Dashboards and the run window

Both dashboards show the runs **five at a time, newest first**, with
**‹ Newer / Older ›** and a "runs 6–10 of 30" indicator: the run chips (v1 top
bar), the per-test dots and the per-test run history follow the window, and so
does the v2 home page's run trend. The page is kept across refreshes: v1 in the
URL (`?runs=2`), v2 in the react-admin store (localStorage), shared by its list,
test and home views.

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
