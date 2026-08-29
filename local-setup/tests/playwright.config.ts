import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // kc-parity is an opt-in harness: it files, assigns and resolves a REAL
  // complaint on whatever BASE_URL points at. Keep it out of the default suite
  // entirely, but let an explicit `BASE_URL=... npx playwright test <file>` in.
  // (testIgnore is applied at collection even for a path given on the CLI, so
  // this has to be conditional rather than absolute.)
  testIgnore: process.env.BASE_URL ? [] : ['**/kc-parity/**'],
  timeout: 90_000,
  retries: 0,
  globalSetup: require.resolve('./global-setup'),
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:18080',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
