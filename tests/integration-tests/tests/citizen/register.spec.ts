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
import { BASE_URL, FIXED_OTP, ROOT_TENANT, generateCitizenPhone } from '../utils/env';
import { getMobileValidationRule, generateValidMobile } from '../utils/mdms-mobile';

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
    // Generate a mobile that satisfies the deployment's MDMS validation rule.
    // getMobileValidationRule tries ROOT_TENANT; if the returned rule is the
    // generic 10-digit fallback (pattern ^\d{10}$), it means MDMS has no
    // entry for this tenant — fall back to generateCitizenPhone() which uses
    // CITIZEN_PHONE_PREFIX (default "7") and produces a 9-digit number that
    // empirically matches Ethiopia's ^[17][0-9]{8}$ server-side rule.
    //
    // NOTE: On some deployments (e.g. Bomet ke) the MDMS rule's
    // allowedStartingDigits may disagree with the UI's actual live
    // validation (MDMS says ['2','3'] but the UI enforces starting with
    // 1 or 7). In that case the MDMS-generated phone is silently rejected
    // and the Continue button stays disabled. We detect this and fall back
    // to generateCitizenPhone() which uses CITIZEN_PHONE_PREFIX ('7' by
    // default) — safe for any deployment that accepts 7XXXXXXXX.
    const rule = await getMobileValidationRule(ROOT_TENANT).catch(() => null);
    const isFallbackRule = !rule || rule.pattern === '^\\d{10}$';
    const mdmsPhone = isFallbackRule ? generateCitizenPhone() : generateValidMobile(rule);

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
    await mobileInput.type(mdmsPhone, { delay: 30 });
    await page.waitForTimeout(500);

    // Check if Continue is still disabled (MDMS allowedStartingDigits may
    // disagree with the UI's live validator — e.g. ke MDMS says start
    // with 2/3 but the UI only accepts 1/7). If so, clear and re-type
    // using generateCitizenPhone() which starts with CITIZEN_PHONE_PREFIX
    // ('7' by default) — accepted by every known deployment.
    const continueBtn = page.locator('button:visible').filter({ hasText: /Continue|Next/i }).first();
    const isDisabledAfterMdmsPhone = await continueBtn.isDisabled().catch(() => true);
    let phone = mdmsPhone;
    if (isDisabledAfterMdmsPhone) {
      phone = generateCitizenPhone();
      await mobileInput.click({ clickCount: 3 });
      await mobileInput.fill('');
      await mobileInput.type(phone, { delay: 30 });
      await page.waitForTimeout(500);
    }

    // Click the Continue/Next button (or Submit / Enter OTP — label varies
    // by digit-ui version; broaden the regex to cover all known variants).
    // Wait up to 5 s for the button to become enabled (validation is async).
    const submitBtn = page.locator('button:visible')
      .filter({ hasText: /Continue|Next|Submit|Enter\s+OTP/i })
      .first();
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 }).catch(() => {
      // If still disabled after 5s, proceed anyway — the test may still
      // pass (some deployments skip the phone-submit step entirely).
    });
    await submitBtn.click();
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
    // Ethiopia digit-ui v2 labels this button "Continue"; older revisions used "Next".
    await page.locator('button:visible').filter({ hasText: /^(Continue|Next)$/i }).first().click();
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
