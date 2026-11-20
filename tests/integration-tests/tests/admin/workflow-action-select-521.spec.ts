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
import { requires } from '../utils/capabilities';
import { loadAuth, pgrSearch } from '../utils/manage/api';
import { readLifecycleFixtures } from '../utils/lifecycle-fixtures';

const COMPLAINTS_LIST_URL = '/configurator/manage/complaints';

test.describe('admin Workflow Action — Escalate visible #521', () => {
  test('Edit view exposes a Workflow Action select; ESCALATE present when state=PENDINGATLME', { tag: ['@persona:admin'] }, async ({
    page,
  }) => {
    // The dropdown can only offer Escalate if the tenant's PGR workflow defines
    // the canonical self-loop. Capability expectations make rollout drift fail
    // explicitly instead of silently patching the live workflow from a test.
    requires(test, 'workflow.pgr.actions.ESCALATE', 'admin #521 Escalate option');

    // Onboarding-data gap: the Escalate-at-PENDINGATLME assertion needs a
    // complaint currently in PENDINGATLME. If the deployment has none, the
    // Workflow-action surface can't be exercised meaningfully — skip rather
    // than fake a pass. (The closure criterion is specifically the Escalate
    // option at PENDINGATLME.)
    const workable = await pgrSearch(loadAuth(), TENANT, {
      status: 'PENDINGATLME',
      limit: 1,
    }).catch(() => []);
    // pgr _search is role-scoped, so "none found" may only mean none THIS session
    // can read. lifecycle.setup.ts drives a complaint to PENDINGATLME every run
    // (complaints.assigned_to_employee): when it exists, the admin must be able to
    // open it, so it is used rather than skipping on an empty search.
    const fixtures = readLifecycleFixtures();
    const seededAtLme =
      fixtures?.status === 'ok' && fixtures.tenant === TENANT
        ? fixtures.complaints?.assigned_to_employee
        : undefined;
    const workableId =
      ((workable[0]?.service as any)?.serviceRequestId as string | undefined) ?? seededAtLme;
    test.skip(
      !workableId,
      `no PENDINGATLME complaint on ${TENANT} (none visible to this session, none seeded by lifecycle-setup)`,
    );

    // RC7: the list is sorted most-recent-first, so clicking the FIRST row
    // used to drive whatever complaint happened to be newest — often a
    // terminal (CLOSEDAFTERRESOLUTION) one with no workflow action select at
    // all, not the PENDINGATLME complaint found above. Navigate straight to
    // that complaint's edit page instead.
    await page.goto(`${BASE_URL}${COMPLAINTS_LIST_URL}/${encodeURIComponent(workableId!)}/edit?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    // ComplaintEdit.tsx's "Request ID" field carries the loaded record's id; a
    // session that cannot read the complaint through /request/_search bounces to
    // the list instead, which is the failure (not a missing-data skip).
    await expect(
      page.getByLabel(/^Request ID$/i),
      `the Edit page must load ${workableId}; if it bounces to the list, the configurator session cannot ` +
        "read it through /pgr-services/v2/request/_search (its resource.complaint.scope grants this " +
        'session no scope — v2.20 seeds SUPERUSER/ACCOUNT_ADMIN = ALL/ALL in eaacdf7f5)',
    ).toHaveValue(workableId!, { timeout: 30_000 });

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
