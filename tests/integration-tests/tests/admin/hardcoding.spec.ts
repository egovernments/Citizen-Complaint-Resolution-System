/**
 * Smoke checks for the recently-cleaned hardcoding regressions.
 *
 * Each assertion guards a specific bug class that has bitten us before:
 *   1. Login tenant placeholder is the configured tenant, not a baked-in literal.
 *   2. Employee/user create payloads address only the configured tenant.
 *   3. Complaint create payload addresses only the configured tenant.
 *   4. Localization never falls back to some other deployment's tenant.
 *
 * Tests 2-4 intercept network requests and probe the bodies. They DO NOT
 * actually create data — assertions fire as soon as the relevant XHR is
 * issued, then the spec navigates away.
 *
 * WHY THIS FILE NO LONGER HUNTS THE LITERAL 'pg'
 * ----------------------------------------------
 * It used to assert that the string "pg" never appeared as a tenant value
 * anywhere — 'pg' (Punjab) being the upstream default that leaked into the
 * Kenya deployment. That encoding of the rule has two defects:
 *
 *   (a) It is WRONG on any deployment whose tenant genuinely is 'pg' (the
 *       playground tenant we now test against). Test 1 asserted both
 *       `placeholder === ROOT_TENANT` and `placeholder !== 'pg'`, which are
 *       flatly contradictory once ROOT_TENANT === 'pg'. No app behaviour
 *       could satisfy both; it was an unconditional failure.
 *
 *   (b) It is TOO WEAK everywhere else. 'pg' is one of many tenants that
 *       could leak. A Kenya default leaking into this deployment was invisible
 *       to the old check, because it only ever looked for that one literal.
 *
 * The invariant we actually care about is "every tenantId on the wire belongs
 * to THIS deployment" — i.e. it is ROOT_TENANT or a descendant of it. That is
 * deployment-agnostic and strictly stronger than the literal hunt: it catches
 * 'pg' leaking into a 'ke' deployment AND 'ke' leaking into a 'pg' one.
 */
import { test, expect, type Request } from '@playwright/test';
import { ROOT_TENANT } from '../utils/env';

// The configured root (state) tenant, from env — the login placeholder
// derives from the configured tenant (app fix), so we expect ROOT_TENANT here.
const TENANT_CODE = ROOT_TENANT;

/**
 * A tenantId belongs to this deployment if it is the root tenant itself or a
 * dot-separated descendant of it ('pg' -> 'pg.citya'). Anything else is a
 * foreign tenant: either a hardcoded literal from another deployment, or a
 * default the app invented instead of reading its own configuration.
 */
function isOwnTenant(tenantId: string): boolean {
  return tenantId === ROOT_TENANT || tenantId.startsWith(`${ROOT_TENANT}.`);
}

/** Every distinct `"tenantId": "..."` value in a JSON request body. */
function tenantIdsIn(body: string): string[] {
  if (!body) return [];
  const out = new Set<string>();
  for (const m of body.matchAll(/"tenantId"\s*:\s*"([^"]*)"/g)) out.add(m[1]);
  return [...out];
}

/** Foreign tenantIds in a body — empty means the payload is clean. */
function foreignTenantIds(body: string): string[] {
  return tenantIdsIn(body).filter((t) => !isOwnTenant(t));
}

