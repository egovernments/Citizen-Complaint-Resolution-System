# Playwright Test Consolidation — Phase 1 (Additive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `smoke` and `api` Playwright projects to the canonical `tests/integration-tests/` suite, populate them by moving existing `@kind:smoke` and API-only specs, and port the 7 unique specs from `local-setup/tests/e2e/` while applying the proposal's portability rules. No deletions, no Ansible/dashboard changes, no CI/Jest changes.

**Architecture:** Single `playwright.config.ts` defines three setup projects (existing `setup`, existing `lifecycle-setup`, new `api-setup`) and four leaf projects (existing `chromium`, new `smoke`, new `api`, new gated subset for `@local-only`). The `api-setup` project writes `auth-api.json` via API token injection (ROPC grant); `smoke`/`api` consume that storage state. The `@local-only` tag is gated via `grepInvert` in the project definitions when `LOCAL_STACK` is unset.

**Tech Stack:** Playwright 1.59 + TypeScript 5.4, Node 20. No new dependencies.

## Global Constraints

- Branch: `feat/fix_citizen_tests_automation` (no worktree)
- Scope: proposal steps 1–5 only. Steps 6 (Ansible), 7 (dashboard), 8 (deletions) are explicitly excluded — leave them as TODO comments where they touch.
- Test framework version pin: `@playwright/test ^1.59.1` (unchanged)
- All env vars routed through `tests/integration-tests/tests/utils/env.ts`. No new `process.env.X` reads inside spec bodies.
- Hardcoded resource IDs / tenant strings forbidden. Spec must self-seed or read from `env.ts`.
- Default branch for default behaviour: when `LOCAL_STACK` is unset, `@local-only` specs are excluded.
- Commit message style: matches recent history (`<type>(<scope>): <subject>` lowercase, no trailing punctuation). Examples: `feat(tests): add api-setup project`, `chore(tests): move api-smoke to smoke project`.
- Each task = one commit. Use `git add <specific paths>` — never `git add -A`.
- No new READMEs or docs files unless explicitly requested in a task.

## Verification Servers

After every task that changes runtime behaviour (marked with **VERIFY** below), run the new/affected projects against both servers and confirm pass-or-graceful-skip. Server env blocks:

**Server A — Ethiopia (single-segment tenant):**

```bash
export BASE_URL=https://subhadev.digitlab.in
export DIGIT_TENANT=ethiopia
export ROOT_TENANT=ethiopia
export ADMIN_USER=ADMIN
export ADMIN_PASS=eGov@123
export TENANT_CODE=ethiopia
```

**Server B — Bomet (root.city tenant):**

```bash
export BASE_URL=https://bometfeedbackhub.digit.org
export DIGIT_TENANT=ke.etoebeta
export ROOT_TENANT=ke
export ADMIN_USER=ADMIN
export ADMIN_PASS=eGov@123
export TENANT_CODE=ke
```

The standard verification step template is:

```bash
# Against Server A
env BASE_URL=https://subhadev.digitlab.in DIGIT_TENANT=ethiopia ROOT_TENANT=ethiopia ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 TENANT_CODE=ethiopia \
  npx playwright test --project=api-setup --project=<affected-project> --reporter=list 2>&1 | tail -30

# Against Server B
env BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.etoebeta ROOT_TENANT=ke ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 TENANT_CODE=ke \
  npx playwright test --project=api-setup --project=<affected-project> --reporter=list 2>&1 | tail -30
```

A pass = `passed` for every test. A graceful skip = `skipped` with a clear reason. A fail = unexpected `failed` or `timed out`. Treat unexpected fails as blockers; fix the spec and re-verify before committing the task.

---

### Task 1: Add `api-setup`, `smoke`, `api` projects to `playwright.config.ts`

**Files:**
- Modify: `tests/integration-tests/playwright.config.ts`
- Create: `tests/integration-tests/tests/smoke/.gitkeep`
- Create: `tests/integration-tests/tests/api/.gitkeep`

**Interfaces:**
- Produces: project names `api-setup`, `smoke`, `api` selectable via `--project`
- Produces: testDir conventions — `tests/smoke/` and `tests/api/` exist as empty directories ready for specs

- [ ] **Step 1: Verify current project list**

Run: `cd tests/integration-tests && npx playwright test --list 2>&1 | head -20`
Expected: shows existing `setup`, `lifecycle-setup`, `chromium` projects.

- [ ] **Step 2: Create empty smoke and api directories with placeholders**

```bash
mkdir -p tests/integration-tests/tests/smoke tests/integration-tests/tests/api
touch tests/integration-tests/tests/smoke/.gitkeep tests/integration-tests/tests/api/.gitkeep
```

- [ ] **Step 3: Add the three new projects to `playwright.config.ts`**

Modify `tests/integration-tests/playwright.config.ts`. Add this constant near the top:

```ts
const LOCAL_STACK = process.env.LOCAL_STACK === '1';
const EXCLUDE_LOCAL_ONLY = LOCAL_STACK ? undefined : /@local-only/;
```

Add to `testMatch` array (so the api-setup file is discoverable):

```ts
testMatch: [
  '**/*.spec.ts',
  'fixtures/auth.setup.ts',
  'fixtures/lifecycle.setup.ts',
  'fixtures/api.setup.ts',
],
```

Update the existing `chromium` project's `testIgnore` regex to also exclude `api.setup.ts` (otherwise chromium will try to run the api-setup file as a noisy duplicate test, since it now matches `testMatch`):

```ts
testIgnore: /tests\/fixtures\/(auth|lifecycle|api)\.setup\.ts$/,
```

