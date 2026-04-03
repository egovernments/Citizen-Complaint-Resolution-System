import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { EmployeeHomePage } from '../pages/employee-home.page';

test.describe('Employee Logout', () => {
  test('clears session and redirects to login', async ({ page }) => {
    const login = new LoginPage(page);
    await login.login('pg.citya', 'ADMIN', 'eGov@123');

    const home = new EmployeeHomePage(page);
    await home.waitForLoad();

    const sessionBefore = await home.getSessionData();
    expect(sessionBefore.employeeToken).toBeTruthy();

    // Click Logout in sidebar
    const logoutButton = page.getByText('Logout', { exact: false });
    await logoutButton.first().click();

    // Confirm if dialog appears
    const confirmButton = page.getByText('Logout', { exact: false }).last();
    if (await confirmButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmButton.click();
    }

    // Should redirect to login or citizen page
    await page.waitForURL(/\/(user\/login|citizen)/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/(user\/login|citizen)/);

    const tokenAfter = await page.evaluate(() => localStorage.getItem('Employee.token'));
    expect(tokenAfter).toBeFalsy();
  });
});
