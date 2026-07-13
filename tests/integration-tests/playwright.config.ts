import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://naipepea.digit.org';
const LOCAL_STACK = process.env.LOCAL_STACK === '1';
const EXCLUDE_LOCAL_ONLY = LOCAL_STACK ? undefined : /@local-only/;

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
    'fixtures/lifecycle.setup.ts',
    'fixtures/api.setup.ts',
    'fixtures/citizen.setup.ts',
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
    ignoreHTTPSErrors: true,
    headless: true,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  projects: [
    {
      // Runs first — performs UI login and writes storageState to auth.json.
      name: 'setup',
      testMatch: /tests\/fixtures\/auth\.setup\.ts$/,
    },
    {
      // Runs after `setup`. Drives the PGR API end-to-end to seed two
      // complaints (one PENDINGFORASSIGNMENT, one CLOSEDAFTERRESOLUTION
      // with rating=4) and writes lifecycle-fixtures.json. Downstream
      // specs that need a "pinned" SRID read from that file.
      name: 'lifecycle-setup',
      testMatch: /tests\/fixtures\/lifecycle\.setup\.ts$/,
      dependencies: ['setup'],
    },
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        storageState: 'auth.json',
      },
      dependencies: ['setup', 'lifecycle-setup', 'citizen-setup'],
      // Don't try to run setup itself as part of the chromium project.
      testIgnore: /tests\/fixtures\/(auth|lifecycle|api|citizen)\.setup\.ts$/,
      grepInvert: EXCLUDE_LOCAL_ONLY,
    },
    {
      // Token-injection auth — writes auth-api.json storage state.
      // Used by smoke + api projects which do not exercise the UI login form.
      name: 'api-setup',
      testMatch: /tests\/fixtures\/api\.setup\.ts$/,
    },
    {
      // Provisions ONE fresh citizen per `npx playwright test` invocation
      // and writes the identity to citizen-fixture.json. Citizen specs
      // consume the fixture via readProvisionedCitizen() instead of each
      // registering their own citizen — shared identity, single round-trip.
      name: 'citizen-setup',
      testMatch: /tests\/fixtures\/citizen\.setup\.ts$/,
    },
    {
      name: 'smoke',
      testDir: 'tests/smoke',
      testMatch: /.*\.spec\.ts$/,
      dependencies: ['api-setup'],
      grepInvert: EXCLUDE_LOCAL_ONLY,
      timeout: 30_000,
      use: {
        storageState: 'auth-api.json',
      },
    },
    {
      name: 'api',
      testDir: 'tests/api',
      testMatch: /.*\.spec\.ts$/,
      dependencies: ['api-setup'],
      grepInvert: EXCLUDE_LOCAL_ONLY,
      use: {
        storageState: 'auth-api.json',
      },
    },
  ],
});