Append these new projects to the existing `projects` array (do not modify other existing entries):

```ts
{
  // Token-injection auth — writes auth-api.json storage state.
  // Used by smoke + api projects which do not exercise the UI login form.
  name: 'api-setup',
  testMatch: /tests\/fixtures\/api\.setup\.ts$/,
},
{
  name: 'smoke',
  testDir: 'tests/smoke',
  testMatch: /.*\.spec\.ts$/,
  dependencies: ['api-setup'],
  grepInvert: EXCLUDE_LOCAL_ONLY,
  timeout: 30_000,
  use: {
    storageState: 'auth-api.json',
  },
},
{
  name: 'api',
  testDir: 'tests/api',
  testMatch: /.*\.spec\.ts$/,
  dependencies: ['api-setup'],
  grepInvert: EXCLUDE_LOCAL_ONLY,
  use: {
    storageState: 'auth-api.json',
  },
},
```

- [ ] **Step 4: Verify the new projects appear and existing ones still work**

Run: `cd tests/integration-tests && npx playwright test --list --project=smoke 2>&1 | tail -10`
Expected: `Total: 0 tests in 0 files` (empty for now) with no errors.

Run: `cd tests/integration-tests && npx playwright test --list --project=api 2>&1 | tail -10`
Expected: same — 0 tests, no errors.

Run: `cd tests/integration-tests && npx playwright test --list --project=chromium 2>&1 | tail -5`
Expected: existing chromium test count unchanged (should be the same number as before Task 1).

- [ ] **Step 5: Commit**

```bash
git add tests/integration-tests/playwright.config.ts tests/integration-tests/tests/smoke/.gitkeep tests/integration-tests/tests/api/.gitkeep
git commit -m "feat(tests): add smoke and api project scaffolding to integration-tests"
```

---

### Task 2: Implement `api.setup.ts` token-injection setup

**Files:**
- Create: `tests/integration-tests/tests/fixtures/api.setup.ts`

**Interfaces:**
- Consumes: `BASE_URL`, `TENANT`, `ROOT_TENANT`, `ADMIN_USER`, `ADMIN_PASS` from `tests/integration-tests/tests/utils/env.ts`
- Produces: `auth-api.json` storage-state file in the suite root (consumed by `smoke` and `api` project `use.storageState`)
- Mirrors: `local-setup/tests/e2e/utils/auth.ts:loginViaApi`

- [ ] **Step 1: Create the setup file**

Create `tests/integration-tests/tests/fixtures/api.setup.ts`:

```ts
import { test as setup, expect } from '@playwright/test';
import path from 'node:path';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

const AUTH_FILE = path.resolve('auth-api.json');

// Token-injection auth. Skips the UI login form entirely — used by smoke
// and api projects where login is a prerequisite, not the thing under test.
// Mirrors local-setup/tests/e2e/utils/auth.ts:loginViaApi.
setup('authenticate via api', async ({ page }) => {
  const tokenUrl = `${BASE_URL}/user/oauth/token`;
  const body = new URLSearchParams({
    grant_type: 'password',
    username: ADMIN_USER,
    password: ADMIN_PASS,
    tenantId: ROOT_TENANT,
    scope: 'read',
    userType: 'EMPLOYEE',
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
    },
    body: body.toString(),
  });

  expect(resp.ok, `ROPC token request failed (${resp.status})`).toBe(true);
  const tokenJson = await resp.json() as {
    access_token: string;
    UserRequest?: { uuid: string; name: string; roles: Array<{ code: string; tenantId: string }> };
  };
  expect(tokenJson.access_token).toBeTruthy();

  // localStorage is origin-scoped; navigate first to set the origin.
  await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  await page.evaluate(
    ({ token, userInfo, tenant }) => {
      localStorage.setItem('Employee.token', token);
      localStorage.setItem('Employee.tenant-id', tenant);
      localStorage.setItem('Employee.user-info', JSON.stringify(userInfo));
      localStorage.setItem('Employee.locale', 'en_IN');
      localStorage.setItem('token', token);
      localStorage.setItem('tenant-id', tenant);
      localStorage.setItem('user-info', JSON.stringify(userInfo));
    },
    {
      token: tokenJson.access_token,
      userInfo: tokenJson.UserRequest || {},
      tenant: ROOT_TENANT,
    },
  );

  await page.context().storageState({ path: AUTH_FILE });
});
```

- [ ] **Step 2: Add `auth-api.json` to `.gitignore`**

Check whether `auth.json` is already in `.gitignore`:

```bash
grep -n "auth\.json\|auth-api\.json" tests/integration-tests/.gitignore 2>/dev/null || echo "needs add"
```

If `auth.json` is gitignored but `auth-api.json` is not, add it. If `auth.json` isn't gitignored either, add both. Edit `tests/integration-tests/.gitignore` to include:

```
auth.json
auth-api.json
```

- [ ] **Step 3: Verify the api-setup project is discoverable**

Run: `cd tests/integration-tests && npx playwright test --list --project=api-setup 2>&1 | tail -10`
Expected: shows `tests/fixtures/api.setup.ts` with one test `authenticate via api`.

- [ ] **Step 4: VERIFY against Server A and Server B**

```bash
cd tests/integration-tests

# Server A — Ethiopia
env BASE_URL=https://subhadev.digitlab.in DIGIT_TENANT=ethiopia ROOT_TENANT=ethiopia ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 \
  npx playwright test --project=api-setup --reporter=list 2>&1 | tail -20

# Server B — Bomet
env BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.etoebeta ROOT_TENANT=ke ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 \
  npx playwright test --project=api-setup --reporter=list 2>&1 | tail -20
```

