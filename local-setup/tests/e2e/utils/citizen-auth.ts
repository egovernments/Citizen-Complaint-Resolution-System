/**
 * Shared citizen OTP login for the specs/citizen suite.
 *
 * Logs in through the real UI (mobile number → fixed dev OTP) rather
 * than the API so the specs exercise the same session bootstrapping a
 * citizen gets. Credentials are env-overridable; the defaults match
 * the ethiopia dev tenant's seeded citizen (mobile rule ^[17][0-9]{8}$,
 * fixed OTP in non-prod).
 */
import { expect, type Page } from '@playwright/test';

export const CITIZEN_MOBILE = process.env.CITIZEN_MOBILE || '777777777';
export const CITIZEN_OTP = process.env.CITIZEN_OTP || '123456';

export async function citizenOtpLogin(page: Page) {
  await page.goto('/digit-ui/citizen');

  // Language selection screen (first visit only) — continue past it.
  const continueBtn = page
    .locator('button:has-text("Continue"), button:has-text("CONTINUE")')
    .first();
  if (await continueBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await continueBtn.click();
  }

  // The citizen home renders without auth; go straight to the login
  // route (the nav's Login button doesn't navigate reliably headless).
  await page.goto('/digit-ui/citizen/login');

  // Mobile number screen: single tel input.
  const mobileInput = page.locator('input[type="tel"]').first();
  await mobileInput.waitFor({ state: 'visible', timeout: 30_000 });
  await mobileInput.click();
  await mobileInput.fill(CITIZEN_MOBILE);
  await expect(mobileInput).toHaveValue(CITIZEN_MOBILE);
  await page
    .locator('button[type="submit"], button:has-text("Continue")')
    .first()
    .click();

  // OTP screen: 6 single-char boxes with auto-advance; typing into the
  // first box and letting auto-advance route the rest is how a citizen
  // does it, so do the same.
  const otpBoxes = page.locator('input[maxlength="1"]');
  await otpBoxes.first().waitFor({ state: 'visible', timeout: 30_000 }).catch(async () => {
    throw new Error(
      `OTP boxes never appeared after submitting mobile. URL=${page.url()} BODY=${(
        await page.locator('body').innerText()
      ).slice(0, 500)}`
    );
  });
  await otpBoxes.first().click();
  await page.keyboard.type(CITIZEN_OTP, { delay: 80 });
  const otpSubmit = page.locator('button[type="submit"], button:has-text("Continue")').first();
  if (await otpSubmit.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await otpSubmit.click().catch(() => {/* may have auto-submitted */});
  }

  // Genuinely logged in = we leave every /login route.
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
}
