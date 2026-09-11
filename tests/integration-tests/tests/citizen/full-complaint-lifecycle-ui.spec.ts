/**
 * PGR Lifecycle — UI-only
 *
 * Tests the complete PGR complaint lifecycle using only browser interactions:
 *   1. Citizen logs in via OTP (UI)
 *   2. Citizen creates complaint via wizard (UI)
 *   3. Admin sees complaint in inbox (UI)
 *   4. Admin assigns complaint (UI — Take Action modal)
 *   5. Admin resolves complaint (UI — Take Action modal)
 *   6. Citizen sees resolved complaint (UI)
 *
 * Run: npx playwright test tests/specs/pgr-lifecycle-ui.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { getDigitToken, loginViaApi } from '../utils/auth';
import { citizenOtpLogin } from '../utils/citizen-login';
import { getPersona } from '../utils/personas';
import {
  BASE_URL, TENANT, ROOT_TENANT,
  ADMIN_USER, ADMIN_PASS, FIXED_OTP,
  DEFAULT_PASSWORD, PGR_ID_PREFIX,
  generateCitizenPhone,
} from '../utils/env';

import * as fs from 'fs';
import * as path from 'path';

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/pgr-lifecycle-ui-screenshots';
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function snap(page: Page, name: string) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`Screenshot: ${filePath}`);
}

const CITIZEN_PHONE = generateCitizenPhone();
const CITIZEN_NAME = 'E2E UI Citizen';

/**
 * The employee who drives Take Action in steps 3-5. Resolved by CAPABILITY, not
 * by name: the requirement is "can act on this complaint's workflow", which
 * means the GRO role plus an HRMS department at the complaint's own tenant.
 *
 * A pinned name cannot express that and gets it wrong in both directions:
 * bomet's deploy/bomet.env pins CITY_ADMIN_USER=BOMET_LME, which has NO HRMS
 * employee record on `ke` at all — so it logs in fine, never gets a Take Action
 * button, and step 4 fails 10s later on a missing locator that says nothing
 * about the cause. The bare ADMIN default fares no better there (also no HRMS
 * record). getPersona('gro-with-department') finds HS_GRO on bomet and EMP001 on
 * mz.maputo without either deployment declaring anything.
 *
 * CITY_ADMIN_USER still wins when set, so an operator can pin a specific actor.
 *
 * `authTenant` is part of the answer, not an afterthought. personas.ts probes
 * each credential at the city tenant and at the root, and reports the one it
 * PROVED the login works at. Dropping that and hard-coding TENANT at the call
 * site only happens to work while the resolved GRO is a city employee (EMP001
 * on mz.maputo, HS_GRO on bomet, where city and root are the same tenant
 * anyway); a GRO that authenticates only at the root would fail both the inbox
 * and the Assign login for a reason no locator error would explain. Step 5
 * already threads `resolver.tenant` through — this is the same fact.
 *
 * Undefined for the CITY_ADMIN_USER branch: nobody proved anything about a
 * pinned credential, so the caller keeps its existing default.
 */
async function cityAdmin(): Promise<{ username: string; password: string; authTenant?: string }> {
  if (process.env.CITY_ADMIN_USER) {
    return {
      username: process.env.CITY_ADMIN_USER,
      password: process.env.CITY_ADMIN_PASS || DEFAULT_PASSWORD,
    };
  }
  const p = await getPersona('gro-with-department');
  return { username: p.username, password: p.password, authTenant: p.tenant };
}

/**
 * The employee who drives Take Action → Resolve in step 5.
 *
 * Deliberately NOT cityAdmin(): the two steps are gated on different roles.
 * Every deployment we test declares
 *
 *   ASSIGN  : [GRO, PGR_VIEWER]
 *   RESOLVE : [PGR_LME, PGR_VIEWER]
 *
 * and egov-workflow-v2 computes the Take Action menu from the CALLER's roles,
 * so the Resolve option simply never renders for a GRO who holds no PGR_LME.
 * Only mz.maputo happens to have one employee (EMP001: GRO + PGR_LME) covering
 * both, which is why driving all of steps 3-5 as one person passed here and
 * failed on bomet, where the GRO is HS_GRO (roles: [GRO] — nothing else) and
 * step 5 timed out on a Resolve option that was never coming. That is the same
 * "the actor and the assignee are necessarily different people" fact the seed
 * plan already encodes; see personas.ts's persona-triple comment.
 *
 * getPersona('lme') is the same resolution escalate-action-521.spec.ts uses to
 * drive its own Take Action, for the same reason.
 */
