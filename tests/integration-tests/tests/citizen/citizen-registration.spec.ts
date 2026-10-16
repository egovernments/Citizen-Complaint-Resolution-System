import { test, expect } from '@playwright/test';
import { citizenOtpLoginViaUI } from '../utils/citizen-login';
import { generateCitizenPhone } from '../utils/env';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe('Citizen registration through BFF phone possession', () => {
  test('fresh phone → OTP → default national-number name → citizen home', { tag: ['@area:auth', '@persona:citizen'] }, async ({ page }) => {
    const phone = generateCitizenPhone();
    await citizenOtpLoginViaUI(page, phone);
    expect(page.url()).not.toContain('/login');
    expect(page.url()).not.toMatch(/\/register(\/|$)/);
    expect(await page.evaluate(() => Boolean(localStorage.getItem('Citizen.token')))).toBe(true);
    const info = await page.evaluate(() => JSON.parse(localStorage.getItem('Citizen.user-info') || '{}'));
    expect(info.name).toBe(phone);
    expect(info.uuid).toBeTruthy();
    expect(await page.locator('body').innerText()).not.toContain('Something went wrong');
  });
});
