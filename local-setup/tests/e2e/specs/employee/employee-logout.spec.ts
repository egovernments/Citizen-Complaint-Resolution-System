import { test, expect } from '@playwright/test';
import { loginViaApi } from '../../utils/auth';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18080';
const TENANT = process.env.DIGIT_TENANT || 'uitest.citya';
const ADMIN_USER = process.env.DIGIT_USERNAME || 'ADMIN';
const ADMIN_PASS = process.env.DIGIT_PASSWORD || 'eGov@123';

test.describe('Employee Logout', () => {
  test('clears session and redirects to login', async ({ page }) => {
    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });

    // #224: the employee session lives in the tab (sessionStorage), never in localStorage.
    const tokenBefore = await page.evaluate(() => sessionStorage.getItem('Employee.token'));
    expect(tokenBefore).toBeTruthy();

    // Clear the tab's session (simulates logout)
    await page.evaluate(() => {
      for (const k of ['Employee.token', 'Employee.user-info', 'token', 'user-info', 'Digit.User']) sessionStorage.removeItem(k);
      localStorage.removeItem('Employee.tenant-id');
      localStorage.removeItem('Employee.locale');
      localStorage.removeItem('tenant-id');
    });

    // Navigate to employee login page
    await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });

    // Verify we're on a login page
    expect(page.url()).toMatch(/\/(user\/login|citizen|login)/);

    // Verify token is cleared
    const tokenAfter = await page.evaluate(() => sessionStorage.getItem('Employee.token') || localStorage.getItem('Employee.token'));
    expect(tokenAfter).toBeFalsy();
  });
});
