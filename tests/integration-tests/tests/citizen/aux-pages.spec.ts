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
  test('FAQ page does not render the error fallback', async ({ page }) => {
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

  test('How-it-works page does not render the error fallback', async ({ page }) => {
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

  test('HELPLINE sidebar item is reachable + click-actionable', async ({ page }) => {
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
