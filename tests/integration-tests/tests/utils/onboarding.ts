/**
 * Shared onboarding-wizard helpers.
 *
 * The 16 onboarding specs used to each inline their own copy of the phase-walk
 * logic (loginAndCompletePhase1 / …Phases12 / …Phases123). That duplication is
 * exactly why they all drifted together when the configurator UI changed
 * (dual-path Phase 2 landing `caa9617f`, multi-level Phase 3 `019b1594`): a
 * single selector change had to be made in seven places and never was. This
 * module centralises the walk so the current UI is encoded once.
 *
 * Config is imported from ./env so onboarding inherits the suite's single
 * coherent default profile instead of re-hardcoding BASE_URL/tenant/creds.
 */
import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';
import { getDigitToken } from './auth';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from './env';

export const ROOT = ROOT_TENANT;

export interface OnboardingIds {
  SUFFIX: string;
  TENANT_CODE: string;
  TENANT_NAME: string;
  HIERARCHY_TYPE: string;
  BOUNDARY_ROOT: string;
  BOUNDARY_CHILD: string;
  DEPT_CODE: string;
  DESIG_CODE: string;
  EMPLOYEE_CODE: string;
}

/** Mint a unique tenant + master codes for one disposable onboarding run. */
export function freshOnboardingIds(): OnboardingIds {
  // egov-user validates `user.tenantId` against `^[a-zA-Z. ]*$` (letters/dot/space,
  // NO digits) on employee-create. The fresh tenant code below is used verbatim as
  // that tenantId in Phase 4, so a numeric suffix (e.g. `mz.pwt608494659`) makes
  // employee-create 400 while tenant/boundary/master creates accept it. Map the
  // digits → letters (0→a … 9→j) so the code stays unique but is letters-only.
  const SUFFIX = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`.replace(/[0-9]/g, (d) => String.fromCharCode(97 + Number(d)));
  return {
    SUFFIX,
    TENANT_CODE: `${ROOT}.pwt${SUFFIX}`,
    TENANT_NAME: `Playwright Test ${SUFFIX}`,
    HIERARCHY_TYPE: `PWHIER${SUFFIX}`,
    BOUNDARY_ROOT: `PWB1_${SUFFIX}`,
    BOUNDARY_CHILD: `PWB2_${SUFFIX}`,
    DEPT_CODE: `PWD_${SUFFIX}`,
    DESIG_CODE: `PWS_${SUFFIX}`,
    EMPLOYEE_CODE: `PWE_${SUFFIX}`,
  };
}

/** A temp path under os.tmpdir() for a generated xlsx fixture. */
export function tmpXlsx(prefix: string, suffix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${suffix}.xlsx`);
}

// ── Fixture writers ─────────────────────────────────────────────────────────

export async function writeTenantFixture(file: string, ids: OnboardingIds): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Tenant Info');
  sheet.columns = [
    { header: 'tenantCode', key: 'tenantCode' }, { header: 'tenantName', key: 'tenantName' },
    { header: 'displayName', key: 'displayName' }, { header: 'tenantType', key: 'tenantType' },
    { header: 'cityName', key: 'cityName' }, { header: 'districtName', key: 'districtName' },
    { header: 'latitude', key: 'latitude' }, { header: 'longitude', key: 'longitude' },
  ];
  sheet.addRow({
    tenantCode: ids.TENANT_CODE, tenantName: ids.TENANT_NAME, displayName: ids.TENANT_NAME,
    tenantType: 'City', cityName: ids.TENANT_NAME, districtName: 'Test District',
    latitude: 0.1, longitude: 0.1,
  });
  await wb.xlsx.writeFile(file);
}

