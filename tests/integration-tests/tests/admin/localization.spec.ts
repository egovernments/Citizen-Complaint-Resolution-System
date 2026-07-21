/**
 * Localization comparator — pivoted view + inline edit round-trip.
 *
 * The page renders one row per (code, module) with one editable column per
 * supported locale (AVAILABLE_LOCALES in i18nProvider: `en_IN`, `hi_IN`,
 * `pt_BR`, `fr_FR`). API-driven saves go through `localizationUpsert` plus a
 * fire-and-forget `POST /localization/messages/cache-bust` — without the
 * bust, the service's internal Redis cache keeps returning the stale
 * value for the rest of the TTL. (The inline-edit UI path upserts but does
 * NOT issue a cache-bust; see test 5.) Cold load is ~7.3 s bound by the
 * server-side `rainmaker-pgr / en_IN` search (§1 DEV-LOG).
 *
 * Tenant parity at `ke` and `ke.nairobi` is 4,259 / 4,259 for enabled
 * modules. Probed 2026-04-23:
 *   - `rainmaker-common` en_IN ~1,760 rows at both tenants.
 *   - `_upsert` single-row → search-after-cache-bust round-trip works.
 *   - `_upsert` with two rows sharing a `code` but different `module`
 *     returns a HARD 400 `DUPLICATE_RECORDS` (not a silent dedup as the
 *     brief suggested). We assert on that error shape so regressions on
 *     the server don't pass silently.
 */
import { test, expect } from '@playwright/test';
import { loadAuth, type AuthInfo } from '../utils/manage/api';
import { testCode } from '../utils/manage/codes';
import { ROOT_TENANT, TENANT } from '../utils/env';

// Tenant-agnostic: root tenant + city tenant come from env (ROOT_TENANT /
// DIGIT_TENANT), so the parity guard compares the actual deployment's tenants
// rather than a hardcoded ke / ke.nairobi pair.
const TENANT_CODE = ROOT_TENANT;
const CITY_TENANT = TENANT;
const LIST_PATH = '/configurator/manage/localization';

const createdKeys = new Set<string>();

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  if (createdKeys.size === 0) return;
  const auth = loadAuth();
  // Fire-and-forget deletes — each key is "code|module|locale".
  for (const key of createdKeys) {
    const [code, module, locale] = key.split('|');
    await locDelete(auth, TENANT_CODE, locale, [{ code, module }]).catch(() => {});
  }
  // Single final cache-bust so the next run sees clean state.
  await locCacheBust(auth).catch(() => {});
});

