# DIGIT Integration Tests

End-to-end Playwright tests for DIGIT — PGR lifecycle (citizen + employee
flows) and the configurator's manage surface (departments, designations,
complaints). Runs against any DIGIT deployment; configured via env vars.

## Quick Start

```bash
npm install
npx playwright install chromium

# Every run targets one box through two env files (deploy/README.md):
#   deploy/<env>.env   tracked: BASE_URL, root tenant, workspace slug, persona logins
#   secrets file       box-local: persona passwords, the fixed OTP
set -a; source deploy/naipepea.env; source "$RUNNER_SECRETS_ENV"; set +a
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
```

`profile-setup` runs first and fails fast, naming every missing variable, when
the env profile is incomplete, or when `IDENTITY_TEST_TENANT_SLUG` does not
resolve (`/identity/v1/tenant-contexts/{slug}`) to `DIGIT_TENANT`. The `setup`
project then signs the admin persona into the Configurator through Keycloak and
writes `auth.json` (gitignored); it fails with a "Workspace gate" message when
the Configurator sends the admin to `/onboarding/...` because the workspace
setup is not DONE.

## Environment Variables

Root tenants only: every persona, citizen and complaint lives at `DIGIT_TENANT`,
the root tenant the workspace slug resolves to. Nothing has a box default.

