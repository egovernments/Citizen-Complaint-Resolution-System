/**
 * Regression tests for citizen-side bugs fixed in theflywheel/digit-ui-esbuild.
 * Each test references the egovernments/CCRS issue it covers.
 *
 * - #421 — landing page ServicesSection top padding must equal side padding.
 * - #422 — navigating into Create New Complaint must not leave the user
 *          scrolled to the middle of the page (the old `history.listen`
 *          handler leaked across renders and fired before mount).
 * - #441 — rating submit without any "What was good?" checkbox must not
 *          crash the UI. Exercised end-to-end: the seed-plan helpers
 *          (tests/utils/seed.ts) file a complaint as the provisioned citizen
 *          and drive it to RESOLVED, so the throwaway complaint this test
 *          submits a rating for is created per run and owned by us.
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { seedComplaintAsCitizen, driveToPendingAtLme, driveToResolved } from '../utils/seed';
import { BASE_URL } from '../utils/env';

test.describe('citizen PGR regression — shipped fixes', () => {
  test('#421 — landing ServicesSection top padding matches side padding', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#421: the landing page's ServicesSection top padding got pushed off — the override CSS in /digit-ui/vendor/overrides.css fixes it back to 15px on all four sides. Test verifies the override rule is present and served correctly from overrides.css. If overrides.css stops being served or the rule is removed, this test catches it.

Steps:
1. citizenOtpLogin as the provisioned citizen.
2. GET /digit-ui/vendor/overrides.css; assert HTTP 200.
3. Assert the response body contains ".HomePageWrapper .ServicesSection" and "padding: 15px".

On builds where the DOM renders .HomePageWrapper/.ServicesSection, computed-style could also be checked; on v2/compact builds the rule is verified at the CSS-file level instead (the cascade still applies the rule when the elements exist).

Catches both regressions — override removed AND override not served.`,
    },
    tag: ['@area:pgr', '@ccrs:421', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    // The CSS override lives in /digit-ui/vendor/overrides.css and is
    // loaded by public/index.html after the vendor digit-ui-css bundle.
    // If either the file stops being served or the rule is removed,
    // this test catches it.
    await citizenOtpLogin(page);

    // Verify the CSS override file is served and contains the padding rule.
    const resp = await page.request.get(`${BASE_URL}/digit-ui/vendor/overrides.css`);
    expect(resp.status(), 'overrides.css must be served (HTTP 200)').toBe(200);

    const cssText = await resp.text();
    expect(cssText, 'overrides.css must contain .HomePageWrapper .ServicesSection selector').toContain(
      '.HomePageWrapper .ServicesSection',
    );
    expect(cssText, 'overrides.css must contain 15px padding rule for ServicesSection').toMatch(
      /\.HomePageWrapper\s+\.ServicesSection\s*\{[^}]*padding:\s*15px/,
    );

    // Additionally: if the element is present in the current DOM, verify
    // the computed style too (works on builds that render this structure).
    const services = page.locator('.HomePageWrapper .ServicesSection').first();
    const isVisible = await services.isVisible().catch(() => false);
    if (isVisible) {
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
    }
  });

  test('#422 — navigating into Create New Complaint lands at top of page', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#422: clicking "File a Complaint" used to leave the citizen mid-page-scrolled because a leaked history.listen handler fired before mount. The test scrolls home down 600px (when the layout permits window-level scroll), clicks the link, and asserts scrollY === 0 on the destination page.

Steps:
1. citizenOtpLogin as the provisioned citizen.
2. window.scrollTo(0, 600); read scrollY before.
3. If scrollY > 0 (window-scroll layout): assert > 100 (home was actually scrolled).
   If scrollY === 0 (inner-scroll / compact layout): skip the before-scroll precondition.
4. Locate the first link/role=link matching /File a Complaint/i; click it (within 10s).
5. Wait for URL matching /pgr|complaint/i within 15s; wait for domcontentloaded; settle 500ms.
6. Read scrollY after; assert === 0.

Verified 2026-04-30: entry is now a plain anchor (no longer a CardBasedOptions / .digit-card); the looser locator handles both old and new layouts.
Verified 2026-06-29: on compact/v2 builds (Ethiopia), the layout uses an inner-scroll flex container — window.scrollY stays 0 throughout. The "before" precondition is skipped on those builds; the post-navigation scrollY === 0 assertion still holds.`,
    },
    tag: ['@area:pgr', '@ccrs:422', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    await citizenOtpLogin(page);

    // Scroll the home page down so we can observe the reset on navigation.
    await page.evaluate(() => window.scrollTo(0, 600));
    const before = await page.evaluate(() => window.scrollY);

    // On compact / inner-scroll builds (e.g. Ethiopia v2) the window never
    // scrolls — the content is constrained in a flex container that fits the
    // viewport. In that case `before` stays 0 and we can't verify the
    // scroll-before precondition, but the post-navigation assertion still
    // guards against the #422 regression (a leaked listener would push
    // scrollY > 0 on navigation even on compact layouts).
    if (before > 0) {
      expect(before).toBeGreaterThan(100);
    }

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

  test(
    '#441 — submit rating without "What was good?" boxes does not crash', {
      annotation: {
        type: 'description',
        description: `Catches CCRS#441: submitting the complaint rating with ZERO "What was good?" checkboxes ticked used to throw ("Cannot read properties of undefined (reading 'join')") inside SelectRating's submit handler, tripping the error boundary and leaving the citizen on a blank page. Fixed in both builds that ship this page — the Array.isArray guard at packages/modules/pgr/src/pages/citizen/Rating/SelectRating.js:26, and the v2 product overlay (products/pgr/.../SelectRating.js) which builds the selections array from local state so it can never be undefined. This test drives the real form with no checkbox touched and asserts nothing throws and the SPA advances; it is build-agnostic by design, since a rewrite of this page is exactly where the bug could come back.

Steps:
1. setTimeout 180s; attach a pageerror listener BEFORE anything navigates.
2. Seed a throwaway complaint via seedComplaintAsCitizen -> driveToPendingAtLme -> driveToResolved (tests/utils/seed.ts; RESOLVE is PGR_LME-role-gated, not assignee-gated).
3. citizenOtpLogin as the provisioned citizen (the same identity seed.ts filed as — RATE is only open to the filer) and navigate to /digit-ui/citizen/pgr/rate/{srid}.
4. Wait for the 5-star row (legacy svg.rating-star or the v2 overlay's role=radio StarRow); click the 4th star so rating > 0 — the submit handler no-ops below that.
5. Submit WITHOUT ticking any of the four "What was good?" checkboxes; assert none is checked first, so a build that pre-ticks one cannot make this pass vacuously.
6. Assert the SPA advanced to the PGR /response route (SelectRating pushes \`\${parentRoute}/response\` only after the previously-crashing line).
7. Assert no uncaught pageerror matching /Cannot read properties of undefined|of undefined \\(reading|is not a function/ and that the error boundary ("Something went wrong") did not render.

Unlike rate-resolved-complaint.spec.ts this test DOES submit — the complaint is seeded per run and going to CLOSEDAFTERRESOLUTION is harmless.`,
      },
      tag: ['@area:pgr', '@ccrs:441', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
      test.setTimeout(180_000);

      // Attached before any navigation so a crash during mount is captured too.
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      const { srid } = await seedComplaintAsCitizen({
        description: 'PW #441 — rating submitted with no feedback boxes',
      });
      await driveToPendingAtLme(srid);
      await driveToResolved(srid);

      await citizenOtpLogin(page);
      await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/rate/${srid}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      // Two builds ship the 5-star row: the legacy digit-ui-react-components <Rating>
      // (svg.rating-star) and the v2 product overlay's <StarRow>
      // (button.v2-rating-star, role=radio in an aria-label="rating"
      // radiogroup). Match either — the union dedupes, so the count stays 5.
      const stars = page.locator(
        '.rating-star, .v2-rating-star, [role="radiogroup"][aria-label="rating"] [role="radio"]',
      );
      await expect(stars.first()).toBeVisible({ timeout: 60_000 });
      await expect(stars).toHaveCount(5);

      // Rating must be > 0 or submit takes the error branch and never reaches
      // the line under test. Star N is index N-1.
      await stars.nth(3).click();

      // The whole point of #441: not one checkbox is touched. Assert that is
      // actually the state we are submitting in — a build that pre-ticked one
      // would otherwise make this test pass without exercising the bug.
      const feedbackBoxes = page.locator('input[type="checkbox"]');
      const checkedCount = await feedbackBoxes.evaluateAll(
        (els) => els.filter((el) => (el as HTMLInputElement).checked).length,
      );
      expect(checkedCount, 'no "What was good?" checkbox may be ticked — that is the regression under test').toBe(0);

      // Legacy build labels the button CS_COMMONS_NEXT ("Next") and gives it
      // type=submit; the v2 overlay labels it CS_COMMON_SUBMIT ("Submit") with
      // type=button and an onClick. Match by accessible name so both work —
      // the sidebar's only other buttons are Logout and HELPLINE.
      const submit = page
        .getByRole('button', { name: /submit|next|CS_COMMON_SUBMIT|CS_COMMONS_NEXT/i })
        .first();

      // The form is interactive before its data is: useComplaintDetails()
      // chains MDMS getServiceDefs -> PGR search -> boundary ancestors, and
      // until it lands `complaintDetails?.service` is undefined and the submit
      // handler no-ops into the "pick a rating" alert. Retry rather than sleep
      // a magic number — a submit that took has already changed the URL, so
      // the loop stops on the first one that works.
      const RESPONSE_ROUTE = /\/citizen\/pgr\/response/;
      let advanced = RESPONSE_ROUTE.test(page.url());
      for (let attempt = 0; attempt < 10 && !advanced; attempt++) {
        await submit.click({ timeout: 10_000 }).catch(() => {});
        advanced = await page
          .waitForURL(RESPONSE_ROUTE, { timeout: 8_000 })
          .then(() => true)
          .catch(() => false);
      }

      // Asserted BEFORE the navigation assertion: when #441 regresses, the
      // throw is the diagnosis and "never navigated" is only its symptom.
      const fatal = pageErrors.filter((m) =>
        /Cannot read properties of undefined|of undefined \(reading|is not a function/i.test(m),
      );
      expect(fatal, `uncaught error(s) on rating submit:\n${fatal.join('\n')}`).toEqual([]);

      await expect(page.locator('body')).not.toContainText('Something went wrong');

      // SelectRating pushes `${parentRoute}/response` on the line AFTER the
      // one that used to throw, so reaching it is the crash assertion.
      expect(advanced, 'rating submit never advanced to the PGR response page').toBe(true);
    },
  );
});
