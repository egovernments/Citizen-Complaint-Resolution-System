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
  test('login page renders with mobile input', async ({ page }) => {
    await page.goto(`${BASE_URL}/digit-ui/citizen/login`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const mobileInput = page.locator('input[name="mobileNumber"]');
    await mobileInput.waitFor({ state: 'visible', timeout: 20_000 });
    expect(await mobileInput.isVisible()).toBe(true);
  });

  test('citizen can log in with OTP and reach home page', async ({ page }) => {
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
