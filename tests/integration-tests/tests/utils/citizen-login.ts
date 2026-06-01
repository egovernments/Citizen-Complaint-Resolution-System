/**
 * Citizen OTP login helper — walks through the UI login flow.
 *
 * Works with both mock OTP (Kong request-termination) and real OTP services.
 * The fixed OTP value is configurable via FIXED_OTP env var.
 */
import type { Page } from '@playwright/test';
import { BASE_URL, FIXED_OTP } from './env';

export async function citizenOtpLogin(page: Page, phone: string): Promise<void> {
  page.on('pageerror', (err) => console.log(`[PAGE ERROR in login] ${err.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) console.log(`[HTTP ${response.status()}] ${response.url()}`);
  });

  await page.goto(`${BASE_URL}/digit-ui/citizen/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  // Wait for React to render the login form
  const mobileInput = page.locator('input[name="mobileNumber"]');
  await mobileInput.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(2000);

  // Enter phone number
  await mobileInput.click();
  await mobileInput.type(phone, { delay: 30 });
  await page.waitForTimeout(500);

  // Click Next
  await page.locator('button:visible').filter({ hasText: /NEXT|Next|CS_COMMONS_NEXT/ }).click();
  await page.waitForTimeout(5000);

  // Enter 6-digit OTP
  const otpInputs = page.locator('input[maxlength="1"]');
  await otpInputs.first().waitFor({ state: 'visible', timeout: 10_000 });
  for (let i = 0; i < FIXED_OTP.length; i++) {
    await otpInputs.nth(i).click();
    await otpInputs.nth(i).type(FIXED_OTP[i]);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(1000);

  // Submit OTP
  await page.locator('button:visible').filter({ hasText: /NEXT|Next|CS_COMMONS_NEXT/ }).click();
  await page.waitForTimeout(5000);

  // Handle city selection page if it appears
  const url = page.url();
  if (url.includes('select-location')) {
    console.log('City selection page — picking city...');
    await page.waitForTimeout(2000);
    const cityDropdown = page.locator('input.digit-dropdown-employee-select-wrap--elipses');
    const cityRadio = page.locator('input[type="radio"]');
    if (await cityDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cityDropdown.click();
      await page.waitForTimeout(1000);
      await page.locator('.digit-dropdown-item').first().click();
      await page.waitForTimeout(500);
    } else if (await cityRadio.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await cityRadio.first().click();
      await page.waitForTimeout(500);
    }
    const submitBtn = page.locator('button:visible').filter({ hasText: /Continue|Submit|Next/i }).first();
    await submitBtn.click();
    await page.waitForTimeout(5000);
  } else {
    await page.waitForTimeout(3000);
  }
}