Expected: `1 passed` against each. `auth-api.json` is written each time. If Server A 401s, the ROPC payload may need `userType` adjusted or tenant string corrected — capture the response body and stop; do not commit until both pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration-tests/tests/fixtures/api.setup.ts tests/integration-tests/.gitignore
git commit -m "feat(tests): add api.setup.ts token-injection auth for smoke and api projects"
```

---

### Task 3: Inventory `@kind:smoke` specs across the suite

**Files:**
- Read-only investigation step. Produces a written inventory used by Task 4.

**Interfaces:**
- Produces: list of files containing `@kind:smoke` tags, captured in a temporary scratch file `/tmp/smoke-inventory.txt`

- [ ] **Step 1: Grep for `@kind:smoke` tag occurrences**

Run:

```bash
cd tests/integration-tests && grep -rn "@kind:smoke" tests/ --include='*.spec.ts' | tee /tmp/smoke-inventory.txt
```

Expected: at minimum `tests/lifecycle/api-smoke-2026-04-29.spec.ts` is listed. Possibly `tests/admin/hardcoding.spec.ts` if it carries the tag.

- [ ] **Step 2: For each hit, confirm it is a full-file smoke or only individual tests**

Open each file from the grep output. A "full-file smoke" candidate is one where every `test(...)` inside has the `@kind:smoke` tag. A "partial smoke" file keeps some tests as smoke and others elsewhere — those need test-level moves rather than file-level.

For each file, write a one-line classification at the bottom of `/tmp/smoke-inventory.txt`:

```
tests/lifecycle/api-smoke-2026-04-29.spec.ts: FULL_FILE (move whole file)
tests/admin/hardcoding.spec.ts: PARTIAL (leave in place, do not move)
```

- [ ] **Step 3: No commit (read-only investigation)**

Inventory file is a working artifact for the next task.

---

### Task 4: Move full-file `@kind:smoke` specs into `tests/smoke/`

**Files:**
- Move (git mv): `tests/integration-tests/tests/lifecycle/api-smoke-2026-04-29.spec.ts` → `tests/integration-tests/tests/smoke/api-helpers.spec.ts`
- Repeat for any other FULL_FILE entries from Task 3
- Modify (if needed): the moved file's imports to match new relative path depth

**Interfaces:**
- Consumes: `api.setup.ts` storage state from Task 2 (the moved smoke specs run in the `smoke` project)
- Consumes: tag annotations preserved verbatim

- [ ] **Step 1: Move the file with git mv**

```bash
cd tests/integration-tests
git mv tests/lifecycle/api-smoke-2026-04-29.spec.ts tests/smoke/api-helpers.spec.ts
```

- [ ] **Step 2: Fix import paths**

The moved file imports from `../utils/launch-fixes/api.js`, `../utils/lifecycle-fixtures`, `../utils/env`. After the move the relative path depth is unchanged (`../` from `lifecycle/` and from `smoke/` both reach `tests/`). Verify with:

```bash
cd tests/integration-tests && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors. If errors, adjust imports.

- [ ] **Step 3: Confirm the smoke project now discovers the spec**

Run: `cd tests/integration-tests && npx playwright test --list --project=smoke 2>&1 | tail -10`
Expected: lists the moved tests under the new path.

- [ ] **Step 4: Verify the tag is still present**

Run: `grep -n "@kind:smoke" tests/integration-tests/tests/smoke/api-helpers.spec.ts | head -5`
Expected: tag annotations still present (no rewrites needed).

- [ ] **Step 5: Repeat for any other FULL_FILE entries from Task 3's inventory**

If `/tmp/smoke-inventory.txt` flagged additional full-file smoke specs, repeat steps 1–4 for each.

- [ ] **Step 6: VERIFY smoke project against both servers**

```bash
cd tests/integration-tests

env BASE_URL=https://subhadev.digitlab.in DIGIT_TENANT=ethiopia ROOT_TENANT=ethiopia ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 \
  npx playwright test --project=api-setup --project=smoke --reporter=list 2>&1 | tail -25

env BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.etoebeta ROOT_TENANT=ke ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 \
  npx playwright test --project=api-setup --project=smoke --reporter=list 2>&1 | tail -25
```

Expected: all smoke tests `passed` against both. If `mdms search` skips on Ethiopia because the `common-masters.Department` schema is absent, that's acceptable as long as it skips gracefully — but the login test must pass on both.

- [ ] **Step 7: Commit**

```bash
git add -A tests/integration-tests/tests/smoke/ tests/integration-tests/tests/lifecycle/
git commit -m "refactor(tests): move @kind:smoke specs into tests/smoke project"
```

---

### Task 5: Move API-only lifecycle specs into `tests/api/`

**Files:**
- Move (git mv) the following 5 files (pre-confirmed API-only — no `page` fixture, no UI driving):
  - `tests/integration-tests/tests/lifecycle/pgr-api.spec.ts` → `tests/integration-tests/tests/api/pgr-lifecycle.spec.ts`
  - `tests/integration-tests/tests/lifecycle/pgr-escalation-api.spec.ts` → `tests/integration-tests/tests/api/pgr-escalation.spec.ts`
  - `tests/integration-tests/tests/lifecycle/boundary-jurisdiction-496.spec.ts` → `tests/integration-tests/tests/api/boundary-jurisdiction-496.spec.ts`
  - `tests/integration-tests/tests/lifecycle/enc-key-drift-622.spec.ts` → `tests/integration-tests/tests/api/enc-key-drift-622.spec.ts`
  - `tests/integration-tests/tests/lifecycle/filestore-fixes-2026-04-29.spec.ts` → `tests/integration-tests/tests/api/filestore-fixes-2026-04-29.spec.ts`