test.describe('hardcoding smoke', () => {
  // Test 1 needs an unauthenticated session. The other three need the
  // authed session that auth.setup.ts wrote — they share the chromium
  // project's storageState by default.

  test('1. login tenant placeholder uses configured tenant, not "pg"', {
    annotation: {
      type: 'description',
      description: `Smoke check that the configurator login form's tenant placeholder reflects the configured root tenant (ROOT_TENANT, from env) and is NOT the legacy 'pg' (Punjab) value. The app fix derives the placeholder from the configured tenant, so this expects ROOT_TENANT on any deployment. Catches a regression where someone copy-pastes example markup with hardcoded 'pg' back into the login template.

Steps:
1. Open a fresh browser context with no storageState (need the unauthenticated form).
2. Navigate to /configurator/login.
3. Locate input#tenantCode; assert visible.
4. Read placeholder attribute.
5. Assert placeholder === TENANT_CODE (the configured ROOT_TENANT).
6. Assert placeholder.toLowerCase() !== 'pg' — belt-and-braces in case the placeholder is empty.

Pairs with the other three hardcoding tests in this file — together they cover login UI + employee create + complaint create + localization endpoint as the four most common 'pg' leak vectors.`,
    },
    tag: ['@area:configurator-manage', '@kind:smoke', '@layer:ui', '@persona:admin'] }, async ({
    browser,
  }) => {
    // Fresh context with no storageState so we hit the login form.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    try {
      await page.goto('/configurator/login');

      const tenantInput = page.locator('#tenantCode');
      await expect(tenantInput).toBeVisible();

      // Guard the guard: if ROOT_TENANT were empty, the assertion below would
      // be satisfied by a missing placeholder and prove nothing.
      expect(TENANT_CODE, 'ROOT_TENANT must be configured for this test to mean anything').toBeTruthy();

      const placeholder = await tenantInput.getAttribute('placeholder');
      expect(placeholder).toBe(TENANT_CODE);
    } finally {
      await context.close();
    }
  });

  test('2. employee create surface addresses only the configured tenant', {
    annotation: {
      type: 'description',
      description: `Network-intercept smoke check over the employee create page: every tenantId appearing in any request body must belong to this deployment (ROOT_TENANT or a descendant).

Steps:
1. Attach a request listener over ALL requests carrying a body; record any tenantId that is not ROOT_TENANT or a descendant.
2. Navigate to /configurator/manage/employees/create.
3. Wait for networkidle (settles the form's master-data prefetches).
4. Assert at least one tenant-bearing request was observed (non-vacuity guard).
5. Assert offending === [].

TWO DEFECTS FIXED HERE.

(a) VACUOUS. It watched only /egov-hrms/employees/_create and /user/users/_createnovalidate, then deliberately did NOT submit the form (to avoid creating a real employee). No create XHR is fired by merely loading the page, so the offending array was empty on every run and the assertion could never fail. It was scored as a pass 100% of the time while testing nothing — the "absence over an empty set" shape.

(b) WRONG RULE. It hunted the literal 'pg', which is a legitimate tenant here. See the file header.

The fix keeps the no-data-created property — still no fill+submit — but widens the intercept to every request the page does make. A create form loads departments, designations, roles and boundaries, all tenant-scoped, so there is ample real traffic to inspect. The seen-count guard makes a future regression to vacuity fail loudly instead of silently.`,
    },
    tag: ['@area:configurator-manage', '@kind:smoke', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }) => {
    const offending: Array<{ url: string; tenants: string[] }> = [];
    let seen = 0;

    page.on('request', (req: Request) => {
      const body = req.postData() || '';
      if (!tenantIdsIn(body).length) return;
      seen++;
      const foreign = foreignTenantIds(body);
      if (foreign.length) offending.push({ url: req.url(), tenants: foreign });
    });

    // Open the create form. We deliberately do NOT fill + submit — that would
    // create a real employee and pollute the tenant. The master-data fetches
    // the form issues on load are enough to prove tenant scoping.
    await page.goto('/configurator/manage/employees/create');
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(seen, 'no tenant-bearing requests observed — this test would be vacuous').toBeGreaterThan(0);
    expect(
      offending,
      `Found ${offending.length} request(s) addressing a foreign tenant (expected ${ROOT_TENANT} or a descendant):\n` +
        offending.map((o) => `  ${o.url}: ${o.tenants.join(', ')}`).join('\n'),
    ).toEqual([]);
  });

  test('3. complaint create surface addresses only the configured tenant', {
    annotation: {
      type: 'description',
      description: `Sibling of test 2 for the complaint create surface: every tenantId in any request body issued by the complaint create page must be ROOT_TENANT or a descendant.

Steps:
1. Attach a request listener over ALL requests carrying a body; record foreign tenantIds.
2. Navigate to /configurator/manage/complaints/create.
3. Wait for networkidle.
4. Assert at least one tenant-bearing request was observed (non-vacuity guard).
5. Assert offending === [].

Carried the same two defects as test 2 and is fixed the same way: it watched only /pgr-services/v2/request/_create, which never fires on page load, so it passed unconditionally; and it hunted the literal 'pg', which is this deployment's own tenant. The complaint form loads the complaint hierarchy and locality boundaries on mount, both tenant-scoped, giving real traffic to inspect without creating a complaint.`,
    },
    tag: ['@area:configurator-manage', '@kind:smoke', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }) => {
    const offending: Array<{ url: string; tenants: string[] }> = [];
    let seen = 0;

    page.on('request', (req: Request) => {
      const body = req.postData() || '';
      if (!tenantIdsIn(body).length) return;
      seen++;
      const foreign = foreignTenantIds(body);
      if (foreign.length) offending.push({ url: req.url(), tenants: foreign });
    });

    await page.goto('/configurator/manage/complaints/create');
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(seen, 'no tenant-bearing requests observed — this test would be vacuous').toBeGreaterThan(0);
    expect(
      offending,
      `Found ${offending.length} request(s) addressing a foreign tenant (expected ${ROOT_TENANT} or a descendant):\n` +
        offending.map((o) => `  ${o.url}: ${o.tenants.join(', ')}`).join('\n'),
    ).toEqual([]);
  });

  test('4. localization never falls back to a foreign tenant', {
    annotation: {
      type: 'description',
      description: `Network-intercept check across multiple high-traffic configurator pages: every /localization/messages/v1/_search XHR must carry a tenantId belonging to this deployment (ROOT_TENANT or a descendant), on either the query string or the JSON body. Localization fetches happen on virtually every page load, so a leaked default surfaces widely.

Steps:
1. Attach a request listener on /localization/messages/v1/_search.
2. For each request read tenantId from URL.searchParams, else from the JSON body; record any that is not ROOT_TENANT or a descendant.
3. Walk three pages to warm the localization client: /configurator/manage, /configurator/manage/departments, /configurator/manage/complaints (waiting for networkidle each).
4. Assert at least one localization request was observed (non-vacuity guard).
5. Assert offending === [].

Previously asserted specifically that tenantId was not 'pg'. On this deployment 'pg' IS the configured tenant, so every correct localization fetch was scored as a leak and the test failed unconditionally — it could not pass no matter how the app behaved. Checking membership in the configured tenant tree instead is both correct here and stronger elsewhere: it catches any foreign tenant, not just the one literal.

Multi-page walk catches the case where localization defaults wrongly only in certain code paths (e.g. dropdowns vs. labels).`,
    },
    tag: ['@area:configurator-manage', '@kind:smoke', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    const offending: string[] = [];
    let seen = 0;

    page.on('request', (req: Request) => {
      const url = req.url();
      if (!/\/localization\/messages\/v1\/_search/.test(url)) return;
      // tenantId can ride either the query string or the JSON body.
      const qs = new URL(url).searchParams.get('tenantId');
      const tenants = qs ? [qs] : tenantIdsIn(req.postData() || '');
      if (!tenants.length) return;
      seen++;
      const foreign = tenants.filter((t) => !isOwnTenant(t));
      if (foreign.length) offending.push(`${url} -> ${foreign.join(', ')}`);
    });

    // Walk a few high-traffic pages so the localization client warms up
    // in every typical context.
    await page.goto('/configurator/manage');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.goto('/configurator/manage/departments');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.goto('/configurator/manage/complaints');
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(seen, 'no localization requests observed — this test would be vacuous').toBeGreaterThan(0);
    expect(
      offending,
      `Localization addressed a foreign tenant (expected ${ROOT_TENANT} or a descendant) on:\n  ${offending.join('\n  ')}`,
    ).toEqual([]);
  });
});
