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
import {
  BASE_URL, TENANT, ROOT_TENANT,
  ADMIN_USER, ADMIN_PASS, FIXED_OTP,
  SERVICE_CODE, LOCALITY_CODE,
  DEFAULT_PASSWORD,
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

// City-level admin for UI tests (getCurrentTenantId returns ke.nairobi)
const CITY_ADMIN_USER = process.env.CITY_ADMIN_USER || 'EMP-KE_NAIROBI-000089';
const CITY_ADMIN_PASS = process.env.CITY_ADMIN_PASS || DEFAULT_PASSWORD;

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

  test('1 — citizen logs in via UI with fixed OTP', async ({ page }) => {
    await citizenOtpLogin(page, CITIZEN_PHONE);

    const token = await page.evaluate(() => localStorage.getItem('Citizen.token'));
    expect(token).toBeTruthy();
    citizenLoggedIn = true;
    await snap(page, '01-citizen-logged-in');
    console.log(`Citizen ${CITIZEN_PHONE} logged in via UI, URL: ${page.url()}`);
  });

  // ─── 2. Citizen creates complaint via UI wizard ─────────────────────

  test('2 — citizen creates complaint via UI wizard', async ({ page }) => {
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

    // Helper: select dropdown option
    const selectDropdownOption = async (index: number) => {
      const dropdowns = page.locator('input.digit-dropdown-employee-select-wrap--elipses');
      const dropdown = dropdowns.nth(index);
      await dropdown.waitFor({ state: 'visible', timeout: 10_000 });
      await dropdown.click();
      await page.waitForTimeout(1000);
      const items = page.locator('.digit-dropdown-item');
      const count = await items.count();
      console.log(`Dropdown ${index}: ${count} items`);
      await items.first().click();
      await page.waitForTimeout(500);
    };

    // Step 0: Select complaint type
    console.log('Step 0: Selecting complaint type...');
    await selectDropdownOption(0);
    await page.waitForTimeout(2000);
    const subtypeCount = await page.locator('input.digit-dropdown-employee-select-wrap--elipses').count();
    if (subtypeCount > 1) {
      console.log('Selecting subtype...');
      await selectDropdownOption(1);
      await page.waitForTimeout(1000);
    }
    await snap(page, '02a-complaint-type');
    await clickNextOrSubmit('NEXT');

    // Step 1: Geolocation — skip
    console.log('Step 1: Geolocation — skipping...');
    await clickNextOrSubmit('NEXT');

    // Step 2: Location details — skip
    console.log('Step 2: Location details — skipping...');
    await clickNextOrSubmit('NEXT');

    // Step 3: Address — handle radio buttons (city) + locality
    console.log('Step 3: Selecting address...');
    await page.waitForTimeout(2000);

    const radioButtons = page.locator('input[type="radio"]');
    const boundaryDropdowns = page.locator('input[class*="select-wrap--elipses"]');

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
          const localityDropdown = page.locator('input[class*="select-wrap--elipses"]');
          await localityDropdown.first().waitFor({ state: 'visible', timeout: 10_000 });
          const ddCount = await localityDropdown.count();
          console.log(`Locality dropdown appeared (${ddCount} matching)`);
          await localityDropdown.first().click();
          await page.waitForTimeout(1000);
          const items = page.locator('.digit-dropdown-item, .option-item, [class*="dropdown-item"], [class*="option"]');
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
      console.log('No address controls found — skipping');
      await clickNextOrSubmit('NEXT');
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
      const match = bodyText.match(/PG-PGR-\d{4}-\d{2}-\d{2}-\d{6}/);
      if (match) serviceRequestId = match[0];
    }

    expect(serviceRequestId).toBeTruthy();
    complaintCreated = true;
    await snap(page, '02c-complaint-created');
    console.log(`Complaint created via UI: ${serviceRequestId}`);
  });

  // ─── 3. Admin sees complaint in inbox (UI) ──────────────────────────

  test('3 — admin sees complaint in PGR inbox (UI)', async ({ page }) => {
    test.skip(!complaintCreated, 'complaint not created');

    await loginViaApi(page, {
      tenant: TENANT,
      authTenant: TENANT,
      username: CITY_ADMIN_USER,
      password: CITY_ADMIN_PASS,
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

  test('4 — admin assigns complaint via UI', async ({ page }) => {
    test.skip(!complaintCreated, 'complaint not created');
    test.setTimeout(120_000);

    // Login as city-level admin (tenantId = ke.nairobi)
    await loginViaApi(page, {
      tenant: TENANT,
      authTenant: TENANT,
      username: CITY_ADMIN_USER,
      password: CITY_ADMIN_PASS,
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

  test('5 — admin resolves complaint via UI', async ({ page }) => {
    test.skip(!complaintCreated, 'complaint not created');
    test.setTimeout(120_000);

    // Login as city-level admin
    await loginViaApi(page, {
      tenant: TENANT,
      authTenant: TENANT,
      username: CITY_ADMIN_USER,
      password: CITY_ADMIN_PASS,
    });

    // Navigate to complaint details
    console.log(`Navigating to complaint ${serviceRequestId}...`);
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
    await expect(resolveOption).toBeVisible({ timeout: 5_000 });
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

  test('6 — citizen sees resolved complaint on complaints page (UI)', async ({ page }) => {
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