- Leave `tests/lifecycle/pgr-ui.spec.ts` and `tests/lifecycle/pgr-sla-auto-escalate.spec.ts` in place (UI-driven and time-gated respectively).

**Interfaces:**
- Consumes: `api.setup.ts` storage state from Task 2
- Produces: `api` project picks up these specs automatically via `testDir: 'tests/api'`

- [ ] **Step 1: Re-confirm each candidate is API-only**

Run:

```bash
cd tests/integration-tests
for f in tests/lifecycle/pgr-api.spec.ts tests/lifecycle/pgr-escalation-api.spec.ts tests/lifecycle/boundary-jurisdiction-496.spec.ts tests/lifecycle/enc-key-drift-622.spec.ts tests/lifecycle/filestore-fixes-2026-04-29.spec.ts; do
  echo "=== $f ==="
  grep -c "{ page" "$f" || true
done
```

Expected: each prints `0` (no `{ page }` fixture usage).

- [ ] **Step 2: Move each file with git mv**

```bash
cd tests/integration-tests
git mv tests/lifecycle/pgr-api.spec.ts tests/api/pgr-lifecycle.spec.ts
git mv tests/lifecycle/pgr-escalation-api.spec.ts tests/api/pgr-escalation.spec.ts
git mv tests/lifecycle/boundary-jurisdiction-496.spec.ts tests/api/boundary-jurisdiction-496.spec.ts
git mv tests/lifecycle/enc-key-drift-622.spec.ts tests/api/enc-key-drift-622.spec.ts
git mv tests/lifecycle/filestore-fixes-2026-04-29.spec.ts tests/api/filestore-fixes-2026-04-29.spec.ts
```

- [ ] **Step 3: Fix relative imports**

The moved files import from `../utils/...` and `../fixtures/...`. Depth from `tests/lifecycle/` and `tests/api/` to `tests/utils/` is identical (`../utils`), so paths remain valid. Verify:

```bash
cd tests/integration-tests && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Confirm the api project discovers all 5 specs**

Run: `cd tests/integration-tests && npx playwright test --list --project=api 2>&1 | tail -15`
Expected: at least 5 spec files listed.

- [ ] **Step 5: VERIFY api project against Server B (Bomet — known PGR-seeded)**

The PGR API specs assume a tenant with seeded complaints/employees; Server B is the canonical PGR deployment. Run:

```bash
cd tests/integration-tests
env BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.etoebeta ROOT_TENANT=ke ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 EMPLOYEE_USER=BOMET_LME GRO_USER=KE_GRO \
  npx playwright test --project=api-setup --project=api --reporter=list 2>&1 | tail -40
```

Expected: majority pass; tolerated failures are persona-specific (BOMET_LME / KE_GRO may not exist on every tenant — the existing `lifecycle.setup.ts` already handles this with skipped status).

Then run against Server A for parity check:

```bash
env BASE_URL=https://subhadev.digitlab.in DIGIT_TENANT=ethiopia ROOT_TENANT=ethiopia ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 \
  npx playwright test --project=api-setup --project=api --reporter=list 2>&1 | tail -40
```

Expected: tests either pass or skip with reason. Hard failures here indicate a hardcoded assumption that needs fixing — record the failure, do not commit until investigated.

- [ ] **Step 6: Commit**

```bash
git add -A tests/integration-tests/tests/lifecycle/ tests/integration-tests/tests/api/
git commit -m "refactor(tests): move API-only lifecycle specs into tests/api project"
```

---

### Task 6: Port `api-proxy-coverage.spec.ts` → `tests/api/`

**Files:**
- Source (read-only, do not delete): `local-setup/tests/e2e/specs/api-proxy-coverage.spec.ts`
- Create: `tests/integration-tests/tests/api/proxy-coverage.spec.ts`

**Portability rules to apply (from proposal):**
- Replace hardcoded `BASE_URL` default `'https://keycloak-sandbox.live.digit.org'` with import from `utils/env.ts`
- Replace baked-in `'pg.citya'` strings (lines 182, 223, 226, 231, 241, 246 of source) with `TENANT` from `utils/env.ts`
- Replace baked-in `'digit-sandbox'` realm references with `KC_REALM` from `utils/env.ts`
- Replace `'digit-sandbox-ui'` client ID with `KC_CLIENT_ID` from `utils/env.ts`
- The spec hits production-facing proxy endpoints — does NOT require `:18180`. Do **not** tag `@local-only`.

**Interfaces:**
- Consumes: `BASE_URL`, `TENANT`, `KC_REALM`, `KC_CLIENT_ID`, `ADMIN_USER`, `ADMIN_PASS` from `utils/env.ts`

- [ ] **Step 1: Read source and identify all hardcoded strings**

Run: `cd "$(git rev-parse --show-toplevel)" && grep -n "pg\.citya\|digit-sandbox\|localhost\|keycloak-sandbox" local-setup/tests/e2e/specs/api-proxy-coverage.spec.ts`

Capture the line numbers — they form the change list for Step 2.

- [ ] **Step 2: Copy and rewrite**

Copy the source file to the new path, then edit:

```bash
cp local-setup/tests/e2e/specs/api-proxy-coverage.spec.ts tests/integration-tests/tests/api/proxy-coverage.spec.ts
```

Edit `tests/integration-tests/tests/api/proxy-coverage.spec.ts`:

- Replace the top constants block:

```ts
const BASE_URL = process.env.BASE_URL || 'https://keycloak-sandbox.live.digit.org';
```

with:

```ts
import { BASE_URL, TENANT, KC_REALM, KC_CLIENT_ID, ADMIN_USER, ADMIN_PASS } from '../utils/env';
```

- Replace every literal `'pg.citya'` with `TENANT`
- Replace every literal `'digit-sandbox'` with `KC_REALM`
- Replace every literal `'digit-sandbox-ui'` with `KC_CLIENT_ID`
- Replace `'ADMIN'`/`'eGov@123'` literals in the request body with `ADMIN_USER`/`ADMIN_PASS`

- [ ] **Step 3: Type-check**

Run: `cd tests/integration-tests && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors. If the source spec uses old `process.env.BASE_URL` references elsewhere, surface them and replace with the imported constant.

