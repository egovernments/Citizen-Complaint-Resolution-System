/**
 * Playwright config for the configurator's TypeScript e2e specs.
 *
 * Mirrors the existing `e2e-onboarding/playwright.config.ts` so the spec
 * harness behaves consistently across suites. Only picks up *.spec.ts files
 * in this directory — the legacy `.test.mjs` Puppeteer suite lives in
 * `tests/` and is run via `run-all.mjs`, so the two harnesses don't fight
 * over the same files.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || process.env.BASE_URL || 'https://crs-mockup.egov.theflywheel.in',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    },
  },
  outputDir: 'results',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
