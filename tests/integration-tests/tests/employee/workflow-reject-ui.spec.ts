/**
 * Employee PGR REJECT driven through the real Take-Action UI
 * (TEST-COVERAGE-GAPS #7 — REJECT was untested at the UI/transition layer).
 *
 * A fresh PENDINGFORASSIGNMENT complaint is rejected by a GRO through the
 * actual Reject modal: pick a seeded RAINMAKER-PGR.RejectionReasons entry +
 * mandatory comment → assert the workflow moves to REJECTED, that the reason
 * was persisted into the workflow audit comment as `[<CODE>] <free text>`
 * (composed by PGRDetails.handleActionSubmit), and that both the reason and
 * the free text surface on the complaint timeline.
 *
 * NOTE on what the timeline renders: it does NOT echo the raw `[<CODE>]`
 * prefix. TimeLineWrapper.formatComment (and its siblings in
 * modules/pgr/TimeLine, ComplaintDetails, react-components/TLCaption)
 * deliberately resolves `[<CODE>]` through the `CS_REJECTION__<CODE>`
 * localization key and renders `<CS_REJECT_COMPLAINT>: <reason> — <free text>`
 * (egovernments/CCRS#489). The raw bracketed form only ever appears when that
 * key is unlocalized, so this spec asserts the bracketed shape against the
 * WORKFLOW API (the audit record) and the human-readable reason against the
 * page, accepting either rendering.
 *
 * Auth: resolveSeedPlan()'s actor (holds GRO) — REJECT at
 * PENDINGFORASSIGNMENT is a GRO action, and unlike ASSIGN it needs no
 * assignee at all, so the actor alone (no separate persona lookup) drives
 * the whole flow here.
 * Deployment-portable: self-skips when no GRO login is available or no
 * rejection reasons are seeded.
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE_URL, TENANT } from '../utils/env';
import { resolveSeedPlan, type ResolvedPersona } from '../utils/personas';
import { seedComplaintAsCitizen } from '../utils/seed';
import {
  loginEmployeeBrowser, apiStatus, takeAction, type Principal,
} from '../utils/employee-ui';

/** Adapt a personas.ts ResolvedPersona to employee-ui.ts's Principal shape. */
function toPrincipal(p: ResolvedPersona): Principal {
  return { token: p.token, userInfo: p.userInfo, roles: p.roles, authTenant: p.tenant };
}

let reader: Principal | null = null;
let actorUser = '';
let actorPass = '';
let srid = '';
let setupSkip = '';
let reasonCodes: string[] = [];

async function fetchRejectionReasons(token: string): Promise<string[]> {
  try {
    const j: any = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { authToken: token }, MdmsCriteria: { tenantId: TENANT, schemaCode: 'RAINMAKER-PGR.RejectionReasons', limit: 50 } }),
    }).then((r) => r.json());
    return (j.mdms || []).map((m: any) => m.data?.code || m.uniqueIdentifier).filter(Boolean);
  } catch { return []; }
}

/**
 * The workflow audit comment recorded for the REJECT transition.
 *
 * Read from egov-workflow-v2 rather than re-searching pgr-services: the PGR
 * search index lags writes, while the process-instance history is written
 * synchronously by the transition itself. This is the record the `[<CODE>]`
 * composition actually has to land in.
 */
