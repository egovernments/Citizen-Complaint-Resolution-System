import { test, expect } from '@playwright/test';

/**
 * Demo: #521 — manual ESCALATE action on a PENDINGATLME PGR complaint.
 *
 * Runs against bomet PRODUCTION:
 *   PLAYWRIGHT_BASE_URL=https://bometfeedbackhub.digit.org \
 *     npx playwright test demo-521-escalate-bomet --workers=1
 *
 * No storage state needed — this test does a fresh login via the
 * digit-ui /employee/user/login form as BOMET_LME / eGov@123. The
 * complaint PG-PGR-2026-04-13-000848 is a pre-existing PENDINGATLME
 * assigned to BOMET_LME (left over from the e2e demo).
 *
 * What the recorded video shows, end-to-end:
 *   1. Login page with bomet shield logo (#505 sub-3 — 96x96)
 *   2. Filling username/password/city + accepting privacy policy
 *   3. Landing in digit-ui post-login
 *   4. Navigating to the complaint detail
 *   5. Clicking "Take action" — dropdown reveals ESCALATE as a
 *      first-class option alongside Re-assign / Resolve.
 *
 * The ESCALATE option appearing here is the #521 fix surface:
 *   - FE: ACTION_CONFIGS in PGRDetails.js (commit 54946902)
 *   - Workflow: PENDINGATLME -> ESCALATE -> PENDINGATSUPERVISOR for
 *     roles [PGR_LME, PGR_VIEWER] (seed PgrWorkflowConfig.json +
 *     live businessservice/_update on bomet)
 *   - Localization: ES_COMMON_TAKE_ACTION -> "Take action" reachable
 *     for tenant ke, module rainmaker-common, locale en_IN.
 */

const COMPLAINT_ID = 'PG-PGR-2026-04-13-000848';
const COMPLAINT_URL = `/digit-ui/employee/pgr/complaint-details/${COMPLAINT_ID}`;
const LOGIN_URL = '/digit-ui/employee/user/login';

test.describe('Demo: #521 manual ESCALATE on bomet', () => {
  // No storageState — fresh login for the recording.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('LME sees Escalate option in Take action dropdown for PENDINGATLME complaint', async ({ page }) => {
    // --- 1. Land on the login page ---
    await page.goto(LOGIN_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_500); // hold on the login banner for the recording

    // --- 2. Fill credentials (real keyboard so React picks it up) ---
    const userInput = page.locator('input[type="text"]').first();
    await userInput.click();
    await userInput.pressSequentially('BOMET_LME', { delay: 80 });
    await page.waitForTimeout(800);

    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.click();
    await passwordInput.pressSequentially('eGov@123', { delay: 80 });
    await page.waitForTimeout(800);

    // --- 3. City dropdown — Bomet County is the only option and is
    // selected by default. Just hold on it for the recording. ---
    const cityCombobox = page.getByRole('combobox', { name: /City/i });
    await expect(cityCombobox).toContainText('Bomet County');
    await page.waitForTimeout(1_500);

    // --- 4. Privacy policy checkbox — click the visual indicator
    // (the img next to the hidden input) because the bare <input>
    // is overlaid by a <div> that intercepts pointer events. ---
    await page.getByText(/I agree to the DIGIT/i).click();
    await page.waitForTimeout(1_000);

    // --- 5. Login ---
    await page.getByRole('button', { name: /^Login$/i }).click();

    // --- 6. Wait for the redirect into the digit-ui shell ---
    await page.waitForURL(/\/digit-ui\/employee(?!\/user\/login)/, {
      timeout: 30_000,
    });
    await page.waitForTimeout(2_000);

    // --- 7. Navigate to the complaint detail ---
    await page.goto(`${COMPLAINT_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_000); // let the timeline + take-action button mount

    // --- 8. Scroll to the Take action button (it sits below the timeline) ---
    const takeActionBtn = page.getByRole('button', { name: /^Take action$/i });
    await expect(takeActionBtn).toBeVisible({ timeout: 15_000 });
    await takeActionBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1_500);

    // --- 9. Click to open the dropdown — Escalate must be there ---
    await takeActionBtn.click();
    await page.waitForTimeout(1_500);

    const escalate = page.getByText(/^Escalate$/i).first();
    const reassign = page.getByText(/^Re-assign$/i).first();
    const resolve = page.getByText(/^Resolve$/i).first();

    await expect(escalate).toBeVisible();
    await expect(reassign).toBeVisible();
    await expect(resolve).toBeVisible();

    // Hold on the open dropdown so the recording shows it clearly.
    await page.waitForTimeout(2_500);

    // --- 10. Click Escalate — should open the workflow modal ---
    await escalate.click();
    await page.waitForTimeout(2_500);

    // --- 11. Modal: comments are mandatory (per ACTION_CONFIGS) ---
    const commentInput = page.locator('textarea').first();
    await expect(commentInput).toBeVisible({ timeout: 10_000 });
    await commentInput.click();
    await commentInput.pressSequentially(
      'Escalating to supervisor for higher-tier review.',
      { delay: 60 },
    );
    await page.waitForTimeout(1_500);

    // --- 12. Submit the escalation ---
    const submitBtn = page.getByRole('button', { name: /^Submit$/i });
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();
    await page.waitForTimeout(4_500);

    // --- 13. Verify state moved PENDINGATLME -> PENDINGATSUPERVISOR
    // via the workflow API. The token comes from the OAuth call we made
    // in setup-less mode — Playwright doesn't carry one, so probe via
    // the public proxy with the cookie session the page already has. ---
    const wfResp = await page.request.post(
      `/egov-workflow-v2/egov-wf/process/_search?tenantId=ke&businessIds=${COMPLAINT_ID}&history=false`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { RequestInfo: {} },
      },
    );
    expect(wfResp.ok()).toBeTruthy();
    const wfBody = await wfResp.json();
    const latestState = wfBody?.ProcessInstances?.[0]?.state?.state;
    // Some bomet workflow responses return state as a string, others
    // as an object with `.state` — handle both shapes.
    const stateStr = typeof latestState === 'string'
      ? latestState
      : wfBody?.ProcessInstances?.[0]?.state;
    expect(String(stateStr)).toContain('PENDINGATSUPERVISOR');
  });
});