| Variable | Where | Description |
|----------|-------|-------------|
| `BASE_URL` | profile, **required** | Deployment base URL |
| `DIGIT_TENANT` | profile, **required** | The workspace's root tenant (no `.`) |
| `IDENTITY_TEST_TENANT_SLUG` | profile, **required** | Workspace slug: URLs are `/<slug>/digit-ui/...` |
| `ADMIN_LOGIN` / `ADMIN_PASSWORD` | profile / secrets, **required** | Workspace admin (`ACCOUNT_ADMIN` + the founder's admin roles) |
| `GRO_LOGIN` / `GRO_PASSWORD` | profile / secrets | GRO with a department: drives `ASSIGN` |
| `LME_LOGIN` / `LME_PASSWORD` | profile / secrets | `PGR_LME` in that department |
| `WARD_CSR_LOGIN` / `WARD_CSR_PASSWORD` | profile / secrets | CSR scoped below the hierarchy root (#496) |
| `INBOX_VIEWER_LOGIN` / `INBOX_VIEWER_PASSWORD` | profile / secrets | GRO whose jurisdiction covers the seed locality |
| `SUPERVISOR_LOGIN` / `SUPERVISOR_PASSWORD` | profile / secrets | GRO + `PGR_LME` + `SUPERVISOR`; the specs' `EMPLOYEE_USER` |
| `IDENTITY_TEST_OTP_CODE` | secrets | Fixed citizen OTP on a fixed-OTP box (`FIXED_OTP` still accepted) |
| `KC_REALM` | profile | Keycloak realm (default `digit`) |
| `EXPECTATIONS_FILE` | profile | `deploy/expectations/<env>.json`: which capabilities the box must have |
| `SERVICE_CODE` / `LOCALITY_CODE` | profile | Pin the seed complaint type / locality; discovered when unset |
| `WARD_CSR_BOUNDARY` / `FORBIDDEN_WARDS` | profile | The ward CSR's ward / sibling wards that must be hidden |
| `IGNORE_HTTPS_ERRORS` | profile | `1` for self-signed boxes |
| `RUNNER_SECRETS_ENV` | runner | Path of the box secrets file `runner/run-cycle.sh` sources |

Personas are Keycloak logins (an email) with their own Keycloak password,
linked to a DIGIT employee at `DIGIT_TENANT`; the DIGIT identity comes back
from the BFF's `_select`. Nothing guesses a password: an unset persona is not a
candidate, and a refused sign-in fails at once with Keycloak's own message.
`scripts/seed-personas.ts` creates and links all six on a workspace. The
pre-#2398 names (`DIGIT_USERNAME`, `GRO_USER`, `EMPLOYEE_USER`, `ROOT_TENANT`,
`CITY_TENANT`, `PERSONA_PASSWORD_GUESSES`, …) are rejected by name.

See `.env.example` for a template and `deploy/naipepea.env` / `deploy/bomet.env`
for the two boxes.

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
- Put per-deployment values in the box's env profile (`deploy/<env>.env`) or
  its expectations file, never in code defaults; gate on capabilities
  (`requires()`), never on a hostname or env name.

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
`theme-editor`, `theme-applied`,
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

### `tests/onboarding-real/`

`workspace-lifecycle.spec.ts` (#2266) drives the whole self-service journey
against a real stack, at API level through the public origin:

1. Magic-link signup (link read from Mailpit), PGR signup draft, `_submit`,
   then `operations/_search` until `SUCCEEDED`.
2. Founder `_select`; the workspace starts `NOT_STARTED`.
3. The configurator's step calls, in order: Branding (logo upload,
   ThemeConfig), Geography (2-level hierarchy), Departments (2 departments,
   1 designation), Employees (two GROs and an LME via HRMS `_create` then BFF
   `_link`; the water GRO and the LME follow their activation mail and set a
   password; the roads GRO exists only so every routed department has a GRO,
   and is never activated), Complaint types (2 leaves
   with department and SLA). Every step is marked DONE and the workspace ends
   `DONE` with every probe true. The labels the steps wrote resolve for `en_IN`.
4. GRO and LME sign in through Keycloak; a citizen signs in by OTP at `/{slug}/`
   and files a complaint.
5. The GRO sees it in the TEAM inbox and assigns it, the LME sees it in the MINE
   inbox and resolves it, the citizen rates and closes it, and the workflow
   history reads APPLY, ASSIGN, RESOLVE, RATE.
6. The founder removes the LME: HRMS marks the employee inactive, the BFF drops
   the binding, and the LME's session and DIGIT token stop working.

Any 403, 404 or 5xx on any request fails the run at that call. Each run
creates one new tenant and leaves it behind (there is no tenant delete API);
its slug is `e2e-<letters>` and its tenant id `ee<letters>`.

It is not part of any CI job. Run it by hand against a dev box:

| Variable | Description |
|----------|-------------|
| `ONBOARDING_E2E_BASE_URL` | Public origin of the stack (nginx in front of Kong, the BFF and Keycloak) |
| `ONBOARDING_E2E_MAILPIT_URL` | Mailpit API base, e.g. `http://127.0.0.1:18025/mailpit/api/v1` through an SSH tunnel |
| `ONBOARDING_E2E_OTP_COMMAND` | Shell command that prints the citizen OTP. It gets `OTP_PHONE`, `OTP_TENANT_ID`, `OTP_CHALLENGE_ID` and `OTP_SINCE_MS` |
| `ONBOARDING_E2E_EMAIL_DOMAIN` | Domain for the run's addresses (default `e2e.test`; Mailpit catches all) |
| `ONBOARDING_E2E_MOBILE_PREFIX` / `ONBOARDING_E2E_MOBILE_LENGTH` | Shape of generated mobile numbers (default `7`, 9 digits); checked against the tenant's rule |
| `ONBOARDING_E2E_IGNORE_HTTPS_ERRORS` | `1` for a box with a self-signed certificate |
| `ONBOARDING_E2E_SLUG` | Optional: pin the workspace slug (default a fresh `e2e-<letters>`) to create a box's stable test workspace. The tenant id is the slug's letters (`nairobi` → `nairobi`); the slug must be unused and not reserved, so a pinned run works once per box reset |

With `IDENTITY_CITIZEN_OTP_SENDER=log`, the OTP command can read the BFF log:

```bash
ssh -f -N -L 18025:127.0.0.1:18025 <box>
export ONBOARDING_E2E_BASE_URL=https://<box-domain>
export ONBOARDING_E2E_MAILPIT_URL=http://127.0.0.1:18025/mailpit/api/v1
export ONBOARDING_E2E_OTP_COMMAND='ssh <box> "sudo docker logs --since $((OTP_SINCE_MS/1000-5)) digit-identity-bff 2>&1" \
  | grep identity.citizen_otp.log_sender | sed "s/^[^{]*//" \
  | jq -r --arg t "$OTP_TENANT_ID" --arg p "$OTP_PHONE" "select(.tenantId==\$t and (.phoneNumber|tostring|endswith(\$p))) | .code" | tail -1'
npm run test:onboarding-real
```

A run takes about 2–5 minutes; most of it is tenant provisioning (measured: 4.0 min, then 2.0 min once #2310 removed the provisioning retries). Each run uses
one magic-link request, and the BFF allows 3 per client IP per 30 minutes by
default (`IDENTITY_MAGIC_LINK_REQUEST_LIMIT`), so back-to-back runs from one
machine can stall at "No mail with a sign-in link".

## Project Structure

```
tests/
├── fixtures/
│   ├── profile.setup.ts              # env + slug fail-fast, deployment-profile.json
│   └── auth.setup.ts                 # Configurator sign-in → auth.json (storageState)
├── citizen/                          # citizen persona flows
├── employee/                         # employee persona flows
├── admin/                            # configurator + manage surface
├── lifecycle/                        # cross-persona end-to-end
└── utils/
    ├── auth.ts                       # hosted sign-in + BFF _select, shared browser, token cache
    ├── citizen-login.ts              # citizen OTP login UI helper
    ├── configurator-auth.ts          # configurator localStorage injection
    ├── env.ts                        # environment config (no box defaults)
    ├── personas.ts                   # persona logins checked against roles/HRMS
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
- A DIGIT deployment running `develop`'s identity stack (identity-bff + Keycloak)
  with one root workspace whose onboarding is DONE (create it through
  Configurator signup), and:
  - the six personas linked to Keycloak logins (`scripts/seed-personas.ts`)
  - a fixed citizen OTP (`identity_dev_fixed_otp: true`) for `citizen-setup`

## Notes

- **API tests** are fast (~2s) and use `fetch()` directly — no browser needed
- **UI tests** use Playwright headless Chromium, take screenshots at each step
- Staff tokens come from a Keycloak hosted sign-in plus the BFF's `_select`;
  `getDigitToken()` keeps one browser per worker and caches each token per
  (user, tenant, surface), so a persona signs in once per worker
- Citizens sign in by phone OTP through the BFF (`IDENTITY_TEST_OTP_CODE` on a fixed-OTP box)
