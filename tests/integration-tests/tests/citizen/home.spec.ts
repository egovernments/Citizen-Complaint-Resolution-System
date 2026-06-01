/**
 * Citizen home + landing surfaces — Stories 2.1, 2.2, 2.3.
 *
 * Three surfaces:
 *   - /citizen/all-services — post-login default landing
 *   - /citizen/pgr-home     — branded "Nai Pepea" PGR module home
 *   - Header language pill — toggles localization
 *
 * Also smoke-checks that /citizen/ redirects to /all-services (per the
 * Routes table in docs/personas/citizen-flows.md).
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

test.describe('Citizen home + landing', () => {
  test('/citizen/ redirects to /citizen/all-services', async ({ page }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    await page.goto(`${BASE_URL}/digit-ui/citizen`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    expect(page.url()).toContain('/citizen/all-services');
  });

  test('/all-services renders CCRS title + File a Complaint + My Complaints links', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    await page.goto(`${BASE_URL}/digit-ui/citizen/all-services`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    const body = page.locator('body');
    await expect(body).not.toContainText('Something went wrong');
    await expect(body).toContainText('Citizen Complaint Resolution System');
    await expect(body).toContainText('File a Complaint');
    await expect(body).toContainText('My Complaints');

    // Sidebar inventory — Story 2.x note
    for (const item of ['Home', 'Edit Profile', 'Logout', 'HELPLINE']) {
      await expect(body, `sidebar item "${item}" missing`).toContainText(item);
    }
  });

  test('/pgr-home renders the PGR module home with action links', async ({ page }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr-home`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    const body = page.locator('body');
    await expect(body).not.toContainText('Something went wrong');
    // Note: "Nai Pepea" + "Report a grievance" + "Nairobi City County
    // Government" are rendered as background-image / CSS-content on the
    // hero, not DOM text. Asserting on the actionable content + PGR badge
    // instead. If the brand assets ever land as real DOM text, extend.
    await expect(body).toContainText('PGR');
    await expect(body).toContainText('Citizen Complaint Resolution System');
    await expect(body).toContainText('My Complaints');
    await expect(body).toContainText('File a Complaint');
  });

  test('header language pill renders the current locale', async ({ page }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);
    await page.waitForTimeout(2000);

    // Language pill is a <label> with the current locale name. Clicking
    // it opens a native OS-level dropdown (no [role="listbox"] in the
    // DOM) so we don't assert the options list — just that the pill
    // renders with the current locale text.
    const pill = page.locator('label:has-text("English")').first();
    await expect(pill, 'language pill should render with current locale').toBeVisible({
      timeout: 5_000,
    });
  });
});
