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
