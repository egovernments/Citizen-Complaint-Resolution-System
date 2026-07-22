# Integration tests — how they work & how to add them

End-to-end Playwright tests that run against a **live DIGIT deployment** (no mocking).
The same suite must pass on **any** deployment — local Maputo (`mz.maputo`), bomet
Kenya (`ke`), etc. That "deployment-agnostic" rule is the single most important thing
to understand before writing a test.

---

## 1. Layout

```
tests/integration-tests/
  playwright.config.ts        # projects, timeouts, workers
  tests/
    citizen/  employee/  admin/   # UI specs, grouped by who uses the screen
    api/  smoke/                   # API-only specs (token-injection auth)
    keycloak/  lifecycle/  specs/  onboarding/
    fixtures/                      # SETUP projects (run before specs) + auth files
    utils/                         # env, profile, probes, personas, seed, helpers
  scripts/                    # build-catalog.ts (dashboard), tag-tests.ts (tagging)
```

## 2. How a run works (the pipeline)

Every `npx playwright test` runs these **setup projects first** (declared as project
dependencies in `playwright.config.ts`), then the spec projects:

1. **`profile-setup`** → writes `deployment-profile.json`. Interrogates the *live*
   deployment once (`utils/profile.ts` `discoverProfile()`): tenant + label (from
   localization), boundary hierarchy shape + a proven leaf, complaint types, PGR
   workflow actions, mobile regex, postal pattern, populated locales, the **seed plan**
   (serviceCode + localityCode + idPrefix), and the resolved **personas** (logs each in,
   records which tenant accepted it). It **hard-asserts** the anti-vacuous-pass guards
   (rows 1, 3, 4, 5, 6 in §3) so an empty stack fails loudly instead of skipping green.