- [ ] **Step 4: Confirm the spec is picked up by the api project**

Run: `cd tests/integration-tests && npx playwright test --list --project=api --grep "proxy-coverage" 2>&1 | tail -10`
Expected: lists the spec.

- [ ] **Step 5: VERIFY against both servers**

```bash
cd tests/integration-tests

env BASE_URL=https://subhadev.digitlab.in DIGIT_TENANT=ethiopia ROOT_TENANT=ethiopia ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 \
  npx playwright test --project=api-setup --project=api --grep "proxy-coverage" --reporter=list 2>&1 | tail -25

env BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.etoebeta ROOT_TENANT=ke ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 \
  npx playwright test --project=api-setup --project=api --grep "proxy-coverage" --reporter=list 2>&1 | tail -25
```

Expected: passes on both. If a 5xx is observed against either, capture the failing URL and re-check the env-driven tenant substitution.

- [ ] **Step 6: Commit**

```bash
git add tests/integration-tests/tests/api/proxy-coverage.spec.ts
git commit -m "feat(tests): port api-proxy-coverage spec into api project with env-driven tenants"
```

---

### Task 7: Port `hrms-proxy.spec.ts` → `tests/api/`

**Files:**
- Source (read-only): `local-setup/tests/e2e/specs/hrms-proxy.spec.ts`
- Create: `tests/integration-tests/tests/api/hrms-proxy.spec.ts`

**Portability rules:**
- Source default `BASE_URL || 'http://localhost:18080'` — replace with import from `utils/env.ts`
- Source default `DIGIT_TENANT || 'uitest.citya'` — replace with `TENANT` import
- The spec validates that the token-exchange-svc rewrites HRMS URLs. If the spec assumes any `localhost`-only endpoint, tag the entire spec `@local-only`. Otherwise leave untagged.

- [ ] **Step 1: Inspect source for localhost-only dependencies**

Run: `grep -n "localhost\|127\.0\.0\.1\|18000\|18180" local-setup/tests/e2e/specs/hrms-proxy.spec.ts`

If any hits are inside `test()` bodies (not in a string used purely as the `BASE_URL` default), the spec is local-only.

- [ ] **Step 2: Copy and rewrite**

```bash
cp local-setup/tests/e2e/specs/hrms-proxy.spec.ts tests/integration-tests/tests/api/hrms-proxy.spec.ts
```

Edit `tests/integration-tests/tests/api/hrms-proxy.spec.ts`:

- Replace the top constants block with `import { BASE_URL, TENANT, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';`
- Replace all `'uitest.citya'` literals with `TENANT`

If Step 1 found localhost-only dependencies, also add this tag to every `test()` in the file:

```ts
test('rewrites tenantId in HRMS search', {
  tag: ['@local-only', '@area:hrms', '@layer:api'],
}, async ({ request }) => { ... });
```

- [ ] **Step 3: Type-check and list-verify**

Run:
```bash
cd tests/integration-tests
npx tsc --noEmit 2>&1 | head -20
npx playwright test --list --project=api --grep "hrms-proxy" 2>&1 | tail -10
```

Expected: 0 type errors; spec listed.

- [ ] **Step 4: Verify `@local-only` gating works (if applied)**

If the spec was tagged `@local-only`, verify it's excluded by default:

```bash
cd tests/integration-tests && npx playwright test --list --project=api --grep "hrms-proxy" 2>&1 | grep "Total"
LOCAL_STACK=1 npx playwright test --list --project=api --grep "hrms-proxy" 2>&1 | grep "Total"
```

Expected: first command shows 0 matching; second shows the test count.

- [ ] **Step 5: VERIFY against both servers (skip if `@local-only`)**

If the spec is NOT `@local-only`, run:

```bash
cd tests/integration-tests
env BASE_URL=https://subhadev.digitlab.in DIGIT_TENANT=ethiopia ROOT_TENANT=ethiopia ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 \
  npx playwright test --project=api-setup --project=api --grep "hrms-proxy" --reporter=list 2>&1 | tail -20
env BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.etoebeta ROOT_TENANT=ke ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 \
  npx playwright test --project=api-setup --project=api --grep "hrms-proxy" --reporter=list 2>&1 | tail -20
```

Expected: pass on both. If the spec IS `@local-only`, skip this step — it will be exercised by the deployed runner's local-stack mode later.

- [ ] **Step 6: Commit**

```bash
git add tests/integration-tests/tests/api/hrms-proxy.spec.ts
git commit -m "feat(tests): port hrms-proxy spec into api project"
```

---

### Task 8: Port `google-sso-config.spec.ts` → `tests/keycloak/` as `@local-only`

**Files:**
- Source (read-only): `local-setup/tests/e2e/specs/google-sso-config.spec.ts`
- Create: `tests/integration-tests/tests/keycloak/sso-config.spec.ts`

