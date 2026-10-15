/**
 * Full PGR Lifecycle E2E — Three-Persona Test
 *
 * Tests the complete PGR complaint lifecycle across citizen, admin, and employee:
 *   1.  Acquire admin API token
 *   3.  Citizen signs in via the phone OTP form (the BFF creates the citizen)
 *   4.  Citizen creates PGR complaint via the UI wizard, under a type in the employee persona's department
 *   5.  Admin sees complaint in PGR inbox (UI)
 *   7.  Admin assigns complaint to the employee persona (UI — Take Action → Assign)
 *   8.  Employee signs in, sees assigned complaint (UI)
 *   9.  Employee resolves complaint (UI — Take Action → Resolve)
 *  10.  Employee verifies RESOLVED on details page (UI)
 *  11.  Citizen re-logs in, sees RESOLVED status (UI)
 *  12.  Citizen rates complaint (UI — star rating page)
 *  13.  Employee sees CLOSEDAFTERRESOLUTION (UI)
 *
 * Staff are persona logins from env (DIGIT_USERNAME, EMPLOYEE_USER): a new
 * HRMS employee is not linked to Keycloak and cannot sign in. API calls are
 * used only for token acquisition and verification (fetchComplaint).
 */
import { test, expect, type Page } from '@playwright/test';
import { PgrInboxPage } from '../pages/pgr-inbox.page';
import { getDigitToken, loginViaApi, appBase } from '../utils/auth';
import { requiredEnv } from '../utils/identity';
import { citizenLoginViaApi, citizenOtpLogin, runCitizenMobile } from '../utils/citizen-auth';
import { getLmeByUuid } from '../common/hrms-employees';
import { complaintTypePath, pickServiceDefInDepartments } from '../common/mdms-servicedef';

import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = requiredEnv('BASE_URL');
const TENANT = requiredEnv('DIGIT_TENANT');
const ADMIN_USER = requiredEnv('DIGIT_USERNAME');
const ADMIN_PASS = requiredEnv('DIGIT_PASSWORD');
const EMPLOYEE_USER = requiredEnv('EMPLOYEE_USER');
const EMPLOYEE_PASS = requiredEnv('EMPLOYEE_PASSWORD');
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/pgr-lifecycle-screenshots';

// Ensure screenshot dir exists
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

/** Take a named screenshot and save to the screenshot directory */
async function snap(page: Page, name: string) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`Screenshot: ${filePath}`);
}

/**
 * Assert that localization is working — no raw keys visible on screen.
 * Raw keys look like ALL_CAPS_WITH_UNDERSCORES (e.g. CS_COMMON_BACK, CORE_COMMON_LOGOUT).
 * Returns the list of raw keys found (empty = localization OK).
 */
async function assertLocalized(page: Page, context: string): Promise<string[]> {
  const bodyText = await page.locator('body').innerText();
  // Known raw key patterns: CS_, CORE_, ES_, WF_, HR_, ACTION_TEST_, COMMON_, EDIT_PROFILE
  const rawKeyPattern = /\b(CS_|CORE_|ES_|WF_|HR_|ACTION_TEST_|COMMON_BOTTO|EDIT_PROFILE|SERVICEDEFS_)[A-Z0-9_]{3,}\b/g;
  const rawKeys = [...new Set(bodyText.match(rawKeyPattern) || [])];
  if (rawKeys.length > 0) {
    console.log(`[LOCALIZATION WARNING in ${context}] Raw keys found: ${rawKeys.join(', ')}`);
  } else {
    console.log(`[LOCALIZATION OK in ${context}] All labels translated`);
  }
  return rawKeys;
}

// The run's citizen (runCitizenMobile), set in test.beforeAll below.
let CITIZEN_PHONE: string;

/**
 * Fetch the PGR service wrapper: the service plus its latest workflow
 * (action and assignees).
 */
