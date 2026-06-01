/**
 * Employee digit-ui shell — login + chrome + decrypted inbox bundle.
 *
 * Covers in one run:
 *   #592       /digit-ui/globalConfigs.js served + parseable
 *   #505 sub-1 login background brand-dark, not white
 *   #505 sub-2 header surfaces user initial (post-fix circle removal)
 *   #505 sub-3 banner/header logos sized correctly (96x96)
 *   #505 sub-4 dropdown icons render with dark fill (not white-on-white)
 *   #344       PGR SecurityPolicy lets PGR roles read decrypted
 *              name/mobile (not hex blobs) on complaint detail page
 *   #432       PGR inbox-v2 mounts cleanly + every visible row is in
 *              an OPEN workflow state + status filter dropdown
 *              populated + only sortable column has a sort icon
 *   #622       Post-login shell mounts (no 503/something-went-wrong)
 */
import { test, expect } from '@playwright/test';
import {
  BASE_URL,
  EMPLOYEE_USER,
  EMPLOYEE_PASS,
  TENANT_LABEL,
  ASSIGNED_COMPLAINT_ID,
} from '../utils/env';

const LOGIN_URL = '/digit-ui/employee/user/login';
const INBOX_URL = '/digit-ui/employee/pgr/inbox-v2';
const GLOBAL_CONFIGS_URL = '/digit-ui/globalConfigs.js';

