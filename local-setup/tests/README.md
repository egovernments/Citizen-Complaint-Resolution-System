# Tests

## Layout

- `e2e/specs/` — Playwright end-to-end tests against a deployed DIGIT host.
- `e2e/utils/` — shared helpers: `identity.ts` (Identity BFF sign-in, ported from `tests/integration-tests`), `auth.ts` (`loginViaApi`, `getDigitToken`) and `citizen-auth.ts` (citizen phone OTP).
- `e2e/pages/` — page objects used by some specs.
- Jest-based schema/smoke tests live at the top level (`smoke/`, `static/`, see `package.json`); `npm test` runs them against the local compose stack.

## Running the E2E suite

The browser specs run against a deployed host on one **root** workspace
(city tenants are out of scope, #2398). They read the same env names as
`tests/integration-tests`, and have no defaults: a missing value fails the run.
Serving tenant routes from the local compose stack is not supported.

```bash
cd local-setup/tests
npm ci
npm run test:e2e                 # headless
npm run test:e2e:headed          # see the browser
```

Run a single spec:

```bash
npx playwright test --config=e2e/playwright.config.ts e2e/specs/pgr-inbox-pagination.spec.ts
```

### Config

| Env var | Meaning |
|---|---|
| `BASE_URL` | Origin of the deployed host |
| `IDENTITY_TEST_TENANT_SLUG` | Workspace URL slug; every spec opens `/<slug>/digit-ui/` |
| `DIGIT_TENANT` | The root tenant that slug resolves to via `/identity/v1/tenant-contexts/<slug>`; `loginViaApi` fails fast on a mismatch |
| `DIGIT_USERNAME` / `DIGIT_PASSWORD` | Admin persona's Keycloak login (staff sign in through Keycloak and the Identity BFF). It must hold GRO: it assigns complaints and runs the HRMS lookups |
| `EMPLOYEE_USER` / `EMPLOYEE_PASSWORD` | PGR employee persona's Keycloak login (`full-pgr-lifecycle`, `citizen-pgr-complaint-api`): an HRMS employee with `PGR_LME` that complaints are assigned to and resolved by |
| `IDENTITY_TEST_OTP_CODE` | The host's fixed citizen OTP (`identity_dev_fixed_otp: true`); citizen specs sign in a new phone number each run |

`loginViaApi` signs the persona in through the hosted Keycloak form and fails
unless the employee home renders with a session for `DIGIT_TENANT`.
`getDigitToken` posts the same form with Node's `fetch` (no browser) for API tokens.
A worker reuses each persona's BFF session after its first sign-in, while
`/identity/v1/session` reports it live.

The suite targets develop-shaped deployments only: root workspaces, boundary-service,
a seeded `common-masters.MobileNumberValidation` rule. Older deployments run their own
branch's suite, so nothing here falls back to a default or a city tenant.

Citizen OTP sends count against the Identity BFF's hourly limits (5 per phone
and 20 per IP by default). A worker signs each phone in once and later specs
reuse that session, so a run sends about three codes. A refused send with a
`Retry-After` over 60 s fails with a rate-limit message instead of waiting.

## `pgr-inbox-pagination.spec.ts` (issue #916)

Location: `e2e/specs/pgr-inbox-pagination.spec.ts`.

Covers the PGR employee inbox pagination regression: verifies the Next-page
button is enabled once total complaints exceed one page, that clicking it
actually loads different rows, and that the pagination footer shows the real
server-side total rather than the current page's row count (the specific way
this bug kept resurfacing — see the comment block at the top of the spec for
the three separate root causes fixed across #1014/#1058 and the
products/pgr duplicate-hook fix).

Needs a tenant with more than 10 complaints in an inbox-visible status
(`PENDINGFORASSIGNMENT`/`PENDINGFORREASSIGNMENT`/`PENDINGATLME`) to actually
exercise pagination — with 10 or fewer,
the tests skip themselves with a clear reason rather than reporting a false
pass.
