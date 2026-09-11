/**
 * Employee digit-ui shell — login + chrome + decrypted inbox bundle.
 *
 * Covers in one run:
 *   #592       /digit-ui/globalConfigs.js served + parseable
 *   #505 sub-1 login background brand-dark, not white
 *   #505 sub-2 header surfaces the logged-in user's initial (post-fix
 *              circle removal)
 *   #505 sub-3 banner/header logo actually loads and lays out
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
} from '../utils/env';
import { readLifecycleFixtures } from '../utils/lifecycle-fixtures';
import { getPrincipal } from '../utils/employee-ui';

const LOGIN_URL = '/digit-ui/employee/user/login';
const INBOX_URL = '/digit-ui/employee/pgr/inbox-v2';
const GLOBAL_CONFIGS_URL = '/digit-ui/globalConfigs.js';

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

  test('login + chrome + visible decrypt + inbox honest drives', { tag: ['@persona:employee'] }, async ({ page }) => {
    // This test used to carry an unconditional `test.fixme(true, …)` blaming
    // two onboarding-data gaps. Both claims were false and are now retired:
    //   * "#344 needs a seeded ASSIGNED_COMPLAINT_ID" — lifecycle.setup.ts DOES
    //     seed one (lifecycle-fixtures.json -> complaints.assigned_to_employee),
    //     which is exactly what the resolution chain above reads.
    //   * "#505 brand chrome needs tenant branding onboarded" — the login
    //     banner renders its brand colour from the shipped stylesheet with zero
    //     branding seeded, and no stylesheet rule anywhere produces the 96x96
    //     logo the old assertion demanded (see the sizing comment below).
    // The three assertions that were genuinely stale are fixed in place instead.
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
      return img
        ? { w: img.offsetWidth, h: img.offsetHeight, natW: img.naturalWidth, natH: img.naturalHeight }
        : null;
    });
    expect(logoBox, '#505 sub-3 — .bannerLogo must be present in the login banner').not.toBeNull();
    /*
     * The asset must genuinely decode. A broken/404 <img> still lays out a box,
     * so a size-only check cannot tell "logo rendered" from "logo missing" —
     * naturalWidth is 0 for anything the browser failed to load.
     */
    expect(logoBox!.natW, '#505 sub-3 — bannerLogo image must actually load').toBeGreaterThan(0);
    expect(logoBox!.natH, '#505 sub-3 — bannerLogo image must actually load').toBeGreaterThan(0);
    /*
     * Size floor, deliberately NOT the old >= 96x96.
     *
     * The served digit-ui-css.css declares exactly two .bannerLogo rules:
     * `width:80px;height:40px`, and the `.login-container .bannerHeader
     * .bannerLogo{width:50%}` override that makes the rendered height
     * aspect-driven from the banner width. Nothing anywhere declares 96px, so
     * `h >= 96` demanded a size the shipped stylesheet cannot produce on ANY
     * deployment (it measures 246x56 here — width passed, height failed).
     *
     * 40x20 is half the only box the stylesheet actually declares: far below
     * what any real tenant logo renders at (so it does not re-pin a magic
     * number), and far above the 0x0 / 1px collapse that a hidden, unstyled or
     * detached logo produces — which is the regression #505 sub-3 is about.
     */
    expect(logoBox!.w, '#505 sub-3 bannerLogo laid-out width').toBeGreaterThanOrEqual(40);
    expect(logoBox!.h, '#505 sub-3 bannerLogo laid-out height').toBeGreaterThanOrEqual(20);

    // ============ #622 — Login completes ============
    await page.locator('input[type="text"]').first().pressSequentially(EMPLOYEE_USER, { delay: 60 });
    await page.locator('input[type="password"]').first().pressSequentially(EMPLOYEE_PASS, { delay: 60 });

    /*
     * The city picker's visible label is the LOCALIZED CORE_COMMON_CITY. On this
     * deployment rainmaker-common sets it to 'County', so the old
     * `getByRole('combobox', { name: /City/i })` matched nothing and burned the
     * full 120s test timeout. Swapping in /County/i would just move the
     * hardcoded English literal, so the label is kept out of the locator
     * entirely: core's employee login page renders the picker as
     * `<Select id="emp-city">` (pages/employee/Login/login.js), and that id is
     * set by the app, not by any localization or tenant config. The
     * [role="combobox"] arm is the structural fallback if the id is ever
     * renamed — the login form has exactly one combobox.
     */
    const cityCombo = page.locator('#emp-city, [role="combobox"]').first();
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
    /*
     * The header renders the initial of the user's DISPLAY NAME, not of their
     * username: TopBar.js passes `userDetails.info.name` to the Dropdown's
     * `profilePic` prop, and Dropdown renders a string prop as
     * `profilePic[0].toUpperCase()`. The old expectation read
     * EMPLOYEE_USER.charAt(0) — the wrong source field, and wrong on every
     * deployment whose employee login differs from their display name
     * ('EMP001' -> 'E' vs "Jane Doe" -> 'J' here; 'ADMIN' -> 'A' vs
     * "System Administrator" -> 'S' on a stock bootstrap).
     *
     * Resolve the display name live from the deployment's own user record
     * rather than deriving it from any env literal.
     */
    const principal = await getPrincipal(EMPLOYEE_USER, EMPLOYEE_PASS);
    const displayName = String(principal?.userInfo?.name ?? '').trim();
    expect(
      displayName,
      `#505 sub-2 — could not resolve a display name for ${EMPLOYEE_USER}; the header initial has no expectation to compare against`,
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