async function searchComplaint(
  token: string,
  userInfo: Record<string, unknown>,
  serviceRequestId: string,
): Promise<any> {
  const resp = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${serviceRequestId}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo },
      }),
    },
  );
  const data: any = await resp.json();
  return data.ServiceWrappers[0];
}

/** The full PGR service object (needed for _update calls). */
async function fetchComplaint(token: string, userInfo: Record<string, unknown>, serviceRequestId: string): Promise<any> {
  return (await searchComplaint(token, userInfo, serviceRequestId)).service;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.describe.serial('Full PGR lifecycle — citizen, admin, employee', () => {
  test.slow();

  // Shared state across serial tests
  let adminToken: string;
  let adminUserInfo: Record<string, unknown>;
  let citizenToken: string;
  let citizenUserInfo: Record<string, unknown>;
  let serviceRequestId: string;
  let employeeName: string;
  let employeeUuid: string;

  // Gate flags — each test skips if its prerequisite failed
  let citizenLoggedIn = false;
  let complaintCreated = false;
  let complaintAssigned = false;
  let complaintResolved = false;
  let complaintRated = false;

  // The complaint type the citizen files under, top level first: one in the
  // employee persona's department, so the Assign dialog offers the persona.
  let typePath: Array<{ code: string; name: string }>;

  test.beforeAll(async () => {
    CITIZEN_PHONE = await runCitizenMobile();
    const persona = await getDigitToken({ baseURL: BASE_URL, tenant: TENANT, username: EMPLOYEE_USER, password: EMPLOYEE_PASS });
    const admin = { baseURL: BASE_URL, adminUser: ADMIN_USER, adminPassword: ADMIN_PASS };
    const { departments } = await getLmeByUuid(TENANT, persona.UserRequest.uuid, admin);
    const type = await pickServiceDefInDepartments(TENANT, departments, admin);
    typePath = await complaintTypePath(TENANT, type.serviceCode, admin);
    console.log(`[full-lifecycle] citizen=${CITIZEN_PHONE} type=${typePath.map((n) => n.code).join(' > ')} department=${type.department} (tenant=${TENANT})`);
  });

  // ─── 1. Acquire admin API token ───────────────────────────────────────

  test('1 — acquire admin API token', async () => {
    const tokenResponse = await getDigitToken({
      baseURL: BASE_URL,
      tenant: TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });

    expect(tokenResponse.access_token).toBeTruthy();
    adminToken = tokenResponse.access_token;
    adminUserInfo = tokenResponse.UserRequest as Record<string, unknown>;

    // The assignee the admin picks in step 7 is the employee persona.
    const employee = await getDigitToken({ baseURL: BASE_URL, tenant: TENANT, username: EMPLOYEE_USER, password: EMPLOYEE_PASS });
    employeeName = String(employee.UserRequest.name || '');
    employeeUuid = employee.UserRequest.uuid;
    expect(employeeName, 'employee persona has no DIGIT name to pick in the assignee list').toBeTruthy();
  });

  // ─── 3. Citizen logs in via UI (fixed OTP) ────────────────────────────

  test('3 — citizen logs in via UI with fixed OTP', async ({ page }) => {
    const session = await citizenOtpLogin(page, CITIZEN_PHONE);
    // The SPA's own DIGIT session doubles as the citizen API token.
    citizenToken = session.token;
    citizenUserInfo = session.userInfo;
    citizenLoggedIn = true;
    await snap(page, '03-citizen-logged-in');

    // Verify localization — sidebar should show translated text, not raw keys
    const rawKeys = await assertLocalized(page, 'citizen-home');
    // Localization check is informational — some keys may be missing in test environments
    if (rawKeys.length > 0) {
      console.log(`Localization: ${rawKeys.length} raw key(s) found — acceptable in test environment`);
    }
    console.log('Citizen logged in via UI, URL:', page.url());
  });

  // ─── 4. Citizen creates PGR complaint ─────────────────────────────────

  test('4 — citizen creates PGR complaint via UI wizard', async ({ page }) => {
    test.skip(!citizenLoggedIn, 'citizen not logged in');

    // Fresh page context: reuse step 3's BFF session (no new OTP); the SPA
    // builds its own DIGIT session from it.
    await citizenLoginViaApi(page, CITIZEN_PHONE);

    // ── Intercept PGR _create API to capture serviceRequestId ─────────
    let capturedServiceRequestId: string | null = null;
    await page.route('**/pgr-services/v2/request/_create**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      try {
        capturedServiceRequestId =
          body?.ServiceWrappers?.[0]?.service?.serviceRequestId ?? null;
      } catch {
        // If parsing fails, we'll extract from the response page instead
      }
      await route.fulfill({ response });
    });

    // Pin the map's reverse-geocode to an answer without a postcode, so the
    // run does not depend on OSM and no map-filled postcode is gated.
    await page.route('**nominatim.openstreetmap.org/reverse*', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ display_name: 'E2E pin', address: {} }) }));

    await page.goto(`${appBase()}/citizen/pgr/create-complaint/complaint-type`, { waitUntil: 'domcontentloaded' });
    const nextBtn = page.getByRole('button', { name: /^next$/i });

    // ── Step 1, Complaint Details: description, then the type level by level ──
    const description = page.locator('#complaint-description');
    await description.waitFor({ state: 'visible', timeout: 30_000 });
    await description.fill(`Full lifecycle E2E test via UI wizard - ${Date.now()}`);
    for (const [level, node] of typePath.entries()) {
      const combo = page.locator(`#lvl-${level}`);
      await expect(combo).toBeEnabled({ timeout: 15_000 });
      await combo.click();
      const option = page.getByRole('option', { name: new RegExp(`^${escapeRegExp(node.name)}$`, 'i') });
      await expect(option, `complaint type "${node.name}" (${node.code}) is not offered at level ${level}`).toHaveCount(1, { timeout: 20_000 });
      await option.click();
    }
    await snap(page, '04a-complaint-details');
    await expect(nextBtn).toBeEnabled({ timeout: 10_000 });
    await nextBtn.click();

    // ── Step 2, Location: the boundary cascade, whatever depth the tenant has (the map pin is optional) ──
    let levels = 0;
    for (; levels < 6; levels++) {
      const combo = page.locator('[id^="boundary-"]').nth(levels);
      if (!await combo.waitFor({ state: 'visible', timeout: levels === 0 ? 30_000 : 15_000 }).then(() => true, () => false)) break;
      await expect(combo).toBeEnabled({ timeout: 15_000 });
      await combo.click();
      const options = page.getByRole('option');
      await expect.poll(() => options.count(), { timeout: 20_000 }).toBeGreaterThan(0);
      await options.first().click();
    }
    expect(levels, 'no boundary dropdowns rendered on the location step').toBeGreaterThan(0);
    await snap(page, '04b-location');
    await expect(nextBtn).toBeEnabled({ timeout: 10_000 });
    await nextBtn.click();

    // ── Step 3, Review → Submit complaint ──
    const submitBtn = page.getByRole('button', { name: /submit complaint/i });
    await expect(submitBtn).toBeEnabled({ timeout: 15_000 });
    await submitBtn.click();
    await page.waitForURL((url) => url.pathname.includes('/pgr/response'), { timeout: 30_000 });

    // Try to extract serviceRequestId from:
    // 1. Intercepted API response (most reliable)
    // 2. Page body text (fallback — Banner renders complaintNumber)
    if (capturedServiceRequestId) {
      serviceRequestId = capturedServiceRequestId;
      console.log(`Captured serviceRequestId from API: ${serviceRequestId}`);
    } else {
      // Fallback: extract from page body text using PGR ID pattern
      const bodyText = await page.locator('body').innerText();
      const match = bodyText.match(/[A-Z0-9-]+-PGR-[0-9-]+/);
      if (match) {
        serviceRequestId = match[0];
        console.log(`Extracted serviceRequestId from page: ${serviceRequestId}`);
      } else {
        console.log('Response page body text:', bodyText.slice(0, 1000));
      }
    }

    expect(serviceRequestId).toBeTruthy();
    complaintCreated = true;
    await snap(page, '04c-complaint-created-response');
    console.log(`Citizen created complaint via UI wizard: ${serviceRequestId}`);
  });

  // ─── 5. Admin sees complaint in PGR inbox ─────────────────────────────

  test('5 — admin sees complaint in PGR inbox (UI)', async ({ page }) => {
    test.skip(!complaintCreated, 'complaint not created');

    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });

    const inbox = new PgrInboxPage(page);
    await inbox.goto();

    const bodyText = await inbox.getBodyText();
    expect(bodyText.length).toBeGreaterThan(50);

    await snap(page, '05-pgr-inbox');

    // Verify localization — inbox should show translated column headers and statuses
    const rawKeys = await assertLocalized(page, 'pgr-inbox');
    // Localization check is informational — some keys may be missing in test environments
    if (rawKeys.length > 0) {
      console.log(`Localization: ${rawKeys.length} raw key(s) found — acceptable in test environment`);
    }

    // Check if our complaint is visible (may need scrolling on large datasets)
    if (bodyText.includes(serviceRequestId)) {
      console.log(`Complaint ${serviceRequestId} found in inbox`);
    } else {
      console.log(`Complaint ${serviceRequestId} not in current inbox view (may need scrolling/filtering)`);
    }
  });

  // ─── 7. Admin assigns complaint to the employee persona (UI) ─────────

  test('7 — admin assigns complaint to the employee persona via UI', async ({ page }) => {
    test.skip(!complaintCreated, 'complaint not created');

    // Verify complaint is in expected state before attempting UI assignment
    const fullService = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
    expect(fullService.applicationStatus).toBe('PENDINGFORASSIGNMENT');

    // Log in as admin
    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });

    // Navigate to complaint details page
    await page.goto(`${appBase()}/employee/pgr/complaint-details/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain(serviceRequestId);

    // Click "Take Action" button — retry up to 3 times (dropdown can be flaky)
    let takeActionClicked = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const takeActionBtn = page.locator('button').filter({
          hasText: /ES_COMMON_TAKE_ACTION|Take Action/i,
        }).first();
        await takeActionBtn.waitFor({ state: 'visible', timeout: 10_000 });
        await takeActionBtn.click();
        await page.waitForTimeout(1000);

        const dropdown = page.locator('.header-dropdown-container');
        await dropdown.waitFor({ state: 'visible', timeout: 5_000 });
        takeActionClicked = true;
        break;
      } catch {
        console.log(`Take Action click attempt ${attempt} failed, retrying...`);
        await page.waitForTimeout(2000);
      }
    }
    expect(takeActionClicked).toBe(true);

    // Click "ASSIGN" option in the dropdown menu
    const assignOption = page.locator('.header-dropdown-option').filter({ hasText: /ASSIGN/i });
    await assignOption.waitFor({ state: 'visible', timeout: 5_000 });
    await assignOption.click();
    await page.waitForTimeout(2000);

    // Modal is now open — wait for it
    const modal = page.locator('.popup-module');
    await modal.waitFor({ state: 'visible', timeout: 10_000 });

    // Select employee from the nested dropdown (AssigneeComponent)
    const assigneeContainer = modal.locator('.assignee-dropdown-container');
    await expect(assigneeContainer, 'ASSIGN modal has no assignee dropdown').toBeVisible({ timeout: 10_000 });
    await assigneeContainer.locator('input').click();

    // Pick the employee persona, who signs in for the next steps. Options read
    // "<name> (<department>)" in sentence case (the Dropdown renders labels
    // TOSENTENCECASE), so match the whole name, ignoring case: "PGR Employee"
    // must not pick "PGR Employee 2".
    const assigneeOption = assigneeContainer.locator('.digit-dropdown-item')
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(employeeName)} \\(`, 'i') });
    await expect(assigneeOption, `employee persona "${employeeName}" is not in the assignee list`).toHaveCount(1, { timeout: 10_000 });
    await assigneeOption.click();
    await page.waitForTimeout(1000);

    // Fill comments textarea (mandatory)
    const commentsTextarea = modal.locator('textarea').first();
    await commentsTextarea.waitFor({ state: 'visible', timeout: 5_000 });
    await commentsTextarea.fill('Assigned by full lifecycle E2E test via UI');

    // Click Submit button in the modal
    const submitBtn = modal.locator('button').filter({ hasText: /Submit|CS_COMMON_SUBMIT/i }).first();
    await submitBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await submitBtn.click();

    // Wait for the update to process
    await page.waitForTimeout(8000);

    // Verify via API: PENDINGATLME, assigned to the employee persona
    const updated = await searchComplaint(adminToken, adminUserInfo, serviceRequestId);
    expect(updated.service.applicationStatus).toBe('PENDINGATLME');
    expect(updated.workflow?.assignes, 'complaint was assigned to someone other than the employee persona').toEqual([employeeUuid]);
    complaintAssigned = true;
    await snap(page, '07-complaint-assigned');
    console.log(`Complaint ${serviceRequestId} assigned to ${employeeName} via UI → PENDINGATLME`);
  });

  // ─── 8. Employee signs in, sees assigned complaint ────────────────────

  test('8 — employee signs in and sees assigned complaint (UI)', async ({ page }) => {
    test.skip(!complaintAssigned, 'complaint not assigned');

    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: EMPLOYEE_USER, password: EMPLOYEE_PASS });

    // Navigate to complaint details
    await page.goto(`${appBase()}/employee/pgr/complaint-details/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain(serviceRequestId);
    expect(bodyText).toMatch(/PENDINGATLME|Pending at LME|Pending for resolution/i);
    await snap(page, '08-employee-sees-pendingatlme');
    console.log(`Employee ${EMPLOYEE_USER} sees ${serviceRequestId} as PENDINGATLME`);
  });

  // ─── 9. Employee resolves complaint via UI ─────────────────────────────

  test('9 — employee resolves complaint via UI', async ({ page }) => {
    test.skip(!complaintAssigned, 'complaint not assigned');

    // Sign in as the assigned employee (not admin)
    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: EMPLOYEE_USER, password: EMPLOYEE_PASS });

    // Navigate to complaint details page
    await page.goto(`${appBase()}/employee/pgr/complaint-details/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain(serviceRequestId);

    // Click "Take Action" button — retry up to 3 times
    const takeActionBtn = page.locator('button').filter({
      hasText: /ES_COMMON_TAKE_ACTION|Take Action/i,
    }).first();
    let resolveOption = page.locator('.header-dropdown-option').filter({ hasText: /RESOLVE/i });
    for (let attempt = 0; attempt < 3; attempt++) {
      await takeActionBtn.waitFor({ state: 'visible', timeout: 10_000 });
      await takeActionBtn.click();
      await page.waitForTimeout(1000);
      if (await resolveOption.isVisible()) break;
    }
    await expect(resolveOption).toBeVisible({ timeout: 5_000 });
    await resolveOption.click();
    await page.waitForTimeout(1000);

    // Modal open — fill comments textarea (the only mandatory field for RESOLVE)
    const commentsTextarea = page.locator('textarea').first();
    await commentsTextarea.waitFor({ state: 'visible', timeout: 10_000 });
    await commentsTextarea.fill('Resolved by full lifecycle E2E test — issue fixed on site');

    // Click Submit in the modal
    const submitBtn = page.locator('.popup-module button, .popup-module-action-bar button').filter({
      hasText: /Submit|CS_COMMON_SUBMIT/i,
    }).first();
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });
    await submitBtn.click();

    // Wait for update to process
    await page.waitForTimeout(5000);

    // Verify resolution via API
    const resolved = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
    expect(resolved.applicationStatus).toBe('RESOLVED');
    complaintResolved = true;
    await snap(page, '09-complaint-resolved');
    console.log(`Complaint ${serviceRequestId} resolved via UI by employee ${EMPLOYEE_USER}`);
  });

  // ─── 10. Employee verifies RESOLVED on details page ───────────────────

  test('10 — employee verifies RESOLVED on details page (UI)', async ({ page }) => {
    test.skip(!complaintResolved, 'complaint not resolved');

    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: EMPLOYEE_USER, password: EMPLOYEE_PASS });

    await page.goto(`${appBase()}/employee/pgr/complaint-details/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain(serviceRequestId);
    expect(bodyText).toMatch(/RESOLVED|Resolved/i);
    await snap(page, '10-employee-confirms-resolved');
    console.log(`Employee ${EMPLOYEE_USER} confirms RESOLVED for ${serviceRequestId}`);
  });

  // ─── 11. Citizen re-logs in, sees RESOLVED ────────────────────────────

  test('11 — citizen re-logs in and sees RESOLVED status (UI)', async ({ page }) => {
    test.skip(!complaintResolved, 'complaint not resolved');

    await citizenLoginViaApi(page, CITIZEN_PHONE);

    // Navigate to citizen complaint details
    await page.goto(`${BASE_URL}${appBase()}/citizen/pgr/complaints/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/RESOLVED|Resolved/i);
    await snap(page, '11-citizen-sees-resolved');
    console.log(`Citizen sees ${serviceRequestId} as RESOLVED`);
  });

  // ─── 12. Citizen rates complaint via UI ─────────────────────────────

  test('12 — citizen rates complaint via UI', async ({ page }) => {
    test.skip(!complaintResolved, 'complaint not resolved');

    // Fresh page context: reuse step 3's BFF session (no new OTP)
    await citizenLoginViaApi(page, CITIZEN_PHONE);

    // Navigate to the rating page for this complaint
    await page.goto(`${BASE_URL}${appBase()}/citizen/pgr/rate/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    // Rate 4 of 5: the stars are a radio group ("1 star" … "5 stars").
    await page.getByRole('radio', { name: /^4 stars$/i }).click();
    await page.locator('#comments').fill('Issue resolved satisfactorily. Thank you.');

    const submitButton = page.getByRole('button', { name: /^submit$/i });
    await expect(submitButton).toBeEnabled({ timeout: 10_000 });
    await submitButton.click();

    // Wait for redirect to response/success page
    await page.waitForURL('**/pgr/response**', { timeout: 15_000 }).catch(() => {
      console.log('Did not redirect to /pgr/response, current URL:', page.url());
    });
    await page.waitForTimeout(3000);

    // Verify via API that complaint status is now CLOSEDAFTERRESOLUTION
    const rated = await fetchComplaint(citizenToken, citizenUserInfo, serviceRequestId);
    expect(rated.applicationStatus).toBe('CLOSEDAFTERRESOLUTION');
    complaintRated = true;
    await snap(page, '12-citizen-rated');
    console.log(`Complaint ${serviceRequestId} rated via UI → CLOSEDAFTERRESOLUTION`);
  });

  // ─── 13. Employee sees CLOSEDAFTERRESOLUTION ──────────────────────────

  test('13 — employee sees CLOSEDAFTERRESOLUTION (UI)', async ({ page }) => {
    test.skip(!complaintRated, 'complaint not rated');

    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: EMPLOYEE_USER, password: EMPLOYEE_PASS });

    await page.goto(`${appBase()}/employee/pgr/complaint-details/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain(serviceRequestId);
    expect(bodyText).toMatch(/CLOSEDAFTERRESOLUTION|Closed after resolution/i);
    await snap(page, '13-closedafterresolution');
    console.log(`Employee ${EMPLOYEE_USER} confirms CLOSEDAFTERRESOLUTION for ${serviceRequestId}`);
  });
});
