import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * PGR (Public Grievance Redressal) End-to-End Flow
 *
 * Validates the employee PGR experience:
 * - Login, navigate to PGR pages (inbox, create, search)
 * - Full complaint lifecycle via API: create -> assign -> resolve -> close
 * - UI form structure verification
 *
 * Environment variables (all optional, defaults for local dev):
 *   BASE_URL       - DIGIT gateway URL (default: http://127.0.0.1:18000)
 *   PGR_CITY       - City name in login dropdown (default: City A)
 *   PGR_TENANT     - City-level tenant ID (default: pg.citya)
 *   PGR_STATE      - State-level tenant ID (default: pg)
 *   PGR_USERNAME   - Employee username for UI login (default: ADMIN)
 *   PGR_PASSWORD   - Employee password (default: eGov@123)
 *   CI_USERNAME    - HRMS employee for API lifecycle (default: CI-ADMIN)
 *   CI_PASSWORD    - HRMS employee password (default: eGov@123)
 *   CI_SERVICE_CODE - Complaint type matching CI employee dept (default: RequestSprayingOrFoggingOperation)
 */

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18000';
const CITY = process.env.PGR_CITY || 'City A';
const TENANT = process.env.PGR_TENANT || 'pg.citya';
const STATE_TENANT = process.env.PGR_STATE || 'pg';
const USERNAME = process.env.PGR_USERNAME || 'ADMIN';
const PASSWORD = process.env.PGR_PASSWORD || 'eGov@123';
const CI_USER = process.env.CI_USERNAME || 'CI-ADMIN';
const CI_PASS = process.env.CI_PASSWORD || 'eGov@123';
const SERVICE_CODE = process.env.CI_SERVICE_CODE || 'RequestSprayingOrFoggingOperation';

/** Generate a unique 10-digit phone number to avoid citizen data conflicts */
function uniquePhone(): string {
  const ts = Date.now().toString();
  return '9' + ts.slice(-9);
}

/** Sleep helper */
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Robust login that retries page load if form doesn't appear */
async function loginAsEmployee(page: Page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded' });

    try {
      const loginForm = page.locator('form, [class*="login"], [class*="Login"]');
      await expect(loginForm.first()).toBeVisible({ timeout: 20_000 });
      break;
    } catch {
      if (!page.url().includes('/user/login')) return;
      if (attempt < 3) {
        await page.waitForTimeout(2_000);
        continue;
      }
      throw new Error(`Login form did not appear after ${attempt} attempts. URL: ${page.url()}`);
    }
  }

  await page.waitForTimeout(1_000);

  await page.getByRole('textbox', { name: 'City' }).click();
  await page.waitForTimeout(500);
  await page.locator('[class*="option"], [class*="Option"]')
    .filter({ hasText: CITY }).first().click({ timeout: 5_000 });
  await page.waitForTimeout(500);

  await page.getByRole('textbox', { name: 'Mobile Number' }).fill(USERNAME);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Login' }).click();

  await page.waitForURL(url => !url.pathname.includes('/user/login'), { timeout: 30_000 });
  await page.waitForTimeout(3_000);
}

function makeRequestInfo(token: string, uuid: string) {
  return {
    apiId: 'Rainmaker',
    authToken: token,
    userInfo: {
      uuid,
      type: 'EMPLOYEE',
      tenantId: TENANT,
      roles: [
        { code: 'EMPLOYEE', tenantId: STATE_TENANT },
        { code: 'GRO', tenantId: STATE_TENANT },
        { code: 'DGRO', tenantId: STATE_TENANT },
        { code: 'PGR_LME', tenantId: STATE_TENANT },
        { code: 'CSR', tenantId: STATE_TENANT },
        { code: 'CFC', tenantId: STATE_TENANT },
      ],
    },
  };
}

