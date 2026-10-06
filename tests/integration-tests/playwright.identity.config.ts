import { defineConfig } from '@playwright/test';

// No profile/setup dependencies: an unset gate must not contact any deployment.
export default defineConfig({
  testDir: 'tests/identity-real',
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: { browserName: 'chromium', headless: true, trace: 'off', screenshot: 'off', video: 'off' },
});
