import { test as setup } from '@playwright/test';
import path from 'node:path';
import { TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { loginViaApi } from '../utils/auth';

// Persist the BFF cookie as well as the DIGIT context; no native password grant.
setup('authenticate via api', async ({ page }) => {
  await loginViaApi(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
  await page.context().storageState({ path: path.resolve('auth-api.json') });
});
