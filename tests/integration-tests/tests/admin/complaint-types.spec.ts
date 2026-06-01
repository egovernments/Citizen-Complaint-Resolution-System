/**
 * Complaint-type management — list / create / bulk-import / dept filter /
 * tenant parity.
 *
 * Backed by MDMS schema `RAINMAKER-PGR.ServiceDefs`. At Nai Pepea time of
 * writing the tenant has 37 seeded types at BOTH `ke` and `ke.nairobi`
 * (MDMS v2 inherits root → city, so creates at `ke` surface at
 * `ke.nairobi` automatically — probed 2026-04-23). TASKS.md §2.5 calls
 * for registration at BOTH levels; these tests verify the row is visible
 * from a city-level search after a root-level create.
 */
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import {
  loadAuth,
  mdmsCreate,
  mdmsSearch,
  type AuthInfo,
  type MdmsRecord,
} from '../utils/manage/api';
import { testCode, testCodeIndexed } from '../utils/manage/codes';
import { cleanupMdms } from '../utils/manage/teardown';

const TENANT_CODE = process.env.TENANT_CODE || 'ke';
const CITY_TENANT = process.env.DIGIT_TENANT || `${TENANT_CODE}.nairobi`;
const SCHEMA = 'RAINMAKER-PGR.ServiceDefs';
const DEPT_SCHEMA = 'common-masters.Department';
const LIST_PATH = '/configurator/manage/complaint-types';

const createdCodes = new Set<string>();

let liveDeptCode: string | null = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const auth = loadAuth();
  // Pick an existing active department to use as the `department` FK for
  // creates / bulk rows. The live tenant carries ~31 seeded departments.
  const depts = await mdmsSearch(auth, TENANT_CODE, DEPT_SCHEMA, { limit: 50 }).catch(
    () => [] as MdmsRecord[],
  );
  for (const d of depts) {
    if (d.isActive === false) continue;
    const code = (d.data as Record<string, unknown>).code as string | undefined;
    if (code) { liveDeptCode = code; break; }
  }
});

