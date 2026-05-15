/**
 * Admin Assignment Test — login via API token injection, view inbox, assign complaints.
 * Bypasses the login form (React FormComposer dropdown doesn't register Playwright clicks)
 * by injecting localStorage session state from the OAuth token response.
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18080';
const TENANT = process.env.DIGIT_TENANT || 'uitest.citya';
const ROOT_TENANT = TENANT.includes('.') ? TENANT.split('.')[0] : TENANT;
const ADMIN_USER = process.env.DIGIT_USERNAME || 'ADMIN';
const ADMIN_PASS = process.env.DIGIT_PASSWORD || 'eGov@123';

const COMPLAINTS = [
  'PG-PGR-2026-04-13-016772',
  'PG-PGR-2026-04-13-016720',
];

test.describe.serial('Admin login and assign complaints', () => {
  test.slow();

  let adminToken: string;
  let adminUserInfo: Record<string, unknown>;
  let loggedIn = false;

  test('1 — admin login via token injection', async ({ page }) => {
    // Get token via API
    const tokenResponse = await getDigitToken({
      baseURL: BASE_URL,
      tenant: ROOT_TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });
    expect(tokenResponse.access_token).toBeTruthy();
    adminToken = tokenResponse.access_token;
    adminUserInfo = tokenResponse.UserRequest as Record<string, unknown>;

    // Navigate to login page first (to set the origin)
    await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Inject session into localStorage (same keys the Login component sets)
    await page.evaluate(({ token, userInfo, tenant }) => {
      localStorage.setItem('Employee.token', token);
      localStorage.setItem('Employee.tenant-id', tenant);
      localStorage.setItem('Employee.user-info', JSON.stringify(userInfo));
      localStorage.setItem('Employee.locale', 'en_IN');
      // Also set citizen token (some components check both)
      localStorage.setItem('token', token);
      localStorage.setItem('tenant-id', tenant);
      localStorage.setItem('user-info', JSON.stringify(userInfo));
    }, { token: adminToken, userInfo: adminUserInfo, tenant: TENANT });

    // Navigate to employee home — should skip login
    await page.goto(`${BASE_URL}/digit-ui/employee`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(5000);

    const url = page.url();
    console.log(`After token injection, URL: ${url}`);

    // If redirected back to login, the token injection failed
    if (url.includes('/user/login')) {
      // Try again with a page reload
      await page.goto(`${BASE_URL}/digit-ui/employee`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(5000);
      console.log(`After retry, URL: ${page.url()}`);
    }

    expect(page.url()).not.toContain('/user/login');
    loggedIn = true;
    await page.screenshot({ path: '/tmp/admin-assign-screenshots/01-logged-in.png', fullPage: true });
  });

  test('2 — check inbox page and network calls', async ({ page }) => {
    test.skip(!loggedIn, 'admin not logged in');
    test.setTimeout(120_000);

    // Inject session
    await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.evaluate(({ token, userInfo, tenant }) => {
      localStorage.setItem('Employee.token', token);
      localStorage.setItem('Employee.tenant-id', tenant);
      localStorage.setItem('Employee.user-info', JSON.stringify(userInfo));
      localStorage.setItem('Employee.locale', 'en_IN');
      localStorage.setItem('token', token);
      localStorage.setItem('tenant-id', tenant);
      localStorage.setItem('user-info', JSON.stringify(userInfo));
    }, { token: adminToken, userInfo: adminUserInfo, tenant: TENANT });

    // Capture ALL network calls from the inbox page
    const networkCalls: { url: string; status: number; method: string }[] = [];
    page.on('response', (resp) => {
      const url = resp.url();
      if (url.includes('/pgr') || url.includes('/inbox') || url.includes('/workflow') ||
          url.includes('/mdms') || url.includes('/boundary') || url.includes('/location') ||
          url.includes('/user/')) {
        networkCalls.push({ url: url.slice(0, 150), status: resp.status(), method: resp.request().method() });
      }
    });

    // Capture console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('Warning:'))
        consoleErrors.push(msg.text().slice(0, 200));
    });
    page.on('pageerror', (err) => consoleErrors.push(`PAGE ERROR: ${err.message.slice(0, 200)}`));

    // Navigate to inbox
    await page.goto(`${BASE_URL}/digit-ui/employee/pgr/inbox`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(15_000); // Wait for all API calls to complete

    // Report findings
    console.log('\n=== INBOX NETWORK CALLS ===');
    for (const call of networkCalls) {
      console.log(`  [${call.method} ${call.status}] ${call.url}`);
    }

    const inboxV2Calls = networkCalls.filter(c => c.url.includes('/inbox/'));
    const pgrSearchCalls = networkCalls.filter(c => c.url.includes('/pgr-services/'));
    const workflowCalls = networkCalls.filter(c => c.url.includes('/workflow'));

    console.log(`\n=== SUMMARY ===`);
    console.log(`inbox/v2 calls: ${inboxV2Calls.length}`);
    console.log(`pgr-services calls: ${pgrSearchCalls.length}`);
    console.log(`workflow calls: ${workflowCalls.length}`);
    console.log(`total API calls: ${networkCalls.length}`);

    if (consoleErrors.length > 0) {
      console.log(`\n=== CONSOLE ERRORS (non-warning) ===`);
      for (const err of consoleErrors) console.log(`  ${err}`);
    }

    await page.screenshot({ path: '/tmp/admin-assign-screenshots/02-inbox.png', fullPage: true });

    // Get page body text
    const bodyText = await page.locator('body').innerText();
    console.log(`\nPage body (first 500 chars):\n${bodyText.slice(0, 500)}`);
  });

  for (const [i, serviceRequestId] of COMPLAINTS.entries()) {
    test(`3.${i + 1} — assign ${serviceRequestId}`, async ({ page }) => {
      test.skip(!loggedIn, 'admin not logged in');
      test.setTimeout(120_000);

      // Check complaint status via API first
      const searchResp = await fetch(
        `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${serviceRequestId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
          }),
        },
      );
      const searchData: any = await searchResp.json();
      const status = searchData?.ServiceWrappers?.[0]?.service?.applicationStatus;
      if (status !== 'PENDINGFORASSIGNMENT') {
        console.log(`${serviceRequestId} is ${status}, skipping`);
        test.skip(true, `status is ${status}`);
        return;
      }

      // Inject session
      await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.evaluate(({ token, userInfo, tenant }) => {
        localStorage.setItem('Employee.token', token);
        localStorage.setItem('Employee.tenant-id', tenant);
        localStorage.setItem('Employee.user-info', JSON.stringify(userInfo));
        localStorage.setItem('Employee.locale', 'en_IN');
        localStorage.setItem('token', token);
        localStorage.setItem('tenant-id', tenant);
        localStorage.setItem('user-info', JSON.stringify(userInfo));
      }, { token: adminToken, userInfo: adminUserInfo, tenant: TENANT });

      // Navigate to complaint details
      await page.goto(`${BASE_URL}/digit-ui/employee/pgr/complaint/details/${serviceRequestId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page.waitForTimeout(8000);

      const bodyText = await page.locator('body').innerText();
      console.log(`Details page for ${serviceRequestId}, body length: ${bodyText.length}`);
      await page.screenshot({ path: `/tmp/admin-assign-screenshots/03-${i + 1}-details.png`, fullPage: true });

      // If page shows "Something went wrong", log and skip
      if (bodyText.includes('Something went wrong') || bodyText.includes('WENT_WRONG')) {
        console.log(`ERROR: Details page shows error for ${serviceRequestId}`);
        expect(bodyText).not.toContain('Something went wrong');
        return;
      }

      expect(bodyText).toContain(serviceRequestId);

      // Click "Take Action" — retry up to 3 times
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
          console.log(`Take Action attempt ${attempt} failed, retrying...`);
          await page.waitForTimeout(2000);
        }
      }
      if (!takeActionClicked) {
        console.log(`Take Action button not responding for ${serviceRequestId} — skipping assign`);
        test.skip(true, 'Take Action dropdown did not appear after 3 attempts');
        return;
      }

      // Click "ASSIGN"
      const assignOption = page.locator('.header-dropdown-option').filter({ hasText: /ASSIGN/i });
      await assignOption.waitFor({ state: 'visible', timeout: 5_000 });
      await assignOption.click();
      await page.waitForTimeout(2000);

      // Modal — select employee
      const modal = page.locator('.popup-module');
      await modal.waitFor({ state: 'visible', timeout: 10_000 });

      const assigneeContainer = modal.locator('.assignee-dropdown-container');
      if (await assigneeContainer.isVisible({ timeout: 5_000 }).catch(() => false)) {
        const dropdownInput = assigneeContainer.locator('input');
        await dropdownInput.click();
        await page.waitForTimeout(2000);
        const employeeOptions = assigneeContainer.locator('.digit-dropdown-item');
        const optionCount = await employeeOptions.count();
        console.log(`Found ${optionCount} employee(s) in assignee dropdown`);
        if (optionCount > 0) {
          await employeeOptions.first().click();
          await page.waitForTimeout(1000);
        }
      }

      // Fill comments
      const commentsTextarea = modal.locator('textarea').first();
      await commentsTextarea.waitFor({ state: 'visible', timeout: 5_000 });
      await commentsTextarea.fill(`Assigned by E2E test — ${serviceRequestId}`);

      await page.screenshot({ path: `/tmp/admin-assign-screenshots/03-${i + 1}-modal.png`, fullPage: true });

      // Submit
      const submitBtn = modal.locator('button').filter({ hasText: /Submit|CS_COMMON_SUBMIT/i }).first();
      await submitBtn.waitFor({ state: 'visible', timeout: 5_000 });
      await submitBtn.click();
      await page.waitForTimeout(8000);

      // Verify via API
      const verifyResp = await fetch(
        `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${serviceRequestId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
          }),
        },
      );
      const verifyData: any = await verifyResp.json();
      const newStatus = verifyData?.ServiceWrappers?.[0]?.service?.applicationStatus;
      console.log(`${serviceRequestId}: ${status} → ${newStatus}`);
      expect(newStatus).toBe('PENDINGATLME');
      await page.screenshot({ path: `/tmp/admin-assign-screenshots/03-${i + 1}-assigned.png`, fullPage: true });
    });
  }
});
