/**
 * Citizen Login E2E
 *
 * Tests the citizen OTP login flow:
 *   1. Login page loads with correct mobile prefix
 *   2. Enter mobile number → OTP page
 *   3. Enter OTP → citizen logged in (auto-register for new numbers)
 *   4. Home page loads without crash
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

const CITIZEN_PHONE = generateCitizenPhone();

test.describe('Citizen Login', () => {
  test('login page renders with mobile input', {
    annotation: {
      type: 'description',
      description: `Smoke check that the citizen login page actually serves an input[name="mobileNumber"] field. Catches the most basic class of regression — the page errors during render and no input appears at all.

Steps:
1. Navigate to /digit-ui/citizen/login.
2. Wait up to 20s for input[name="mobileNumber"] to be visible.
3. Assert isVisible() === true.

If this fails, every other citizen test will fail downstream — pairs with the OTP-login test below.`,
    },
    tag: ['@area:auth', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    await page.goto(`${BASE_URL}/digit-ui/citizen/login`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Match current digit-ui (input#login-mobile, type=tel, no name) and
    // older revisions that still set name="mobileNumber".
    const mobileInput = page.locator(
      'input#login-mobile, input[name="mobileNumber"], input[type="tel"]',
    ).first();
    await mobileInput.waitFor({ state: 'visible', timeout: 20_000 });
    expect(await mobileInput.isVisible()).toBe(true);
  });

  test('citizen can log in with OTP and reach home page', {
    annotation: {
      type: 'description',
      description: `End-to-end OTP login walk for a brand-new citizen — exercises the auto-register-on-first-login path with the mock OTP. Asserts the citizen lands on a valid post-login URL with a Citizen.token in localStorage and no error fallback.

Steps:
1. citizenOtpLogin(page, CITIZEN_PHONE) — drives the phone form, OTP form, language/city pickers.
2. Read localStorage 'Citizen.token'; assert it's truthy.
3. Read page.url(); assert it does NOT contain '/login' or '/select-language'.
4. Read body innerText; assert it does NOT contain 'Something went wrong'.

Catches the broadest class of citizen-auth regressions — register flow broken, OTP not accepted, language picker stuck, etc.`,
    },
    tag: ['@area:auth', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    await citizenOtpLogin(page, CITIZEN_PHONE);

    const token = await page.evaluate(() => localStorage.getItem('Citizen.token'));
    expect(token).toBeTruthy();

    // Verify we're on a citizen page (not stuck on login/select-language)
    const url = page.url();
    expect(url).not.toContain('/login');
    expect(url).not.toContain('/select-language');

    // Verify no crash
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('Something went wrong');

    console.log(`Citizen ${CITIZEN_PHONE} logged in, URL: ${url}`);
  });
});