export async function writeBoundaryFixture(file: string, ids: OnboardingIds): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Boundary');
  sheet.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'boundaryType', key: 'boundaryType' }, { header: 'parentCode', key: 'parentCode' },
    { header: 'latitude', key: 'latitude' }, { header: 'longitude', key: 'longitude' },
  ];
  // boundaryType must be a DIRECT descendant of its parent's type in the
  // Phase-2 hierarchy definition. Phase 2 (createHierarchyOption1) creates the
  // wizard's default chain Country → State → City → Ward, so the child here has
  // to be `State` (Country's direct child). Using `City` skipped `State` and
  // boundary-service rejected the child relationship with HIERARCHY_ERROR
  // ("child should be the direct descendant of parent's boundary hierarchy
  // type") — the entity landed but the relationship never persisted, so the
  // wizard's verify-retry loop spun until the spec's 60s timeout.
  sheet.addRow({ code: ids.BOUNDARY_ROOT, name: `Country ${ids.SUFFIX}`, boundaryType: 'Country', parentCode: '', latitude: 0.1, longitude: 0.1 });
  sheet.addRow({ code: ids.BOUNDARY_CHILD, name: `State ${ids.SUFFIX}`, boundaryType: 'State', parentCode: ids.BOUNDARY_ROOT, latitude: 0.1, longitude: 0.1 });
  await wb.xlsx.writeFile(file);
}

/**
 * Common-masters workbook. Post-`019b1594` the Common Master sheet carries only
 * Departments + Designations — complaint types moved to the Step 3.2 hierarchy
 * flow. `deptCount`/`desigCount` let multi-row specs assert the preview counts.
 */
export async function writeMastersFixture(
  file: string, ids: OnboardingIds, opts: { deptCount?: number; desigCount?: number } = {},
): Promise<void> {
  const deptCount = opts.deptCount ?? 1;
  const desigCount = opts.desigCount ?? 1;
  const wb = new ExcelJS.Workbook();
  const dept = wb.addWorksheet('Departments');
  dept.columns = [{ header: 'code', key: 'code' }, { header: 'name', key: 'name' }, { header: 'active', key: 'active' }];
  for (let i = 1; i <= deptCount; i++) {
    dept.addRow({ code: `PWD${i}_${ids.SUFFIX}`, name: `Dept ${i} ${ids.SUFFIX}`, active: true });
  }
  const desig = wb.addWorksheet('Designations');
  desig.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'description', key: 'description' }, { header: 'department', key: 'department' },
    { header: 'active', key: 'active' },
  ];
  for (let i = 1; i <= desigCount; i++) {
    desig.addRow({ code: `PWS${i}_${ids.SUFFIX}`, name: `Desig ${i} ${ids.SUFFIX}`, description: 'PW', department: `PWD1_${ids.SUFFIX}`, active: true });
  }
  await wb.xlsx.writeFile(file);
}

/** The single-dept-single-desig masters fixture the phase4 specs seed. */
export async function writeMastersSingle(file: string, ids: OnboardingIds): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const dept = wb.addWorksheet('Departments');
  dept.columns = [{ header: 'code', key: 'code' }, { header: 'name', key: 'name' }, { header: 'active', key: 'active' }];
  dept.addRow({ code: ids.DEPT_CODE, name: `Test Dept ${ids.SUFFIX}`, active: true });
  const desig = wb.addWorksheet('Designations');
  desig.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'description', key: 'description' }, { header: 'department', key: 'department' },
    { header: 'active', key: 'active' },
  ];
  desig.addRow({ code: ids.DESIG_CODE, name: `Test Desig ${ids.SUFFIX}`, description: 'PW', department: ids.DEPT_CODE, active: true });
  await wb.xlsx.writeFile(file);
}

/**
 * Step 3.2 complaint-hierarchy workbook, matching
 * `parseComplaintHierarchyExcel` (configurator/src/utils/excelParser.ts): sheet
 * name `ComplaintHierarchy`, one column per level code + the three leaf-attr
 * columns. Defaults to the wizard's default 4-level chain so the spec can leave
 * the Step 3.2 "define levels" form untouched.
 */
export async function writeComplaintHierarchyFixture(
  file: string,
  ids: OnboardingIds,
  levels: string[] = ['AUTHORITY_TYPE', 'MAIN_CATEGORY', 'SECTOR', 'SUB_TYPE'],
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('ComplaintHierarchy');
  const header = [...levels, 'Department Name*', 'Resolution Time (Hours)*', 'Search Words*'];
  sheet.addRow(header);
  // One fully-specified path → exactly one leaf sub-type.
  const leaf = `PWSUB_${ids.SUFFIX}`;
  const pathVals = levels.map((lc, i) => (i === levels.length - 1 ? leaf : `PW${lc}_${ids.SUFFIX}`));
  sheet.addRow([...pathVals, ids.DEPT_CODE || 'DEPT_1', 48, 'pw']);
  await wb.xlsx.writeFile(file);
}

