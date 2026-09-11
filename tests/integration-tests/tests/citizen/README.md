# Citizen tests

End-to-end and API-driven tests that exercise the **citizen** surface of the digit-ui SPA — everything a member of the public sees when they visit `/digit-ui/citizen`. Where a workflow spans citizen + admin actions (e.g. the full complaint lifecycle), the spec still lives here if the *entry point* is the citizen side.

## What's in this folder

| Spec | What it covers |
|---|---|
| `citizen-otp-login.spec.ts` | OTP login flow: mobile → OTP → citizen home |
| `citizen-registration.spec.ts` | Fresh-phone registration: mobile → OTP → name + email → `/all-services` |
| `citizen-logout.spec.ts` | Logout button redirects to login page |
| `login-mobile-input-validation.spec.ts` | Mobile-input pattern, MDMS-driven helper hint, invalid-digit error |
| `citizen-landing-dispatch.spec.ts` | Landing mode dispatch (language-select / auto-skip-home / auto-skip-login) based on tenant config |
| `citizen-home-page.spec.ts` | Citizen home + `/pgr-home` + All Services menu |
| `citizen-help-and-faq.spec.ts` | FAQ, How-it-works, HELPLINE (aux surfaces) |
| `citizen-profile-page.spec.ts` | Profile page render + field shapes |
| `profile-photo-save.spec.ts` | Save avatar photo, persists after reload |
| `profile-avatar-refresh.spec.ts` | Avatar refresh after edit (camera-gated, currently skipped) |
| `file-complaint-wizard.spec.ts` | **Canonical E2E**: walks all 6 wizard steps and asserts confirmation page shows `<PREFIX>-PGR-…` id. Also raw-key localization scan across all steps |
| `wizard-pin-and-boundary-cascade.spec.ts` | Pin location + locality cascade regression (CCRS #469 + #477) |
| `complaint-type-dropdown-labels.spec.ts` | Complaint-type Step 1 dropdown/hierarchy populates with human-readable labels |
| `complaint-create-payload-contract.spec.ts` | API-only contract check for the `_create` payload shape (AddressOne/Two, Kenya 5-digit pincode) |
| `complaint-attachment.spec.ts` | Attachment upload during filing + attachment `<img>` on detail page (CCRS #555) |
| `track-my-complaint.spec.ts` | My Complaints list + detail page + plural `/complaints/:id` URL |
| `complaint-detail-page.spec.ts` | Detail page renders without error fallback |
| `complaint-timeline-and-rating-display.spec.ts` | PGR `_search` returns `service.rating` + `workflow.action=RATE` for rated complaints; localization keys seeded |
| `rate-resolved-complaint.spec.ts` | Citizen rates a resolved complaint (5 stars + feedback checkboxes) |
| `reopen-closed-complaint.spec.ts` | Citizen reopens a closed complaint (title + 4 reason radios + Next) |
| `pgr-home-layout-and-scroll.spec.ts` | PGR home layout padding (CCRS #421) + scroll-to-top on Create New (CCRS #422) |
| `full-complaint-lifecycle-ui.spec.ts` | End-to-end 6-step UI lifecycle: citizen files → admin sees in inbox → admin assigns → admin resolves → citizen sees resolved |

## How to run

All citizen specs against a deployment:

```bash
env BASE_URL=<deployment> DIGIT_TENANT=<city> ROOT_TENANT=<state> ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 TENANT_CODE=<state> \
  npx playwright test --project=chromium tests/citizen/
```

A single spec:

```bash
env BASE_URL=... DIGIT_TENANT=... ROOT_TENANT=... ADMIN_USER=... ADMIN_PASS=... TENANT_CODE=... \
  npx playwright test --project=chromium tests/citizen/file-complaint-wizard.spec.ts
```

Fast reruns after `citizen-fixture.json` and `auth.json` are already on disk — skip re-provisioning:

```bash
env BASE_URL=... DIGIT_TENANT=... ROOT_TENANT=... ADMIN_USER=... ADMIN_PASS=... TENANT_CODE=... \
  npx playwright test --no-deps --project=chromium tests/citizen/<spec>.spec.ts
```

## Setup dependencies

The `chromium` Playwright project auto-runs three setup projects before any spec:

| Setup project | Writes | Purpose |
|---|---|---|
| `setup` (`fixtures/auth.setup.ts`) | `auth.json` | UI-form admin login → storage state for admin-driven specs |
| `citizen-setup` (`fixtures/citizen.setup.ts`) | `citizen-fixture.json` | Provisions ONE citizen for the whole run: mobile from MDMS rule + server-error discovery, PGR id prefix from egov-idgen |
| `lifecycle-setup` (`fixtures/lifecycle.setup.ts`) | `lifecycle-fixtures.json` | Seeds one non-terminal + one resolved+rated complaint for specs that need pinned SRIDs |

Each spec that needs the citizen identity calls `readProvisionedCitizen()` from `../utils/citizen-provision`; the helper reads `citizen-fixture.json`. See the "Adding a new test" section below.

## Environment variables

The suite is deployment-agnostic. All tenant-specific values come from env. Common ones:

| Var | Default | Purpose |
|---|---|---|
| `BASE_URL` | `https://naipepea.digit.org` | Deployment URL |
| `DIGIT_TENANT` | `ke.nairobi` | City-scoped tenant |
| `ROOT_TENANT` | `ke` | State-level root tenant |
| `ADMIN_USER` / `ADMIN_PASS` | `ADMIN` / `eGov@123` | Admin credentials |
| `TENANT_CODE` | `ke` | Tenant code shown on configurator login page |
| `FIXED_OTP` | `123456` | Deployment's mock OTP |
| `TENANT_LABEL` | `Bomet County` | Tenant display name for the city picker |

Full list in `tests/utils/env.ts`.

## Adding a new test

### 1. Pick a filename that describes what the test does

Names should be self-explanatory without opening the file. Rules of thumb:
- Include the subject (`complaint-`, `profile-`, `citizen-`) and the verb/observation (`renders`, `payload`, `cascade`, `dispatch`).
- Skip issue numbers and dates — they go in the test's `annotation.description` or the commit message, not the filename.
- Skip `-spec` or `-test` suffixes — Playwright uses `.spec.ts`.
- Prefer specific over generic: `wizard-pin-and-boundary-cascade.spec.ts` > `wizard-fixes.spec.ts`.

### 2. Use the shared setup — don't re-provision

Every citizen spec should consume the suite-wide provisioned citizen instead of registering its own:

```ts
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { readProvisionedCitizen } from '../utils/citizen-provision';

test.describe('My new citizen flow', () => {
  test('does the thing', async ({ page }) => {
    await citizenOtpLogin(page); // no args = uses provisioned citizen from fixture
    const citizen = readProvisionedCitizen();
    expect(citizen).not.toBeNull();
    // …drive the flow, assert the outcome
  });
});
```

Only pass an explicit phone to `citizenOtpLogin(page, phone)` when the test genuinely needs a fresh citizen (e.g. `citizen-registration.spec.ts`).

### 3. Use MDMS-derived values, not env constants, where possible

If the test constructs a PGR complaint, use `resolveServiceCode()` and `resolveLocalityCode()` from `../utils/launch-fixes/api` — they query MDMS at runtime and pick a code valid for the current deployment. Don't hardcode `SERVICE_CODE` or `LOCALITY_CODE` unless the test is specifically asserting on a known value.

For the complaint-ID prefix (e.g. `NCCG-PGR-…` vs `PG-PGR-…`), read it from `readProvisionedCitizen()?.pgrIdPrefix` — set by `citizen-setup` via egov-idgen.

### 4. Handle both flat and hierarchical wizard shapes

If the test drives Step 1 (complaint-type) of the wizard, either import and reuse the `walkWizard` helper from `file-complaint-wizard.spec.ts`, OR replicate its combobox-iteration pattern that handles both:
- Ethiopia-style flat dropdown (one combobox, click first `[role="option"]`)
- Bomet CRS-style hierarchical drill-down (multiple comboboxes appearing as levels are selected)

See `complaint-type-dropdown-labels.spec.ts` for a lighter version that just enumerates the labels.

### 5. Tag the test

Every test needs `tag: [...]` matching sibling-spec conventions. Common tag families:

| Family | Values |
|---|---|
| `@area` | `@area:pgr`, `@area:auth`, `@area:configurator-manage`, `@area:hrms`, `@area:keycloak`, `@area:proxy` |
| `@kind` | `@kind:smoke`, `@kind:regression`, `@kind:lifecycle`, `@kind:edge-case` |
| `@layer` | `@layer:ui`, `@layer:api` |
| `@persona` | `@persona:citizen`, `@persona:employee`, `@persona:admin`, `@persona:cross` |
| `@local-only` | Apply to specs that hit KC admin (`:18180`) or MDMS direct (`:18000`) — excluded from deployed runs |
| `@ccrs:<n>` | Issue reference for regression guards, e.g. `@ccrs:555` |

Example:

```ts
test('rate page renders 5 stars + 4 feedback checkboxes', {
  annotation: {
    type: 'description',
    description: `Story 6.1 rating page contract. Steps: 1. Log in as provisioned citizen. 2. Navigate to /pgr/rate/<seededSrId>. 3. Assert 5 stars + 4 feedback checkboxes + Comments textarea are visible.`,
  },
  tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'],
}, async ({ page }) => {
  // …
});
```

### 6. Handle real deployment gaps honestly

- If the test hits a known unresolved product bug (not something the test can work around), use `test.fixme(...)` — it counts as an expected failure, not a regression.
- If a test genuinely cannot run against certain deployments (e.g. requires the new CRS backend), use `test.skip(ROOT_TENANT === 'ke', 'ke PGR submit returns JsonMappingException — deployment bug')`.
- Do NOT relax an assertion to hide a real deployment gap. Skip with a clear reason instead.

### 7. Verify against at least one deployment before committing

```bash
cd tests/integration-tests
env BASE_URL=https://subhadev.digitlab.in DIGIT_TENANT=ethiopia ROOT_TENANT=ethiopia ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 TENANT_CODE=ethiopia \
  npx playwright test --no-deps --project=chromium tests/citizen/<your-new-spec>.spec.ts --reporter=list
```

If you're aiming for deployment portability, also verify against Bomet (`bometfeedbackhub.digit.org / ke`).

### 8. Commit convention

Use `feat(tests):` for new specs, `refactor(tests):` for reorganization, `fix(tests):` for spec bug fixes. Reference the CCRS issue if applicable:

```
feat(tests): add complaint reopen validation against reason mandatory field (CCRS#812)
```

## Related folders

- `tests/api/` — API-only specs; runs under the fast `api` Playwright project (no browser)
- `tests/admin/` — Configurator admin-side UI
- `tests/employee/` — Employee/GRO/LME UI flows
- `tests/lifecycle/` — Non-citizen-anchored cross-persona flows (e.g. SLA auto-escalation)
- `tests/onboarding/` — Tenant setup wizard
- `tests/keycloak/` — Keycloak realm / IdP config
- `tests/smoke/` — `@kind:smoke`-tagged fast health checks
- `tests/utils/` — Shared helpers, env, MDMS lookups, provisioning
- `tests/fixtures/` — Setup projects that write shared JSON fixtures