async function resolverPersona() {
  return getPersona('lme');
}

/** Fetch complaint status via API (verification helper — not a "UI under test" action). */
async function fetchComplaintStatus(serviceRequestId: string): Promise<string> {
  const tokenResp = await getDigitToken({
    tenant: ROOT_TENANT,
    username: ADMIN_USER,
    password: ADMIN_PASS,
  });
  const resp = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${serviceRequestId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenResp.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: tokenResp.access_token, userInfo: tokenResp.UserRequest } }),
    },
  );
  const data: any = await resp.json();
  return data.ServiceWrappers[0].service.applicationStatus;
}

test.describe.serial('PGR lifecycle — UI only', () => {
  test.slow();

  let serviceRequestId: string;
  let citizenLoggedIn = false;
  let complaintCreated = false;

  // ─── 1. Citizen logs in via UI (OTP flow) ───────────────────────────

  test('1 — citizen logs in via UI with fixed OTP', {
    annotation: {
      type: 'description',
      description: `Drives the citizen OTP login flow through the actual login form (no API shortcut). Confirms the auto-register-on-first-login behavior works end-to-end: a brand-new phone number can sign in with the mock OTP "123456" and walk straight into the citizen home page with a Citizen.token in localStorage.

Steps:
1. citizenOtpLogin(page, CITIZEN_PHONE) — UI helper that drives the phone form, OTP form, and language/city pickers.
2. Read localStorage 'Citizen.token'; assert it's truthy.
3. Set citizenLoggedIn flag, snap screenshot 01-citizen-logged-in.

First link in a 6-step UI lifecycle. Marked test.slow() at the describe level — UI flow with multiple page hydrations.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    await citizenOtpLogin(page, CITIZEN_PHONE);

    const token = await page.evaluate(() => localStorage.getItem('Citizen.token'));
    expect(token).toBeTruthy();
    citizenLoggedIn = true;
    await snap(page, '01-citizen-logged-in');
    console.log(`Citizen ${CITIZEN_PHONE} logged in via UI, URL: ${page.url()}`);
  });

  // ─── 2. Citizen creates complaint via UI wizard ─────────────────────

  test('2 — citizen creates complaint via UI wizard', {
    annotation: {
      type: 'description',
      description: `Drives the full citizen file-complaint wizard through the UI and captures the resulting serviceRequestId both via response interception and a fallback regex on the response page. Heavy spec — exercises type/subtype dropdowns, geolocation skip, address selection (radios for <5 localities, dropdowns for 5+), description, and final submit.

Steps:
1. test.skip if citizen wasn't logged in.
2. setTimeout 180s; re-login via UI.
3. Install a route handler on /pgr-services/v2/request/_create to capture the response body's serviceRequestId.
4. Navigate to /digit-ui/citizen/pgr/create-complaint and wait 8s for hydration.
5. Step 0: select complaint type (and subtype if a second dropdown appears) → NEXT.
6. Step 1: skip geolocation → NEXT.
7. Step 2: skip location details → NEXT.
8. Step 3: select address — try city radios first, then locality radios or dropdown depending on count; throw if no locality option appears.
9. Step 4: fill description textarea with an ISO timestamp; NEXT.
10. Step 5: click SUBMIT, wait for /pgr/response URL, snap final screenshot.
11. Pull serviceRequestId from the captured response or fall back to scraping the response page.
12. Assert serviceRequestId is truthy; set complaintCreated.

Long timeout (180s) because of multiple boundary lookups and DOM settles. Catches a regression where the boundary mismatch leaves locality dropdowns empty (CCRS#477).`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    test.skip(!citizenLoggedIn, 'citizen not logged in');
    test.setTimeout(180_000);

    // Login again (fresh page context)
    await citizenOtpLogin(page, CITIZEN_PHONE);
    const token = await page.evaluate(() => localStorage.getItem('Citizen.token'));
    expect(token).toBeTruthy();

    // Intercept PGR _create to capture serviceRequestId
    let capturedId: string | null = null;
    await page.route('**/pgr-services/v2/request/_create**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      try { capturedId = body?.ServiceWrappers?.[0]?.service?.serviceRequestId ?? null; } catch {}
      await route.fulfill({ response });
    });

    page.on('console', (msg) => { if (msg.type() === 'error') console.log(`[CONSOLE ERROR] ${msg.text()}`); });
    page.on('pageerror', (err) => console.log(`[PAGE ERROR] ${err.message}`));

    // Navigate to complaint creation wizard
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/create-complaint`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(8000);

    // Helper: click NEXT or SUBMIT
    const clickNextOrSubmit = async (label = 'NEXT') => {
      const btn = page.locator('button[type="button"], button[type="submit"]')
        .filter({ hasText: new RegExp(label, 'i') }).first();
      await btn.waitFor({ state: 'visible', timeout: 10_000 });
      await btn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await btn.click();
      await page.waitForTimeout(5000);
    };

    // Cross-build dropdown locator. The modern digit-ui (CreatePGRFlowV2)
    // renders each hierarchy level as a shadcn <button role="combobox">;
    // older builds used input.digit-dropdown-employee-select-wrap--elipses.
    // Matching only the legacy input made this spec time out on the v2 build
    // (the wizard was never touched, so NEXT stayed disabled). Match both.
    const wizardDropdowns = page.locator(
      'button[role="combobox"], input.digit-dropdown-employee-select-wrap--elipses',
    );
    const optionLocator = () =>
      page.locator(
        '[role="listbox"][data-state="open"] [role="option"], [role="option"]:visible, .digit-dropdown-item:visible',
      );

    // Helper: select dropdown option
    const selectDropdownOption = async (index: number) => {
      const dropdown = wizardDropdowns.nth(index);
      await dropdown.waitFor({ state: 'visible', timeout: 10_000 });
      await dropdown.click();
      await page.waitForTimeout(1000);
      const items = optionLocator();
      const count = await items.count();
      console.log(`Dropdown ${index}: ${count} items`);
      await items.first().click();
      await page.waitForTimeout(500);
    };

    // Walk a depth-agnostic dropdown cascade. Used for both the complaint-type
    // levels and the boundary levels: depth is tenant-defined (complaint types
    // are 2 levels on mz.maputo vs 4 on ke; boundaries are 4 on MAPUTO_ADMIN —
    // Município > Distrito Municipal > Bairro > Quarteirão), each child renders
    // disabled until the parent's lookup lands, and every level carrying options
    // is mandatory — so NEXT only enables once the deepest is picked.
    const walkCascade = async (firstLevelTimeout = 10_000) => {
      for (let level = 0; level < 8; level++) {
        const combobox = wizardDropdowns.nth(level);
        const visible = await combobox
          .isVisible({ timeout: level === 0 ? firstLevelTimeout : 3000 })
          .catch(() => false);
        if (!visible) break;
        await expect(combobox).toBeEnabled({ timeout: 8000 }).catch(() => {});
        if (!(await combobox.isEnabled().catch(() => false))) break;
        // "Is this level still unselected?" — asked differently per build,
        // because the two builds keep the answer in different places. The v2
        // combobox is a <button> whose innerText is the chosen label (or
        // "Select ..."), but the legacy control is an <input>, and innerText is
        // ALWAYS "" on an <input> — so a single innerText test silently reports
        // every legacy dropdown as already-selected, skips the click, and
        // leaves NEXT disabled until the step times out. Read `value` there.
        const hasPlaceholder = await combobox
          .evaluate((el) => {
            if (el instanceof HTMLInputElement) {
              const chosen = el.value.trim();
              return !chosen || /^Select/i.test(chosen);
            }
            return /^Select/i.test((el as HTMLElement).innerText.trim());
          })
          .catch(() => true);
        if (!hasPlaceholder) continue;
        await selectDropdownOption(level);
        await page.waitForTimeout(1500);
      }
    };

    // Step 0: Select complaint type.
    console.log('Step 0: Selecting complaint type...');
    await walkCascade();
    await snap(page, '02a-complaint-type');
    await clickNextOrSubmit('NEXT');

    // Step 1: Geolocation — skip
    console.log('Step 1: Geolocation — skipping...');
    await clickNextOrSubmit('NEXT');

    // Step 2: Location details — the boundary cascade lives here and its top
    // level is required (rendered with a `*`), so this step cannot be skipped:
    // clicking NEXT blind leaves the button disabled until the test times out.
    console.log('Step 2: Location details — walking boundary cascade...');
    await page.waitForTimeout(3000);
    await walkCascade(5000);
    await snap(page, '02a1-location-details');
    await clickNextOrSubmit('NEXT');

    // Step 3: Address — handle radio buttons (city) + locality
    console.log('Step 3: Selecting address...');
    await page.waitForTimeout(2000);

    const radioButtons = page.locator('input[type="radio"]');
    // Cross-build: v2 renders boundary levels as shadcn button comboboxes.
    const boundaryDropdowns = page.locator(
      'button[role="combobox"], input[class*="select-wrap--elipses"]',
    );

    if (await radioButtons.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      const radioCount = await radioButtons.count();
      console.log(`${radioCount} radio buttons found — selecting last (city-level)`);
      await radioButtons.last().click();

      // Wait for boundary API response and DOM update
      await page.waitForTimeout(8000);
      await snap(page, '02b-address-debug');

      let localitySelected = false;

      // Try waiting for new radio buttons (< 5 localities)
      try {
        const newRadio = page.locator('.radio-wrap input[type="radio"]').nth(radioCount);
        await newRadio.waitFor({ state: 'attached', timeout: 10_000 });
        const newRadioCount = await page.locator('.radio-wrap input[type="radio"]').count();
        if (newRadioCount > radioCount) {
          console.log(`${newRadioCount - radioCount} locality radio options appeared`);
          await page.locator('.radio-wrap input[type="radio"]').nth(radioCount).click();
          await page.waitForTimeout(500);
          localitySelected = true;
        }
      } catch { /* no new radios, try dropdown */ }

      // Try waiting for a dropdown (>= 5 localities)
      if (!localitySelected) {
        try {
          const localityDropdown = boundaryDropdowns;
          await localityDropdown.first().waitFor({ state: 'visible', timeout: 10_000 });
          const ddCount = await localityDropdown.count();
          console.log(`Locality dropdown appeared (${ddCount} matching)`);
          await localityDropdown.first().click();
          await page.waitForTimeout(1000);
          const items = optionLocator();
          const itemCount = await items.count();
          console.log(`Locality dropdown items: ${itemCount}`);
          if (itemCount > 0) {
            await items.first().click();
            await page.waitForTimeout(500);
            localitySelected = true;
          }
        } catch { /* no dropdown either */ }
      }

      if (!localitySelected) {
        console.log('No locality options loaded — boundary type mismatch likely');
        throw new Error('UI wizard blocked: locality options empty');
      }

      await snap(page, '02b-address');
      await clickNextOrSubmit('NEXT');
    } else if (await boundaryDropdowns.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      const dropdownCount = await boundaryDropdowns.count();
      console.log(`${dropdownCount} boundary dropdowns found`);
      for (let i = 0; i < dropdownCount; i++) {
        console.log(`Selecting boundary level ${i}...`);
        await selectDropdownOption(i);
        await page.waitForTimeout(2000);
      }
      await snap(page, '02b-address');
      await clickNextOrSubmit('NEXT');
    } else {
      // No address controls. On builds where the boundary cascade already lives
      // on Location Details (mz.maputo), there is no separate address step and
      // we are already on Description — clicking NEXT here would wait on a
      // button that stays disabled until Description is filled, hanging until
      // the test times out. Only advance if this really is an empty step.
      const onDescription = await page
        .locator('textarea')
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      if (onDescription) {
        console.log('No separate address step on this build — already at Description');
      } else {
        console.log('No address controls found — skipping');
        await clickNextOrSubmit('NEXT');
      }
    }

    // Step 4: Description
    console.log('Step 4: Filling description...');
    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 15_000 });
    await textarea.fill(`E2E UI lifecycle test — ${new Date().toISOString()}`);
    await clickNextOrSubmit('NEXT');

    // Step 5: Photo upload — submit
    console.log('Step 5: Submitting...');
    await clickNextOrSubmit('SUBMIT');

    // Wait for response page
    await page.waitForURL('**/pgr/response**', { timeout: 30_000 }).catch(() => {
      console.log('Did not redirect to /pgr/response, URL:', page.url());
    });
    await page.waitForTimeout(5000);

    // Extract serviceRequestId
    if (capturedId) {
      serviceRequestId = capturedId;
    } else {
      const bodyText = await page.locator('body').innerText();
      // Build the SRID regex from the deployment's own idgen prefix (PG on
      // maputo, NCCG on nairobi, …) — a hardcoded `PG-PGR` matched nothing on
      // any other deployment, leaving serviceRequestId undefined.
      const match = bodyText.match(new RegExp(`${PGR_ID_PREFIX}-PGR-\\d{4}-\\d{2}-\\d{2}-\\d{6}`));
      if (match) serviceRequestId = match[0];
    }

    expect(serviceRequestId).toBeTruthy();
    complaintCreated = true;
    await snap(page, '02c-complaint-created');
    console.log(`Complaint created via UI: ${serviceRequestId}`);
  });

  // ─── 3. Admin sees complaint in inbox (UI) ──────────────────────────

  test('3 — admin sees complaint in PGR inbox (UI)', {
    annotation: {
      type: 'description',
      description: `Logs in as the city-level admin (tenant = TENANT env) and confirms the PGR inbox page renders. Whether the freshly-created complaint is actually visible is logged but not asserted — boundary filters can legitimately hide it from the configured admin's scope, so the assertion stays at "the inbox page itself rendered".

Steps:
1. test.skip if !complaintCreated.
2. loginViaApi as CITY_ADMIN_USER on tenant = TENANT env.
3. Navigate to /digit-ui/employee/pgr/inbox and wait 15s for hydration.
4. Snap screenshot 03-pgr-inbox.
5. Assert the "Inbox" breadcrumb is visible (page rendered).
6. Log whether bodyText.includes(serviceRequestId) — informational only.

Doesn't assert the complaint appears in the inbox because legitimate boundary scoping can hide it; the test focuses on the inbox UI rendering at all.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    test.skip(!complaintCreated, 'complaint not created');

    // Resolved ONCE. Calling cityAdmin() per field re-entered persona
    // resolution for each of username and password.
    const admin = await cityAdmin();
    await loginViaApi(page, {
      tenant: TENANT,
      authTenant: admin.authTenant ?? TENANT,
      username: admin.username,
      password: admin.password,
    });

    await page.goto(`${BASE_URL}/digit-ui/employee/pgr/inbox`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(15_000);
    await snap(page, '03-pgr-inbox');

    // Verify the inbox page rendered
    const breadcrumb = page.locator('text=Inbox');
    await expect(breadcrumb.first()).toBeVisible({ timeout: 5_000 });

    const bodyText = await page.locator('body').innerText();
    if (bodyText.includes(serviceRequestId)) {
      console.log(`Complaint ${serviceRequestId} found in inbox`);
    } else {
      console.log(`Complaint ${serviceRequestId} not visible in inbox (may be filtered out by boundary config)`);
    }
  });

  // ─── 4. Admin assigns complaint via UI ──────────────────────────────

  test('4 — admin assigns complaint via UI', {
    annotation: {
      type: 'description',
      description: `Drives the Take Action → Assign flow on the complaint detail page entirely through the UI: open the complaint, click Take Action, pick Assign from the dropdown menu, fill the comments textarea in the modal, submit, then verify status flipped to PENDINGATLME via API (read-only verification).

Steps:
1. test.skip if !complaintCreated; setTimeout 120s.
2. loginViaApi as the city admin and navigate to /pgr/complaint-details/{srid}.
3. Assert the complaint ID appears in the body (correct page loaded).
4. Click the "Take Action" button.
5. Click the "Assign" header dropdown option.
6. Wait for the modal, fill its first textarea with "Assigned via E2E UI test".
7. Click SUBMIT inside the modal.
8. fetchComplaintStatus(srid) and assert applicationStatus === 'PENDINGATLME'.

Status verification is API-only because there's no good DOM signal that the assign succeeded — but every preceding interaction is UI-driven.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    test.skip(!complaintCreated, 'complaint not created');
    test.setTimeout(120_000);

    // Login as city-level admin (tenantId = TENANT env), authenticating at the
    // tenant personas.ts proved this credential works at — see cityAdmin().
    const admin = await cityAdmin();
    await loginViaApi(page, {
      tenant: TENANT,
      authTenant: admin.authTenant ?? TENANT,
      username: admin.username,
      password: admin.password,
    });

    // Navigate to complaint details
    console.log(`Navigating to complaint ${serviceRequestId}...`);
    await page.goto(`${BASE_URL}/digit-ui/employee/pgr/complaint-details/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(10_000);
    await snap(page, '04a-complaint-before-assign');

    // Verify complaint loaded
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain(serviceRequestId);

    // Click "Take Action" button
    console.log('Clicking Take Action...');
    const takeAction = page.locator('button').filter({ hasText: /take action|ES_COMMON_TAKE_ACTION/i });
    await expect(takeAction.first()).toBeVisible({ timeout: 10_000 });
    await takeAction.first().click();
    await page.waitForTimeout(2_000);

    // Click "Assign" in the dropdown menu
    console.log('Clicking Assign...');
    const assignOption = page.locator('.header-dropdown-option').filter({ hasText: /^Assign$/i });
    await expect(assignOption).toBeVisible({ timeout: 5_000 });
    await assignOption.click();
    await page.waitForTimeout(3_000);
    await snap(page, '04b-assign-modal');

    // Modal should be open
    const modal = page.locator('[class*="modal"], [class*="Modal"], .popup-module');
    await expect(modal.first()).toBeVisible({ timeout: 5_000 });
    console.log('Assign modal opened');

    // Fill in comments
    const commentsField = modal.locator('textarea').first();
    await expect(commentsField).toBeVisible({ timeout: 5_000 });
    await commentsField.fill('Assigned via E2E UI test');

    // Click SUBMIT
    console.log('Submitting assign...');
    const submitBtn = modal.locator('button').filter({ hasText: /submit/i });
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });
    await submitBtn.click();

    // Wait for the update to complete
    await page.waitForTimeout(8_000);
    await snap(page, '04c-after-assign');

    // Verify status changed via API
    const status = await fetchComplaintStatus(serviceRequestId);
    expect(status).toBe('PENDINGATLME');
    console.log(`UI assign successful: ${serviceRequestId} → PENDINGATLME`);
  });

  // ─── 5. Admin resolves complaint via UI ─────────────────────────────

  test('5 — admin resolves complaint via UI', {
    annotation: {
      type: 'description',
      description: `Sibling of step 4 — drives Take Action → Resolve through the UI and confirms the complaint flips to RESOLVED. The post-condition for the lifecycle (citizen-side step 6 then asserts visibility on the citizen complaints page).

Steps:
1. test.skip if !complaintCreated; setTimeout 120s.
2. loginViaApi as city admin; navigate to complaint detail page.
3. Click "Take Action".
4. Click the "Resolve" header dropdown option.
5. Fill modal's first textarea with "Resolved via E2E UI test".
6. Click SUBMIT.
7. fetchComplaintStatus(srid) and assert applicationStatus === 'RESOLVED'.

API-only verification of status follows the same pattern as step 4 — UI flow is exercised in full.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    test.skip(!complaintCreated, 'complaint not created');
    test.setTimeout(120_000);

    // Log in as someone the workflow will actually offer Resolve to (PGR_LME),
    // not the GRO who did the ASSIGN — see resolverPersona().
    const resolver = await resolverPersona();
    await loginViaApi(page, {
      tenant: TENANT,
      authTenant: resolver.tenant,
      username: resolver.username,
      password: resolver.password,
    });

    // Navigate to complaint details
    console.log(`Navigating to complaint ${serviceRequestId} as ${resolver.username} (roles: ${resolver.roles.join('|')})...`);
    await page.goto(`${BASE_URL}/digit-ui/employee/pgr/complaint-details/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(10_000);
    await snap(page, '05a-complaint-before-resolve');

    // Click "Take Action"
    console.log('Clicking Take Action...');
    const takeAction = page.locator('button').filter({ hasText: /take action|ES_COMMON_TAKE_ACTION/i });
    await expect(takeAction.first()).toBeVisible({ timeout: 10_000 });
    await takeAction.first().click();
    await page.waitForTimeout(2_000);

    // Click "Resolve" in the dropdown menu
    console.log('Clicking Resolve...');
    const resolveOption = page.locator('.header-dropdown-option').filter({ hasText: /^Resolve$/i });
    await expect(
      resolveOption,
      `Resolve must be offered to ${resolver.username} (roles: ${resolver.roles.join('|')}). The workflow builds this menu from the caller's roles, so an empty menu here means this persona holds none of RESOLVE's roles — not that the UI is broken.`,
    ).toBeVisible({ timeout: 5_000 });
    await resolveOption.click();
    await page.waitForTimeout(3_000);
    await snap(page, '05b-resolve-modal');

    // Modal should be open
    const modal = page.locator('[class*="modal"], [class*="Modal"], .popup-module');
    await expect(modal.first()).toBeVisible({ timeout: 5_000 });
    console.log('Resolve modal opened');

    // Fill in comments
    const commentsField = modal.locator('textarea').first();
    await expect(commentsField).toBeVisible({ timeout: 5_000 });
    await commentsField.fill('Resolved via E2E UI test');

    // Click SUBMIT
    console.log('Submitting resolve...');
    const submitBtn = modal.locator('button').filter({ hasText: /submit/i });
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });
    await submitBtn.click();

    // Wait for the update to complete
    await page.waitForTimeout(8_000);
    await snap(page, '05c-after-resolve');

    // Verify status changed via API
    const status = await fetchComplaintStatus(serviceRequestId);
    expect(status).toBe('RESOLVED');
    console.log(`UI resolve successful: ${serviceRequestId} → RESOLVED`);
  });

  // ─── 6. Citizen sees resolved complaint on complaints page (UI) ─────

  test('6 — citizen sees resolved complaint on complaints page (UI)', {
    annotation: {
      type: 'description',
      description: `Final step: re-login as the citizen (different browser context, fresh cookies/localStorage) and confirm the resolved complaint appears on the citizen's My Complaints page. Tries a "Resolved/Closed/All" tab fallback if the default view doesn't list the complaint, then asserts visibility.

Steps:
1. test.skip if !complaintCreated; setTimeout 60s.
2. citizenOtpLogin(page, CITIZEN_PHONE).
3. Navigate to /digit-ui/citizen/pgr/complaints.
4. If body text doesn't contain serviceRequestId, click the first tab matching /resolved|closed|all/i and re-snap.
5. Assert final body text contains serviceRequestId.

Closes the citizen → admin → citizen loop. If this fails, the citizen can't see what an admin did to their complaint, which is the most user-visible failure mode.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    test.skip(!complaintCreated, 'complaint not created');
    test.setTimeout(60_000);

    await citizenOtpLogin(page, CITIZEN_PHONE);

    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);
    await snap(page, '06-citizen-complaints');

    // The complaint ID should appear on the page
    const bodyText = await page.locator('body').innerText();
    const hasComplaint = bodyText.includes(serviceRequestId);
    console.log(`Complaint ${serviceRequestId} visible on complaints page: ${hasComplaint}`);

    if (!hasComplaint) {
      // Try clicking a tab if complaints are behind a filter
      const tabs = page.locator('[role="tab"], .digit-tab, button').filter({ hasText: /resolved|closed|all/i });
      if (await tabs.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        await tabs.first().click();
        await page.waitForTimeout(3000);
        await snap(page, '06-citizen-complaints-tab');
      }
    }

    const finalText = await page.locator('body').innerText();
    expect(finalText).toContain(serviceRequestId);
    console.log(`Citizen complaints page shows ${serviceRequestId}`);
  });
});
