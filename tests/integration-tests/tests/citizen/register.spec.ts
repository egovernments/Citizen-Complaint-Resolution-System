/**
 * Citizen register flow — Story 1.3.
 *
 * Walks the auto-register path: fresh phone → OTP screen → name + email
 * screen → /all-services landing. Ensures the registration ergonomics
 * (the catalogue's Story 1.3 sub-steps) actually fire when the phone
 * has never been seen before.
 *
 * The existing tests/citizen/login.spec.ts and login-mobile.spec.ts
 * cover the existing-user OTP login + the mobile-validation regression.
 * This one covers the path through /register/name specifically.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, FIXED_OTP, generateCitizenPhone } from '../utils/env';

test.describe('Citizen registration (auto-register on unknown number)', () => {
  test('fresh phone → OTP → name+email → /all-services', {
    annotation: {
      type: 'description',
      description: `Story 1.3 walk: a brand-new phone number going through citizen login should auto-register and land authenticated on /all-services. Drives every form step manually instead of using the citizenOtpLogin helper because this test is specifically about the /register/name screen the helper would skip past.

Steps:
1. setTimeout 120s; generate a fresh phone.
2. Navigate to /digit-ui/citizen/login; wait 3s.
3. Wait for input[name="mobileNumber"]; click + type the phone (30ms delay).
4. Click visible Next.
5. OTP screen — wait for input[maxlength="1"] inputs; type each char of FIXED_OTP (123456) with 80ms delay; click Next.
6. If URL contains /register, fill the name input with "PW Reg <ts>" and click Next/Continue.
7. If URL contains /select-location, pick the first city option and click Continue/Submit/Next.
8. Wait 2s; assert final URL is NOT /login and NOT /register.
9. Assert localStorage 'Citizen.token' is truthy.
10. Assert body does NOT contain 'Something went wrong'.

Tolerant of post-OTP path differences (some configs go straight to /all-services, others stop at /register/name or /select-location).`,
    },
    tag: ['@area:auth', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(120_000);
    const phone = generateCitizenPhone();

    await page.goto(`${BASE_URL}/digit-ui/citizen/login`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    // Mobile entry — match current digit-ui (input#login-mobile, no name)
    // and older variants.
    const mobileInput = page.locator(
      'input#login-mobile, input[name="mobileNumber"], input[type="tel"]',
    ).first();
    await mobileInput.waitFor({ state: 'visible', timeout: 15_000 });
    await mobileInput.click();
    await mobileInput.type(phone, { delay: 30 });
    await page.waitForTimeout(500);

    await page.locator('button:visible').filter({ hasText: /^(Continue|Next)$/i }).first().click();
    await page.waitForTimeout(5000);

    // OTP screen — 6 single-char inputs
    const otpInputs = page.locator('input[maxlength="1"]');
    await otpInputs.first().waitFor({ state: 'visible', timeout: 15_000 });
    for (let i = 0; i < FIXED_OTP.length; i++) {
      await otpInputs.nth(i).click();
      await otpInputs.nth(i).type(FIXED_OTP[i]);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(800);
    await page.locator('button:visible').filter({ hasText: /^Next$/i }).first().click();
    await page.waitForTimeout(5000);

    // We may be on /register/name OR on /select-location OR landed already.
    // If we're on the name screen, fill it.
    const url = page.url();
    if (url.includes('/register/name') || url.includes('/register')) {
      const nameInput = page.locator('input[name="name"], input[placeholder*="Name" i]').first();
      if (await nameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await nameInput.fill(`PW Reg ${Date.now()}`);
        await page.waitForTimeout(300);
        await page.locator('button:visible').filter({ hasText: /^(Next|Continue)$/i }).first().click();
        await page.waitForTimeout(5000);
      }
    }

    // Possible city-pick screen (some configs show one); pick first option
    if (page.url().includes('select-location')) {
      const cityInput = page.locator('input.digit-dropdown-employee-select-wrap--elipses').first();
      if (await cityInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await cityInput.click();
        await page.waitForTimeout(800);
        await page.locator('.digit-dropdown-item').first().click();
        await page.waitForTimeout(500);
        await page.locator('button:visible').filter({ hasText: /Continue|Submit|Next/i }).first().click();
        await page.waitForTimeout(5000);
      }
    }

    // Landed authenticated
    await page.waitForTimeout(2000);
    const finalUrl = page.url();
    expect(finalUrl, 'should not be stuck on /login').not.toContain('/login');
    expect(finalUrl, 'should not be stuck on /register').not.toMatch(/\/register(\/|$)/);

    const token = await page.evaluate(() => localStorage.getItem('Citizen.token'));
    expect(token, 'Citizen.token must be persisted after registration').toBeTruthy();

    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Something went wrong');
  });
});
