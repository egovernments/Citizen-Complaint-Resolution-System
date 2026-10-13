/**
 * Employee digit-ui shell — hosted sign-in chrome + shell + decrypted inbox bundle.
 *
 * Covers in one run:
 *   #592       /digit-ui/globalConfigs.js served + parseable
 *   #505 sub-1 sign-in background brand-dark, not white — now asserted on
 *              the Keycloak digit-employee theme (.dg-banner), which replaced
 *              the digit-ui login form in #1999
 *   #505 sub-2 header surfaces the logged-in user's initial (post-fix
 *              circle removal)
 *   #505 sub-3 sign-in header logo (.dg-banner-header__logo) actually loads
 *              and lays out
 *   #505 sub-4 dropdown icons render with dark fill (not white-on-white)
 *   #344       PGR SecurityPolicy lets PGR roles read decrypted
 *              name/mobile (not hex blobs) on complaint detail page
 *   #432       PGR inbox-v2 mounts cleanly + every visible row is in
 *              an OPEN workflow state + status filter dropdown
 *              populated + only sortable column has a sort icon
 *   #622       Post-login shell mounts (no 503/something-went-wrong)
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, EMPLOYEE_USER, EMPLOYEE_PASS } from '../utils/env';
import { readLifecycleFixtures } from '../utils/lifecycle-fixtures';
import { authorizeUrl, hostedSignIn, surfacePath, tenantSlug } from '../utils/identity-bff';

const GLOBAL_CONFIGS_URL = '/digit-ui/globalConfigs.js';

// hostedSignIn types the persona password into the hosted form, and traces
// record filled values: keep this spec out of the published trace.
test.use({ trace: 'off' });

const _fixtures = readLifecycleFixtures();
/**
 * A complaint known to sit in the logged-in employee's inbox, for the #344
 * decrypt assertion. env.ts's own ASSIGNED_COMPLAINT_ID export is a dead
 * naipepea literal (always truthy, so nothing downstream ever notices it's
 * wrong) — this resolves it properly instead:
 *   explicit env override
 *   -> lifecycle.setup.ts's assigned_to_employee (the complaint it drives to
 *      PENDINGATLME and leaves assigned, specifically so a spec like this one
 *      has a real "assigned to an employee" SRID on the live deployment)
 *   -> '' (no cross-deployment fallback — an SRID from a different tenant
 *      renders "No Results Found" and burns the #344 assertion's whole
 *      timeout waiting for content that was never going to appear; see
 *      pgr-details.spec.ts for the same lesson learned the hard way).
 */
const ASSIGNED_COMPLAINT_ID =
  process.env.ASSIGNED_COMPLAINT_ID || _fixtures?.complaints?.assigned_to_employee || '';

