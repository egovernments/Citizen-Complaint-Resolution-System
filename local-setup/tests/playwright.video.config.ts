/**
 * Same harness as playwright.config.ts, but records video for every test.
 *
 * Kept separate so normal runs stay fast — video capture costs wall-clock and
 * disk on a suite that already takes minutes per run.
 *
 *   BASE_URL=... npx playwright test e2e/kc-parity/pgr-ui-lifecycle.spec.ts \
 *     --config=playwright.video.config.ts --project=chromium --workers=1
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  // base excludes kc-parity from the default suite; this config exists to run
  // it deliberately, so the exclusion has to be lifted here.
  testIgnore: [],
  outputDir: process.env.VIDEO_OUT || './test-results-video',
  use: {
    ...base.use,
    viewport: { width: 1280, height: 720 },
    video: { mode: 'on', size: { width: 1280, height: 720 } },
  },
});
