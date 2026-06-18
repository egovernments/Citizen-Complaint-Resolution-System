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
  TENANT_LABEL,
  ASSIGNED_COMPLAINT_ID,
} from '../utils/env';

const LOGIN_URL = '/digit-ui/employee/user/login';

test.describe('employee — manual Escalate action #521', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('PENDINGATLME → Escalate → PENDINGATSUPERVISOR (workflow state moves)', async ({ page }) => {
    // ============ digit-ui employee login ============
    await page.goto(`${BASE_URL}${LOGIN_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_500);

    await page.locator('input[type="text"]').first().pressSequentially(EMPLOYEE_USER, { delay: 60 });
    await page.locator('input[type="password"]').first().pressSequentially(EMPLOYEE_PASS, { delay: 60 });

    const cityCombo = page.getByRole('combobox', { name: /City/i });
    if (!(await cityCombo.textContent())?.includes(TENANT_LABEL)) {
      await cityCombo.click();
      await page.waitForTimeout(700);
      await page.getByRole('option', { name: new RegExp(TENANT_LABEL, 'i') }).first().click();
      await page.waitForTimeout(700);
    }
    await page.getByText(/I agree to the DIGIT/i).click();
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: /^Login$/i }).click();
    await page.waitForURL(/\/digit-ui\/employee(?!\/user\/login)/, { timeout: 30_000 });
    await page.waitForTimeout(3_000);

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
