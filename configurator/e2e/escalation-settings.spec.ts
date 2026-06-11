/**
 * E2E spec for the CRS Escalation Settings page — configurator-owned.
 *
 * Covers the escalation-PRD-alignment scope:
 *   - /manage/escalation-settings renders the header (with the
 *     deployment-wide tenant note) and either the setup banner or the
 *     cards directly — the spec is tenant-agnostic, so a fresh install
 *     (no CRS.WorkflowStateMapping yet) passes too.
 *   - Card 1 ("How the SLA for a complaint is chosen") shows exactly 6
 *     cascade rows: the status-mapping gate + the 5 SLA sources.
 *   - Card 3 ("Complaint-status mapping") renders its table and the
 *     "Add a status" / "Add standard complaint statuses" controls.
 *   - Card 4's "Run a test scan (changes nothing)" button is visible.
 *
 * Read-only against live tenants. Save flows and the test scan itself
 * are intentionally NOT exercised here — the scan needs SUPERUSER and
 * saves would mutate deployment-wide singletons.
 *
 * Run:
 *   cd configurator
 *   E2E_BASE_URL=https://bometfeedbackhub.digit.org/configurator \
 *     E2E_TENANT=ke \
 *     E2E_USERNAME=ADMIN E2E_PASSWORD=eGov@123 \
 *     npx playwright test --config e2e/playwright.config.ts \
 *     e2e/escalation-settings.spec.ts --reporter=line
 */

import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = process.env.E2E_BASE_URL
  || process.env.BASE_URL
  || 'https://bometfeedbackhub.digit.org/configurator';
const TENANT = process.env.E2E_TENANT || 'ke';
const USERNAME = process.env.E2E_USERNAME || 'ADMIN';
const PASSWORD = process.env.E2E_PASSWORD || 'eGov@123';

const TS = Date.now();
const RUN_TAG = `PW_CRS_ESC_SETTINGS_${String(TS).slice(-6)}`;

// Same cool-down the matrix spec uses — Kong's auth-flow rate limit trips
// when Playwright suites chain back-to-back.
test.beforeAll(async () => {
  await new Promise((r) => setTimeout(r, 90_000));
});

async function loginAsManagement(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  const managementBtn = page.getByRole('button', { name: /Management/i }).first();
  await managementBtn.click({ timeout: 10_000 });

  const tenantInput = page.locator('#tenantCode');
  if (await tenantInput.count()) await tenantInput.fill(TENANT);
  const usernameInput = page.locator('#username');
  if (await usernameInput.count() && (await usernameInput.inputValue()) !== USERNAME) {
    await usernameInput.fill(USERNAME);
  }
  const passwordInput = page.locator('#password');
  if (await passwordInput.count() && !(await passwordInput.inputValue())) {
    await passwordInput.fill(PASSWORD);
  }
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/manage(\/|$)/, { timeout: 30_000 });
}

test.describe.serial('Escalation Settings', () => {
  test('header, cascade card, mapping card, and test-scan button render', async ({ page }) => {
    test.info().annotations.push({ type: 'run-tag', description: RUN_TAG });

    await loginAsManagement(page);
    await page.goto(`${BASE_URL}/manage/escalation-settings`);
    await page.waitForLoadState('networkidle');

    // Screenshot first so a layout regression is captured even if the
    // assertions below fail.
    await page.screenshot({ path: '/tmp/sc-CRS-ESCALATION-SETTINGS.png', fullPage: true });

    // Header + the deployment-wide tenant note.
    await expect(page.getByRole('heading', { name: /Escalation Settings/i })).toBeVisible();
    await expect(page.getByText(/apply to the whole deployment/i)).toBeVisible();

    // Banner-or-cards: the setup banner only shows while the status
    // mapping is empty, so it's optional — the cards must always render.
    // Card 1: the cascade rule line + exactly 6 rows (gate + 5 sources).
    await expect(page.getByText(/How the SLA for a complaint is chosen/i)).toBeVisible();
    await expect(page.getByText(/first source with a value wins/i)).toBeVisible();
    await expect(page.locator('[data-testid="cascade-row"]')).toHaveCount(6);

    // Card 3: the status-mapping table renders (header row even when the
    // tenant has no mapping yet) with both add buttons.
    const mappingCard = page.locator('#status-mapping');
    await expect(mappingCard).toBeVisible();
    await expect(mappingCard.locator('table')).toBeVisible();
    await expect(page.getByRole('button', { name: /Add a status/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add standard complaint statuses/i })).toBeVisible();

    // Card 4: the test scan is offered (not run — needs SUPERUSER).
    await expect(page.getByRole('button', { name: /Run a test scan/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Check a single complaint/i })).toBeVisible();
  });
});