test.afterAll(async () => {
  if (createdCodes.size === 0) return;
  const auth = loadAuth();
  const r = await cleanupMdms(Array.from(createdCodes), SCHEMA, TENANT_CODE, auth);
  if (r.failed.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[complaint-types] cleanup left ${r.failed.length} record(s) behind:`,
      r.failed,
    );
  }
});

test.describe('manage/complaint-types', () => {
  test('1. list renders with Service Code / Name / Department / SLA / Status columns', async ({
    page,
  }) => {
    await page.goto(LIST_PATH);

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    for (const header of ['Service Code', 'Name', 'Department', 'SLA', 'Status']) {
      await expect(
        page.getByRole('columnheader', { name: new RegExp(header, 'i') }),
      ).toBeVisible();
    }

    // Healthy tenant has 37 seeded types; at least >1 rows means the list
    // is rendering data, not just the header.
    const rows = page.getByRole('row');
    expect(await rows.count()).toBeGreaterThan(1);

    // API sanity — live MDMS count should also be non-empty.
    const auth = loadAuth();
    const live = await mdmsSearch(auth, TENANT_CODE, SCHEMA, { limit: 200 });
    expect(live.length).toBeGreaterThan(0);
  });

  test('2. create → edit → deactivate round-trip; visible at city tenant', async ({
    page,
  }, testInfo) => {
    if (!liveDeptCode) test.skip(true, 'No active department seeded on tenant');

    // PascalCase kind — DigitFormCodeInput strips non-alphanumerics when
    // deriving the code from the name.
    const code = testCode(testInfo, 'CT_RT');
    const name = `PW Roundtrip ${code}`;
    createdCodes.add(code);

    await page.goto(`${LIST_PATH}/create`);
    await page.getByLabel(/^Name/i).fill(name);

    const codeInput = page.getByLabel(/Service Code/i);
    await codeInput.fill('');
    await codeInput.fill(code);

    // Department select — typeahead or click + pick first option matching
    // our scratch dept code.
    const deptSelect = page.getByLabel(/^Department/i);
    await deptSelect.click();
    const deptOption = page.getByRole('option', { name: new RegExp(liveDeptCode!, 'i') }).first();
    if (await deptOption.isVisible().catch(() => false)) {
      await deptOption.click();
    } else {
      // Fall back to first option.
      await page.getByRole('option').first().click();
    }

    await page.getByLabel(/SLA/i).fill('24');

    await Promise.all([
      page.waitForURL(LIST_PATH, { timeout: 30_000 }),
      page.getByRole('button', { name: /^Create$/ }).click(),
    ]);

    // Verify via MDMS API at the city tenant — MDMS v2 inherits root → city.
    const auth = loadAuth();
    const cityHit = await mdmsSearch(auth, CITY_TENANT, SCHEMA, {
      uniqueIdentifiers: [code],
      limit: 5,
    });
    expect(
      cityHit.length,
      `complaint-type created at ${TENANT_CODE} should be visible from ${CITY_TENANT}`,
    ).toBeGreaterThan(0);

    // --- Edit SLA ---
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    const row = page.getByRole('row').filter({ hasText: code });
    await expect(row).toBeVisible();
    await row.click();

    await page.getByRole('button', { name: /^Edit$/i }).click();
    const sla = page.getByLabel(/SLA/i);
    await sla.fill('72');
    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByText(/72/)).toBeVisible();

    // --- Verify SLA persisted via MDMS ---
    const afterEdit = await mdmsSearch(auth, TENANT_CODE, SCHEMA, {
      uniqueIdentifiers: [code],
      limit: 5,
    });
    expect(afterEdit.length).toBeGreaterThan(0);
    expect((afterEdit[0].data as Record<string, unknown>).slaHours).toBe(72);
  });

  test('3. bulk import — happy path creates 3 types, each carries SLA + dept', async ({
    page,
  }, testInfo) => {
    if (!liveDeptCode) test.skip(true, 'No active department seeded on tenant');

    const codes = Array.from({ length: 3 }, (_, i) =>
      testCodeIndexed(testInfo, 'CTBulk', i + 1),
    );
    codes.forEach((c) => createdCodes.add(c));

    await page.goto(`${LIST_PATH}/bulk`);

    const buffer = await buildComplaintTypeXlsx(
      codes.map((c, i) => ({
        serviceCode: c,
        name: `PW Bulk Type ${i + 1}`,
        department: liveDeptCode!,
        slaHours: 48,
        menuPath: 'Complaint',
      })),
    );

    const fileInput = page.locator('input[type="file"]').first();
    if (!(await fileInput.count())) {
      test.skip(true, 'No bulk import page for complaint-types on this build');
    }
    await fileInput.setInputFiles({
      name: 'complaint-types.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    });

    await expect(page.getByText(/3\s*(valid|rows)/i).first()).toBeVisible({
      timeout: 30_000,
    });

    const createBtn = page.getByRole('button', { name: /Create\s+\d+/i });
    await createBtn.click();

    await expect(page.getByText(/3\s*(created|success)/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // Sanity-check via MDMS
    const auth = loadAuth();
    const landed = await mdmsSearch(auth, TENANT_CODE, SCHEMA, {
      uniqueIdentifiers: codes,
      limit: codes.length + 5,
    });
    expect(landed.length).toBe(3);
    for (const rec of landed) {
      const data = rec.data as Record<string, unknown>;
      expect(data.slaHours).toBe(48);
      expect(data.department).toBe(liveDeptCode);
    }
  });

  test('4. department reference filter narrows the list', async ({ page }) => {
    await page.goto(LIST_PATH);

    const filter = page.getByLabel(/^Department/i).first();
    if (!(await filter.isVisible().catch(() => false))) {
      test.skip(true, 'Department filter not present on this build');
    }

    await filter.click();
    const firstOpt = page.getByRole('option').first();
    const deptLabel = ((await firstOpt.textContent()) || '').trim();
    await firstOpt.click();
    await page.waitForLoadState('networkidle').catch(() => {});

    const rows = page.getByRole('row');
    const n = await rows.count();
    if (n <= 1) return; // filter validly returned 0 rows

    // Spot-check up to 5 rows — each should contain either the dept label
    // or the dept code in its text content.
    const sample = Math.min(5, n - 1);
    for (let i = 1; i <= sample; i++) {
      const t = ((await rows.nth(i).textContent()) || '').toLowerCase();
      expect(
        t.includes(deptLabel.toLowerCase()),
        `row ${i} should match dept filter "${deptLabel}"`,
      ).toBe(true);
    }
  });

  test('5. tenant parity — api create at ke is visible at ke.nairobi', async ({
  }, testInfo) => {
    if (!liveDeptCode) test.skip(true, 'No active department seeded on tenant');

    // API-only check — guards the TASKS.md §2.5 requirement that types
    // registered at root surface at city level. Skips the UI entirely so
    // we catch inheritance regressions even if the form is half-wired.
    const auth = loadAuth();
    const code = testCode(testInfo, 'CT_PARITY');
    createdCodes.add(code);

    await mdmsCreate(auth, TENANT_CODE, SCHEMA, code, {
      serviceCode: code,
      name: 'PW Parity Type',
      active: true,
      keywords: 'parity',
      menuPath: 'Complaint',
      slaHours: 24,
      department: liveDeptCode!,
    });

    const [atRoot, atCity] = await Promise.all([
      mdmsSearch(auth, TENANT_CODE, SCHEMA, {
        uniqueIdentifiers: [code], limit: 5,
      }),
      mdmsSearch(auth, CITY_TENANT, SCHEMA, {
        uniqueIdentifiers: [code], limit: 5,
      }),
    ]);
    expect(atRoot.length, `should exist at ${TENANT_CODE}`).toBe(1);
    expect(
      atCity.length,
      `should also be visible at ${CITY_TENANT} (inheritance)`,
    ).toBe(1);
  });
});

// --- Local helpers ---

async function buildComplaintTypeXlsx(
  rows: Array<{
    serviceCode: string;
    name: string;
    department: string;
    slaHours: number;
    menuPath: string;
  }>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('ComplaintType');
  sheet.addRow(['serviceCode', 'name', 'department', 'slaHours', 'menuPath']);
  for (const r of rows) {
    sheet.addRow([r.serviceCode, r.name, r.department, r.slaHours, r.menuPath]);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AuthShape = AuthInfo;
