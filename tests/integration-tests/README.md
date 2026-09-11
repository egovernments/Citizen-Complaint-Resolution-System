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

# Run against a different deployment (bomet is single-tenant `ke`)
BASE_URL=https://bometfeedbackhub.digit.org \
DIGIT_TENANT=ke \
LOCALITY_CODE=BOMET_BOMET_CENTRAL_CHESOEN \
SERVICE_CODE=RudeBehavior \
npx playwright test

# …or source a ready-made per-deployment env file (see deploy/bomet.env)
set -a; source deploy/bomet.env; set +a && npx playwright test
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
| `SERVICE_CODE` | `IllegalConstruction` | PGR service code for complaint tests (must exist on the deployment) |
| `LOCALITY_CODE` | `NAIROBI_CITY_VIWANDANI` | Boundary locality code for address |
| `EMPLOYEE_USER` / `EMPLOYEE_PASSWORD` | `BOMET_LME` / `eGov@123` | PGR_LME employee for inbox/resolve flows |
| `GRO_USER` / `GRO_PASSWORD` | `KE_GRO` / `eGov@123` | GRO employee — required for the PGR `ASSIGN` action |
| `WARD_CSR_USER` / `WARD_CSR_PASSWORD` | `BOMET_CSR_CHESOEN_…` / `eGov@123` | Ward-scoped CSR (boundary jurisdiction tests) |
| `WARD_CSR_BOUNDARY` / `FORBIDDEN_WARDS` | bomet wards | Leaf ward the CSR is scoped to / sibling wards that must be hidden |
| `CITY_TENANT` | `ke.nairobi` | A real city tenant in the configurator list (tenants-search test) |
| `TENANT_LABEL` | `Bomet County` | Tenant label shown on the login City combobox |
| `SCREENSHOT_DIR` | `/tmp/full-complaint-lifecycle-ui-screenshots` | Directory for UI test screenshots |

See `.env.example` for a complete template, and `deploy/bomet.env` for a
worked per-deployment override file.

## Portability

This suite is meant to run against **any** DIGIT deployment, not just the
one it was authored against (Nairobi). How far that holds depends on the
spec. Every spec falls into one of three tiers — know which tier you're
writing before you add assertions.

### Tier 1 — Platform-portable (runs on any healthy deployment)

Needs only a valid login + correct env **values**; it either asserts
platform/UI *behaviour* or **self-seeds** the data it needs (registers its
own citizen, creates its own complaint, onboards its own throwaway tenant).
These are the bulk of the suite (most of the API surface + self-seeding
flows). They pass anywhere the platform is healthy and the env vars point
at valid values.

**Rule for staying in Tier 1:** assert behaviour, not a particular
deployment's data. Read the rule/label/locale the deployment actually has
(e.g. "the configured locale resolves these keys") rather than pinning a
literal (`sw_KE`, a specific label string, a fixed complaint id).

### Tier 2 — Provisioning-coupled (runs only where the deployment is seeded for it)

Needs the deployment to actually **have** specific entities wired up: a GRO,
a `PGR_LME` *in the department the service routes to*, a ward-scoped CSR, a
known assigned complaint. No env var can conjure these — they must exist in
the deployment's HRMS / role / boundary / service→department topology.

> Real example: PGR `ASSIGN` requires a GRO, and the assignee must be a
> `PGR_LME` whose department matches the complaint's service-code routing.
> On a box where every service routes to an empty department, the flow
> cannot complete no matter how the test is configured — that's a
> deployment data gap, not a test bug.

**Rule for Tier 2:** discover the precondition at runtime and
`test.skip(reason)` when it's absent, instead of failing red. A missing
persona on deployment X should read as "skipped: no PGR_LME in dept Y", not
as a failure. Prefer a shared resolver (look up a valid persona from HRMS)
over a hardcoded username.

### Tier 3 — Deployment-pinned (avoid; refactor toward Tier 1)

Hardcodes one deployment's data into assertions (`ke.nairobi`, `sw_KE`,
exact label text, "31 boundaries", a fixed complaint id). These only pass
on the one box whose data matches. Treat any new Tier-3 assertion as a
smell: parameterize the value via env, or rewrite it as a behavioural
(Tier-1) check.

### Practical checklist for a portable spec

- Read deployment values from `tests/utils/env.ts` — never inline a tenant,
  user, locale, service code, or boundary literal in a spec.
- Self-seed data where you can (register citizen, create complaint/tenant)
  instead of assuming pre-existing inventory.
- When you genuinely need seeded state (Tier 2), `test.skip()` with a clear
  reason if it's missing — don't fail.
- Assert *behaviour and shape*, not a specific deployment's *values*.
- Put per-deployment values in an env file (see `deploy/bomet.env`), not in
  code defaults — code defaults should track the canonical reference
  deployment only.

## Test Suites

Specs are organised by **persona** (citizen / employee / admin) plus a
shared `lifecycle/` directory for cross-persona end-to-end flows. Date-
stamped specs (`*-fixes-YYYY-MM-DD.spec.ts`) capture regressions for a
specific fix wave; future fix waves should add assertions to the
existing persona spec, not a new dated tree.

### `tests/citizen/`

- `citizen-otp-login.spec.ts` — OTP login (auto-register + fixed OTP)
- `citizen-logout.spec.ts` — logout flow ends on the login page
- `complaint-detail-page.spec.ts` — detail page loads without crashing
- `complaint-type-dropdown-labels.spec.ts` — translated category names
- `pgr-home-layout-and-scroll.spec.ts` — citizen-side regression smoke (CCRS#421/#422/#441)
- `complaint-create-payload-contract.spec.ts` — pincode + AddressOne/Two populators
- `complaint-timeline-and-rating-display.spec.ts` — rating + timeline localization

### `tests/employee/`

- `citizen-otp-login.spec.ts` — token + UI session injection
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
