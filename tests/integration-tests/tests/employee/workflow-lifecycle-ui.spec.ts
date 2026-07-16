/**
 * Employee PGR lifecycle DRIVEN THROUGH THE REAL TAKE-ACTION UI
 * (TEST-COVERAGE-GAPS #6 — "the lifecycle is asserted at render level but
 * rarely exercised through the real-role UI").
 *
 * A complaint is walked PENDINGFORASSIGNMENT → PENDINGATLME → RESOLVED using
 * the actual Take-Action modal (not an ADMIN-masked API call):
 *
 *   1. ASSIGN  as resolveSeedPlan()'s actor (holds GRO) — pick an assignee
 *      from the UI's own department-grouped picker + mandatory comment →
 *      assert the workflow moves to PENDINGATLME.
 *   2. RESOLVE as getPersona('lme') (whoever actually carries PGR_LME) —
 *      mandatory comment → assert RESOLVED.
 *
 * Each state transition is verified out-of-band via PGR _search, and each
 * mandatory comment is asserted to land on the complaint timeline.
 *
 * Role reality on mz.maputo: EMP001 carries GRO+EMPLOYEE+PGR_LME, so one
 * officer does both steps there. On bomet the two are necessarily DIFFERENT
 * PEOPLE (see personas.ts's persona-triple comment: HS_GRO has GRO but not
 * PGR_LME, DEMO_WATER has PGR_LME but not GRO) — resolveSeedPlan()'s actor is
 * only ever asked for GRO, and getPersona('lme') is asked separately for
 * whoever holds PGR_LME, so the two steps below log in as different
 * principals there without either knowing it's happening.
 *
 * The UI's own Assign-Complaint picker chooses the assignee (department-
 * grouped, first option) — this file never needs the specific uuid
 * resolveSeedPlan() computed for API-driven seeding, only that plan.serviceCode
 * is one the deployment can actually assign, which is exactly what
 * resolveSeedPlan() guarantees.
 */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { BASE_URL } from '../utils/env';
import { resolveSeedPlan, getPersona, type ResolvedPersona } from '../utils/personas';
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
let lmeUser = '';
let lmePass = '';
let srid = '';
let setupSkip = '';

test.beforeAll(async () => {
  const plan = await resolveSeedPlan();
  if ('error' in plan) { setupSkip = plan.error; return; }
  actorUser = plan.actor.username;
  actorPass = plan.actor.password;
  reader = toPrincipal(plan.actor);

  try {
    // getPersona throws (rather than returning null) when nobody on this
    // deployment carries PGR_LME — caught below and reported as a normal
    // skip reason, same as every other setup failure in this block.
    const lme = await getPersona('lme');
    lmeUser = lme.username;
    lmePass = lme.password;

    const created = await seedComplaintAsCitizen({ description: `lifecycle-ui seed ${new Date().toISOString()}` });
    srid = created.srid;
    if (created.status !== 'PENDINGFORASSIGNMENT') {
      setupSkip = `seed landed at ${created.status}, not PENDINGFORASSIGNMENT`;
    }
  } catch (err: any) {
    setupSkip = `seed failed: ${err?.message?.slice(0, 200)}`;
  }
});

/** Fresh browser context + page logged in as `user`, opened on the complaint
 *  detail page. A dedicated context per principal guarantees the session
 *  actually switches (re-injecting localStorage on a live SPA page does not
 *  reliably swap the logged-in employee). */
async function openDetailsAs(browser: Browser, user: string, pass: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const ok = await loginEmployeeBrowser(page, user, pass);
  test.skip(!ok, `login failed for ${user}`);
  await page.goto(`${BASE_URL}/digit-ui/employee/pgr/complaint-details/${srid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('.digit-viewcard-field-pair, .v2-pgr-details').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(3_000);
  return page;
}

async function timelineText(page: Page): Promise<string> {
  await expect(page.getByText('Complaint Timeline', { exact: true })).toBeVisible({ timeout: 10_000 });
  return (await page.locator('body').innerText());
}

test.describe('employee PGR lifecycle through the Take-Action UI', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('ASSIGN (GRO) → PENDINGATLME, then RESOLVE (LME) → RESOLVED @p0', async ({ browser }) => {
    test.skip(!!setupSkip, setupSkip);
    expect(srid).not.toBe('');

    const assignComment = `UI-ASSIGN ${Date.now()}`;
    const resolveComment = `UI-RESOLVE ${Date.now()}`;

    // ---------- 1. ASSIGN as GRO ----------
    let page = await openDetailsAs(browser, actorUser, actorPass);
    expect(await apiStatus(reader!, srid)).toBe('PENDINGFORASSIGNMENT');

    await takeAction(page, /^assign$/i);
    await expect(page.getByText(/Assign Complaint|CS_ACTION_ASSIGN/i).first()).toBeVisible({ timeout: 10_000 });

    // Pick the (first) LME assignee from the department-grouped picker.
    const empInput = page.locator('.digit-dropdown-employee-select-wrap input[type="text"]').first();
    await empInput.click();
    await page.waitForTimeout(800);
    const empOption = page.locator('.main-option').first();
    if (await empOption.count()) await empOption.click();
    else { await empInput.press('ArrowDown'); await empInput.press('Enter'); }
    await page.waitForTimeout(500);

    await page.locator('textarea').first().fill(assignComment);
    await page.getByRole('button', { name: /^SUBMIT$|^Submit$/ }).first().click();

    await expect.poll(async () => apiStatus(reader!, srid), { timeout: 25_000, intervals: [1500] })
      .toBe('PENDINGATLME');

    // Comment on the timeline.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000);
    expect(await timelineText(page)).toContain(assignComment);
    await page.context().close();

    // ---------- 2. RESOLVE as LME (fresh session) ----------
    page = await openDetailsAs(browser, lmeUser, lmePass);
    await takeAction(page, /^resolve$/i);
    await expect(page.getByText(/PGR_ACTION_RESOLVE|Resolve Complaint|Resolve/i).first()).toBeVisible({ timeout: 10_000 });
    await page.locator('textarea').first().fill(resolveComment);
    await page.getByRole('button', { name: /^SUBMIT$|^Submit$/ }).first().click();

    await expect.poll(async () => apiStatus(reader!, srid), { timeout: 25_000, intervals: [1500] })
      .toBe('RESOLVED');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000);
    expect(await timelineText(page)).toContain(resolveComment);
    await page.context().close();
  });
});