export async function writeEmployeesFixture(
  file: string, ids: OnboardingIds, mobile: string,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Employee');
  sheet.columns = [
    { header: 'employeeCode', key: 'employeeCode' }, { header: 'name', key: 'name' },
    { header: 'mobileNumber', key: 'mobileNumber' }, { header: 'dob', key: 'dob' },
    { header: 'department', key: 'department' }, { header: 'designation', key: 'designation' },
    { header: 'roles', key: 'roles' }, { header: 'jurisdictions', key: 'jurisdictions' },
    { header: 'dateOfAppointment', key: 'dateOfAppointment' },
  ];
  sheet.addRow({
    employeeCode: ids.EMPLOYEE_CODE, name: `PW Employee ${ids.SUFFIX}`, mobileNumber: mobile,
    dob: '1990-01-01', department: ids.DEPT_CODE, designation: ids.DESIG_CODE,
    // EMPLOYEE is the universal baseline role under ACCESSCONTROL-ROLES at root;
    // safer than PGR-specific roles that may not exist on every deployment.
    roles: 'EMPLOYEE', jurisdictions: ids.BOUNDARY_ROOT, dateOfAppointment: '2024-01-01',
  });
  await wb.xlsx.writeFile(file);
}

// ── Teardown ────────────────────────────────────────────────────────────────

/** Soft-delete a tenant via API — the configurator has no UI delete (#21). */
export async function deactivateTenantViaApi(code: string): Promise<void> {
  const token = await getDigitToken({ tenant: ROOT, username: ADMIN_USER, password: ADMIN_PASS });
  const ri = { apiId: 'Rainmaker', ver: '1.0', ts: Date.now(), msgId: `${Date.now()}|en_IN`, authToken: token.access_token };
  const searchResp = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: ri, MdmsCriteria: { tenantId: ROOT, schemaCode: 'tenant.tenants', uniqueIdentifiers: [code] } }),
  });
  if (!searchResp.ok) return;
  const record = ((await searchResp.json()) as { mdms?: Array<Record<string, unknown>> }).mdms?.[0];
  if (!record) return;
  await fetch(`${BASE_URL}/mdms-v2/v2/_update/tenant.tenants`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: ri, Mdms: { ...record, isActive: false } }),
  });
}

// ── Phase-walk building blocks ──────────────────────────────────────────────

/** Log in on the configurator in Onboarding mode; lands on /configurator/phase/1. */
export async function loginOnboarding(page: Page): Promise<void> {
  await page.goto('/configurator/login');
  await expect(page.locator('#username')).toBeVisible();
  await page.locator('#username').fill(ADMIN_USER);
  await page.locator('#password').fill(ADMIN_PASS);
  await page.locator('#tenantCode').click();
  await page.locator('#tenantCode').fill(ROOT);
  await page.getByRole('button', { name: /^Onboarding$/ }).click();
  await Promise.all([
    page.waitForURL(/\/configurator\/phase\/1/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Sign In/i }).click(),
  ]);
}

/** Phase 1: upload tenant xlsx, skip branding; lands on /configurator/phase/2. */
export async function completePhase1(page: Page, ids: OnboardingIds, tenantFixture: string): Promise<void> {
  await page.getByRole('button', { name: /Start Setup/i }).click();
  await page.locator('input[type="file"]').first().setInputFiles(tenantFixture);
  await expect(page.getByRole('cell', { name: ids.TENANT_CODE })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Upload to DIGIT/i }).click();
  await expect(page.getByText('Step 1.2: Branding assets')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await expect(page.getByText('Phase 1 Complete!')).toBeVisible({ timeout: 30_000 });
  await Promise.all([
    page.waitForURL(/\/configurator\/phase\/2/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Continue to Phase 2/i }).click(),
  ]);
}

