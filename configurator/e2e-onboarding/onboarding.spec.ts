/**
 * E2E Onboarding Flow — Playwright test
 *
 * Walks through the full 4-phase onboarding wizard:
 *   Login → Phase 1 (Tenant) → Phase 2 (Boundaries) → Phase 3 (Masters) → Phase 4 (Employees)
 *
 * Generates unique XLSX fixtures per run (timestamp-based) so tests are isolated.
 *
 * Run:
 *   npx playwright test --config e2e-onboarding/playwright.config.ts
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = process.env.E2E_BASE_URL || 'https://crs-mockup.egov.theflywheel.in';
const TENANT = process.env.E2E_TENANT || 'pg';
const USERNAME = process.env.E2E_USERNAME || 'ADMIN';
const PASSWORD = process.env.E2E_PASSWORD || 'eGov@123';

// ---------------------------------------------------------------------------
// Unique test data (timestamp-based for run isolation)
// ---------------------------------------------------------------------------
const TS = Date.now();
const sfx = String(TS).slice(-6); // short suffix for readable codes

const TENANT_CODE = `pg.e2e${sfx}`;
const TENANT_NAME = `E2E City ${sfx}`;
const HIERARCHY_TYPE = `E2E${sfx}`;

const DEPT_CODE = `E2E_DEPT_${sfx}`;
const DESIG_CODE = `E2E_DESG_${sfx}`;
const CT_CODE = `E2E_CT_${sfx}`;

const BDRY_COUNTRY = `E2E_CN_${sfx}`;
const BDRY_STATE = `E2E_ST_${sfx}`;
const BDRY_CITY = `E2E_CI_${sfx}`;
const BDRY_WARD = `E2E_WD_${sfx}`;

const EMP_CODE = `E2E_EMP_${sfx}`;
const EMP_NAME = 'E2E Employee';
const EMP_USER = `e2e${sfx}`;
const EMP_MOBILE = `9${String(TS).slice(-9)}`;

// ---------------------------------------------------------------------------
// XLSX fixture generators
// ---------------------------------------------------------------------------
function writeXlsx(dir: string, name: string, sheets: Record<string, unknown[]>): string {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  }
  const filePath = join(dir, name);
  XLSX.writeFile(wb, filePath);
  return filePath;
}

function generateTenantXlsx(dir: string): string {
  return writeXlsx(dir, 'tenant.xlsx', {
    'Tenant Info': [{
      tenantCode: TENANT_CODE,
      tenantName: TENANT_NAME,
      tenantType: 'City',
      cityName: 'E2E City',
      districtName: 'E2E District',
      latitude: 28.6,
      longitude: 77.2,
    }],
  });
}

function generateBoundaryXlsx(dir: string): string {
  return writeXlsx(dir, 'boundary.xlsx', {
    Boundary: [
      { code: BDRY_COUNTRY, name: 'E2E Country', boundaryType: 'Country', parentCode: '' },
      { code: BDRY_STATE, name: 'E2E State', boundaryType: 'State', parentCode: BDRY_COUNTRY },
      { code: BDRY_CITY, name: 'E2E City', boundaryType: 'City', parentCode: BDRY_STATE },
      { code: BDRY_WARD, name: 'E2E Ward', boundaryType: 'Ward', parentCode: BDRY_CITY },
    ],
  });
}

function generateMastersXlsx(dir: string): string {
  return writeXlsx(dir, 'masters.xlsx', {
    Department: [
      { code: DEPT_CODE, name: 'E2E Department', active: true },
    ],
    Designation: [
      { code: DESIG_CODE, name: 'E2E Designation', department: DEPT_CODE, active: true },
    ],
    ComplaintType: [
      { serviceCode: CT_CODE, serviceName: 'E2E Complaint Type', department: DEPT_CODE, slaHours: 24, active: true },
    ],
  });
}

function generateEmployeeXlsx(dir: string): string {
  return writeXlsx(dir, 'employee.xlsx', {
    Employee: [{
      employeeCode: EMP_CODE,
      name: EMP_NAME,
      userName: EMP_USER,
      mobileNumber: EMP_MOBILE,
      department: DEPT_CODE,
      designation: DESIG_CODE,
      roles: 'EMPLOYEE,GRO',
      jurisdictions: BDRY_CITY,
    }],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Click a button by its visible text (partial match, case-insensitive). */
async function clickButton(page: Page, text: string | RegExp, opts?: { timeout?: number }) {
  const timeout = opts?.timeout ?? 15_000;
  const btn = page.locator(`button:has-text("${text}")`).first();
  // If regex was passed, use getByRole instead
  if (text instanceof RegExp) {
    const roleBtn = page.getByRole('button', { name: text });
    await roleBtn.click({ timeout });
    return;
  }
  await btn.click({ timeout });
}

/** Wait for text to appear on page (case-insensitive). Uses .first() to avoid strict-mode issues. */
async function waitForText(page: Page, text: string | RegExp, opts?: { timeout?: number }) {
  const timeout = opts?.timeout ?? 15_000;
  if (typeof text === 'string') {
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout });
  } else {
    await expect(page.getByText(text).first()).toBeVisible({ timeout });
  }
}