/** Search for a complaint with retries (Kafka persistence is async) */
async function searchWithRetry(
  request: APIRequestContext,
  token: string,
  uuid: string,
  serviceRequestId: string,
  maxRetries = 5,
  delayMs = 2000
) {
  for (let i = 0; i < maxRetries; i++) {
    const resp = await request.post(
      `/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${serviceRequestId}`,
      { data: { RequestInfo: makeRequestInfo(token, uuid) } }
    );
    if (resp.ok()) {
      const data = await resp.json();
      if (data.ServiceWrappers && data.ServiceWrappers.length > 0) {
        return data;
      }
    }
    if (i < maxRetries - 1) await sleep(delayMs);
  }
  throw new Error(`Complaint ${serviceRequestId} not found after ${maxRetries} retries`);
}

// ─── UI Tests ──────────────────────────────────────────────────────────────

test.describe('PGR UI Navigation', () => {
  test('employee can login and reach home page', async ({ page }) => {
    await loginAsEmployee(page);

    expect(page.url()).toContain('/digit-ui/employee');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(0);
  });

  test('PGR inbox page loads', async ({ page }) => {
    await loginAsEmployee(page);

    await page.goto(`${BASE}/digit-ui/employee/pgr/inbox`);
    await page.waitForTimeout(5_000);

    expect(page.url()).toContain('pgr/inbox');
    const body = await page.locator('body').innerText();
    expect(body).toContain('Inbox');
  });

  test('create complaint form has all required fields', async ({ page }) => {
    await loginAsEmployee(page);

    await page.goto(`${BASE}/digit-ui/employee/pgr/create-complaint`);
    await page.waitForTimeout(5_000);

    const body = await page.locator('body').innerText();
    expect(body).toContain('Create Complaint');
    expect(body).toContain('Complainant');
    expect(body).toContain('Complaint Type');
    expect(body).toContain('Description');

    await expect(page.locator('input[name="ComplainantContactNumber"]')).toBeVisible();
    await expect(page.locator('input[name="ComplainantName"]')).toBeVisible();
    await expect(page.locator('textarea[name="description"]')).toBeVisible();
    await expect(
      page.locator('button:has-text("SUBMIT"), button:has-text("Submit")').first()
    ).toBeVisible();
  });
});

// ─── API Tests (PGR Lifecycle) ─────────────────────────────────────────────

