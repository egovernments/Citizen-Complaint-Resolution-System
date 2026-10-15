import { defineConfig, devices } from '@playwright/test';
import { requiredEnv } from './utils/identity';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1, // shared stack — no parallel
  timeout: 60_000, // DIGIT UI is slow (async MDMS/localization init)
  retries: process.env.CI ? 1 : 0,
  outputDir: './test-results',
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: './playwright-report', open: 'never' }]]
    : [['list']],
  use: {
    // A deployed host (the integration suite's BASE_URL); there is no local default.
    baseURL: requiredEnv('BASE_URL'),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