**Portability rules:**
- This spec hits `http://localhost:18180` (KC admin port). It is genuinely local-only. **Tag every test `@local-only`.**
- The spec belongs in the `keycloak` directory, which runs under the existing `chromium` project (UI-auth). However, since this spec is API-only (no `page` interactions, just `fetch` to KC admin), it can live in `keycloak/` and the `chromium` project will skip it when LOCAL_STACK is unset because of `@local-only` — but `chromium` does not currently have `grepInvert`. Add `grepInvert` to `chromium` in this task.

- [ ] **Step 1: Copy and rewrite imports**

```bash
cp local-setup/tests/e2e/specs/google-sso-config.spec.ts tests/integration-tests/tests/keycloak/sso-config.spec.ts
```

Edit `tests/integration-tests/tests/keycloak/sso-config.spec.ts`:

- Add at top: `import { KC_REALM, KC_CLIENT_ID } from '../utils/env';`
- Replace `const REALM = 'digit-sandbox';` with usage of `KC_REALM`
- Replace `const CLIENT_ID = 'digit-sandbox-ui';` with usage of `KC_CLIENT_ID`
- Leave `http://localhost:18180` hardcoded — this is the local KC admin port, the entire point of the spec

- [ ] **Step 2: Add `@local-only` tag to every test**

For each `test(name, ...)` block, restructure to include a tag annotation:

```ts
test('KC realm has Google IDP configured', {
  tag: ['@local-only', '@area:keycloak', '@layer:api'],
}, async () => { ... });
```

- [ ] **Step 3: Add `grepInvert` to the chromium project**

Edit `tests/integration-tests/playwright.config.ts`. Find the `chromium` project block and add `grepInvert: EXCLUDE_LOCAL_ONLY,`. The `testIgnore` was already updated in Task 1 to include `api.setup.ts`, so do not re-touch it:

```ts
{
  name: 'chromium',
  use: {
    browserName: 'chromium',
    storageState: 'auth.json',
  },
  dependencies: ['setup', 'lifecycle-setup'],
  testIgnore: /tests\/fixtures\/(auth|lifecycle|api)\.setup\.ts$/,
  grepInvert: EXCLUDE_LOCAL_ONLY,
},
```

- [ ] **Step 4: Verify default-mode exclusion**

```bash
cd tests/integration-tests
npx playwright test --list --project=chromium --grep "sso-config" 2>&1 | grep "Total"
LOCAL_STACK=1 npx playwright test --list --project=chromium --grep "sso-config" 2>&1 | grep "Total"
```

Expected: first prints `Total: 0 tests`; second prints `Total: N tests` (whatever count of tests in the file).

- [ ] **Step 5: Commit**

```bash
git add tests/integration-tests/tests/keycloak/sso-config.spec.ts tests/integration-tests/playwright.config.ts
git commit -m "feat(tests): port google-sso-config as @local-only keycloak spec"
```

---

### Task 9: Port `citizen-flow.spec.ts` → `tests/citizen/landing-dispatch.spec.ts`

**Files:**
- Source (read-only): `local-setup/tests/e2e/specs/citizen/citizen-flow.spec.ts`
- Create: `tests/integration-tests/tests/citizen/landing-dispatch.spec.ts`

**Portability rules:**
- Source defaults to `http://localhost:18080` and `uitest.citya`. Replace with `BASE_URL`/`TENANT` imports.
- This is a UI spec — it must live under the `chromium` project's testDir glob (citizen/ is already covered).
- No `@local-only` tag — the landing-dispatch logic is environment-agnostic.

- [ ] **Step 1: Copy**

```bash
cp local-setup/tests/e2e/specs/citizen/citizen-flow.spec.ts tests/integration-tests/tests/citizen/landing-dispatch.spec.ts
```

- [ ] **Step 2: Rewrite env reads**

Edit the new file:

- Replace top-of-file constants with `import { BASE_URL, TENANT, ROOT_TENANT } from '../utils/env';`
- Replace any `'uitest.citya'` with `TENANT`
- Replace any `'uitest'` (root tenant) with `ROOT_TENANT`

- [ ] **Step 3: Type-check and list-verify**

```bash
cd tests/integration-tests
npx tsc --noEmit 2>&1 | head -20
npx playwright test --list --project=chromium --grep "landing-dispatch" 2>&1 | tail -10
```

Expected: 0 type errors; spec listed under chromium.

- [ ] **Step 4: VERIFY against both servers**

```bash
cd tests/integration-tests
env BASE_URL=https://subhadev.digitlab.in DIGIT_TENANT=ethiopia ROOT_TENANT=ethiopia ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 TENANT_CODE=ethiopia \
  npx playwright test --project=setup --project=chromium --grep "landing-dispatch" --reporter=list 2>&1 | tail -25
env BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.etoebeta ROOT_TENANT=ke ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 TENANT_CODE=ke \
  npx playwright test --project=setup --project=chromium --grep "landing-dispatch" --reporter=list 2>&1 | tail -25
```

Expected: passes on both. If the landing page redirects differently on the two deployments (auto-skip-home vs language-select), the spec needs branching by detection, not by env — file an issue and skip the verify with a TODO if needed.

- [ ] **Step 5: Commit**

```bash
git add tests/integration-tests/tests/citizen/landing-dispatch.spec.ts
git commit -m "feat(tests): port citizen landing-dispatch spec into chromium project"
```

---

### Task 10: Port `proxy.spec.ts` new-citizen SSO fragment → `tests/keycloak/` as `@local-only`

