# Integration tests — how they work & how to add them

End-to-end Playwright tests that run against a **live DIGIT deployment** (no mocking).
The same suite must pass on **any** deployment — local Maputo (`mz.maputo`), bomet
Kenya (`ke`), etc. That "deployment-agnostic" rule is the single most important thing
to understand before writing a test.

See also **`docs/TEST-PREREQUISITES.md`** (repo root) for the data a deployment must
have and what each setup step does.

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

Every `npx playwright test` runs these **setup projects first** (dependencies in
`playwright.config.ts`), then the spec projects:

1. **`profile-setup`** interrogates the live deployment once and writes
   `deployment-profile.json` — tenant + label, boundary hierarchy, complaint types,
   PGR workflow actions, mobile/postal patterns, locales, a seed plan, resolved
   personas. It hard-fails if the deployment can't be tested at all (no boundaries,
   no workflow, etc.) so an empty stack fails loudly instead of skipping green.
2. **`setup`** (UI login → `auth.json`), **`api-setup`** (token injection →
   `auth-api.json`), **`citizen-setup`** (one fresh citizen → `citizen-fixture.json`),
   **`lifecycle-setup`** (seeds 3 complaints → `lifecycle-fixtures.json`).
3. Then **`chromium`** (all UI specs), **`api`**, **`smoke`** run.

`utils/env.ts` reads `deployment-profile.json` **synchronously at import time**, so any
spec that imports a value from `env.ts` is automatically deployment-correct.

**`workers: 1`** — specs run one at a time. They share the fixture files above
(`auth.json`, `deployment-profile.json`, …), so **never run two `npx playwright test`
invocations against the same stack at once** — they clobber each other.

## 3. The golden rule: no hardcoded deployment literals

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

This extends to **workflow shape**, not just literals: read a feature's actual
configuration live (e.g. what state `ESCALATE` moves to, whether a filter exists)
rather than assuming one deployment's behaviour.

## 4. Adding a test — checklist

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
3. **Pull deployment values from `env.ts`** (§3) — never hardcode.
4. **Reuse the helpers** instead of rolling your own:
   - `utils/auth.ts` `getDigitToken`, `loadAuth`; `utils/employee-ui.ts`
     `loginEmployeeBrowser`, `getPrincipal`, `readInboxRows`, `fetchService`.
   - `utils/seed.ts` `seedComplaintAsCitizen`, `driveToPendingAtLme`, … (file/assign/
     resolve a complaint — APPLY is always `[CITIZEN, CSR]`, so file as a citizen).
   - `utils/manage/api.ts` `pgrSearch`, `pgrCount`, `mdmsSearch`, `employeeSearch`.
   - `utils/personas.ts` `getPersona`, `resolveSeedPlan` (the exact serviceCode/actor/
     assignee triple PGR will actually accept on this deployment).
5. **Skip, don't fail, when a capability or data legitimately isn't present** — with a
   precise reason (`test.skip(!x, 'no ward-scoped CSR on <tenant>: …')`). Reserve a
   red for a real regression. Never let a spec pass by asserting nothing.
6. **Clean up what you create.** Track created records and soft-delete them in
   `afterAll` (`utils/manage/teardown.ts`); use the `PW_` code prefix
   (`utils/manage/codes.ts` `testCode`) so leftovers are identifiable and never collide.

## 5. Conventions & gotchas (learned the hard way)

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

## 6. Running

```bash
cd tests/integration-tests
set -a; source .env; set +a          # deployment target: BASE_URL, DIGIT_TENANT, …
npx playwright test tests/admin --project=chromium --workers=1
npx playwright test tests/api   --project=api
```

Run **one suite / project at a time** (shared fixtures — §2). The runner
(`runner/run-cycle.sh`) and dashboard (`scripts/build-catalog.ts`,
`scripts/tag-tests.ts`) publish results; the dashboard groups by the tags above.

## 7. Pass / fail / skip — what each means

- **pass** — the behaviour is correct on this deployment.
- **fail** — a real regression, OR a genuine app/deployment defect the test correctly
  catches (keep it red; don't weaken the assertion to go green).
- **skip** — a capability/data/build feature this deployment legitimately lacks, with a
  precise reason. A skip must never hide a failure.
