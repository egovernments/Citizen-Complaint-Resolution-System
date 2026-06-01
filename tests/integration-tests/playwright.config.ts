import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://naipepea.digit.org';

export default defineConfig({
  // Specs live under tests/<persona>/ (citizen, employee, admin) plus
  // tests/lifecycle/ for cross-persona end-to-end flows. The setup project
  // below writes auth.json before any spec project runs.
  // Anchor test discovery to the canonical `tests/` tree at the repo
  // root. Using testDir: '.' with `tests/**/*.spec.ts` matches files
  // inside dev worktrees too (`.worktrees/<branch>/tests/...`), which
  // double-loads @playwright/test and crashes the runner. Pinning
  // testDir to `tests` scopes discovery to this checkout's specs only.
  testDir: 'tests',
  testMatch: [
    '**/*.spec.ts',
    'fixtures/auth.setup.ts',
  ],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  // Manage specs mutate tenant state; serial keeps cleanup deterministic.
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'report.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'on',
    trace: 'on',
    video: 'on',
  },
  projects: [
    {
      // Runs first — performs UI login and writes storageState to auth.json.
      name: 'setup',
      testMatch: /tests\/fixtures\/auth\.setup\.ts$/,
    },
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        storageState: 'auth.json',
      },
      dependencies: ['setup'],
      // Don't try to run setup itself as part of the chromium project.
      testIgnore: /tests\/fixtures\/auth\.setup\.ts$/,
    },
  ],
});