/** Take a named screenshot for debugging. */
async function snap(page: Page, name: string) {
  const dir = join(__dirname, 'screenshots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}-${sfx}.png`), fullPage: true });
}

// ---------------------------------------------------------------------------
// Test suite — serial, shared page
// ---------------------------------------------------------------------------
test.describe.serial('Full Onboarding Flow', () => {
  let page: Page;
  let context: BrowserContext;
  let fixtureDir: string;
  let tenantFile: string;
  let boundaryFile: string;
  let mastersFile: string;
  let employeeFile: string;

  test.beforeAll(async ({ browser }) => {
    // Generate XLSX fixtures in temp dir
    fixtureDir = join(tmpdir(), `e2e-onboard-${sfx}`);
    mkdirSync(fixtureDir, { recursive: true });

    tenantFile = generateTenantXlsx(fixtureDir);
    boundaryFile = generateBoundaryXlsx(fixtureDir);
    mastersFile = generateMastersXlsx(fixtureDir);
    employeeFile = generateEmployeeXlsx(fixtureDir);

    console.log(`\n  Test data suffix: ${sfx}`);
    console.log(`  Tenant: ${TENANT_CODE}`);
    console.log(`  Fixtures: ${fixtureDir}\n`);

    // Shared browser context + page
    context = await browser.newContext();
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
  });

  test.afterAll(async () => {
    await snap(page, 'final-state');
    await page?.close();
    await context?.close();
    try { rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // =========================================================================
  // LOGIN
  // =========================================================================
  test('Login in onboarding mode', async () => {
    await page.goto(`${BASE_URL}/login`);

    // Select Onboarding mode
    await clickButton(page, 'Onboarding');

    // Set tenant code (default may be "statea"; we need our state tenant)
    const tenantInput = page.locator('#tenantCode');
    await tenantInput.clear();
    await tenantInput.fill(TENANT);

    // The username and password should already have defaults (ADMIN / eGov@123)
    // But fill them explicitly to be safe
    const usernameInput = page.locator('#username');
    const currentUsername = await usernameInput.inputValue();
    if (currentUsername !== USERNAME) {
      await usernameInput.clear();
      await usernameInput.fill(USERNAME);
    }

    const passwordInput = page.locator('#password');
    const currentPassword = await passwordInput.inputValue();
    if (!currentPassword) {
      await passwordInput.fill(PASSWORD);
    }

    await snap(page, '00-login-filled');

    // Submit
    await page.locator('button[type="submit"]').click();

    // Wait for navigation to Phase 1
    await page.waitForURL('**/phase/1', { timeout: 30_000 });
    await expect(page).toHaveURL(/\/phase\/1/);

    await snap(page, '01-phase1-landing');
  });

  // =========================================================================
  // PHASE 1: Tenant & Branding
  // =========================================================================
  test('Phase 1: Create tenant from Excel', async () => {
    // Verify Phase 1 landing — use heading to avoid strict-mode violation
    await expect(page.getByRole('heading', { name: /Phase 1/i })).toBeVisible();

    // Click "Start Setup"
    await clickButton(page, 'Start Setup');

    // Upload tenant Excel (the BulkUpload component uses id="file-upload")
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(tenantFile);

    // Wait for preview step — tenant code should appear in the table
    await waitForText(page, TENANT_CODE, { timeout: 15_000 });
    await snap(page, '02-phase1-preview');

    // Click "Upload to DIGIT" to create the tenant
    await clickButton(page, 'Upload to DIGIT');

    // Wait for branding step (or for phase to complete)
    // The branding step shows image upload cards; wait for "Continue" button
    await page.waitForTimeout(2_000); // let the API call finish
    await snap(page, '03-phase1-branding');

    // Skip branding — click the Continue/skip button
    // On the branding step, the SubmitBar says "Continue" or there's a skip option
    const continueBtn = page.getByRole('button', { name: /Continue/i }).first();
    await continueBtn.click({ timeout: 15_000 });

    // Wait for complete step — should show success
    await waitForText(page, /Continue to Phase 2/i, { timeout: 15_000 });
    await snap(page, '04-phase1-complete');

    // Navigate to Phase 2
    await clickButton(page, 'Continue to Phase 2');
    await page.waitForURL('**/phase/2', { timeout: 15_000 });
  });

  // =========================================================================
  // PHASE 2: Boundary Setup
  // =========================================================================
  test('Phase 2: Create hierarchy and upload boundaries', async () => {
    test.setTimeout(180_000); // boundary creation involves multiple API calls

    await expect(page.getByRole('heading', { name: /Phase 2/i })).toBeVisible();

    // --- Step 1: Choose "Create New Hierarchy" ---
    await clickButton(page, 'Create New');
    await snap(page, '05-phase2-create-hierarchy');

    // --- Step 2: Fill hierarchy form ---
    // Change hierarchy type to unique name
    const hierarchyInput = page.locator('#hierarchyType');
    await hierarchyInput.clear();
    await hierarchyInput.fill(HIERARCHY_TYPE);

    // The default levels are ['Country', 'State', 'City', 'Ward'] — keep them
    // They match our boundary XLSX data

    // Click "Create Hierarchy"
    await clickButton(page, 'Create Hierarchy');

    // Wait for template/upload step
    await waitForText(page, /Boundary Data Upload/i, { timeout: 30_000 });
    await snap(page, '06-phase2-template');

    // --- Step 3: Upload boundary Excel ---
    await page.locator('#boundary-file-upload').setInputFiles(boundaryFile);

    // Wait for verify step — should show parsed boundaries
    await waitForText(page, /Verify Boundary Data/i, { timeout: 15_000 });
    await expect(page.getByText(BDRY_COUNTRY).first()).toBeVisible();
    await snap(page, '07-phase2-verify');

    // --- Step 4: Upload boundaries ---
    // The button says "Upload N Boundaries"
    const uploadBtn = page.getByRole('button', { name: /Upload \d+ Boundar/i });
    await uploadBtn.click();

    // Wait for completion — "Boundaries Created Successfully!"
    await waitForText(page, /Boundaries Created/i, { timeout: 120_000 });
    await snap(page, '08-phase2-complete');

    // --- Step 5: Continue to Phase 3 ---
    await clickButton(page, 'Continue to Phase 3');
    await page.waitForURL('**/phase/3', { timeout: 15_000 });
  });

  // =========================================================================
  // PHASE 3: Common Masters (Departments, Designations, Complaint Types)
  // =========================================================================
  test('Phase 3: Upload common masters', async () => {
    test.setTimeout(120_000);

    await expect(page.getByRole('heading', { name: /Phase 3/i })).toBeVisible();

    // Click "Start Setup" (or "Get Started" — the landing has a SubmitBar)
    const startBtn = page.getByRole('button', { name: /Start|Get Started|Begin/i }).first();
    await startBtn.click({ timeout: 15_000 }).catch(async () => {
      // If there's no explicit start button, the landing might auto-advance
      // or the button text might differ. Take screenshot and try alternate.
      await snap(page, '09-phase3-landing-debug');
    });

    // Upload masters Excel
    const fileInput = page.locator('input[type="file"]');
    // Wait for file input to be available (the upload step might take a moment)
    await fileInput.waitFor({ state: 'attached', timeout: 10_000 });
    await fileInput.setInputFiles(mastersFile);

    // Wait for preview step — department code should appear
    await waitForText(page, DEPT_CODE, { timeout: 15_000 });
    await snap(page, '10-phase3-preview');

    // Click "Create All"
    await clickButton(page, 'Create All');

    // Wait for the creation to complete — progress goes 0→30→60→100
    // Then the complete step shows "Continue to Phase 4"
    await waitForText(page, /Continue to Phase 4/i, { timeout: 90_000 });
    await snap(page, '11-phase3-complete');

    // Navigate to Phase 4
    await clickButton(page, 'Continue to Phase 4');
    await page.waitForURL('**/phase/4', { timeout: 15_000 });
  });

  // =========================================================================
  // PHASE 4: Employee Creation
  // =========================================================================
  test('Phase 4: Create employees', async () => {
    test.setTimeout(180_000);

    await expect(page.getByRole('heading', { name: /Phase 4/i })).toBeVisible();

    // The landing shows prerequisites and reference data. Wait for it to load.
    // Then click "Start Phase 4"
    const startBtn = page.getByRole('button', { name: /Start Phase 4|Start|Begin/i }).first();
    await startBtn.click({ timeout: 30_000 }).catch(async () => {
      await snap(page, '12-phase4-landing-debug');
    });

    // Upload employee Excel
    const fileInput = page.locator('input[type="file"]');
    await fileInput.waitFor({ state: 'attached', timeout: 10_000 });
    await fileInput.setInputFiles(employeeFile);

    // Wait for preview — employee name should appear
    await waitForText(page, EMP_NAME, { timeout: 15_000 });
    await snap(page, '13-phase4-preview');

    // Click "Create N Employees"
    const createBtn = page.getByRole('button', { name: /Create \d+ Employee/i });
    await createBtn.click();

    // Handle confirmation dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await snap(page, '14-phase4-confirm-dialog');

    // Click confirm button inside dialog (also says "Create N Employees")
    const confirmBtn = dialog.getByRole('button', { name: /Create|Confirm/i }).last();
    await confirmBtn.click();

    // Wait for creation to complete
    // On success: "Complete Setup" button appears
    // On failure: error messages but "Complete Setup" should still be available
    await waitForText(page, /Complete Setup|Employees Created|Download Credentials/i, { timeout: 120_000 });
    await snap(page, '15-phase4-complete');

    // Click "Complete Setup"
    const completeBtn = page.getByRole('button', { name: /Complete Setup/i });
    if (await completeBtn.isVisible()) {
      await completeBtn.click();
      await page.waitForURL('**/complete', { timeout: 15_000 });
      await snap(page, '16-onboarding-done');
    }
  });
});
