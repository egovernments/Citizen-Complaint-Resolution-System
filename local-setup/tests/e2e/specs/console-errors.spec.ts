import { test, expect } from '@playwright/test';
import { PgrInboxPage } from '../pages/pgr-inbox.page';
import { loginViaApi } from '../utils/auth';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18080';
const TENANT = process.env.DIGIT_TENANT || 'uitest.citya';
const ADMIN_USER = process.env.DIGIT_USERNAME || 'ADMIN';
const ADMIN_PASS = process.env.DIGIT_PASSWORD || 'eGov@123';

test.describe('Console Errors', () => {
  test('no uncaught JS errors across employee flow', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => {
      const msg = error.message || error.toString();
      // Filter known benign errors
      if (/ResizeObserver|Script error|Loading chunk|Request failed with status code/i.test(msg)) return;
      errors.push(msg);
    });

    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });

    const inbox = new PgrInboxPage(page);
    await inbox.goto();

    expect(errors).toEqual([]);
  });
});