test.describe('employee digit-ui shell bundle', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login + chrome + visible decrypt + inbox honest drives', async ({ page }) => {
    // ============ #592 globalConfigs.js ============
    const gcResp = await page.request.get(`${BASE_URL}${GLOBAL_CONFIGS_URL}?cb=${Date.now()}`);
    expect(gcResp.status()).toBe(200);
    expect(await gcResp.text()).toMatch(/STATE_LEVEL_TENANT_ID|stateTenantId/);

    // ============ #505 sub-1 + sub-3 — login page UI ============
    await page.goto(`${BASE_URL}${LOGIN_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_500);

    const bannerBg = await page.evaluate(() => {
      const el = document.querySelector('.banner') as HTMLElement | null;
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    expect(bannerBg, 'login banner must render with a brand color, not white').not.toMatch(
      /rgba?\(\s*255\s*,\s*255\s*,\s*255/,
    );

    const logoBox = await page.evaluate(() => {
      const img = document.querySelector('.bannerLogo') as HTMLImageElement | null;
      return img ? { w: img.offsetWidth, h: img.offsetHeight } : null;
    });
    expect(logoBox!.w, '#505 sub-3 bannerLogo width').toBeGreaterThanOrEqual(96);
    expect(logoBox!.h, '#505 sub-3 bannerLogo height').toBeGreaterThanOrEqual(96);

    // ============ #622 — Login completes ============
    await page.locator('input[type="text"]').first().pressSequentially(EMPLOYEE_USER, { delay: 60 });
    await page.locator('input[type="password"]').first().pressSequentially(EMPLOYEE_PASS, { delay: 60 });

    const cityCombo = page.getByRole('combobox', { name: /City/i });
    if (!(await cityCombo.textContent())?.includes(TENANT_LABEL)) {
      await cityCombo.click();
      await page.waitForTimeout(700);
      await page.getByRole('option', { name: new RegExp(TENANT_LABEL, 'i') }).first().click();
      await page.waitForTimeout(700);
    }
    await page.getByText(/I agree to the DIGIT/i).click();
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: /^Login$/i }).click();
    await page.waitForURL(/\/digit-ui\/employee(?!\/user\/login)/, { timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // ============ #505 sub-2 — header initial visible ============
    const expectedInitial = EMPLOYEE_USER.charAt(0);
    const headerInitial = await page.evaluate((expected) => {
      const headerNodes = [
        ...document.querySelectorAll(
          'header *, [class*="topbar" i] *, [class*="TopBar" i] *, [class*="header" i] *',
        ),
      ];
      return headerNodes.find((n) => (n.textContent || '').trim() === expected) ? true : false;
    }, expectedInitial);
    expect(headerInitial, `#505 sub-2 — header must surface user initial '${expectedInitial}'`).toBe(
      true,
    );

    // ============ #505 sub-4 — dropdown icons rendered with dark fill ============
    const profileTrigger = page.locator('.header-dropdown-profile').first();
    if (await profileTrigger.isVisible().catch(() => false)) {
      await profileTrigger.scrollIntoViewIfNeeded();
      const btn = profileTrigger.locator('xpath=ancestor::button[1]');
      if (await btn.isVisible().catch(() => false)) await btn.click();
      else await profileTrigger.click();
      await page.waitForTimeout(1_500);

      await expect(page.getByText(/Edit Profile/i).first()).toBeVisible({ timeout: 8_000 });
      await expect(page.getByText(/Logout/i).first()).toBeVisible({ timeout: 8_000 });

      const iconColors = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.header-dropdown-option, [role="menuitem"]')];
        const colors: string[] = [];
        for (const item of items) {
          const svg = item.querySelector('svg path, svg rect, svg circle') as SVGElement | null;
          if (svg) {
            const fill = svg.getAttribute('fill') || getComputedStyle(svg).fill;
            if (fill) colors.push(fill);
          }
        }
        return colors;
      });
      const hasDark = iconColors.some(
        (c) =>
          !/^#?fff(fff)?$/i.test(c.trim()) &&
          !/^rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)$/.test(c.trim()) &&
          !/^rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(c.trim()),
      );
      expect(hasDark, `#505 sub-4 — at least one dropdown icon must be visibly dark`).toBeTruthy();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    }

    // ============ #344 — complaint detail visible decrypt ============
    await page.goto(
      `${BASE_URL}/digit-ui/employee/pgr/complaint-details/${ASSIGNED_COMPLAINT_ID}?cb=${Date.now()}`,
    );
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_500);

    const detailBody = (await page.locator('body').innerText()) || '';
    expect(detailBody, '#344 — detail body must not surface base64-shaped hex blobs').not.toMatch(
      /\b[A-Za-z0-9+/]{30,}=+/,
    );
    await expect(
      page.getByText(/Contact Details:\s*\d{9,10}/).first(),
      '#344 — Contact Details must render decrypted (numeric)',
    ).toBeVisible({ timeout: 15_000 });

    // ============ #432 sub-1/2/3 — inbox honest drives ============
    await page.goto(`${BASE_URL}${INBOX_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_000);

    await expect(page.getByText(/service unavailable|503|something went wrong/i)).toHaveCount(0);
    await expect(page.locator('table, [role="table"]').first()).toBeVisible({ timeout: 20_000 });

    const body = (await page.locator('body').innerText()) || '';
    expect(body, '#432/#344 — inbox body must not surface base64-shaped hex blobs').not.toMatch(
      /\b[A-Za-z0-9+/]{30,}=+/,
    );

    // sub-1: rows in OPEN states only
    const OPEN_STATES = /PENDINGFORASSIGNMENT|PENDINGFORREASSIGNMENT|PENDINGATLME|PENDINGATSUPERVISOR|PENDINGFORWORK|OPEN/i;
    const CLOSED_STATES = /RESOLVED|REJECTED|CLOSED/i;
    const rowCount = await page.locator('tbody tr').count();
    if (rowCount > 0) {
      const rowsText = await page.locator('tbody tr').allInnerTexts();
      const offenders = rowsText
        .filter((r) => OPEN_STATES.test(r) || CLOSED_STATES.test(r))
        .filter((r) => CLOSED_STATES.test(r) && !OPEN_STATES.test(r));
      expect(offenders.length, `#432 sub-1 — inbox default view should only surface OPEN states`).toBe(0);
    }

    // sub-2: status filter dropdown populated
    const statusFilterTrigger = page
      .locator('button, [role="combobox"], [class*="filter" i]')
      .filter({ hasText: /status|workflow/i })
      .first();
    if (await statusFilterTrigger.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await statusFilterTrigger.click();
      await page.waitForTimeout(1_500);
      const filterOptions = page.locator(
        '[role="listbox"][data-state="open"] [role="option"], [role="option"], [class*="filter" i] input[type="checkbox"]',
      );
      expect(
        await filterOptions.count(),
        '#432 sub-2 — status filter must list at least 1 option',
      ).toBeGreaterThan(0);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
    }

    // sub-3: only sortable column has a sort icon
    const headerCells = page.locator('thead th, thead [role="columnheader"]');
    const headerCount = await headerCells.count();
    if (headerCount > 0) {
      let sortableCount = 0;
      for (let i = 0; i < headerCount; i++) {
        const html = (await headerCells.nth(i).innerHTML().catch(() => '')) || '';
        if (/<svg|class="[^"]*sort|aria-sort/i.test(html)) sortableCount++;
      }
      expect(
        sortableCount,
        `#432 sub-3 — only the sortable column should show a sort icon; got ${sortableCount}/${headerCount}`,
      ).toBeLessThanOrEqual(1);
    }
  });
});