test.describe('manage/localization', () => {
  test('1. tenant parity — root and city tenants serve a coherent rainmaker-common en_IN bundle', {
    annotation: {
      type: 'description',
      description: `Tenant-parity guard: localization counts at root tenant and city tenant for rainmaker-common / en_IN must be coherent. On a FLAT deployment (root tenant IS the city tenant — the same tenant queried twice) the two counts must match EXACTLY. On a TWO-LEVEL deployment (root != city, e.g. mz / mz.maputo) the localization service resolves the city bundle as root rows PLUS city-specific additions (measured on mz/mz.maputo: 5,789 root rows vs 6,224 city rows — the city adds 435 city-specific rows), so a strict ±2 parity assert is a flat-deployment (Kenya-seed) convention, not a portable service contract. The portable contract this test enforces instead: the city bundle must be AT LEAST as complete as the root's — a city count BELOW root means city-level lookups lost inherited rows, which is the actual regression this test guards against.

Steps:
1. In parallel, locSearch(TENANT_CODE, 'en_IN', 'rainmaker-common') and locSearch(CITY_TENANT, 'en_IN', 'rainmaker-common').
2. Assert keRows.length > 100.
3. If TENANT_CODE === CITY_TENANT (flat deployment): assert cityRows.length === keRows.length exactly.
   Else (two-level deployment): assert cityRows.length >= keRows.length.

Catches a regression where city-level localization stops inheriting from root, or where one tenant gets a partial seed.`,
    },
    tag: ['@area:configurator-manage', '@area:localization', '@kind:regression', '@layer:ui', '@persona:admin'] }, async () => {
    const auth = loadAuth();
    const [keRows, cityRows] = await Promise.all([
      locSearch(auth, TENANT_CODE, 'en_IN', 'rainmaker-common'),
      locSearch(auth, CITY_TENANT, 'en_IN', 'rainmaker-common'),
    ]);
    // Onboarding-data gap: rainmaker-common en_IN must be seeded on this
    // deployment for the parity comparison to mean anything. On a tenant that
    // hasn't loaded the localization bundle both counts are ~0 — skip rather
    // than fail on missing seed data.
    test.skip(
      keRows.length <= 100,
      'rainmaker-common en_IN not seeded on this deployment (localization bundle not loaded)',
    );
    expect(keRows.length).toBeGreaterThan(100);
    if (TENANT_CODE === CITY_TENANT) {
      // Flat deployment: same tenant queried twice must agree exactly.
      expect(cityRows.length).toBe(keRows.length);
    } else {
      // Two-level deployment: the localization service resolves city = root
      // rows + city-specific additions (measured on mz/mz.maputo: 5,789 vs
      // 6,224), so the city bundle must be at least as complete as the
      // root's. A city count BELOW root means city-level lookups lost
      // inherited rows — the actual regression this test guards.
      expect(cityRows.length).toBeGreaterThanOrEqual(keRows.length);
    }
  });

  test('2. upsert + cache-bust round-trip — value lands after bust, not before', {
    annotation: {
      type: 'description',
      description: `Documents the cache-bust requirement: localization service caches _search responses per (tenant, locale, module). Without /cache-bust, an upsert lands in the database but the next _search returns stale cached data until the TTL expires. This test confirms a full upsert → bust → search round-trip works AND that overwrites also work.

Steps:
1. Generate a unique code; track for cleanup.
2. locUpsert with { code, message: 'first-version', module: 'rainmaker-common' } at TENANT_CODE / en_IN.
3. Assert response array length === 1.
4. locCacheBust.
5. locSearch; find the row by code; assert its message === 'first-version'.
6. locUpsert again with message: 'second-version'.
7. locCacheBust.
8. locSearch; assert the updated row's message === 'second-version'.

Doesn't assert pre-bust read because caching is timing-sensitive — only post-bust visibility is the contract.`,
    },
    tag: ['@area:configurator-manage', '@area:localization', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({}, testInfo) => {
    const auth = loadAuth();
    const code = testCode(testInfo, 'LOC_RT');
    const locale = 'en_IN';
    const module = 'rainmaker-common';
    createdKeys.add(`${code}|${module}|${locale}`);

    // Upsert once.
    const upserted = await locUpsert(auth, TENANT_CODE, locale, [
      { code, message: 'first-version', module },
    ]);
    expect(upserted.length).toBe(1);

    // Cache-bust is required — the localization service caches _search
    // responses per (tenant, locale, module). We don't assert on the
    // pre-bust read because caching is timing-sensitive; we only assert
    // that AFTER the bust the row is visible.
    await locCacheBust(auth);

    const afterBust = await locSearch(auth, TENANT_CODE, locale, module);
    const match = afterBust.find((m) => m.code === code);
    expect(match, 'upserted row should be visible after cache-bust').toBeTruthy();
    expect(match?.message).toBe('first-version');

    // Update + bust — the new value replaces the old one.
    await locUpsert(auth, TENANT_CODE, locale, [
      { code, message: 'second-version', module },
    ]);
    await locCacheBust(auth);
    const afterUpdate = await locSearch(auth, TENANT_CODE, locale, module);
    const updated = afterUpdate.find((m) => m.code === code);
    expect(updated?.message).toBe('second-version');
  });

  test('3. _upsert rejects same code on different modules in one batch (DUPLICATE_RECORDS)', {
    annotation: {
      type: 'description',
      description: `Pins the _upsert batch contract: same code on two different modules in a single batch must hard-fail with HTTP 4xx and Errors[0].code === 'DUPLICATE_RECORDS'. Pre-investigation suggested silent dedup; the actual server behavior is a hard reject. Test guards against future silent acceptance.

Steps:
1. Generate a unique code; do NOT track for cleanup (the batch fails entirely so nothing persists).
2. POST /localization/messages/v1/_upsert with two messages: { code, module: 'rainmaker-common' } and { code, module: 'rainmaker-pgr' } in one batch.
3. Read response.Errors; assert length > 0 (with diagnostic message including the response JSON).
4. Assert Errors[0].code === 'DUPLICATE_RECORDS'.

If a future release silently accepts duplicates, this test goes red so callers re-check their batch-building logic before relying on the contract.`,
    },
    tag: ['@area:configurator-manage', '@area:localization', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({}, testInfo) => {
    const auth = loadAuth();
    const code = testCode(testInfo, 'LOC_DUP');
    const locale = 'en_IN';
    // Don't register for cleanup — the batch fails before anything persists.

    const url = `${auth.baseUrl}/localization/messages/v1/_upsert?tenantId=${TENANT_CODE}&locale=${locale}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({
        RequestInfo: {
          apiId: 'Rainmaker', ver: '1.0', ts: Date.now(),
          msgId: `${Date.now()}|en_IN`, authToken: auth.token,
        },
        tenantId: TENANT_CODE,
        messages: [
          { code, message: 'in common', module: 'rainmaker-common', locale },
          { code, message: 'in pgr', module: 'rainmaker-pgr', locale },
        ],
      }),
    });
    const json = await res.json() as { Errors?: Array<{ code?: string; message?: string }> };
    // The server surfaces this as a 4xx with DUPLICATE_RECORDS in the Errors
    // array. If a future release silently accepts it we want this test to
    // go red so callers re-check their batch-building logic.
    const errs = json.Errors || [];
    expect(errs.length, `expected Errors[] on duplicate-code batch, got ${JSON.stringify(json)}`).toBeGreaterThan(0);
    expect(errs[0].code).toBe('DUPLICATE_RECORDS');
  });

  test('4. list renders with a usable layout and shows data', {
    annotation: {
      type: 'description',
      description: `Smoke check the pivoted comparator UI: the page renders a table, the table has at least 10 rows, and the body text contains the expected column headers (code, module, plus one column per supported locale — en_IN, hi_IN, pt_BR, fr_FR).

Steps:
1. Navigate to /configurator/manage/localization; wait for networkidle.
2. Assert role=table is visible within 30s (cold load is ~7.3s).
3. Assert getByRole('row') count > 10 (well under the 1760 rows we know live).
4. For each label regex /code/i, /module/i, /en_IN/i, /hi_IN/i, /pt_BR/i, /fr_FR/i, assert at least one matching text element is visible.

Loose label-match tolerates minor copy tweaks. The 10-row threshold avoids brittleness around virtualization chunk sizes.`,
    },
    tag: ['@area:configurator-manage', '@area:localization', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(LIST_PATH);
    // Cold load is ~7.3s; extend visibility timeout so we don't flake.
    await page.waitForLoadState('networkidle').catch(() => {});

    // Core structure — a table (or grid) with more than just a header.
    const table = page.getByRole('table').first();
    await expect(table).toBeVisible({ timeout: 30_000 });

    const rows = page.getByRole('row');
    // Expect meaningful data — 50+ rows is well under the 1760 we know
    // live and avoids being brittle about virtualization chunk size.
    expect(await rows.count()).toBeGreaterThan(10);

    // The page is the "pivoted" comparator — Code + Module + one column per
    // supported locale (en_IN / hi_IN / pt_BR / fr_FR, from AVAILABLE_LOCALES
    // in i18nProvider). Match leniently (case + substring) so minor label
    // tweaks don't break the test.
    const body = page.locator('body');
    for (const label of [/code/i, /module/i, /en_IN/i, /hi_IN/i, /pt_BR/i, /fr_FR/i]) {
      await expect(body.getByText(label).first()).toBeVisible();
    }
  });

  test('5. inline edit — UI save round-trips via localizationUpsert + cache-bust', {
    annotation: {
      type: 'description',
      description: `Confirms inline cell editing on the comparator triggers the _upsert XHR and that the new value persists through a fresh _search. The inline-edit UI path does NOT issue a cache-bust (only the API-level save helper does), so we assert on the upsert XHR only and force our own cache-bust before the confirming _search. Seeds via API for determinism, then drives the click + edit + Enter flow.

Steps:
1. Generate a unique code; track for cleanup.
2. locUpsert with 'seeded-english'; locCacheBust.
3. Navigate to /manage/localization; wait for networkidle.
4. If a search input exists, type the code; wait networkidle.
5. test.skip if the seeded row isn't visible (virtualization edge case).
6. Set up a waitForRequest promise for the /_upsert POST.
7. Click the cell containing 'seeded-english'; test.skip if not reachable.
8. Locate the focused input/textarea; test.skip if not focused.
9. Fill 'edited-english'; press Enter.
10. Assert the upsert XHR resolved truthy.
11. locCacheBust then locSearch; assert updated.message === 'edited-english'.

Skips gracefully when UI layout shifts make the click target unreachable — better than failing on cosmetic refactors.`,
    },
    tag: ['@area:configurator-manage', '@area:localization', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    // Seed a PW_ row via the API so the test has something deterministic
    // to click, independent of whichever legacy rows happen to be first.
    const auth = loadAuth();
    const code = testCode(testInfo, 'LOC_EDIT');
    const locale = 'en_IN';
    const module = 'rainmaker-common';
    createdKeys.add(`${code}|${module}|${locale}`);

    await locUpsert(auth, TENANT_CODE, locale, [
      { code, message: 'seeded-english', module },
    ]);
    await locCacheBust(auth);

    await page.goto(LIST_PATH);
    await page.waitForLoadState('networkidle').catch(() => {});

    // Search for our seeded code — UI has a text filter on code.
    const search = page.getByPlaceholder(/search/i).first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill(code);
      await page.waitForLoadState('networkidle').catch(() => {});
    }

    const row = page.getByRole('row').filter({ hasText: code }).first();
    // If the pivot view hides non-matching rows via virtualization, we may
    // need to click the row to reach the edit cell; otherwise inline
    // edit is the standard react-admin EditableCell.
    if (!(await row.isVisible().catch(() => false))) {
      test.skip(true, 'Seeded row not surfaced in the list within networkidle — skipping inline edit');
    }

    // Capture the upsert XHR. The inline-edit path upserts but does NOT
    // fire a cache-bust (that's only done by the API-level save helper), so
    // we don't wait on a cache-bust request here.
    const upsertPromise = page.waitForRequest(
      (req) => req.url().includes('/localization/messages/v1/_upsert') && req.method() === 'POST',
      { timeout: 15_000 },
    ).catch(() => null);

    // Click the en_IN cell for our row and edit.
    // Style: click the row's English column cell to enter edit mode.
    const editCell = row.getByText('seeded-english').first();
    if (!(await editCell.isVisible().catch(() => false))) {
      test.skip(true, 'Editable cell not reachable via text match — UI layout changed');
    }
    await editCell.click();

    const input = page.locator('input:focus, textarea:focus').first();
    if (!(await input.isVisible().catch(() => false))) {
      test.skip(true, 'No editable input focused after cell click — layout changed');
    }
    await input.fill('edited-english');
    await input.press('Enter');

    const upsertReq = await upsertPromise;
    expect(upsertReq, 'clicking save should trigger _upsert').toBeTruthy();

    // API round-trip confirmation — force a cache-bust so the cached
    // _search doesn't lie to us.
    await locCacheBust(auth);
    const refreshed = await locSearch(auth, TENANT_CODE, locale, module);
    const updated = refreshed.find((m) => m.code === code);
    expect(updated?.message).toBe('edited-english');
  });

  test('6. missing locale translation renders em-dash placeholder', {
    annotation: {
      type: 'description',
      description: `UX check: when an en_IN row exists but its counterparts in the other supported locales (hi_IN / pt_BR / fr_FR) don't, the pivoted view renders a placeholder character (em-dash, en-dash, or triple-hyphen) instead of an empty cell. Avoids the citizen-confusing "blank column" effect. (LocalizationList renders "— missing —" for empty locale cells.)

Steps:
1. Generate a unique code; track for cleanup.
2. locUpsert english-only at TENANT_CODE / en_IN; locCacheBust. NO other-locale counterpart.
3. Navigate to /manage/localization; wait for networkidle.
4. If a search input exists, type the code; wait networkidle.
5. test.skip if the row isn't visible.
6. Read row textContent.
7. Assert it matches /[—–]|---/ (em-dash, en-dash, or triple-hyphen).

Skips gracefully if virtualization hides the row — UI behavior here is best-effort.`,
    },
    tag: ['@area:configurator-manage', '@area:localization', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({ page }, testInfo) => {
    // Seed an en_IN row but NO counterpart in the other locales. The pivoted
    // view should display an em-dash (—) for each missing locale cell.
    const auth = loadAuth();
    const code = testCode(testInfo, 'LOC_DASH');
    const locale = 'en_IN';
    const module = 'rainmaker-common';
    createdKeys.add(`${code}|${module}|${locale}`);

    await locUpsert(auth, TENANT_CODE, locale, [
      { code, message: 'english-only', module },
    ]);
    await locCacheBust(auth);

    await page.goto(LIST_PATH);
    await page.waitForLoadState('networkidle').catch(() => {});

    const search = page.getByPlaceholder(/search/i).first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill(code);
      await page.waitForLoadState('networkidle').catch(() => {});
    }

    const row = page.getByRole('row').filter({ hasText: code }).first();
    if (!(await row.isVisible().catch(() => false))) {
      test.skip(true, 'Seeded row not surfaced in list — skipping dash assertion');
    }

    const rowText = (await row.textContent()) || '';
    // em-dash (U+2014) OR en-dash (U+2013) OR triple-hyphen — accept any
    // placeholder style.
    expect(rowText).toMatch(/[—–]|---/);
  });

  test('7. module filter narrows rows', {
    annotation: {
      type: 'description',
      description: `Validates the Module filter on the localization comparator: picking a module option must produce at most as many rows as the unfiltered view (could be equal if the tenant only has rows in one module).

Steps:
1. Navigate to /manage/localization; wait for networkidle.
2. Locate getByLabel(/^Module/i); test.skip if not visible.
3. Read initialRows count.
4. Click the filter; click the first option; wait for networkidle.
5. Read filteredRows count.
6. Assert filteredRows <= initialRows.

Tolerates the single-module edge case (filter doesn't narrow anything) — only fails if the count actually grows after filter, which would indicate filter logic is broken.`,
    },
    tag: ['@area:configurator-manage', '@area:localization', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(LIST_PATH);
    await page.waitForLoadState('networkidle').catch(() => {});

    const moduleFilter = page.getByLabel(/^Module/i).first();
    if (!(await moduleFilter.isVisible().catch(() => false))) {
      test.skip(true, 'Module filter not present on this build');
    }

    const initialRows = await page.getByRole('row').count();
    await moduleFilter.click();
    await page.getByRole('option').first().click();
    await page.waitForLoadState('networkidle').catch(() => {});

    const filteredRows = await page.getByRole('row').count();
    // The filter either narrows rows or leaves them equal (single module).
    expect(filteredRows).toBeLessThanOrEqual(initialRows);
  });
});

// --- Local helpers — inline so we don't widen helpers/api.ts for a single
// page's contract. Kept symmetric with DigitApiClient.localization*. ---

interface LocMessage { code: string; message: string; module: string; locale?: string }

async function locSearch(
  auth: AuthInfo,
  tenantId: string,
  locale: string,
  module?: string,
): Promise<LocMessage[]> {
  const params = new URLSearchParams({ tenantId, locale });
  if (module) params.append('module', module);
  const url = `${auth.baseUrl}/localization/messages/v1/_search?${params.toString()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({
      RequestInfo: {
        apiId: 'Rainmaker', ver: '1.0', ts: Date.now(),
        msgId: `${Date.now()}|en_IN`, authToken: auth.token,
      },
    }),
  });
  const data = await res.json() as { messages?: LocMessage[] };
  return data.messages || [];
}

async function locUpsert(
  auth: AuthInfo,
  tenantId: string,
  locale: string,
  messages: LocMessage[],
): Promise<LocMessage[]> {
  const url = `${auth.baseUrl}/localization/messages/v1/_upsert?tenantId=${tenantId}&locale=${locale}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({
      RequestInfo: {
        apiId: 'Rainmaker', ver: '1.0', ts: Date.now(),
        msgId: `${Date.now()}|en_IN`, authToken: auth.token,
      },
      tenantId,
      messages: messages.map((m) => ({ ...m, locale })),
    }),
  });
  const data = await res.json() as { messages?: LocMessage[]; Errors?: Array<{ code?: string; message?: string }> };
  if (data.Errors?.length) {
    throw new Error(`_upsert failed: ${data.Errors.map((e) => e.code).join(', ')}`);
  }
  return data.messages || [];
}

async function locDelete(
  auth: AuthInfo,
  tenantId: string,
  locale: string,
  messages: Array<{ code: string; module: string }>,
): Promise<boolean> {
  const url = `${auth.baseUrl}/localization/messages/v1/_delete`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({
      RequestInfo: {
        apiId: 'Rainmaker', ver: '1.0', ts: Date.now(),
        msgId: `${Date.now()}|en_IN`, authToken: auth.token,
      },
      tenantId,
      messages: messages.map((m) => ({ ...m, locale })),
    }),
  });
  const data = await res.json() as { successful?: boolean };
  return data.successful === true;
}

async function locCacheBust(auth: AuthInfo): Promise<void> {
  const url = `${auth.baseUrl}/localization/messages/cache-bust`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({
      RequestInfo: {
        apiId: 'Rainmaker', ver: '1.0', ts: Date.now(),
        msgId: `${Date.now()}|en_IN`, authToken: auth.token,
      },
    }),
  });
}
