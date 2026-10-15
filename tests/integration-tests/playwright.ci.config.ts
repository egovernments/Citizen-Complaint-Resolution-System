// The suite as the "Integration tests" workflow runs it on GitHub runners
// (.github/workflows/integration-tests.yml): playwright.config.ts plus
//   - a 60 s test timeout instead of 120 s. On the first CI runs passing tests
//     took 1.7 s median, 21 s p99, 48 s at most, while every timed-out test
//     burned the full timeout twice (once more on the retry) and the run hit
//     its global timeout with a third of the suite unrun;
//   - one retry, so a flaky test shows as `flaky` and does not fail a PR
//     (scripts/ci-compare.mjs counts flaky as a pass);
//   - traces, video and screenshots only for tests that fail;
//   - the blob reporter: the workflow shards the suite over several runners,
//     each with its own stack, and merges the blobs with
//     playwright.ci-merge.config.ts into report.json + the HTML report;
//   - the GitHub reporter, which puts each failure on the PR's Files tab.
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  timeout: 60_000,
  retries: 1,
  reporter: [['list'], ['github'], ['blob', { outputDir: 'blob-report' }]],
  use: {
    ...base.use,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});
