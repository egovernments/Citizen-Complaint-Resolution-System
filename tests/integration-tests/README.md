# DIGIT Integration Tests

End-to-end Playwright tests for DIGIT — PGR lifecycle (citizen + employee
flows) and the configurator's manage surface (departments, designations,
complaints). Runs against any DIGIT deployment; configured via env vars.

## Quick Start

```bash
npm install
npx playwright install chromium

# Run everything against the default environment (Nairobi)
npm test

# Run a single persona's flows
npm run test:citizen
npm run test:employee
npm run test:admin
npm run test:lifecycle

# Interactive runner
npm run test:ui

# Sanity-check that all specs parse without running them
npm run test:list

# Run against a different deployment
BASE_URL=https://bometfeedbackhub.digit.org \
DIGIT_TENANT=ke.bomet \
LOCALITY_CODE=BOMET_SOTIK \
npx playwright test
```

The first run executes the `setup` project (auth.setup.ts) which logs into
the configurator UI as `ADMIN/eGov@123` (override via `ADMIN_USER`,
`ADMIN_PASSWORD`, `TENANT_CODE`) and writes `auth.json`. All other
projects pick up `storageState: 'auth.json'`. `auth.json` is gitignored.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `https://naipepea.digit.org` | DIGIT deployment base URL |
| `DIGIT_TENANT` | `ke.nairobi` | City-level tenant ID |
| `ROOT_TENANT` | Derived from `DIGIT_TENANT` | State/root tenant ID (e.g. `ke`) |
| `DIGIT_USERNAME` | `ADMIN` | Employee admin username |
| `DIGIT_PASSWORD` | `eGov@123` | Employee admin password |
| `CITY_ADMIN_USER` | `EMP-KE_NAIROBI-000089` | City-level admin username (for UI tests) |
| `CITY_ADMIN_PASS` | `eGov@123` | City-level admin password |
| `CITIZEN_PHONE_PREFIX` | `7` | First digit(s) for valid mobile numbers |
| `FIXED_OTP` | `123456` | OTP value (for mock OTP deployments) |
| `SERVICE_CODE` | `IllegalConstruction` | PGR service code for complaint tests |
| `LOCALITY_CODE` | `NAIROBI_CITY_VIWANDANI` | Boundary locality code for address |
| `SCREENSHOT_DIR` | `/tmp/pgr-lifecycle-ui-screenshots` | Directory for UI test screenshots |

See `.env.example` for a complete template.

## Test Suites

Specs are organised by **persona** (citizen / employee / admin) plus a
shared `lifecycle/` directory for cross-persona end-to-end flows. Date-
stamped specs (`*-fixes-YYYY-MM-DD.spec.ts`) capture regressions for a
specific fix wave; future fix waves should add assertions to the
existing persona spec, not a new dated tree.

### `tests/citizen/`

- `login.spec.ts` — OTP login (auto-register + fixed OTP)
- `logout.spec.ts` — logout flow ends on the login page
- `complaint-details.spec.ts` — detail page loads without crashing
- `complaint-type-labels.spec.ts` — translated category names
- `pgr-fixes.spec.ts` — citizen-side regression smoke (CCRS#421/#422/#441)
- `create-fixes-2026-04-29.spec.ts` — pincode + AddressOne/Two populators
- `timeline-fixes-2026-04-29.spec.ts` — rating + timeline localization

### `tests/employee/`

- `login.spec.ts` — token + UI session injection
- `pgr-fixes-2026-04-29.spec.ts` — assign workflow, role filter, REJECT reasons

### `tests/admin/`

Configurator manage surface (`/configurator/manage/*`) plus admin-scoped
regression checks:
`departments`, `designations`, `complaint-types`, `complaints`,
`employees`, `users`, `tenants`, `boundary-hierarchies`, `localization`,
`theme-editor`, `theme-applied`, `target-tenant-onboarding`,
`pgr-dashboard`, `hardcoding`, `recently-shipped-fixes`,
`configurator-mdms-fixes-2026-04-29`.

Specs that create data use a `PW_${hash}_${kind}` prefix and an
`afterAll` that soft-deletes via the helpers (`mdms _update isActive=false`
for masters, PGR `REJECT` workflow action for complaints). Tests pull
live data dynamically — no hardcoded `ContractDispute` / `DEPT_14` /
`PGR_LME assignee uuid`; if the tenant lacks an HRMS employee with the
needed role, the relevant test calls `test.skip()` with a clear reason.

### `tests/lifecycle/`

Cross-persona end-to-end flows:
- `pgr-api.spec.ts` — pure API lifecycle (~2s)
- `pgr-ui.spec.ts` — pure UI lifecycle (~4 min)
- `pgr-escalation-api.spec.ts` — manual ESCALATE chain
- `api-smoke-2026-04-29.spec.ts` — API helpers reach the deployment
- `filestore-fixes-2026-04-29.spec.ts` — JPEG upload regression

## Project Structure

```
tests/
├── fixtures/
│   └── auth.setup.ts                 # UI login → auth.json (storageState)
├── citizen/                          # citizen persona flows
├── employee/                         # employee persona flows
├── admin/                            # configurator + manage surface
├── lifecycle/                        # cross-persona end-to-end
└── utils/
    ├── auth.ts                       # token acquisition (legacy oauth path)
    ├── citizen-login.ts              # citizen OTP login UI helper
    ├── configurator-auth.ts          # configurator localStorage injection
    ├── env.ts                        # environment config
    ├── manage/                       # admin spec helpers
    │   ├── api.ts                    # reads auth.json, mdms/pgr/hrms calls
    │   ├── codes.ts                  # PW_${hash}_${kind} test codes
    │   └── teardown.ts               # cleanupMdms / cleanupPgrComplaints
    └── launch-fixes/                 # date-stamped fix-wave helpers
        ├── api.ts
        └── ui.ts
```

## CI

`.github/workflows/e2e.yml` is `workflow_dispatch`-only for now — the
manage-surface specs are still being stabilized and we don't want every
PR to wake the suite against the live tenant. Trigger manually from the
Actions tab once secrets `TEST_BASE_URL` and `ADMIN_PASSWORD` are set.

## Prerequisites

- Node.js 18+
- A running DIGIT deployment with:
  - PGR services (`pgr-services`)
  - User service (`egov-user`)
  - Workflow service (`egov-workflow-v2`)
  - Mock OTP (Kong `request-termination` plugin) for citizen login
  - City-level admin employee for UI tests (e.g. `EMP-KE_NAIROBI-000089`)

## Notes

- **API tests** are fast (~2s) and use `fetch()` directly — no browser needed
- **UI tests** use Playwright headless Chromium, take screenshots at each step
- The city-level admin (`CITY_ADMIN_USER`) is needed because DIGIT's `getCurrentTenantId()` returns the employee's login tenant — UI workflow actions require this to match the complaint's city tenant
- Citizen registration uses mock OTP (`FIXED_OTP=123456`) — the Kong gateway returns 200 for `/user-otp` and `/otp` endpoints