test.describe('employee digit-ui shell bundle', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('hosted sign-in + chrome + visible decrypt + inbox honest drives', { tag: ['@persona:employee'] }, async ({ page }) => {
    // This test used to carry an unconditional `test.fixme(true, …)` blaming
    // two onboarding-data gaps. Both claims were false and are now retired:
    //   * "#344 needs a seeded ASSIGNED_COMPLAINT_ID" — lifecycle.setup.ts DOES
    //     seed one (lifecycle-fixtures.json -> complaints.assigned_to_employee),
    //     which is exactly what the resolution chain above reads.
    //   * "#505 brand chrome needs tenant branding onboarded" — the sign-in
    //     banner renders its brand colour from the shipped stylesheet with zero
    //     branding seeded.
    //
    // No skip guard here on purpose: an unresolved SRID is a broken
    // lifecycle-setup, not a legitimate "nothing to test" — fail loudly with the
    // cause rather than driving the UI at a blank SRID and timing out opaquely.
    expect(
      ASSIGNED_COMPLAINT_ID,
      'no assigned_to_employee complaint available — lifecycle.setup.ts did not seed one; set ASSIGNED_COMPLAINT_ID to override',
    ).not.toBe('');

    // ============ #592 globalConfigs.js ============
    const gcResp = await page.request.get(`${BASE_URL}${GLOBAL_CONFIGS_URL}?cb=${Date.now()}`);
    expect(gcResp.status()).toBe(200);
    expect(await gcResp.text()).toMatch(/STATE_LEVEL_TENANT_ID|stateTenantId/);

    // ============ #505 sub-1 + sub-3 — hosted sign-in page (Keycloak theme) ============
    // Since #1999 the employee signs in on Keycloak's digit-employee theme
    // (keycloak/theme-src EmployeeTemplate.tsx); the digit-ui form with its
    // .banner / City picker is gone. Without carousel images the card sits on
    // .dg-banner (--color-digitv2-header-sidenav), with them on .dg-carousel-shell.
    await page.goto(authorizeUrl(BASE_URL, 'employee'));
    await expect(page.locator('#username')).toBeVisible({ timeout: 30_000 });
    const shell = page.locator('.dg-root.dg-employee').locator('.dg-banner, .dg-carousel-shell').first();
    await expect(shell, '#505 — the digit-employee theme must render its sign-in shell').toBeVisible();
    if (await page.locator('.dg-banner').count()) {
      const bannerBg = await page.locator('.dg-banner').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bannerBg, '#505 sub-1 — sign-in banner must render with a brand color, not white').not.toMatch(
        /rgba?\(\s*255\s*,\s*255\s*,\s*255/,
      );
    }

    /*
     * #505 sub-3: TenantHeader's logo (Chrome.tsx). SafeImage renders nothing
     * for an unset or failed src, so a broken logo shows up here as a missing
     * element; naturalWidth guards against a decoded-but-empty box too. The
     * stylesheet pins height 56px; 20px is the collapse floor, not a size pin.
     */
    const logo = page.locator('.dg-banner-header__logo').first();
    await expect(logo, '#505 sub-3 — the sign-in header logo must render').toBeVisible();
    const logoBox = await logo.evaluate((img: HTMLImageElement) => ({
      w: img.offsetWidth, h: img.offsetHeight, natW: img.naturalWidth, natH: img.naturalHeight,
    }));
    expect(logoBox.natW, '#505 sub-3 — logo image must actually load').toBeGreaterThan(0);
    expect(logoBox.natH, '#505 sub-3 — logo image must actually load').toBeGreaterThan(0);
    expect(logoBox.w, '#505 sub-3 logo laid-out width').toBeGreaterThanOrEqual(20);
    expect(logoBox.h, '#505 sub-3 logo laid-out height').toBeGreaterThanOrEqual(20);

    // ============ #622 — sign-in completes and the shell mounts ============
    await hostedSignIn(page, { baseURL: BASE_URL, surface: 'employee', username: EMPLOYEE_USER, password: EMPLOYEE_PASS });
    await page.waitForURL(/\/digit-ui\/employee(?!\/user\/login)/, { timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // ============ #505 sub-2 — header initial visible ============
    /*
     * The header renders the initial of the user's DISPLAY NAME, not of their
     * username: TopBar.js passes `userDetails.info.name` to the Dropdown's
     * `profilePic` prop, and Dropdown renders a string prop as
     * `profilePic[0].toUpperCase()`. Read the name from the same session
     * object the header reads (Digit.UserService.getUser()), instead of a
     * second hosted sign-in.
     */
    const displayName = String(
      (await page.evaluate(() => (window as any).Digit?.UserService?.getUser?.()?.info?.name)) ?? '',
    ).trim();
    expect(
      displayName,
      `#505 sub-2 — no display name in the session for ${EMPLOYEE_USER}; the header initial has no expectation to compare against`,
    ).not.toBe('');
    const expectedInitial = displayName.charAt(0).toUpperCase();
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
      `${BASE_URL}/${tenantSlug()}/digit-ui/employee/pgr/complaint-details/${ASSIGNED_COMPLAINT_ID}?cb=${Date.now()}`,
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
    await page.goto(`${BASE_URL}${surfacePath('employee', 'pgr/inbox-v2')}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_000);

    await expect(page.getByText(/service unavailable|503|something went wrong/i)).toHaveCount(0);
    await expect(page.locator('table, [role="table"]').first()).toBeVisible({ timeout: 20_000 });

    const body = (await page.locator('body').innerText()) || '';
    expect(body, '#432/#344 — inbox body must not surface base64-shaped hex blobs').not.toMatch(
      /\b[A-Za-z0-9+/]{30,}=+/,
    );

    // sub-1: rows in OPEN states only
    const OPEN_STATES = /PENDINGFORASSIGNMENT|PENDINGFORREASSIGNMENT|PENDINGATLME|PENDINGFORWORK|OPEN/i;
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