async function fetchRejectComment(token: string, id: string): Promise<string> {
  const j: any = await fetch(
    `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?tenantId=${TENANT}&businessIds=${id}&history=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token } }),
    },
  ).then((r) => r.json());
  const reject = (j.ProcessInstances || []).find((p: any) => p?.action === 'REJECT');
  return reject?.comment || '';
}

test.beforeAll(async () => {
  const plan = await resolveSeedPlan();
  if ('error' in plan) { setupSkip = plan.error; return; }
  actorUser = plan.actor.username;
  actorPass = plan.actor.password;
  reader = toPrincipal(plan.actor);
  reasonCodes = await fetchRejectionReasons(plan.actor.token);
  try {
    const created = await seedComplaintAsCitizen({ description: `reject-ui seed ${new Date().toISOString()}` });
    srid = created.srid;
    if (created.status !== 'PENDINGFORASSIGNMENT') setupSkip = `seed at ${created.status}, not PENDINGFORASSIGNMENT`;
  } catch (err: any) {
    setupSkip = `seed failed: ${err?.message?.slice(0, 200)}`;
  }
});

test.describe('employee PGR REJECT through the Take-Action UI', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('REJECT (GRO) with a rejection reason → REJECTED, reason on timeline @p0', { tag: ['@persona:employee'] }, async ({ page }) => {
    test.skip(!!setupSkip, setupSkip);
    test.skip(!reasonCodes.length, 'no RAINMAKER-PGR.RejectionReasons seeded on this deployment');

    const rejectComment = `UI-REJECT ${Date.now()}`;

    const ok = await loginEmployeeBrowser(page, actorUser, actorPass);
    test.skip(!ok, `login failed for ${actorUser}`);
    await page.goto(`${BASE_URL}/digit-ui/employee/pgr/complaint-details/${srid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.locator('.digit-viewcard-field-pair, .v2-pgr-details').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(3_000);
    expect(await apiStatus(reader!, srid)).toBe('PENDINGFORASSIGNMENT');

    await takeAction(page, /^reject$/i);
    await expect(page.getByText(/PGR_ACTION_REJECT|Reject Complaint|Reject/i).first()).toBeVisible({ timeout: 10_000 });

    // Pick the first seeded rejection reason, remembering the label the operator
    // actually saw — that (not the MDMS code) is what the timeline renders once
    // CS_REJECTION__<CODE> is localized.
    const reasonInput = page.locator('.digit-dropdown-employee-select-wrap input[type="text"]').first();
    await reasonInput.click();
    await page.waitForTimeout(800);
    const firstReason = page.locator('.digit-dropdown-options-card .digit-dropdown-item').first();
    expect(await firstReason.count(), 'reject modal offers a rejection-reason option').toBeGreaterThan(0);
    const reasonLabel = (await firstReason.innerText()).trim();
    expect(reasonLabel.length, 'the picked reason has a visible label').toBeGreaterThan(0);
    await firstReason.click();
    await page.waitForTimeout(400);

    await page.locator('textarea').first().fill(rejectComment);
    await page.getByRole('button', { name: /^SUBMIT$|^Submit$/ }).first().click();

    await expect.poll(async () => apiStatus(reader!, srid), { timeout: 25_000, intervals: [1500] })
      .toBe('REJECTED');

    // The audit record itself carries the composed "[<CODE>] <free text>" — the
    // whole point of plumbing the picker into the workflow comment.
    const auditComment = await fetchRejectComment(reader!.token, srid);
    expect(auditComment, 'REJECT audit comment is "[<CODE>] <free text>"')
      .toMatch(/^\[[A-Z_][A-Z0-9_]*\]\s/);
    const auditCode = auditComment.match(/^\[([A-Z_][A-Z0-9_]*)\]/)![1];
    expect(reasonCodes, 'the recorded code is a seeded RejectionReasons entry').toContain(auditCode);
    expect(auditComment, 'free text preserved after the code').toContain(rejectComment);

    // Reason + comment render on the timeline. The UI resolves the code through
    // CS_REJECTION__<CODE>, so accept the localized reason label the operator
    // picked OR the raw bracketed code on a deployment where that key is
    // unlocalized (both are the same fact, differently rendered).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000);
    await expect(page.getByText(/Complaint Timeline|CS_COMPLAINT_DETAILS_COMPLAINT_TIMELINE/i).first()).toBeVisible({ timeout: 10_000 });
    const body = await page.locator('body').innerText();
    expect(body, 'free-text comment on timeline').toContain(rejectComment);
    expect(
      body.includes(reasonLabel) || body.includes(`[${auditCode}]`),
      `rejection reason on timeline (expected "${reasonLabel}" or "[${auditCode}]")`,
    ).toBeTruthy();
  });
});
