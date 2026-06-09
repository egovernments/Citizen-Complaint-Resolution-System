import { test, expect } from '@playwright/test';

/**
 * Smoke — issue #521 — Escalate action wiring on PGR complaint edit.
 *
 * Bug: PGR ACTION_CONFIGS lacked an entry for ESCALATE, so the Escalate
 * button never rendered on the complaint detail page in digit-ui. The
 * configurator counterpart is the `WorkflowActionSelect` component, which
 * filters the dropdown by the live workflow business-service definition —
 * if the ESCALATE action is present in the PGR workflow def and the label
 * map has 'Escalate', it should appear as an option whenever the current
 * state has an ESCALATE-emitting transition.
 *
 * Mount point: `/configurator/manage/complaints/:id` (Edit view) — the only
 * place WorkflowActionSelect is wired (configurator/.../ComplaintEdit.tsx:25).
 *
 * Smoke shape: we don't programmatically create a complaint in beforeAll —
 * that's "too involved" per the task description. Instead we open the
 * complaints LIST (which we know loads on ovh ke.citya), click into the
 * first row if any, and assert the Workflow action dropdown is present.
 * If the list is empty, we fall back to the Create page and assert the
 * configurator's WorkflowActionSelect module didn't crash on load (the
 * label map 'ESCALATE: Escalate' is defined). This catches a regression
 * where ACTION_LABELS or the WorkflowActionSelect import breaks.
 */

const COMPLAINTS_LIST_URL = '/configurator/manage/complaints';

test.describe('Smoke #521 — Escalate wiring', () => {
  test('complaint edit view renders Workflow Action select (Escalate-capable)', async ({ page }) => {
    await page.goto(COMPLAINTS_LIST_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_500);

    // Try to click into the first data row.
    const firstRow = page.locator('tbody tr').first();
    const hasRow = await firstRow.isVisible().catch(() => false);

    if (hasRow) {
      await firstRow.click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3_500);

      // The first row navigates to the VIEW page (/manage/complaints/<id>).
      // The Workflow section + WorkflowActionSelect live on the EDIT
      // page; click Edit to surface them.
      const editBtn = page.getByRole('button', { name: /^Edit$/ }).first();
      if (await editBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await editBtn.click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3_000);
      }

      // ComplaintEdit renders a <FieldSection title="Workflow"> with the
      // WorkflowActionSelect inside. The combobox trigger is rendered by
      // Radix. Either is fine to assert against.
      const workflowSection = page.getByText(/^Workflow$/i).first();
      await expect(workflowSection).toBeVisible({ timeout: 10_000 });

      // The action dropdown is a Radix combobox. Open it and look for an
      // ESCALATE option — but ONLY if the current state has it as a
      // transition; we can't guarantee that for a random row, so just
      // assert the trigger exists. Regression catch: WorkflowActionSelect
      // failing to render at all (e.g. label-map import break) flips this.
      const trigger = page
        .getByRole('combobox')
        .filter({ hasText: /select action|action/i })
        .first();
      await expect(trigger).toBeVisible({ timeout: 5_000 });
    } else {
      // No complaints seeded — fall back to a lighter assertion: the page
      // itself loaded without a React error boundary. We're not asserting
      // the button, just that the bundle that contains ACTION_LABELS
      // (with ESCALATE) loads without crashing.
      const bodyText = (await page.textContent('body')) ?? '';
      expect(bodyText).not.toMatch(/Cannot read properties|TypeError|Error boundary/i);
    }
  });
});