**Files:**
- Source (read-only): `local-setup/tests/e2e/specs/citizen/proxy.spec.ts`
- Create: `tests/integration-tests/tests/keycloak/new-citizen-provisioning.spec.ts`

**Portability rules:**
- Source uses sandbox KC admin (`http://localhost:18180`) and `pg.citya` tenant. Spec is local-only — tag every test `@local-only`.
- Spec creates a temporary KC user — this is a destructive/admin operation that only makes sense against a fresh KC. Keep that behaviour, document it.

- [ ] **Step 1: Inspect the source for the new-citizen provisioning slice**

The source mixes provisioning with other concerns. For this port, copy only the test(s) that exercise the new-citizen provisioning via KC admin.

```bash
grep -n "^test\|^test.describe" local-setup/tests/e2e/specs/citizen/proxy.spec.ts
```

If the file contains exactly one provisioning test, copy the whole file. If multiple, copy only the provisioning test into the new file.

- [ ] **Step 2: Copy or extract**

If full-file:
```bash
cp local-setup/tests/e2e/specs/citizen/proxy.spec.ts tests/integration-tests/tests/keycloak/new-citizen-provisioning.spec.ts
```

If extracting one test, write the new file directly with the extracted test plus required imports.

- [ ] **Step 3: Rewrite env reads and add `@local-only` tag**

- Replace env reads with imports from `utils/env.ts`
- For every `test(...)`, add `tag: ['@local-only', '@area:keycloak', '@persona:citizen']`

- [ ] **Step 4: Type-check and gating verify**

```bash
cd tests/integration-tests
npx tsc --noEmit 2>&1 | head -20
npx playwright test --list --project=chromium --grep "new-citizen-provisioning" 2>&1 | grep "Total"
LOCAL_STACK=1 npx playwright test --list --project=chromium --grep "new-citizen-provisioning" 2>&1 | grep "Total"
```

Expected: first prints `Total: 0 tests`; second prints test count.

- [ ] **Step 5: Commit**

```bash
git add tests/integration-tests/tests/keycloak/new-citizen-provisioning.spec.ts
git commit -m "feat(tests): port new-citizen SSO provisioning as @local-only keycloak spec"
```

---

### Task 11: Port `localization-modules.spec.ts` → `tests/admin/`

**Files:**
- Source (read-only): `local-setup/tests/e2e/specs/configurator/localization-modules.spec.ts`
- Create: `tests/integration-tests/tests/admin/localization-modules.spec.ts`

