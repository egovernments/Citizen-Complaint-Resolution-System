/**
 * Regression tests for citizen-side bugs fixed in theflywheel/digit-ui-esbuild.
 * Each test references the egovernments/CCRS issue it covers.
 *
 * - #421 — landing page ServicesSection top padding must equal side padding.
 * - #422 — navigating into Create New Complaint must not leave the user
 *          scrolled to the middle of the page (the old `history.listen`
 *          handler leaked across renders and fired before mount).
 * - #441 — rating submit without any "What was good?" checkbox must not
 *          crash the UI. Requires a complaint in RESOLVED state to exercise
 *          the form, which isn't deterministic in a shared deployment —
 *          currently asserted via bundle-level grep until we wire a full
 *          lifecycle fixture.
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

test.describe('citizen PGR regression — shipped fixes', () => {
  test('#421 — landing ServicesSection top padding matches side padding', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#421: the landing page's ServicesSection top padding got pushed off — the override CSS in /digit-ui/vendor/overrides.css fixes it back to 15px on all four sides. Test reads computed style and asserts top/left/right are all '15px'. If overrides.css stops being served or is loaded before digit-ui-css.css, this test catches the load-order break.

Steps:
1. citizenOtpLogin as a fresh citizen.
2. Locate .HomePageWrapper .ServicesSection; assert visible within 20s.
3. evaluate getComputedStyle and capture paddingTop / paddingLeft / paddingRight.
4. Assert all three === '15px'.

Catches both regressions — override removed AND override clobbered by load-order.`,
    },
    tag: ['@area:pgr', '@ccrs:421', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    // The CSS override lives in /digit-ui/vendor/overrides.css and is
    // loaded by public/index.html after the vendor digit-ui-css bundle.
    // If either the file stops being served or the <link> is reordered
    // ahead of digit-ui-css.css, this test catches it.
    await citizenOtpLogin(page, generateCitizenPhone());

    const services = page.locator('.HomePageWrapper .ServicesSection').first();
    await expect(services).toBeVisible({ timeout: 20_000 });

    const padding = await services.evaluate((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      return {
        top: cs.paddingTop,
        left: cs.paddingLeft,
        right: cs.paddingRight,
      };
    });

    expect(padding.top).toBe('15px');
    expect(padding.left).toBe('15px');
    expect(padding.right).toBe('15px');
  });

  test('#422 — navigating into Create New Complaint lands at top of page', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#422: clicking "File a Complaint" used to leave the citizen mid-page-scrolled because a leaked history.listen handler fired before mount. The test scrolls home down 600px, clicks the link, and asserts scrollY === 0 on the destination page.

Steps:
1. citizenOtpLogin as a fresh citizen.
2. window.scrollTo(0, 600); read scrollY before; assert > 100 (home was actually scrolled).
3. Locate the first link/role=link matching /File a Complaint/i; click it (within 10s).
4. Wait for URL matching /pgr|complaint/i within 15s; wait for domcontentloaded; settle 500ms.
5. Read scrollY after; assert === 0.

Verified 2026-04-30: entry is now a plain anchor (no longer a CardBasedOptions / .digit-card); the looser locator handles both old and new layouts.`,
    },
    tag: ['@area:pgr', '@ccrs:422', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    await citizenOtpLogin(page, generateCitizenPhone());

    // Scroll the home page down so we can observe the reset on navigation.
    await page.evaluate(() => window.scrollTo(0, 600));
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(100);

    // Click the "File a Complaint" link on /all-services. The earlier
    // CardBasedOptions / .digit-card layout no longer renders on this
    // build — the entry point is now a plain anchor (verified
    // 2026-04-30 walk).
    const fileLink = page
      .locator('a, [role="link"]')
      .filter({ hasText: /File a Complaint/i })
      .first();
    await fileLink.click({ timeout: 10_000 });

    await page.waitForURL(/pgr|complaint/i, { timeout: 15_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => window.scrollY);
    expect(after).toBe(0);
  });

  test.fixme(
    '#441 — submit rating without "What was good?" boxes does not crash', {
      annotation: {
        type: 'description',
        description: `TODO: needs a complaint in RESOLVED state belonging to a citizen we control before this can be exercised end-to-end. Either chain off pgr-lifecycle-ui.spec.ts (which already resolves one) or bootstrap via the PGR API before the browser step. Until then, the code-level guard is verified offline with grep on build/index.js for an isArray check around CS_FEEDBACK_WHAT_WAS_GOOD.

Steps (target):
1. Seed a RESOLVED complaint owned by the test citizen.
2. citizenOtpLogin and navigate to /pgr/rate/{srid}.
3. Submit the rating without checking any "What was good?" feedback boxes.
4. Assert the page does NOT crash and either advances to the next step or shows a recoverable error.

Marked test.fixme — runs only when manually un-fixed and the seed step is wired in.`,
      },
      tag: ['@area:pgr', '@ccrs:441', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
      // TODO: needs a complaint in RESOLVED state belonging to a citizen
      // we control. Either chain off pgr-lifecycle-ui.spec.ts (which
      // already resolves one) or bootstrap via the PGR API before the
      // browser step. Until then, the code-level guard is verified
      // offline with `grep isArray(.*CS_FEEDBACK_WHAT_WAS_GOOD)` on
      // `build/index.js`.
      void page; // placeholder so the fixme block type-checks
    },
  );
});
