# Unified CI Workflow Design

## Summary

Merge three separate CI workflows (`local-setup-ci.yaml`, `tilt-ci.yaml`, and new Playwright PGR tests) into a single `ci.yaml` workflow with two parallel jobs.

## Current State

| Workflow | File | Infra Mode | Tests | Timeout |
|---|---|---|---|---|
| Local Setup CI | `local-setup-ci.yaml` | Docker Compose | Jest smoke, Newman/Postman, ci-dataloader, cross-root bootstrap, boundary E2E, telemetry | 45min |
| Tilt CI | `tilt-ci.yaml` | Tilt (wraps Docker Compose) | `tilt ci` health + telemetry | 30min |
| DataLoader E2E | `dataloader-tests.yml` | None (remote env) | Python pytest against chakshu/unified-dev | 45min |

**Out of scope:** `dataloader-tests.yml` stays separate — different trigger path (`utilities/crs_dataloader/**`), tests against remote environments, not local Docker Compose.

## Design

### Architecture: Two parallel jobs in one workflow

```
ci.yaml
├── Job: docker-compose (timeout: 45min)
│   ├── Existing local-setup-ci steps (all preserved, unchanged)
│   ├── NEW: Playwright install
│   ├── NEW: ci-dataloader for pg.citya
│   └── NEW: Playwright PGR E2E tests (5 tests)
│
└── Job: tilt (timeout: 30min)
    └── Existing tilt-ci steps (all preserved, unchanged)
```

Both jobs run in parallel on separate GitHub Actions runners with the same triggers.

### Triggers

```yaml
on:
  push:
    branches: [main, master, feature/*]
    paths: ['local-setup/**']
  pull_request:
    branches: [main, master, develop]
    paths: ['local-setup/**']
  workflow_dispatch:
```

Unchanged from both existing workflows (they already share identical triggers).

### Job 1: `docker-compose`

All existing `local-setup-ci.yaml` steps preserved in order, with three new steps inserted after boundary tests and before telemetry verification:

| # | Step | Status |
|---|---|---|
| 1 | Checkout | Existing |
| 2 | Free disk space | Existing |
| 3 | Verify telemetry in compose files + Tiltfile | Existing |
| 4 | Start services (`docker compose up -d`) | Existing |
| 5 | Wait for infrastructure (Postgres, Redis, Redpanda) | Existing |
| 6 | Wait for all containers healthy (15min) | Existing |
| 7 | Wait for PGR workflow seed | Existing |
| 8 | Verify database data | Existing |
| 9 | Run health checks | Existing |
| 10 | Wait for PGR functional readiness | Existing |
| 11 | Setup Node.js 20 | Existing |
| 12 | Install test dependencies (`npm ci`) | Existing |
| 13 | Run Jest smoke tests | Existing |
| 14 | Test idgen service | Existing |
| 15 | Run Postman core validation | Existing |
| 16 | Run Postman complaints demo (ci-dataloader → `pg.citest`) | Existing |
| 17 | Run cross-root bootstrap test (`ciboot.citya`) | Existing |
| 18 | Run boundary template E2E test | Existing |
| 19 | **Setup Playwright for E2E tests** | **NEW** |
| 20 | **Setup pg.citya for Playwright PGR tests** | **NEW** |
| 21 | **Run Playwright PGR E2E tests** | **NEW** |
| 22 | Verify telemetry events | Existing |
| 23 | Show service logs on failure | Existing |
| 24 | Cleanup | Existing |

#### New Step 19: Setup Playwright

```yaml
- name: Setup Playwright for E2E tests
  run: |
    cd tests
    npx playwright install chromium --with-deps
```

Installs Chromium browser for Playwright. Uses `npx` so it picks up the version from `package-lock.json` (already has `@playwright/test: 1.58.2`).

#### New Step 20: Setup pg.citya

```yaml
- name: Setup pg.citya for Playwright PGR tests
  run: |
    set +e
    CITYA_OUTPUT=$(DIGIT_URL=http://localhost:18000 TARGET_TENANT=pg.citya python3 scripts/ci-dataloader.py 2>&1)
    CITYA_RC=$?
    set -e
    echo "$CITYA_OUTPUT"
    if [ $CITYA_RC -ne 0 ]; then
      echo "FATAL: ci-dataloader for pg.citya failed (exit code $CITYA_RC)"
      exit 1
    fi
    CITYA_SERVICE_CODE=$(echo "$CITYA_OUTPUT" | grep '^CI_SERVICE_CODE=' | cut -d= -f2)
    echo "CITYA_SERVICE_CODE=${CITYA_SERVICE_CODE}" >> $GITHUB_ENV
```

