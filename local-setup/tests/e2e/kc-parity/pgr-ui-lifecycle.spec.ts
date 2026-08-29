/**
 * PGR lifecycle, UI ONLY — raise → assign → resolve.
 *
 * Every step is performed by clicking through the SPA; nothing is done over the
 * API. That is the point: it is the only way to prove the Keycloak build really
 * behaves like the default one, because the adapter changes what the browser
 * holds and how each XHR is authorised.
 *
 * BASE_URL is required — this suite files, assigns and resolves a REAL complaint
 * on whatever it points at, so it self-skips rather than defaulting to a host:
 *   BASE_URL=https://<native-auth-deployment> npx playwright test pgr-ui-lifecycle
 *   BASE_URL=https://<keycloak-deployment>    npx playwright test pgr-ui-lifecycle
 * Run the same spec unmodified against both; any difference is an auth-path bug.
 *
 * Iterating on steps 2/3 only? Pass CID=<existing complaint> to skip the wizard.
 *
 * Env: CITIZEN_MOBILE, OTP, EMP_USER, EMP_PASS, EMP_CITY, AREA_MATCH, CID,
 *      ASSIGNEE_MATCH, RESOLVER_USER, RESOLVER_PASS
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

/**
 * Token transport audit (inert unless TOKEN_AUDIT=<path.json> is set).
 *
 * Rides the real lifecycle rather than a synthetic flow, so it reports what the
 * browser actually sends on every DIGIT call across all three steps. Under
 * Keycloak the browser should hold a JWT and token-exchange-svc should swap it
 * for a DIGIT uuid upstream; under native auth the browser holds the uuid itself.
 */
const AUDIT = process.env.TOKEN_AUDIT;
const audit: Array<Record<string, unknown>> = [];
let auditStep = '';

function tokenShape(t?: string | null): 'none' | 'jwt' | 'uuid' | 'other' {
  if (!t) return 'none';
  if (/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(t)) return 'jwt';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return 'uuid';
  return 'other';
}

const BASE = (process.env.BASE_URL || 'http://localhost:18080').replace(/\/$/, '');
const MOBILE = process.env.CITIZEN_MOBILE || '712345678';
const OTP = process.env.OTP || '123456';
const EMP_USER = process.env.EMP_USER || 'ADMIN';
const EMP_PASS = process.env.EMP_PASS || 'eGov@123';
const EMP_CITY = process.env.EMP_CITY || 'Bomet County';
// Whoever resolves must be the complaint's assignee, so by default the same
// officer assigns it to themselves and then resolves it.
const RESOLVER_USER = process.env.RESOLVER_USER || EMP_USER;
const RESOLVER_PASS = process.env.RESOLVER_PASS || EMP_PASS;

/**
 * The registered employee routes are `pgr/inbox-v2` and `pgr/complaint-details/:id`.
 * `pgr/inbox` and `pgr/complaint/details/:id` are NOT routes — an unmatched
 * PrivateRoute renders the chrome and a breadcrumb and nothing else, which looks
 * exactly like a broken screen. Keep these in one place so that never recurs.
 */
const detailUrl = (id: string) => `${BASE}/digit-ui/employee/pgr/complaint-details/${id}`;
const inboxUrl = `${BASE}/digit-ui/employee/pgr/inbox-v2`;

test.describe.configure({ mode: 'serial' });

let complaintId = process.env.CID || '';

