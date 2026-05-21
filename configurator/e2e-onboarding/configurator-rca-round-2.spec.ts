/**
 * Round-2 RCA fixes — Playwright regression suite
 *
 * Covers Gurjeet's review comments and follow-ups closed in PRs #45 and #46:
 *   #417 — Misleading Undo toast hidden
 *   #461 — Citizen Create: Username field removed; mobile uses Kenya regex
 *   #462 — Citizen Create: visible "*" on Name and Mobile
 *   #459 — Employee Create: Tenant picker present (drives tenant-scoped fetches)
 *   #476 — Hardcoded RETIRED/TERMINATED/RESIGNED deactivation-reason floor
 *           dropped from the bundle
 *   #483 — Master-data Edit: boolean field renders as checkbox, not text input
 *
 * Login happens once in beforeAll; each test page.goto's the resource it
 * cares about. `serial` mode keeps order deterministic.
 *
 * Run:
 *   E2E_BASE_URL=https://naipepea.digit.org/configurator \
 *   E2E_TENANT=ke \
 *   npx playwright test --config e2e-onboarding/playwright.config.ts \
 *     e2e-onboarding/configurator-rca-round-2.spec.ts
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'https://naipepea.digit.org/configurator';
const TENANT = process.env.E2E_TENANT || 'ke';
const USERNAME = process.env.E2E_USERNAME || 'ADMIN';
const PASSWORD = process.env.E2E_PASSWORD || 'eGov@123';

test.describe.configure({ mode: 'serial' });

test.describe('Configurator RCA — Round 2 regressions', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    page.setDefaultTimeout(30_000);

    await page.goto(`${BASE_URL}/login`);
    const manageBtn = page.getByRole('button', { name: /^\s*Management\s*$/i });
    await manageBtn.waitFor({ timeout: 10_000 });
    await manageBtn.click();

    await page.locator('#tenantCode').fill(TENANT);
    await page.locator('#username').fill(USERNAME);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/manage(\/|$|\?)/, { timeout: 30_000 });
  });

  test.afterAll(async () => {
    await page?.close();
    await context?.close();
  });

  // -------------------------------------------------------------------------
  // #417 — Undo toast not present
  // -------------------------------------------------------------------------
  test('#417: Manage view does NOT render the misleading Undo toast', async () => {
    await page.goto(`${BASE_URL}/manage`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const undoTrigger = page.getByRole('button', { name: /^Undo$/i });
    expect(await undoTrigger.count()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // #461 + #462 — Citizen Create form structure
  // -------------------------------------------------------------------------
  test('#461 + #462: Citizen Create has no Username field; Name + Mobile show "*"', async () => {
    await page.goto(`${BASE_URL}/manage/users/create`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('input', { timeout: 20_000 });

    // 1. The standalone "Username" label/input must be gone.
    const usernameLabel = page.locator('label').filter({ hasText: /^Username\s*\*?$/i });
    expect(await usernameLabel.count()).toBe(0);

    // 2. Name and Mobile labels render the asterisk.
    const nameLabelText = (await page.locator('label').filter({ hasText: /^Name\s*\*?$/i }).first().innerText()).trim();
    expect(nameLabelText).toMatch(/^Name\s*\*$/);

    const mobileLabelText = (await page.locator('label').filter({ hasText: /^Mobile Number\s*\*?$/i }).first().innerText()).trim();
    expect(mobileLabelText).toMatch(/^Mobile Number\s*\*$/);

    // 3. Help text reflects the Kenya format.
    const helpKE = page.getByText(/9 digits.*7.*1|712345678/i);
    expect(await helpKE.count()).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // #459 — Employee Create has a form-picked Tenant field
  // -------------------------------------------------------------------------
  test('#459: Employee Create surfaces a Tenant picker (drives tenant-scoped MDMS fetches)', async () => {
    await page.goto(`${BASE_URL}/manage/employees/create`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('input, [role="combobox"]', { timeout: 20_000 });

    const tenantLabel = page.locator('label').filter({ hasText: /^Tenant\s*\*?$/i });
    await expect(tenantLabel.first()).toBeVisible();
    const tenantLabelText = (await tenantLabel.first().innerText()).trim();
    expect(tenantLabelText).toMatch(/^Tenant\s*\*$/);
  });

  // -------------------------------------------------------------------------
  // #476 — Hardcoded deactivation-reason floor removed from bundle
  // -------------------------------------------------------------------------
  test('#476: hardcoded RETIRED/TERMINATED/RESIGNED floor removed from the served bundle', async () => {
    // The rendered dropdown only mounts for an existing employee in INACTIVE
    // state (extra nav noise). Reading the served JS bundle is enough to
    // prove the floor literals were removed.
    const bundle = await page.evaluate(async (base) => {
      const html = await fetch(base + '/').then((r) => r.text());
      const m = html.match(/assets\/index-[^"]+\.js/);
      if (!m) return '';
      const url = base + '/' + m[0];
      return fetch(url).then((r) => r.text());
    }, BASE_URL);

    expect(bundle.length).toBeGreaterThan(10_000);

    // The hardcoded floor list contained `TERMINATED` and `RESIGNED` codes
    // which appear NOWHERE else in the configurator (Employee Status uses
    // EMPLOYED / INACTIVE / RETIRED). RETIRED on its own is ambiguous, but
    // these two are unique floor markers — their absence proves the floor
    // was removed.
    expect(bundle).not.toContain('TERMINATED');
    expect(bundle).not.toContain('RESIGNED');
  });

  // -------------------------------------------------------------------------
  // #483 — Boolean field rendered as checkbox in MdmsResourceEdit
  // -------------------------------------------------------------------------
  test('#483: Gender-types Edit renders boolean `active` as a checkbox, not text', async () => {
    await page.goto(`${BASE_URL}/manage/gender-types/TRANSGENDER/edit`);
    await page.waitForLoadState('domcontentloaded');

    if (page.url().includes('/manage/gender-types') === false || page.url().endsWith('/manage/gender-types')) {
      await page.goto(`${BASE_URL}/manage/gender-types`);
      await page.waitForLoadState('domcontentloaded');
      const editLink = page.locator('a[href*="/edit"], button:has-text("Edit")').first();
      if (await editLink.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await editLink.click();
        await page.waitForLoadState('domcontentloaded');
      }
    }

    await page.waitForSelector('input', { timeout: 20_000 });

    const checkboxes = page.locator('input[type="checkbox"]');
    expect(await checkboxes.count()).toBeGreaterThan(0);

    const activeText = page.locator('input[type="text"][name="active" i], input[type="text"][id*="active" i]');
    expect(await activeText.count()).toBe(0);
  });
});