**Portability rules:**
- Source defaults to `localhost:18080` / `uitest.citya`. Replace with env imports.
- Spec verifies dept/designation localizations land in `rainmaker-common` not `-masters` (PR #636 regression).
- UI spec — lives under chromium project automatically via `admin/` glob.

- [ ] **Step 1: Copy**

```bash
cp local-setup/tests/e2e/specs/configurator/localization-modules.spec.ts tests/integration-tests/tests/admin/localization-modules.spec.ts
```

- [ ] **Step 2: Rewrite env reads**

- Replace constants with `import { BASE_URL, TENANT, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';`
- Replace literal tenant strings with `TENANT` / `ROOT_TENANT`

- [ ] **Step 3: Type-check and list-verify**

```bash
cd tests/integration-tests
npx tsc --noEmit 2>&1 | head -20
npx playwright test --list --project=chromium --grep "localization-modules" 2>&1 | tail -5
```

Expected: 0 errors; spec listed.

- [ ] **Step 4: VERIFY against both servers**

```bash
cd tests/integration-tests
env BASE_URL=https://subhadev.digitlab.in DIGIT_TENANT=ethiopia ROOT_TENANT=ethiopia ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 TENANT_CODE=ethiopia \
  npx playwright test --project=setup --project=chromium --grep "localization-modules" --reporter=list 2>&1 | tail -25
env BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.etoebeta ROOT_TENANT=ke ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 TENANT_CODE=ke \
  npx playwright test --project=setup --project=chromium --grep "localization-modules" --reporter=list 2>&1 | tail -25
```

Expected: passes on both. Spec verifies that newly-added dept/designation localizations land in `rainmaker-common`, not `-masters` — write path is the same on both deployments.

- [ ] **Step 5: Commit**

```bash
git add tests/integration-tests/tests/admin/localization-modules.spec.ts
git commit -m "feat(tests): port dept/designation localization-modules spec into admin"
```

---

### Task 12: Fold raw-key scan from `complaint-submit.spec.ts` into `citizen/wizard.spec.ts`

**Files:**
- Source (read-only): `local-setup/tests/e2e/specs/citizen/complaint-submit.spec.ts`
- Modify: `tests/integration-tests/tests/citizen/wizard.spec.ts`

**Portability rules:**
- Only the raw-key scan portion (`SERVICEDEFS.*` raw-key detection at each wizard step) is unique. The wizard-walk portion is duplicate.
- Add the raw-key assertion as a new `test()` inside the existing `wizard.spec.ts` describe block, not as a separate file.

- [ ] **Step 1: Identify the raw-key scan in the source**

```bash
grep -n "SERVICEDEFS\|raw.key\|untranslated" local-setup/tests/e2e/specs/citizen/complaint-submit.spec.ts | head -20
```

Capture the function/code block that performs the scan.

- [ ] **Step 2: Read `wizard.spec.ts` to find the right insertion point**

Identify the existing `test.describe(...)` block, choose to append a new `test()` to it.

- [ ] **Step 3: Add the raw-key scan test**

Add a new test to `tests/integration-tests/tests/citizen/wizard.spec.ts` (inside the same describe block) that:

- Walks each wizard step
- After each step renders, scans `page.locator('body').textContent()` for the regex `/SERVICEDEFS\.[A-Z0-9_]+/` (or whatever the original regex was)
- Asserts no match — fails with the raw key as the message

Adapt imports from the original source as needed (preserving the regex).

- [ ] **Step 4: Type-check and list-verify**

```bash
cd tests/integration-tests
npx tsc --noEmit 2>&1 | head -20
npx playwright test --list --project=chromium --grep "wizard" 2>&1 | tail -10
```

Expected: 0 errors; new test name appears in the wizard.spec.ts list.

- [ ] **Step 5: Commit**

```bash
git add tests/integration-tests/tests/citizen/wizard.spec.ts
git commit -m "feat(tests): add raw-key localization scan to citizen wizard spec"
```

---

### Task 13: Add npm scripts for the new project slices

**Files:**
- Modify: `tests/integration-tests/package.json`

**Interfaces:**
- Produces: `npm run test:smoke` and `npm run test:api` for operator convenience

- [ ] **Step 1: Add scripts**

Edit `tests/integration-tests/package.json`. Add to the `scripts` block:

```json
"test:smoke": "playwright test --project=smoke",
"test:api": "playwright test --project=api",
"test:smoke-api": "playwright test --project=smoke --project=api"
```

- [ ] **Step 2: Verify scripts work**

```bash
cd tests/integration-tests
npm run test:smoke -- --list 2>&1 | tail -5
npm run test:api -- --list 2>&1 | tail -5
```

Expected: both list non-empty test sets.

- [ ] **Step 3: Commit**

```bash
git add tests/integration-tests/package.json
git commit -m "chore(tests): add npm scripts for smoke and api projects"
```

---

### Task 14: Final verification and PR push

**Files:**
- Read-only verification. No file changes unless a regression is found.

- [ ] **Step 1: Type-check the whole suite**

```bash
cd tests/integration-tests && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: List all projects to confirm matrix is healthy**

```bash
cd tests/integration-tests
for proj in setup lifecycle-setup api-setup chromium smoke api; do
  echo "=== $proj ==="
  npx playwright test --list --project=$proj 2>&1 | tail -3
done
```

Expected: each project produces a `Total: N tests` line with no errors. `setup` shows 1 test; `api-setup` shows 1 test; `lifecycle-setup` shows >0; `chromium`, `smoke`, `api` show >0.

- [ ] **Step 3: Confirm `@local-only` gating works both ways**

```bash
cd tests/integration-tests
echo "default (excluded):"
npx playwright test --list 2>&1 | grep -c "@local-only" || echo "0"
echo "LOCAL_STACK=1 (included):"
LOCAL_STACK=1 npx playwright test --list 2>&1 | grep -c "@local-only" || echo "0"
```

Expected: default count is 0; `LOCAL_STACK=1` count is >0 (matches number of `@local-only`-tagged tests).

- [ ] **Step 4: FINAL VERIFY — smoke + api against both servers (end-to-end)**

```bash
cd tests/integration-tests

echo "=== Server A — Ethiopia ==="
env BASE_URL=https://subhadev.digitlab.in DIGIT_TENANT=ethiopia ROOT_TENANT=ethiopia ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 TENANT_CODE=ethiopia \
  npx playwright test --project=api-setup --project=smoke --project=api --reporter=list 2>&1 | tee /tmp/server-a-final.log | tail -50

echo "=== Server B — Bomet ==="
env BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.etoebeta ROOT_TENANT=ke ADMIN_USER=ADMIN ADMIN_PASS=eGov@123 TENANT_CODE=ke EMPLOYEE_USER=BOMET_LME GRO_USER=KE_GRO \
  npx playwright test --project=api-setup --project=smoke --project=api --reporter=list 2>&1 | tee /tmp/server-b-final.log | tail -50
```

Acceptance: every test either `passed` or `skipped` with a clear reason. No `failed` lines. If failures appear, capture the failing test name and the assertion message; do not push until investigated.

- [ ] **Step 5: Push branch and note follow-ups**

```bash
git push origin feat/fix_citizen_tests_automation
```

Out-of-scope follow-ups (do NOT do them in this PR):
- Step 6: Update `local-setup/ansible/playbook-deploy.yml` stage B (lines 3055–3138) — separate change, needs fresh-box verification.
- Step 7: Add "Fast smoke" button to `tests/integration-tests/runner/server.mjs` — UX change for operator dashboard.
- Step 8: Delete `local-setup/tests/e2e/` and `tests/playwright/` — destructive, gated on Step 6 landing.

---

## Self-Review Notes

- **Spec coverage:** Steps 1–5 of the proposal are covered by Tasks 1, 2, 4, 5, and 6–12 respectively. Tasks 3, 13, 14 are scaffolding/verification overhead.
- **Placeholder scan:** No "TBD"/"add appropriate error handling" placeholders. Where investigation is required (Task 3, Task 6 Step 1, Task 7 Step 1), the engineer is given an exact grep command and explicit classification rule.
- **Type consistency:** `BASE_URL`, `TENANT`, `ROOT_TENANT`, `ADMIN_USER`, `ADMIN_PASS`, `KC_REALM`, `KC_CLIENT_ID` are exact names exported from `tests/integration-tests/tests/utils/env.ts` (verified). The `EXCLUDE_LOCAL_ONLY` constant introduced in Task 1 is reused in Task 8.
- **Risk:** The raw-key scan in Task 12 requires reading the original spec for its specific regex. The plan instructs the engineer to capture and preserve the original.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-26-playwright-consolidation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session with checkpoints for review

Which approach?
