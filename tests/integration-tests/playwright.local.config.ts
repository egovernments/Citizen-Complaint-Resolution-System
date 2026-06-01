// Local dev-server config: skips the configurator auth.setup, talks to a
// localhost dev server, and runs only the spec passed on the CLI. Useful
// for validating digit-ui-esbuild PRs against a local dev build before
// merging — the citizen flows run without a configurator auth session.
import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18081';

export default defineConfig({
  testDir: '.',
  testMatch: ['tests/**/*.spec.ts'],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
