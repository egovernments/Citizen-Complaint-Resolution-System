// Merges the shards' blob reports (playwright.ci.config.ts) into one run:
//   npx playwright merge-reports --config playwright.ci-merge.config.ts <blob dir>
// report.json is what scripts/ci-compare.mjs judges and what later runs use as
// their baseline; playwright-report/ is the HTML report the workflow uploads.
// testDir matches playwright.config.ts so file paths come out the same.
export default {
  testDir: 'tests',
  reporter: [
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'report.json' }],
  ],
};