2. **`setup`** (real UI login at `/configurator/login` as ADMIN → `auth.json`; *skips*
   if the configurator isn't deployed).
3. **`api-setup`** (token injection, no UI → `auth-api.json`; used by `api` + `smoke`).
4. **`citizen-setup`** (one fresh citizen per run → `citizen-fixture.json`).
5. **`lifecycle-setup`** (seeds 3 complaints → `lifecycle-fixtures.json`: one
   non-terminal at `PENDINGFORASSIGNMENT`, one assigned at `PENDINGATLME`, one walked
   ASSIGN→RESOLVE→RATE to `CLOSEDAFTERRESOLUTION` rating=4). Always files as a CITIZEN
   (APPLY is `[CITIZEN, CSR]` everywhere). If no viable seed triple exists it writes a
   `status: skipped` marker and **passes** — downstream specs fall back to their own
   env/historical defaults rather than cascade-failing.

Then the spec projects run: **`chromium`** (all UI specs), **`api`** (`tests/api`),
**`smoke`** (`tests/smoke`). `@local-only` specs run only when `LOCAL_STACK=1`.

`utils/env.ts` reads `deployment-profile.json` **synchronously at import time** — that
ordering (a project dependency, not a `beforeAll`) is why any spec that imports a value
from `env.ts` is automatically deployment-correct.

**Fixture files written to the suite root** (shared, per-invocation state):
`deployment-profile.json`, `auth.json`, `auth-api.json`, `citizen-fixture.json`,
`lifecycle-fixtures.json`. Because they're shared, **`workers: 1`** and you must **never
run two `npx playwright test` invocations against the same stack at once** — they
clobber each other's profile + auth + seed fixtures.

## 3. Data a deployment must have

The suite *discovers* these live (§2) rather than hardcoding them — but discovery can
only find what the deployment was seeded with. If a row is missing, the paired setup
step either **hard-fails** (suite stops) or **self-skips** (that capability's specs
skip, not fail).

| # | Data | Service / MDMS | Missing → | Guard |
|---|------|----------------|-----------|-------|
| 1 | Tenant hierarchy: root + city (e.g. `mz` / `mz.maputo`) | tenant-management | can't resolve TENANT | hard-fail |
| 2 | City display label `TENANT_TENANTS_<CITY>` in `en_IN` | localization | login combobox spins → 120s timeout | warn (falls back to guess) |
| 3 | Boundary hierarchy, ≥2 levels, ≥1 leaf node | boundary-service + MDMS boundary | no complaint can be filed | **hard-fail** |
| 4 | PGR `BusinessService` **at the city tenant**, ≥1 action | egov-workflow-v2 | no workflow to drive | **hard-fail** |
| 5 | Complaint types (`RAINMAKER-PGR.ServiceDefs` / `ComplaintHierarchy`) at city | MDMS v2 | nothing to file | **hard-fail** |
| 6 | An **employee persona** the seed plan can use: a GRO actor + a PGR_LME assignee whose HRMS department matches a complaint type's department | egov-hrms | ASSIGN 400s `DEPARTMENT_NOT_FOUND`; setup can't seed | **hard-fail** (employee persona), else lifecycle self-skips |
| 6b | **Escalation suite only:** ≥2 *more* employees in the seed complaint-type's department (≥3 total incl. the assignee), to build the 2-level `reportingTo` chain | egov-hrms | `pgr-escalation` tests 3–12 self-skip | self-skip |
| 7 | `MobileNumberValidation` regex | common-masters MDMS | phone gen falls back to `7`-lead (Kenya) | degrades |
| 8 | Postal config `CORE_POSTAL_CONFIGS.postalCodePattern` in SPA globalConfigs | globalConfigs.js | falls back to 5-digit rule | degrades |
| 9 | PGR id prefix (segment before `-PGR-`) | egov-idgen | falls back to `NCCG` | degrades |
| 10 | Localization messages for `en_IN` (+ any locale under test), incl. workflow action labels (ESCALATE, …) | localization | label assertions skip/fail | per-spec |
| 11 | `RejectionReasons`, `Department`, `Designation` masters | MDMS v2 | admin/HRMS specs skip | per-spec |
| 12 | Citizen self-registration + fixed OTP `123456` | user-service (+ OTP disabled/fixed) | citizen-setup fails | hard-fail (citizen specs) |
| 13 | **Optional:** Keycloak realm + OIDC discovery | keycloak | `tests/keycloak/*` self-skip | self-skip |

A deployment's onboarding (XLSX + `deploy.sh`) may not seed all of these — close the
gaps by hand on the test tenant.

## 4. The golden rule: no hardcoded deployment literals

Every deployment-shaped value resolves through one chain:

```
explicit env var  →  deployment-profile.json  →  legacy hardcoded default
```

Do **not** hardcode: tenant (`ke`, `mz.maputo`), phone prefix (`+254`), a complaint
type (`ContractDispute`, `reparo_buracos`), a postal format, a boundary/ward code, an
id prefix (`NCCG`), a tenant label ("Bomet County"), a specific SRID, a username
(`EMP001`). Instead, import from `utils/env.ts`:

```ts
import { TENANT, ROOT_TENANT, SERVICE_CODE, LOCALITY_CODE, TENANT_LABEL,
         POSTAL_CODE_PATTERN, LOCALES, PGR_ID_PREFIX, generateCitizenPhone } from '../utils/env';
```

…or resolve it live (MDMS / boundary / workflow lookups via `utils/probes.ts`,
`utils/personas.ts`). A test that "passes" only because a hardcoded literal happens to
match one deployment is a **vacuous pass** — the whole point of this chain is to turn
those into real, portable assertions.

**This extends to workflow *shape*, not just literals** — read a feature's actual
configuration live rather than assuming one deployment's behaviour:
- **ESCALATE model** — Kenya wires it as a **self-loop** on `PENDINGATLME` (status
  unchanged, an escalation *level* increments); a supervisor-tier deployment (maputo)
  wires it as a **forward transition** to `PENDINGATSUPERVISOR`. Read the ESCALATE
  action's configured `nextState` from the businessservice; multi-level self-loop
  assertions self-skip on the forward model.
- **Inbox locality sort** — some deployments sort by the raw leaf boundary code, others
  by a coarser bairro/name key, so a spec cannot assume raw-leaf-code order.
- **Postal / mobile formats, id prefixes, locales** — always from the profile.

## 5. Adding a test — checklist

1. **Put it in the right persona folder** (`tests/admin/`, `tests/citizen/`, …). The
   folder + filename drive its default dashboard tags.
2. **Tag it.** Every `test()` takes an options object with a `tag` array:
   ```ts
   test('does the thing', {
     tag: ['@persona:admin', '@area:pgr', '@layer:ui', '@kind:regression'],
   }, async ({ page }) => { … });
   ```
   Facets (used by the dashboard filters): `@persona:` (admin | citizen | employee |
   cross | system), `@area:` (pgr, hrms, configurator-manage, localization, theme,
   dashboard, auth, mdms-schema, proxy, keycloak, onboarding, manage-boundaries),
   `@layer:` (ui | api), `@kind:` (happy-path | edge-case | regression | smoke |
   lifecycle | validation). Reference a ticket with `@ccrs:NNN` / `@pr:NNN`.
3. **Pull deployment values from `env.ts`** (§4) — never hardcode.
4. **Reuse the helpers** instead of rolling your own:
   - `utils/auth.ts` `getDigitToken`, `loadAuth`; `utils/employee-ui.ts`
     `loginEmployeeBrowser`, `getPrincipal`, `readInboxRows`, `fetchService`.
   - `utils/seed.ts` `seedComplaintAsCitizen`, `driveToPendingAtLme`, … (file/assign/
     resolve a complaint — APPLY is always `[CITIZEN, CSR]`, so file as a citizen).
   - `utils/manage/api.ts` `pgrSearch`, `pgrCount`, `mdmsSearch`, `employeeSearch`.
   - `utils/personas.ts` `getPersona`, `resolveSeedPlan` (the exact serviceCode/actor/
     assignee triple PGR will actually accept on this deployment).
5. **Skip, don't fail, when a capability or data legitimately isn't present** — with a
   precise reason (`test.skip(!x, 'no ward-scoped CSR on <tenant>: …')`). Reserve a red
   for a real regression. Never let a spec pass by asserting nothing.
6. **Clean up what you create.** Track created records and soft-delete them in
   `afterAll` (`utils/manage/teardown.ts`); use the `PW_` code prefix
   (`utils/manage/codes.ts` `testCode`) so leftovers are identifiable and never collide.

## 6. Conventions & gotchas (learned the hard way)

- **Assert on the write's RESPONSE, not an immediate re-search.** pgr-services' search
  index lags the write by a beat — an immediate `_search` after an update reads the
  *old* value. Read the value back from the `_update`/`_create` response.
- **Wait for the XHR before asserting.** Don't race a UI Save:
  ```ts
  const [resp] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/_update') && r.request().method()==='POST'),
    page.getByRole('button', { name: /^Save$/ }).click(),
  ]);
  ```
- **Default to `mode: 'default'`, not `'serial'`.** With `workers:1` both run in file
  order, but `serial` cascade-skips every test after the first failure — hiding the
  real state. Use `serial` only when tests genuinely depend on each other.
- **Locate custom selects/filters by role + name**, e.g.
  `getByRole('combobox', { name: /^Status$/i })` — `getByLabel` misses controls that
  render without a `<label>` association.
- **Two-level tenants:** a complaint's boundary, assignee, and workflow live at the
  **city** tenant (`mz.maputo`), while the citizen lives at the **root** (`mz`). File
  and validate against the correct one.
- **HRMS `employees/_search` needs `offset=0`** (it 500s without it); its
  `roles=`/`codes=` filters are unreliable — search then filter in code.
- **`@local-only`-tagged specs** are excluded unless `LOCAL_STACK=1`.

## 7. Running

```bash
cd tests/integration-tests
set -a; source .env; set +a          # deployment target: BASE_URL, DIGIT_TENANT, …
npx playwright test tests/admin --project=chromium --workers=1
npx playwright test tests/api   --project=api
```

Run **one suite / project at a time** (shared fixtures — §2). The runner
(`runner/run-cycle.sh`) and dashboard (`scripts/build-catalog.ts`,
`scripts/tag-tests.ts`) publish results; the dashboard groups by the tags above.

## 8. Pass / fail / skip — what each means

- **pass** — the behaviour is correct on this deployment.
- **fail** — a real regression, OR a genuine app/deployment defect the test correctly
  catches (keep it red; don't weaken the assertion to go green).
- **skip** — a capability/data/build feature this deployment legitimately lacks, with a
  precise reason. A skip must never hide a failure.
