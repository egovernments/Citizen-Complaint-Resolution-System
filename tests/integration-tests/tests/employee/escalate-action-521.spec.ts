/**
 * Employee — manual Escalate action end-to-end (CCRS #521).
 *
 * Closes Gurjeet's #521 retest: complaint at PENDINGATLME, employee
 * picks Escalate from the action dropdown, submits comment, workflow
 * state moves to PENDINGATSUPERVISOR.
 *
 * Requires a deployment where:
 *   - PGR ACTION_CONFIGS lists ESCALATE (#521 frontend half)
 *   - The PGR workflow on the root tenant has PENDINGATLME → ESCALATE
 *     → PENDINGATSUPERVISOR with PGR_LME role (PR #635 / commit ce302053)
 *   - A complaint exists at PENDINGATLME assigned to EMPLOYEE_USER
 *     (override ASSIGNED_COMPLAINT_ID env var on your deployment).
 */
import { test, expect } from '@playwright/test';
import {
  BASE_URL,
  TENANT,
  EMPLOYEE_USER,
  EMPLOYEE_PASS,
  ASSIGNED_COMPLAINT_ID,
} from '../utils/env';
import { loginViaApi } from '../utils/auth';

test.describe('employee — manual Escalate action #521', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('PENDINGATLME → Escalate → PENDINGATSUPERVISOR (workflow state moves)', async ({ page }) => {
    // ============ API session injection (replaces UI form login) ============
    // Test subject is the Take Action → Escalate flow on a complaint
    // detail page, not the login form. Inject the employee session via
    // API so the spec runs on deployments where the configurator-style
    // login form doesn't bridge to /digit-ui/employee/* sessions.
    await loginViaApi(page, {
      baseURL: BASE_URL,
      tenant: TENANT,
      username: EMPLOYEE_USER,
      password: EMPLOYEE_PASS,
    });

    // ============ Open the assigned complaint detail ============
    await page.goto(
      `${BASE_URL}/digit-ui/employee/pgr/complaint-details/${ASSIGNED_COMPLAINT_ID}?cb=${Date.now()}`,
    );
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_000);

    // ============ Take action → Escalate ============
    const takeAction = page.getByRole('button', { name: /take action/i }).first();
    await expect(takeAction).toBeVisible({ timeout: 15_000 });
    await takeAction.click();
    await page.waitForTimeout(1_500);

    const escalateOption = page.getByText(/^Escalate$/i).first();
    await expect(
      escalateOption,
      '#521 — Escalate option must appear in the Take action menu when state = PENDINGATLME',
    ).toBeVisible({ timeout: 8_000 });
    await escalateOption.click();
    await page.waitForTimeout(2_000);

    // ============ Fill comment + submit ============
    const commentBox = page.locator('textarea').first();
    await expect(commentBox).toBeVisible({ timeout: 10_000 });
    await commentBox.fill('Integration test escalation comment.');

    const submitBtn = page.getByRole('button', { name: /^submit$|^send$|^escalate$/i }).first();
    await submitBtn.click();
    await page.waitForTimeout(3_000);

    // ============ Verify workflow state via process-search ============
    const wfResp = await page.request.post(
      `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?businessIds=${ASSIGNED_COMPLAINT_ID}&tenantId=${TENANT}`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { RequestInfo: {} },
      },
    );
    expect(wfResp.ok()).toBeTruthy();
    const body = await wfResp.text();
    expect(
      body,
      '#521 — workflow state must move to PENDINGATSUPERVISOR after Escalate submit',
    ).toContain('PENDINGATSUPERVISOR');
  });
});