test.describe('PGR API Lifecycle', () => {
  let token: string;
  let uuid: string;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });

    // Auth as CI-ADMIN (has HRMS employee record with department)
    const authResp = await request.post('/user/oauth/token', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
      },
      form: {
        username: CI_USER,
        password: CI_PASS,
        tenantId: TENANT,
        grant_type: 'password',
        scope: 'read',
        userType: 'EMPLOYEE',
      },
    });
    expect(authResp.ok(), `Auth failed: ${authResp.status()}`).toBe(true);
    const authData = await authResp.json();
    token = authData.access_token;
    uuid = authData.UserRequest.uuid;

    await request.dispose();
  });

  test('can create a complaint and search for it', async ({ playwright }) => {
    const request = await playwright.request.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });

    const phone = uniquePhone();

    // Create
    const createResp = await request.post(
      `/pgr-services/v2/request/_create?tenantId=${TENANT}`,
      {
        data: {
          RequestInfo: makeRequestInfo(token, uuid),
          service: {
            tenantId: TENANT,
            serviceCode: SERVICE_CODE,
            description: `Playwright create test - ${Date.now()}`,
            source: 'web',
            address: {
              city: TENANT,
              locality: { code: 'WARD1', name: 'Ward 1' },
              geoLocation: { latitude: 31.6, longitude: 74.8 },
            },
            citizen: {
              name: 'Test Citizen',
              mobileNumber: phone,
              tenantId: TENANT,
            },
          },
          workflow: { action: 'APPLY' },
        },
      }
    );
    const createBody = await createResp.text();
    expect(createResp.ok(), `Create failed (${createResp.status()}): ${createBody.slice(0, 500)}`).toBe(true);

    const createData = JSON.parse(createBody);
    const serviceRequestId = createData.ServiceWrappers[0].service.serviceRequestId;
    expect(serviceRequestId).toBeTruthy();

    test.info().annotations.push({ type: 'complaint-id', description: serviceRequestId });

    // Search with retries (Kafka persistence is async)
    const searchData = await searchWithRetry(request, token, uuid, serviceRequestId);
    expect(searchData.ServiceWrappers).toHaveLength(1);
    expect(searchData.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGFORASSIGNMENT');

    await request.dispose();
  });

  test('full lifecycle: create -> assign -> resolve -> rate & close', async ({ playwright }) => {
    const request = await playwright.request.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });

    const phone = uniquePhone();

    // 1. Create
    const createResp = await request.post(
      `/pgr-services/v2/request/_create?tenantId=${TENANT}`,
      {
        data: {
          RequestInfo: makeRequestInfo(token, uuid),
          service: {
            tenantId: TENANT,
            serviceCode: SERVICE_CODE,
            description: `PGR lifecycle test - ${Date.now()}`,
            source: 'web',
            address: {
              city: TENANT,
              locality: { code: 'WARD1', name: 'Ward 1' },
              geoLocation: { latitude: 31.6, longitude: 74.8 },
            },
            citizen: {
              name: 'Jane Doe',
              mobileNumber: phone,
              tenantId: TENANT,
            },
          },
          workflow: { action: 'APPLY' },
        },
      }
    );
    const createBody = await createResp.text();
    expect(createResp.ok(), `Create failed (${createResp.status()}): ${createBody.slice(0, 500)}`).toBe(true);

    let wrapper = (JSON.parse(createBody)).ServiceWrappers[0];
    const serviceRequestId = wrapper.service.serviceRequestId;
    expect(wrapper.service.applicationStatus).toBe('PENDINGFORASSIGNMENT');

    // Wait for async persistence before proceeding
    await sleep(3000);

    // Re-fetch to get persisted version
    const freshData = await searchWithRetry(request, token, uuid, serviceRequestId);
    wrapper = freshData.ServiceWrappers[0];

    // 2. ASSIGN
    const assignResp = await request.post('/pgr-services/v2/request/_update', {
      data: {
        RequestInfo: makeRequestInfo(token, uuid),
        service: wrapper.service,
        workflow: { action: 'ASSIGN', assignes: [uuid], comments: 'Assigned via Playwright' },
      },
    });
    const assignBody = await assignResp.text();
    expect(assignResp.ok(), `Assign failed (${assignResp.status()}): ${assignBody.slice(0, 500)}`).toBe(true);

    wrapper = (JSON.parse(assignBody)).ServiceWrappers[0];
    expect(wrapper.service.applicationStatus).toBe('PENDINGATLME');

    // Wait for persistence
    await sleep(2000);

    // 3. RESOLVE
    const resolveResp = await request.post('/pgr-services/v2/request/_update', {
      data: {
        RequestInfo: makeRequestInfo(token, uuid),
        service: wrapper.service,
        workflow: { action: 'RESOLVE', comments: 'Fixed via Playwright' },
      },
    });
    const resolveBody = await resolveResp.text();
    expect(resolveResp.ok(), `Resolve failed (${resolveResp.status()}): ${resolveBody.slice(0, 500)}`).toBe(true);

    wrapper = (JSON.parse(resolveBody)).ServiceWrappers[0];
    expect(wrapper.service.applicationStatus).toBe('RESOLVED');

    // Wait for persistence
    await sleep(2000);

    // 4. RATE & CLOSE
    const rateResp = await request.post('/pgr-services/v2/request/_update', {
      data: {
        RequestInfo: makeRequestInfo(token, uuid),
        service: wrapper.service,
        workflow: { action: 'RATE', assignes: [], rating: 5 },
      },
    });
    const rateBody = await rateResp.text();
    expect(rateResp.ok(), `Rate failed (${rateResp.status()}): ${rateBody.slice(0, 500)}`).toBe(true);

    wrapper = (JSON.parse(rateBody)).ServiceWrappers[0];
    expect(wrapper.service.applicationStatus).toBe('CLOSEDAFTERRESOLUTION');

    test.info().annotations.push({
      type: 'lifecycle',
      description: `${serviceRequestId}: APPLY -> ASSIGN -> RESOLVE -> RATE = CLOSEDAFTERRESOLUTION`,
    });

    await request.dispose();
  });
});