/**
 * Phase 2 now opens on a "Choose Your Data Source" landing (OpenStreetMap vs
 * Upload-from-Excel, `caa9617f`). The Excel path — Option 1/Option 2 hierarchy
 * cards ("Choose Your Path") — is behind the "Upload from Excel" card. Click it
 * to reach the excel-landing step.
 */
export async function enterPhase2ExcelLanding(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Upload from Excel/i }).click();
  await expect(page.getByText('Choose Your Path')).toBeVisible({ timeout: 15_000 });
}

/** From excel-landing: create a fresh hierarchy (Option 1) and land on Boundary Data Upload. */
export async function createHierarchyOption1(page: Page, ids: OnboardingIds): Promise<void> {
  await page.getByRole('button', { name: /Option 1: Create New Hierarchy/i }).click();
  await expect(page.locator('#hierarchyType')).toBeVisible({ timeout: 15_000 });
  await page.locator('#hierarchyType').fill(ids.HIERARCHY_TYPE);
  await page.getByRole('button', { name: /Create Hierarchy/i }).click();
  await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 60_000 });
}

/** Upload the boundary xlsx and confirm creation (leaves the wizard ready to continue to Phase 3). */
export async function uploadBoundaries(page: Page, boundaryFixture: string): Promise<void> {
  await page.locator('input[type="file"]').first().setInputFiles(boundaryFixture);
  await expect(page.getByText('Verify Boundary Data')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Upload \d+ Boundaries/i }).click();
  await expect(page.getByText('Boundaries Created Successfully!')).toBeVisible({ timeout: 60_000 });
}

/** Full Phase 2 (Excel path): enter excel landing → create hierarchy → upload boundaries → go to Phase 3. */
export async function completePhase2(page: Page, ids: OnboardingIds, boundaryFixture: string): Promise<void> {
  await enterPhase2ExcelLanding(page);
  await createHierarchyOption1(page, ids);
  await uploadBoundaries(page, boundaryFixture);
  await Promise.all([
    page.waitForURL(/\/configurator\/phase\/3/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Continue to Phase 3/i }).click(),
  ]);
}

/** Phase 3 Step 3.1: Start Setup + upload the common-masters xlsx; leaves the wizard on the preview step. */
export async function phase3UploadMasters(page: Page, mastersFixture: string): Promise<void> {
  await page.getByRole('button', { name: /Start Setup/i }).click();
  await expect(page.getByText('Step 3.1: Upload Common Master Excel')).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(mastersFixture);
}

/**
 * Drive from the Phase 3 masters preview all the way to "Phase 3 Complete!":
 * "Create & Continue" (was "Create All", renamed `019b1594`) → creating-depts →
 * Step 3.2 Define Complaint Hierarchy (leave the default 4 levels) → Next:
 * Template → upload the complaint-hierarchy xlsx → Create N Sub-types.
 */
export async function completePhase3(page: Page, hierarchyFixture: string): Promise<void> {
  await page.getByRole('button', { name: /^Create & Continue$/ }).click();
  // Step 3.2 — define levels (defaults are fine), advance to the template step.
  await expect(page.getByText('Step 3.2: Define Complaint Hierarchy')).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: /Next: Template/i }).click();
  await expect(page.getByText('Step 3.2: Download & Upload Template')).toBeVisible({ timeout: 15_000 });
  await page.locator('#ch-file-upload').setInputFiles(hierarchyFixture);
  await expect(page.getByText('Step 3.2: Verify & Create')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Create \d+ Sub-types?/i }).click();
  await expect(page.getByText('Phase 3 Complete!')).toBeVisible({ timeout: 120_000 });
}

/** Composite: Phases 1→2→3 complete, ready at the "Continue to Phase 4" gate. */
export async function completePhases123(
  page: Page,
  ids: OnboardingIds,
  fixtures: { tenant: string; boundary: string; masters: string; hierarchy: string },
): Promise<void> {
  await loginOnboarding(page);
  await completePhase1(page, ids, fixtures.tenant);
  await completePhase2(page, ids, fixtures.boundary);
  await phase3UploadMasters(page, fixtures.masters);
  await completePhase3(page, fixtures.hierarchy);
}
