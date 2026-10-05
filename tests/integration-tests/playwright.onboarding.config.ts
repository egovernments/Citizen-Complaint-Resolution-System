import { defineConfig } from '@playwright/test';

// Real-stack onboarding journey (#2266). Like the identity gate: no profile or
// setup dependencies, so an unset gate never contacts a deployment.
export default defineConfig({
  testDir: 'tests/onboarding-real',
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 20 * 60_000,
  reporter: [['list', { printSteps: true }]],
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
