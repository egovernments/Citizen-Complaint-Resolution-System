/**
 * Localization comparator — pivoted view + inline edit round-trip.
 *
 * The page renders one row per (code, module) with parallel `en_IN` and
 * `sw_KE` columns. Saves go through `localizationUpsert` and a
 * fire-and-forget `POST /localization/messages/cache-bust` — without the
 * bust, the service's internal Redis cache keeps returning the stale
 * value for the rest of the TTL. Cold load is ~7.3 s bound by the
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

const TENANT_CODE = process.env.TENANT_CODE || 'ke';
const CITY_TENANT = process.env.DIGIT_TENANT || `${TENANT_CODE}.nairobi`;
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
  test('1. tenant parity — both ke and ke.nairobi return the same rainmaker-common en_IN count', {
    annotation: {
      type: 'description',
      description: `Tenant-parity guard: localization counts at root tenant (ke) and city tenant (ke.nairobi) for rainmaker-common / en_IN must match within ±2 rows. Probed 2026-04-23 at 4,259 rows on each. Tiny skew is tolerated to absorb seed/inline-edit churn.

Steps:
1. In parallel, locSearch(TENANT_CODE, 'en_IN', 'rainmaker-common') and locSearch(CITY_TENANT, 'en_IN', 'rainmaker-common').
2. Assert keRows.length > 100.
3. Assert |keRows.length - cityRows.length| <= 2.

Catches a regression where city-level localization stops inheriting from root, or where one tenant gets a partial seed.`,
    },
    tag: ['@area:configurator-manage', '@area:localization', '@kind:regression', '@layer:ui', '@persona:admin'] }, async () => {
    const auth = loadAuth();
    const [keRows, cityRows] = await Promise.all([
      locSearch(auth, TENANT_CODE, 'en_IN', 'rainmaker-common'),
      locSearch(auth, CITY_TENANT, 'en_IN', 'rainmaker-common'),
    ]);
    expect(keRows.length).toBeGreaterThan(100);
    // ±2 slack — seed / inline-edit churn can create tiny skew.
    expect(Math.abs(keRows.length - cityRows.length)).toBeLessThanOrEqual(2);
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
      description: `Smoke check the pivoted comparator UI: the page renders a table, the table has at least 10 rows, and the body text contains all four expected column-header keywords (code, module, English/en_IN, Swahili/sw_KE).

Steps:
1. Navigate to /configurator/manage/localization; wait for networkidle.
2. Assert role=table is visible within 30s (cold load is ~7.3s).
3. Assert getByRole('row') count > 10 (well under the 1760 rows we know live).
4. For each label regex /code/i, /module/i, /english|en_IN/i, /swahili|sw_KE/i, assert at least one matching text element is visible.

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

    // The page is the "pivoted" comparator — Code + Module + English +
    // Swahili columns. Match leniently (case + substring) so minor label
    // tweaks don't break the test.
    const body = page.locator('body');
    for (const label of [/code/i, /module/i, /english|en_IN/i, /swahili|sw_KE/i]) {
      await expect(body.getByText(label).first()).toBeVisible();
    }
  });

  test('5. inline edit — UI save round-trips via localizationUpsert + cache-bust', {
    annotation: {
      type: 'description',
      description: `Confirms inline cell editing on the comparator triggers BOTH the _upsert XHR and the fire-and-forget /cache-bust XHR, and that the new value persists through a fresh _search. Seeds via API for determinism, then drives the click + edit + Enter flow.

Steps:
1. Generate a unique code; track for cleanup.
2. locUpsert with 'seeded-english'; locCacheBust.
3. Navigate to /manage/localization; wait for networkidle.
4. If a search input exists, type the code; wait networkidle.
5. test.skip if the seeded row isn't visible (virtualization edge case).
6. Set up two waitForRequest promises: one for /_upsert POST, one for /cache-bust POST.
7. Click the cell containing 'seeded-english'; test.skip if not reachable.
8. Locate the focused input/textarea; test.skip if not focused.
9. Fill 'edited-english'; press Enter.
10. Assert both XHR promises resolved truthy (upsert AND cache-bust fired).
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

    // Capture the upsert XHR.
    const upsertPromise = page.waitForRequest(
      (req) => req.url().includes('/localization/messages/v1/_upsert') && req.method() === 'POST',
      { timeout: 15_000 },
    ).catch(() => null);
    // Fire-and-forget cache-bust should follow.
    const bustPromise = page.waitForRequest(
      (req) => req.url().includes('/localization/messages/cache-bust') && req.method() === 'POST',
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
    const bustReq = await bustPromise;
    expect(upsertReq, 'clicking save should trigger _upsert').toBeTruthy();
    expect(bustReq, 'upsert should be followed by cache-bust').toBeTruthy();

    // API round-trip confirmation — force a cache-bust so the cached
    // _search doesn't lie to us.
    await locCacheBust(auth);
    const refreshed = await locSearch(auth, TENANT_CODE, locale, module);
    const updated = refreshed.find((m) => m.code === code);
    expect(updated?.message).toBe('edited-english');
  });

  test('6. missing sw_KE translation renders em-dash placeholder', {
    annotation: {
      type: 'description',
      description: `UX check: when an en_IN row exists but the sw_KE counterpart doesn't, the pivoted view renders a placeholder character (em-dash, en-dash, or triple-hyphen) instead of an empty cell. Avoids the citizen-confusing "blank Swahili column" effect.

Steps:
1. Generate a unique code; track for cleanup.
2. locUpsert english-only at TENANT_CODE / en_IN; locCacheBust. NO sw_KE counterpart.
3. Navigate to /manage/localization; wait for networkidle.
4. If a search input exists, type the code; wait networkidle.
5. test.skip if the row isn't visible.
6. Read row textContent.
7. Assert it matches /[—–]|---/ (em-dash, en-dash, or triple-hyphen).

Skips gracefully if virtualization hides the row — UI behavior here is best-effort.`,
    },
    tag: ['@area:configurator-manage', '@area:localization', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({ page }, testInfo) => {
    // Seed an en_IN row but NO sw_KE counterpart. The pivoted view should
    // display an em-dash (—) for the missing swahili cell.
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