async function citizenLogin(page: Page) {
  await page.goto(`${BASE}/digit-ui/citizen/login`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(5000);
  await page.locator('input[type="tel"], input[name="mobileNumber"]').first().fill(MOBILE);
  await page.locator('button:has-text("Continue"), button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  const boxes = page.locator('input[type="tel"], input[maxlength="1"]');
  const n = await boxes.count();
  if (n >= 6) { for (let i = 0; i < 6; i++) await boxes.nth(i).fill(OTP[i]); }
  else if (n >= 1) { await boxes.first().fill(OTP); }
  const next = page.locator('button:has-text("Continue"), button:has-text("Verify"), button[type="submit"]').first();
  if (await next.count()) await next.click();
  await page.waitForTimeout(10_000);
}

async function employeeLogin(page: Page, user = EMP_USER, pass = EMP_PASS) {
  await page.goto(`${BASE}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(6000);
  await page.locator('#emp-username, input[name="username"]').first().fill(user);
  await page.locator('#emp-password, input[name="password"]').first().fill(pass);
  const cityBtn = page.locator('button:has-text("Select city")').first();
  if (await cityBtn.count()) {
    await cityBtn.click();
    await page.waitForTimeout(1200);
    await page.locator(`li:has-text("${EMP_CITY}")`).first().click({ timeout: 8000 });
  }
  // React-controlled checkbox: only a click on the <label> toggles it
  const lbl = page.locator('label[for="privacy-component-check"]').first();
  if (await lbl.count()) await lbl.click();
  await page.waitForTimeout(800);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(12_000);
  // first-login language interstitial
  for (let i = 0; i < 3 && /language-selection/.test(page.url()); i++) {
    const lang = page.locator('button:has-text("English")').first();
    if (await lang.count()) { await lang.click(); await page.waitForTimeout(800); }
    const cont = page.locator('button:has-text("Continue")').first();
    if (await cont.count()) await cont.click();
    await page.waitForTimeout(7000);
  }
  expect(page.url(), 'employee should be logged in').not.toContain('/user/login');
}

/**
 * The complaint form is an N-level cascade (AUTHORITY_TYPE -> MAIN_CATEGORY ->
 * SECTOR -> SUB_TYPE) rendered as <button>s reading "Select…"; each level only
 * becomes selectable once its parent is chosen. Later steps read "Select County",
 * so the matcher has to allow a trailing word, not just the ellipsis.
 */
async function fillCascade(page: Page, match?: RegExp, maxLevels = 6): Promise<string[]> {
  const picked: string[] = [];
  for (let level = 0; level < maxLevels; level++) {
    const trigger = page.locator('button', { hasText: /^Select(…|\s|$)/ }).first();
    if (!(await trigger.count())) break;
    if (!(await trigger.isEnabled().catch(() => false))) break;
    await trigger.click();
    await page.waitForTimeout(1200);

    const opts = page.locator('li, [role="option"], .digit-dropdown-item');
    const count = await opts.count();
    if (!count) break;

    let idx = 0;
    if (match) {
      for (let i = 0; i < count; i++) {
        const t = (await opts.nth(i).innerText().catch(() => '')) || '';
        if (match.test(t)) { idx = i; break; }
      }
    }
    const label = ((await opts.nth(idx).innerText().catch(() => '')) || '').trim();
    await opts.nth(idx).click();
    await page.waitForTimeout(1800);
    picked.push(label);
  }
  return picked;
}

/**
 * Drive the whole FormComposer wizard generically instead of hardcoding a step
 * order: at each screen fill whatever it asks for (cascade selects, postal code,
 * landmark, description), then press NEXT — and SUBMIT on the last screen. The
 * wizard's shape is tenant-configurable, so this survives config changes.
 */
async function advanceWizard(page: Page, description: string, maxSteps = 10) {
  for (let step = 0; step < maxSteps; step++) {
    // 1. any cascade on this screen. Prefer a Bomet-matching option so the
    // complaint lands inside the officers' jurisdiction — otherwise it is filed
    // in whatever boundary happens to be first and no inbox will ever show it.
    await fillCascade(page, new RegExp(process.env.AREA_MATCH || 'bomet', 'i')).catch(() => []);

    // 2. required free-text fields
    const postal = page.locator('#postal-code');
    if (await postal.count() && !(await postal.inputValue().catch(() => ''))) {
      await postal.fill(process.env.POSTAL || '20400');
    }
    const landmark = page.locator('#landmark');
    if (await landmark.count() && !(await landmark.inputValue().catch(() => ''))) {
      await landmark.fill('Near the market');
    }
    const ta = page.locator('textarea').first();
    if (await ta.count() && !(await ta.inputValue().catch(() => ''))) {
      await ta.fill(description);
    }
    await page.waitForTimeout(1200);

    // 3. advance
    const btn = page.locator('button').filter({ hasText: /^(NEXT|SUBMIT|CS_COMMON_NEXT|CS_COMMON_SUBMIT)$/i }).last();
    if (!(await btn.count())) break;
    const label = ((await btn.innerText().catch(() => '')) || '').trim();
    if (!(await btn.isEnabled().catch(() => false))) {
      const txt = (await page.locator('body').innerText()).slice(0, 200).replace(/\n+/g, ' | ');
      throw new Error(`wizard stuck: "${label}" disabled at step ${step}. Screen: ${txt}`);
    }
    await btn.click();
    await page.waitForTimeout(6500);

    if (/complaint\/response|success/i.test(page.url())) break;
    const body = await page.locator('body').innerText();
    if (/[A-Z]{2}-[A-Z]+-\d{4}-\d{2}-\d{2}-\d+/.test(body)) break;
  }
}

/** The detail page renders the workflow state as a localised label, not a code. */
async function currentStatus(page: Page): Promise<string> {
  const body = await page.locator('body').innerText();
  const m = body.match(/Current Status\s*\n\s*([^\n]+)/);
  return (m ? m[1] : '').trim();
}

async function openDetail(page: Page, id: string) {
  await page.goto(detailUrl(id), { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(11_000);
  await expect(
    page.locator('button').filter({ hasText: /Take action|CS_COMMON_TAKE_ACTION/i }).first(),
    'the complaint detail screen must render a Take action button'
  ).toBeVisible({ timeout: 30_000 });
}

/** Open "Take action" and pick one of Reject / Assign / Escalate / Resolve. */
async function chooseAction(page: Page, action: RegExp) {
  await page.locator('button').filter({ hasText: /Take action|CS_COMMON_TAKE_ACTION/i }).first().click();
  await page.waitForTimeout(1800);
  const options = page.locator('.header-dropdown-option');
  const labels: string[] = [];
  const n = await options.count();
  for (let i = 0; i < n; i++) labels.push(((await options.nth(i).innerText().catch(() => '')) || '').trim());
  const idx = labels.findIndex((l) => action.test(l));
  expect(idx, `action ${action} must be offered. Menu had: ${labels.join(', ') || '(empty)'}`).toBeGreaterThanOrEqual(0);
  await options.nth(idx).click();
  await page.waitForTimeout(4000);
  return labels;
}

/** Fill and submit the workflow modal; returns nothing, throws with the screen on failure. */
async function submitModal(page: Page, comment: string, assigneeMatch?: RegExp) {
  const modal = page.locator('.popup-module');
  await modal.waitFor({ state: 'visible', timeout: 25_000 });

  const assignee = modal.locator('.assignee-dropdown-container');
  if (await assignee.count()) {
    await assignee.locator('input').first().click();
    await page.waitForTimeout(2000);
    const opts = page.locator('.digit-dropdown-item, .employee-select-wrap li, li');
    const count = await opts.count();
    expect(count, 'an eligible assignee must exist for this complaint type\'s department').toBeGreaterThan(0);
    let idx = 0;
    if (assigneeMatch) {
      for (let i = 0; i < count; i++) {
        const t = (await opts.nth(i).innerText().catch(() => '')) || '';
        if (assigneeMatch.test(t)) { idx = i; break; }
      }
    }
    console.log(`  assignee: ${((await opts.nth(idx).innerText().catch(() => '')) || '').trim()}`);
    await opts.nth(idx).click();
    await page.waitForTimeout(1200);
  }

  const comments = modal.locator('textarea').first();
  if (await comments.count()) await comments.fill(comment);
  await page.waitForTimeout(600);

  const submit = modal.locator('button').filter({ hasText: /^(SUBMIT|Submit|CS_COMMON_SUBMIT)$/ }).first();
  if (!(await submit.isEnabled().catch(() => false))) {
    const txt = (await modal.innerText()).slice(0, 300).replace(/\n+/g, ' | ');
    throw new Error(`modal SUBMIT disabled. Modal: ${txt}`);
  }
  await submit.click();
  await page.waitForTimeout(14_000);
}

test.describe('PGR lifecycle via UI only', () => {
  // This suite files, assigns and resolves a REAL complaint on whatever it is
  // pointed at, so it must never run by accident against a default host.
  test.skip(
    () => !process.env.BASE_URL,
    'Set BASE_URL to a running DIGIT deployment — this suite writes a real complaint',
  );

  test.beforeEach(async ({ page }, info) => {
    if (!AUDIT) return;
    auditStep = info.title.split('—')[0].trim();
    page.on('response', (res) => {
      const req = res.request();
      if (req.method() !== 'POST') return;
      let path = '';
      try { path = new URL(res.url()).pathname; } catch { return; }
      if (/\.(js|css|png|jpe?g|svg|woff2?|ico|map)$/.test(path)) return;

      let bodyTok: string | null = null;
      try {
        const j = JSON.parse(req.postData() || '{}');
        bodyTok = (j && j.RequestInfo && j.RequestInfo.authToken) || null;
      } catch { /* not JSON */ }

      const auth = req.headers()['authorization'] || '';
      audit.push({
        step: auditStep,
        path,
        status: res.status(),
        header: tokenShape(auth.replace(/^Bearer\s+/i, '')),
        body: tokenShape(bodyTok),
      });
    });
  });

  test.afterAll(() => {
    if (AUDIT) fs.writeFileSync(AUDIT, JSON.stringify(audit, null, 1));
  });

  test('1 — citizen files a complaint through the wizard', async ({ page }) => {
    test.setTimeout(300_000);
    test.skip(!!process.env.CID, 'CID supplied — reusing an existing complaint');

    await citizenLogin(page);
    expect(page.url(), 'citizen should be logged in').not.toContain('/citizen/login');

    await page.goto(`${BASE}/digit-ui/citizen/pgr/create-complaint`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForTimeout(9000);

    await advanceWizard(page, `UI lifecycle probe ${Date.now()}`);
    await page.waitForTimeout(6000);

    const body = await page.locator('body').innerText();
    const m = body.match(/[A-Z]{2}-[A-Z]+-\d{4}-\d{2}-\d{2}-\d+/);
    expect(m, `complaint id should appear on the response screen. Got: ${body.slice(0, 300)}`).toBeTruthy();
    complaintId = m![0];
    console.log(`  filed: ${complaintId}`);
  });

  test('2 — employee finds it in the inbox and assigns it', async ({ page }) => {
    test.setTimeout(360_000);
    expect(complaintId, 'needs a complaint from step 1 (or CID=)').toBeTruthy();
    await employeeLogin(page);

    // Reach the complaint the way an officer does. inbox-v2 opens on the "My
    // Complaints" tab, which is empty until something is assigned to you, so an
    // unassigned complaint only appears under "All Complaints".
    await page.goto(inboxUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForTimeout(12_000);
    const allTab = page.locator('div, button, li, span').filter({ hasText: /^(All Complaints|ALL)$/i }).first();
    if (await allTab.count()) {
      await allTab.click({ force: true });
      await page.waitForTimeout(10_000);
    }
    const links = page.locator(`a[href*="complaint-details"]`);
    expect(await links.count(), 'the All Complaints tab must list complaints').toBeGreaterThan(0);

    await openDetail(page, complaintId);
    expect(await currentStatus(page), 'a fresh complaint starts unassigned').toMatch(/Pending for assignment/i);

    await chooseAction(page, /Assign/i);
    // Assign to the acting officer where possible, so the same session can
    // resolve it in step 3 without provisioning a second account.
    await submitModal(page, 'assigned via UI lifecycle probe', new RegExp(process.env.ASSIGNEE_MATCH || EMP_USER, 'i'));

    await openDetail(page, complaintId);
    const status = await currentStatus(page);
    console.log(`  after assign: ${status}`);
    expect(status, 'assignment should move it out of Pending for assignment').not.toMatch(/Pending for assignment/i);
    expect(status).toMatch(/Pending at|Assigned/i);
  });

  test('3 — the assignee resolves it', async ({ page }) => {
    test.setTimeout(360_000);
    expect(complaintId).toBeTruthy();
    await employeeLogin(page, RESOLVER_USER, RESOLVER_PASS);
    await openDetail(page, complaintId);

    await chooseAction(page, /Resolve/i);
    // The resolve modal has no assignee picker, just comments.
    await submitModal(page, 'resolved via UI lifecycle probe');

    await openDetail(page, complaintId);
    const status = await currentStatus(page);
    console.log(`  ${complaintId} final status: ${status}`);
    expect(status, 'complaint should be resolved').toMatch(/Resolved/i);
  });
});
