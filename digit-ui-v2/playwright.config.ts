import { defineConfig, devices } from '@playwright/test';

/**
 * Citizen UI end-to-end tests. Defaults to the deployed naipepea instance —
 * override via BASE_URL=https://... npx playwright test.
 *
 * No webServer block: we exercise the actually-deployed bundle, not a local
 * `npm run dev` instance. That way regressions in the build pipeline (Vite
 * config, env var injection, nginx routing) are caught here too.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.BASE_URL || 'https://naipepea.digit.org',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
