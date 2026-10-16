import { test, expect } from '@playwright/test';
import { PgrInboxPage } from '../pages/pgr-inbox.page';
import { loginViaApi } from '../utils/auth';
import { requiredEnv } from '../utils/identity';

const BASE_URL = requiredEnv('BASE_URL');
const TENANT = requiredEnv('DIGIT_TENANT');
const ADMIN_USER = requiredEnv('DIGIT_USERNAME');
const ADMIN_PASS = requiredEnv('DIGIT_PASSWORD');

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
