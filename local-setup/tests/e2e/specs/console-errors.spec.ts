import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { EmployeeHomePage } from '../pages/employee-home.page';
import { PgrInboxPage } from '../pages/pgr-inbox.page';

test.describe('Console Errors', () => {
  test('no uncaught JS errors across employee flow', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => {
      const msg = error.message || error.toString();
      // Filter known benign errors
      if (/ResizeObserver|Script error|Loading chunk|Request failed with status code/i.test(msg)) return;
      errors.push(msg);
    });

    const login = new LoginPage(page);
    await login.login('pg.citya', 'ADMIN', 'eGov@123');

    const home = new EmployeeHomePage(page);
    await home.waitForLoad();

    const inbox = new PgrInboxPage(page);
    await inbox.goto();

    expect(errors).toEqual([]);
  });
});
