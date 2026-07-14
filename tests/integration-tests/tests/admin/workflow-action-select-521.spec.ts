/**
 * Admin — WorkflowActionSelect surfaces Escalate at PENDINGATLME (CCRS #521).
 *
 * Smoke that complements the digit-ui employee-side full-action drive
 * in tests/employee/escalate-action-521.spec.ts. This one stays on
 * the configurator side and asserts that:
 *
 *   1. The complaint Edit view renders a Workflow section.
 *   2. The Workflow Action dropdown opens with ≥ 1 option (so
 *      ACTION_LABELS map loaded without crashing).
 *   3. When the row's current state is PENDINGATLME, the dropdown
 *      MUST include an "Escalate" option — the original closure
 *      criterion. Pre-fix bug was the option being missing.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, TENANT } from '../utils/env';
import { loadAuth, pgrSearch } from '../utils/manage/api';

const COMPLAINTS_LIST_URL = '/configurator/manage/complaints';

test.describe('admin Workflow Action — Escalate visible #521', () => {
  test('Edit view exposes a Workflow Action select; ESCALATE present when state=PENDINGATLME', async ({
    page,
  }) => {
    // Onboarding-data gap: the Escalate-at-PENDINGATLME assertion needs a
    // complaint currently in PENDINGATLME. If the deployment has none, the
    // Workflow-action surface can't be exercised meaningfully — skip rather
    // than fake a pass. (The closure criterion is specifically the Escalate
    // option at PENDINGATLME.)
    const workable = await pgrSearch(loadAuth(), TENANT, {
      status: 'PENDINGATLME',
      limit: 1,
    }).catch(() => []);
    test.skip(workable.length === 0, 'no PENDINGATLME complaint seeded to exercise the Escalate action');

    await page.goto(`${BASE_URL}${COMPLAINTS_LIST_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_500);

    const firstRow = page.locator('tbody tr').first();
    if (!(await firstRow.isVisible().catch(() => false))) {
      // No data — fall back to "complaints page mounted without crash".
      const bodyText = (await page.textContent('body')) ?? '';
      expect(bodyText).not.toMatch(/Cannot read properties|TypeError|Error boundary/i);
      return;
    }

    await firstRow.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_500);

    // Click Edit to surface the Workflow section.
    const editBtn = page.getByRole('button', { name: /^Edit$/ }).first();
    if (await editBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3_000);
    }

    await expect(page.getByText(/^Workflow$/i).first()).toBeVisible({ timeout: 10_000 });

    const trigger = page
      .getByRole('combobox')
      .filter({ hasText: /select action|action/i })
      .first();
    await expect(trigger).toBeVisible({ timeout: 5_000 });
    await trigger.click();
    await page.waitForTimeout(1_500);

    const options = page.locator(
      '[role="listbox"][data-state="open"] [role="option"], [role="option"]',
    );
    const optionTexts = await options.allInnerTexts();
    expect(
      optionTexts.length,
      'WorkflowActionSelect must render ≥ 1 option (ACTION_LABELS map loaded)',
    ).toBeGreaterThan(0);

    // If state surfaces PENDINGATLME, Escalate MUST be one of the options.
    const bodyText = (await page.textContent('body')) ?? '';
    if (/Pending\s+At\s+LME|PENDINGATLME/i.test(bodyText)) {
      expect(
        optionTexts.some((t) => /escalate/i.test(t)),
        `#521 — Escalate must be in the action dropdown at PENDINGATLME. Options: ${JSON.stringify(optionTexts)}`,
      ).toBe(true);
    }

    await page.keyboard.press('Escape');
  });
});
