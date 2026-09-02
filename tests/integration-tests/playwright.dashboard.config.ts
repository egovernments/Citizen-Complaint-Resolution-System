import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const BASE_URL = process.env.BASE_URL;
if (!BASE_URL) throw new Error('BASE_URL is required for dashboard tests');

const resultsDir = process.env.DASHBOARD_RESULTS_DIR
  ? resolve(process.env.DASHBOARD_RESULTS_DIR)
  : resolve('../../performance/results/dashboard-runs/manual');
const warmups = Number(process.env.DASHBOARD_WARMUPS || 2);
const samples = Number(process.env.DASHBOARD_SAMPLES || 20);

if (!Number.isInteger(warmups) || warmups < 0) {
  throw new Error('DASHBOARD_WARMUPS must be a non-negative integer');
}
if (!Number.isInteger(samples) || samples < 1) {
  throw new Error('DASHBOARD_SAMPLES must be a positive integer');
}

export default defineConfig({
  testDir: 'tests/dashboard-performance',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  outputDir: resolve(resultsDir, 'playwright-artifacts'),
  reporter: [
    ['list'],
    ['json', { outputFile: resolve(resultsDir, 'playwright-report.json') }],
    ['html', { open: 'never', outputFolder: resolve(resultsDir, 'playwright-report') }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    headless: process.env.DASHBOARD_HEADED !== '1',
    ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS === '1',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'dashboard-functional',
      testMatch: '**/*.functional.spec.ts',
    },
    {
      name: 'dashboard-benchmark',
      testMatch: '**/*.benchmark.spec.ts',
      repeatEach: warmups + samples,
    },
  ],
});
