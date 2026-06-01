/**
 * Citizen auxiliary surfaces — Stories 10.1, 10.2, 10.3.
 *
 * Currently expected to **fail** on the live build per
 * docs/personas/citizen-flows.md and issue #12 — `/citizen/pgr-faq` and
 * `/citizen/pgr-how-it-works` render "Something went wrong", and the
 * HELPLINE sidebar item is a dead handler. The test is written to PASS
 * when the bugs are fixed (no error fallback present, HELPLINE either
 * navigates or fires a dialog) — green CI on this spec means the
 * upstream fix landed.
 *
 * The user's instruction was "let broken things fail" — no `test.fail()`
 * masking. Red on this spec is the visible signal that the bugs are
 * still open.
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

test.describe('Citizen aux surfaces — issue #12 regression guards', () => {
  test('FAQ page does not render the error fallback', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#12: /citizen/pgr-faq used to throw and render "Something went wrong". The test logs in as a fresh citizen, navigates to the FAQ page, and asserts the error fallback is NOT visible. Currently expected to fail on builds where the bug is open — green CI here means the upstream fix landed.

Steps:
1. setTimeout 60s; generate a fresh citizen phone and OTP-login.
2. Navigate to /digit-ui/citizen/pgr-faq, wait for domcontentloaded then 4s for hydration.
3. Assert body does not contain "Something went wrong".

No test.fail() masking — by design, a red here is the visible signal CCRS#12 is still open.`,
    },
    tag: ['@area:pgr', '@ccrs:12', '@kind:edge-case', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr-faq`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(4000);

    const body = page.locator('body');
    await expect(body, '/citizen/pgr-faq must not show the error fallback').not.toContainText(
      'Something went wrong',
    );
  });

  test('How-it-works page does not render the error fallback', {
    annotation: {
      type: 'description',
      description: `Sibling of the FAQ test for CCRS#12: /citizen/pgr-how-it-works also currently throws. Same pattern — log in, navigate, assert no error fallback. Red until the bug is fixed.

Steps:
1. setTimeout 60s; generate a fresh citizen phone and OTP-login.
2. Navigate to /digit-ui/citizen/pgr-how-it-works, wait for domcontentloaded then 4s.
3. Assert body does not contain "Something went wrong".

Pairs with the FAQ test — both pages are listed in CCRS#12 as the broken aux surfaces.`,
    },
    tag: ['@area:pgr', '@ccrs:12', '@kind:edge-case', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr-how-it-works`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(4000);

    const body = page.locator('body');
    await expect(
      body,
      '/citizen/pgr-how-it-works must not show the error fallback',
    ).not.toContainText('Something went wrong');
  });

  test('HELPLINE sidebar item is reachable + click-actionable', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#12 (third sub-issue): the HELPLINE sidebar item used to render but its click handler is dead. The test asserts the link is visible AND that clicking it produces ANY observable side effect — a navigation, a JS dialog, or a DOM modal.

Steps:
1. setTimeout 60s; OTP-login as a fresh citizen.
2. Wait 3s, locate the HELPLINE sidebar item; assert it is visible.
3. Capture beforeUrl, attach a page.on('dialog') listener, click HELPLINE.
4. Wait 2s; capture afterUrl, count modal-shaped elements ([role="dialog"], .modal, [class*="Modal"]).
5. Assert that hasObservableEffect — beforeUrl !== afterUrl OR dialogFired OR modalAppeared > 0.

Loose assertion intentionally — the spec doesn't care HOW HELPLINE responds, just that it responds at all. Currently red until the handler is wired.`,
    },
    tag: ['@area:pgr', '@ccrs:12', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);
    await page.waitForTimeout(3000);

    const helpline = page.locator('text=HELPLINE').first();
    await expect(helpline, 'HELPLINE sidebar item should render').toBeVisible({ timeout: 5_000 });

    // Click → assert *some* observable effect: either a navigation, a
    // modal, or a tel:/href trigger. Today the click does nothing
    // (issue #12); this assertion fails until the handler is wired.
    const beforeUrl = page.url();
    let dialogFired = false;
    page.on('dialog', () => {
      dialogFired = true;
    });

    await helpline.click();
    await page.waitForTimeout(2000);

    const afterUrl = page.url();
    const modalAppeared = await page.locator('[role="dialog"], .modal, [class*="Modal"]').count();
    const hasObservableEffect = beforeUrl !== afterUrl || dialogFired || modalAppeared > 0;

    expect(
      hasObservableEffect,
      'HELPLINE click should produce a navigation, dialog, or modal — currently dead per issue #12',
    ).toBe(true);
  });
});