Runs the same ci-dataloader used for `pg.citest`, but targeting `pg.citya` (the default City A tenant used by Playwright UI tests). Creates departments, designations, HRMS employee `CI-ADMIN`, and loads complaint type masters. Parses the output to extract `CI_SERVICE_CODE` for the PGR tests.

#### New Step 21: Run Playwright PGR E2E tests

```yaml
- name: Run Playwright PGR E2E tests
  env:
    BASE_URL: http://localhost:18000
    PGR_TENANT: pg.citya
    PGR_STATE: pg
    PGR_CITY: City A
    PGR_USERNAME: ADMIN
    PGR_PASSWORD: eGov@123
    CI_USERNAME: CI-ADMIN
    CI_PASSWORD: eGov@123
  run: |
    cd tests
    CI_SERVICE_CODE="${CITYA_SERVICE_CODE:-RequestSprayingOrFoggingOperation}" \
      npx playwright test e2e/pgr-flow.spec.ts --reporter list
```

Runs 5 Playwright tests:
- 3 UI tests: login, inbox navigation, create complaint form structure
- 2 API tests: create+search, full lifecycle (create → assign → resolve → rate → close)

Uses `ADMIN` for UI tests (has all employee roles) and `CI-ADMIN` for API lifecycle tests (has HRMS employee record with department for PGR ASSIGN).

### Job 2: `tilt`

All existing `tilt-ci.yaml` steps preserved unchanged:

| # | Step |
|---|---|
| 1 | Checkout |
| 2 | Free disk space |
| 3 | Install Tilt v0.33.21 |
| 4 | Run `tilt ci --timeout 20m` |
| 5 | Verify telemetry events |
| 6 | Show logs on failure |
| 7 | Cleanup |

## Files Changed

| Action | File | Description |
|---|---|---|
| **Create** | `.github/workflows/ci.yaml` | New unified workflow |
| **Delete** | `.github/workflows/local-setup-ci.yaml` | Replaced by ci.yaml |
| **Delete** | `.github/workflows/tilt-ci.yaml` | Replaced by ci.yaml |
| **Create** | `local-setup/tests/e2e/pgr-flow.spec.ts` | Playwright PGR E2E tests (already written and validated) |
| **Modify** | `local-setup/tests/global-setup.ts` | Bug fix: locale/tenantId/module as query params (already done) |
| **Modify** | `local-setup/tests/playwright.config.ts` | Fix: `localhost` → `127.0.0.1` (already done) |
| **No change** | `.github/workflows/dataloader-tests.yml` | Stays separate |

## Playwright Test File: `tests/e2e/pgr-flow.spec.ts`

Already written, validated, and passing on the remote machine. 5 tests in 2 describe blocks:

```
PGR UI Navigation
  ✓ employee can login and reach home page
  ✓ PGR inbox page loads
  ✓ create complaint form has all required fields
PGR API Lifecycle
  ✓ can create a complaint and search for it
  ✓ full lifecycle: create → assign → resolve → rate & close
```

All environment variables have defaults for local development. CI overrides via workflow env block.

### Global Setup (`global-setup.ts`)

Polls localization API until seed data is available (up to 3 minutes). Verifies `CS_COMMON_SUBMIT` key is present. This prevents race conditions where tests start before localization-seed container finishes.

Bug fix already applied: locale/tenantId/module moved from POST body to query parameters.

## Validation

The Playwright tests have been validated on the remote machine (`root@204.168.184.167:/opt/ccrs`):
- All 5 PGR tests pass in ~1.4 minutes
- Global setup correctly waits for localization
- Tests work with CI environment variables
- `CI_SERVICE_CODE` from ci-dataloader output correctly routes to matching department

## Decisions Made

1. **dataloader-tests.yml stays separate** — Different trigger path, tests remote envs, not related to local-setup
2. **Playwright steps go after boundary tests** — All dataloader/python dependencies are already installed by then, and all DIGIT services are proven healthy
3. **pg.citya gets its own ci-dataloader run** — Reuses the same script as pg.citest, just with different `TARGET_TENANT`
4. **Workflow name: `ci.yaml`** — Short, clear, replaces two files with one
5. **Tilt job has no Playwright tests** — `tilt ci` exits as soon as resources are healthy; adding test steps would require keeping Tilt running, which changes the semantics
