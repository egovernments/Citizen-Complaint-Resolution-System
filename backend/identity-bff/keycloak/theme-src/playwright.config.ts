import { defineConfig, devices } from "@playwright/test";

/**
 * Screenshot regression for the login theme.
 *
 * Baselines are captured in the official Playwright container so that CI and a
 * developer's machine rasterize text identically; `npm run screenshots` wraps
 * that. Running `npx playwright test` directly on a host will report font
 * differences, which is expected and is why the npm script exists.
 */
export default defineConfig({
    testDir: "tests/visual",
    snapshotPathTemplate: "{testDir}/__screenshots__/{arg}-{projectName}{ext}",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: process.env.CI ? "line" : "list",
    use: {
        baseURL: process.env.THEME_BASE_URL ?? "http://127.0.0.1:5173",
        // The backdrop drifts and the strap-lines rotate. Both are decorative
        // and both are disabled under reduced motion, which is also how a
        // screenshot becomes reproducible.
        contextOptions: { reducedMotion: "reduce" }
    },
    expect: {
        toHaveScreenshot: {
            maxDiffPixelRatio: 0.01,
            animations: "disabled",
            caret: "hide"
        }
    },
    projects: [
        { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
        { name: "mobile", use: { ...devices["Pixel 7"] } }
    ],
    webServer: process.env.THEME_BASE_URL
        ? undefined
        : {
              command: "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
              url: "http://127.0.0.1:5173/dev.html?page=login.ftl",
              reuseExistingServer: !process.env.CI,
              timeout: 120_000
          }
});
