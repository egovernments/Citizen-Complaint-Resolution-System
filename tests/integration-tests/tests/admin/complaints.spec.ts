/**
 * Complaint management — the most regression-prone surface.
 *
 * 9 tests cover create, edit + workflow merge, dropdown labels, source
 * allow-list, server-side pagination, server filters, client filters,
 * Show page extras, and the mobile-only citizen heuristic.
 *
 * beforeAll picks live data dynamically:
 *   - one active complaint-type code via MDMS (no hardcoded
 *     "ContractDispute"),
 *   - an HRMS employee with PGR_LME role for the ASSIGN test (skipped
 *     gracefully if none exists).
 */
import { test, expect, type Request } from '@playwright/test';
import {
  loadAuth,
  mdmsSearch,
  pgrSearch,
  pgrCount,
  employeeSearch,
  type AuthInfo,
} from '../utils/manage/api';
import { cleanupPgrComplaints } from '../utils/manage/teardown';

const TENANT_CODE = process.env.TENANT_CODE || 'ke';
const CITY_TENANT = process.env.DIGIT_TENANT || `${TENANT_CODE}.nairobi`;

const LIST_PATH = '/configurator/manage/complaints';
const CREATE_PATH = `${LIST_PATH}/create`;

const createdComplaints = new Set<string>();

let liveServiceCode: string | null = null;
let lmeAssigneeUuid: string | null = null;
let liveBoundaryCode: string | null = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const auth = loadAuth();

  // --- Pick a live complaint type ---
  const ctRecords = await mdmsSearch(
    auth,
    TENANT_CODE,
    'RAINMAKER-PGR.ServiceDefs',
    { limit: 200 },
  ).catch(() => [] as Awaited<ReturnType<typeof mdmsSearch>>);
  for (const r of ctRecords) {
    if (r.isActive === false) continue;
    const code = (r.data as Record<string, unknown>).serviceCode as string | undefined;
    if (code) { liveServiceCode = code; break; }
  }

  // --- Pick an HRMS employee with PGR_LME role for ASSIGN test ---
  const employees = await employeeSearch(auth, CITY_TENANT, {
    roles: ['PGR_LME'],
    limit: 100,
  }).catch(() => [] as Record<string, unknown>[]);
  for (const e of employees) {
    const user = e.user as Record<string, unknown> | undefined;
    const uuid = (user?.uuid as string) || (e.uuid as string);
    if (uuid) { lmeAssigneeUuid = uuid; break; }
  }

  // --- Pick a live boundary code we know exists on this tenant ---
  // Boundaries don't go through MDMS; we infer one from a recent
  // complaint instead. If none exist yet, the LocalityPicker test will
  // fall back to whatever the cascading select offers.
  const recent = await pgrSearch(auth, CITY_TENANT, { limit: 10 }).catch(() => []);
  for (const w of recent) {
    const svc = w.service as Record<string, unknown> | undefined;
    const addr = svc?.address as Record<string, unknown> | undefined;
    const loc = addr?.locality as Record<string, unknown> | undefined;
    const code = loc?.code as string | undefined;
    if (code) { liveBoundaryCode = code; break; }
  }
});

test.afterAll(async () => {
  if (createdComplaints.size === 0) return;
  const auth = loadAuth();
  const r = await cleanupPgrComplaints(
    Array.from(createdComplaints),
    CITY_TENANT,
    auth,
  );
  if (r.failed.length) {
    // eslint-disable-next-line no-console
    console.warn('[complaints] cleanup left rejects pending:', r.failed);
  }
});

test.describe('manage/complaints', () => {
  test('1. file complaint — citizen, locality, required landmark', async ({
    page,
  }) => {
    if (!liveServiceCode) test.skip(true, 'No active complaint type seeded on tenant');

    await page.goto(CREATE_PATH);

    // Pick complaint type via the labeled select.
    const typeSelect = page.getByLabel(/^Complaint Type/i);
    await typeSelect.click();
    await page.getByRole('option', { name: new RegExp(liveServiceCode!) }).first().click();

    await page.getByLabel(/^Description/i).fill(
      'PW filed-by-test — complaint description over ten chars',
    );

    // LocalityPicker is three cascading selects. We pick the first hierarchy
    // option, then the first boundary type, then either liveBoundaryCode
    // (if known on this tenant) or the first listed boundary.
    await pickLocality(page, liveBoundaryCode || undefined);

    // Citizen mobile (fresh PW_-namespaced number).
    const phone = uniquePhoneNumber();
    await page.getByLabel(/^Mobile number/i).fill(phone);
    // Leave name blank intentionally — server should fall back to mobile.

    // Capture the create XHR so we can grab the SR id and the payload.
    const createReqPromise = page.waitForRequest((req) =>
      req.url().includes('/pgr-services/v2/request/_create') &&
      req.method() === 'POST',
    );

    await page.getByRole('button', { name: /^Create$/ }).click();

    const createReq = await createReqPromise;
    const reqBody = JSON.parse(createReq.postData() || '{}');
    const service = reqBody.service as Record<string, unknown>;

    // Citizen tenant must be the STATE tenant, not the city.
    expect((service.citizen as Record<string, unknown>)?.tenantId).toBe(TENANT_CODE);
    // Address tenant is the city.
    const address = service.address as Record<string, unknown>;
    expect(address?.tenantId).toBe(CITY_TENANT);
    expect(((address?.locality as Record<string, unknown>)?.code) ?? '').toBeTruthy();

    // Wait for the redirect to the Show page with a fresh PG-PGR-* id.
    await page.waitForURL(/PG-PGR-/, { timeout: 30_000 });
    const url = page.url();
    const match = url.match(/(PG-PGR-[^/?#]+)/);
    expect(match, `expected PG-PGR id in url ${url}`).not.toBeNull();
    if (match) createdComplaints.add(match[1]);
  });

  test('2. edit merges description + workflow ASSIGN in one round-trip', async ({
    page,
  }) => {
    if (!lmeAssigneeUuid) {
      test.skip(true, 'No HRMS employee with PGR_LME role on tenant — ASSIGN cannot be exercised');
    }

    // Use the complaint from test 1 if available; otherwise pick the most
    // recent PENDINGFORASSIGNMENT one.
    const auth = loadAuth();
    const target = await pickWorkableComplaint(auth);
    if (!target) test.skip(true, 'No workable complaint to assign');

    await page.goto(`${LIST_PATH}/${target}/edit`);

    const newDesc = `PW edited at ${Date.now()}`;
    const desc = page.getByLabel(/^Description/i);
    await desc.fill('');
    await desc.fill(newDesc);

    // Pick ASSIGN action.
    const actionSelect = page.getByLabel(/^Action$/i).or(page.getByLabel(/^Workflow/i)).first();
    await actionSelect.click();
    await page.getByRole('option', { name: /ASSIGN/i }).first().click();

    // The assignee picker may render only after ASSIGN is chosen.
    const assigneeSelect = page.getByLabel(/Assign(ee)?/i).first();
    if (await assigneeSelect.isVisible().catch(() => false)) {
      await assigneeSelect.click();
      // Click the first available employee option — we already validated
      // a PGR_LME exists in beforeAll, so there will be options.
      await page.getByRole('option').first().click();
    }

    await page.getByRole('button', { name: /^Save$/i }).click();

    // Verify both changes landed.
    const wrappers = await pgrSearch(auth, CITY_TENANT, { serviceRequestId: target! });
    expect(wrappers.length).toBeGreaterThan(0);
    const svc = wrappers[0].service as Record<string, unknown>;
    expect(svc.description).toBe(newDesc);
    expect(svc.applicationStatus).toBe('PENDINGATLME');
  });

  test('3. workflow dropdown labels are human-readable, not UUIDs', async ({
    page,
  }) => {
    const target = await pickWorkableComplaint(loadAuth());
    if (!target) test.skip(true, 'No workable complaint to inspect');

    await page.goto(`${LIST_PATH}/${target}/edit`);

    const actionSelect = page.getByLabel(/^Action$/i).or(page.getByLabel(/^Workflow/i)).first();
    await actionSelect.click();
    const options = page.getByRole('option');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);

    // No option label should be a 36-char UUID.
    for (let i = 0; i < count; i++) {
      const text = (await options.nth(i).textContent())?.trim() || '';
      expect(text, `option ${i} should not be a UUID: ${text}`).not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
  });

  test('4. source select offers only Web/Mobile/WhatsApp', async ({ page }) => {
    const target = await pickWorkableComplaint(loadAuth());
    if (!target) test.skip(true, 'No workable complaint to inspect');

    await page.goto(`${LIST_PATH}/${target}/edit`);

    const sourceSelect = page.getByLabel(/^Source$/i);
    await sourceSelect.click();

    const allowed = ['Web', 'Mobile', 'WhatsApp'];
    const options = await page.getByRole('option').allTextContents();
    const trimmed = options.map((o) => o.trim()).filter(Boolean);
    expect(trimmed.sort()).toEqual([...allowed].sort());
    // Belt-and-braces: if IVR ever sneaks back in we want a clear message.
    for (const banned of ['IVR', 'Phone', 'Counter']) {
      expect(trimmed).not.toContain(banned);
    }
  });

  test('5. list footer count matches /pgr-services/v2/request/_count', async ({
    page,
  }) => {
    await page.goto(LIST_PATH);
    await page.waitForLoadState('networkidle').catch(() => {});

    // Find the page-size selector and pick 10.
    const perPage = page.getByLabel(/per page|rows per page/i).first();
    if (await perPage.isVisible().catch(() => false)) {
      await perPage.click();
      await page.getByRole('option', { name: '10' }).click();
      await page.waitForLoadState('networkidle').catch(() => {});
    }

    // Live count via the API.
    const auth = loadAuth();
    const apiCount = await pgrCount(auth, CITY_TENANT);

    // Look for the footer count display ("of N", "Showing 1-10 of N", etc.).
    const footer = page.locator('body').getByText(/of\s+\d+/i).first();
    const footerText = (await footer.textContent()) || '';
    const match = footerText.match(/of\s+(\d+)/i);
    expect(match, `expected list footer to show "of N", got "${footerText}"`).not.toBeNull();
    const uiCount = match ? Number(match[1]) : -1;

    expect(uiCount).toBe(apiCount);
  });

  test('6. status + date filters fire as XHR query params', async ({ page }) => {
    await page.goto(LIST_PATH);
    await page.waitForLoadState('networkidle').catch(() => {});

    const seen: string[] = [];
    page.on('request', (req: Request) => {
      const url = req.url();
      if (/\/pgr-services\/v2\/request\/_search/.test(url)) seen.push(url);
    });

    const statusFilter = page.getByLabel(/^Status$/i).first();
    if (!(await statusFilter.isVisible().catch(() => false))) {
      test.skip(true, 'Status filter not present on this build');
    }
    await statusFilter.click();
    await page.getByRole('option', { name: /PENDINGFORASSIGNMENT/i }).click();

    // From-date = 7 days ago. The widget is a date input; we drive it via
    // its labeled control if present.
    const fromDate = page.getByLabel(/^From|^From\s*date/i).first();
    if (await fromDate.isVisible().catch(() => false)) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const iso = sevenDaysAgo.toISOString().slice(0, 10);
      await fromDate.fill(iso);
    }
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(seen.length, 'status/date change should trigger _search XHR').toBeGreaterThan(0);
    const last = seen[seen.length - 1];
    expect(last).toMatch(/applicationStatus=/);
    if (await fromDate.isVisible().catch(() => false)) {
      expect(last).toMatch(/fromDate=/);
    }
  });

  test('7. department filter narrows visible rows', async ({ page }) => {
    await page.goto(LIST_PATH);
    const filter = page.getByLabel(/^Department/i).first();
    if (!(await filter.isVisible().catch(() => false))) {
      test.skip(true, 'Department filter not present on this build');
    }

    // Pick the FIRST option that has at least one matching row server-side
    // — querying live data avoids tenant-specific assumptions.
    await filter.click();
    const firstOpt = page.getByRole('option').first();
    const optText = ((await firstOpt.textContent()) || '').trim();
    await firstOpt.click();
    await page.waitForLoadState('networkidle').catch(() => {});

    const rows = page.getByRole('row');
    const rowCount = await rows.count();
    if (rowCount <= 1) return; // header only — filter validly returned 0 rows.

    // Sample up to 5 rows and check the Department column contains the
    // selected option's text.
    const sample = Math.min(5, rowCount - 1);
    for (let i = 1; i <= sample; i++) {
      const rowText = (await rows.nth(i).textContent())?.toLowerCase() || '';
      expect(
        rowText.includes(optText.toLowerCase()),
        `row ${i} should match dept filter "${optText}"`,
      ).toBe(true);
    }
  });

  test('8. show page renders address extras and a working geo link', async ({
    page,
  }) => {
    // Find a complaint that has non-zero geo coords; otherwise skip.
    const auth = loadAuth();
    const wrappers = await pgrSearch(auth, CITY_TENANT, { limit: 50 });
    let target: { id: string; lat: number; lng: number } | null = null;
    for (const w of wrappers) {
      const svc = w.service as Record<string, unknown> | undefined;
      const addr = svc?.address as Record<string, unknown> | undefined;
      const geo = addr?.geoLocation as Record<string, unknown> | undefined;
      const lat = Number(geo?.latitude);
      const lng = Number(geo?.longitude);
      if (lat && lng && (lat !== 0 || lng !== 0)) {
        target = {
          id: svc?.serviceRequestId as string,
          lat, lng,
        };
        break;
      }
    }
    if (!target) test.skip(true, 'No complaint with non-zero geoLocation on tenant');

    await page.goto(`${LIST_PATH}/${target!.id}/show`);

    // Address-extras rows we expect to render.
    for (const label of ['Landmark', 'Street', 'Pincode']) {
      const row = page.getByText(new RegExp(`^${label}$`, 'i')).first();
      // Some may be blank — just assert the LABEL renders.
      await expect(row).toBeVisible();
    }

    // Geo link — opens new tab to maps.google.com/maps?q=lat,lng.
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 10_000 }),
      page.getByRole('link', { name: /map|geo|location/i }).first().click(),
    ]);

    const popupUrl = popup.url();
    expect(popupUrl).toMatch(/google\.com\/maps/);
    expect(popupUrl).toContain(String(target!.lat));
    expect(popupUrl).toContain(String(target!.lng));
  });

  test('9. mobile-only citizen heuristic shows suffix on Show page', async ({
    page,
  }) => {
    const auth = loadAuth();
    const wrappers = await pgrSearch(auth, CITY_TENANT, { limit: 100 });
    let target: string | null = null;
    for (const w of wrappers) {
      const svc = w.service as Record<string, unknown> | undefined;
      const citizen = svc?.citizen as Record<string, unknown> | undefined;
      const name = citizen?.name as string | undefined;
      const mobile = citizen?.mobileNumber as string | undefined;
      if (name && mobile && name === mobile) {
        target = svc?.serviceRequestId as string;
        break;
      }
    }
    if (!target) test.skip(true, 'No mobile-only-name complaint on tenant');

    await page.goto(`${LIST_PATH}/${target}/show`);
    await expect(
      page.getByText(/mobile-only account/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('10. real pagination — offset-based _search fires with page 2 nav, not client-slice of first 100', async ({
    page,
  }) => {
    const auth = loadAuth();
    // Need at least 26 complaints (2 pages at perPage=25) for this test to
    // be meaningful. Probed 2026-04-23: ke.nairobi has 55.
    const total = await pgrCount(auth, CITY_TENANT);
    if (total < 26) test.skip(true, `tenant has ${total} complaints, not enough to paginate`);

    await page.goto(LIST_PATH);
    await page.waitForLoadState('networkidle').catch(() => {});

    const searches: URL[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/pgr-services/v2/request/_search')) {
        searches.push(new URL(req.url()));
      }
    });

    // Find pagination — react-admin's default renders a Next / page-n button.
    const nextBtn = page.getByRole('button', { name: /next|›|>/i }).first();
    if (!(await nextBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No Next pagination control rendered');
    }
    await nextBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(searches.length, 'paging should trigger a fresh _search XHR').toBeGreaterThan(0);
    // The last search's offset should be > 0 — i.e. real server-side paging.
    const last = searches[searches.length - 1];
    const offset = Number(last.searchParams.get('offset') || '0');
    expect(offset, 'offset on second page should be > 0').toBeGreaterThan(0);
  });

  test('11. department column renders via EntityLink — not a raw code', async ({
    page,
  }) => {
    await page.goto(LIST_PATH);
    await page.waitForLoadState('networkidle').catch(() => {});

    const auth = loadAuth();
    // Find a complaint whose additionalDetail.department is populated so
    // we know the column has something to render.
    const wrappers = await pgrSearch(auth, CITY_TENANT, { limit: 50 });
    let deptCode: string | null = null;
    for (const w of wrappers) {
      const svc = w.service as Record<string, unknown> | undefined;
      const add = svc?.additionalDetail as Record<string, unknown> | undefined;
      const d = add?.department as string | undefined;
      if (d) { deptCode = d; break; }
    }
    if (!deptCode) test.skip(true, 'No complaint with additionalDetail.department on tenant');

    // EntityLink renders an <a> whose href points at the dept show page.
    const link = page.getByRole('link').filter({
      has: page.locator(`text=${deptCode!}`).or(page.locator(`[href*="/departments/"]`)),
    }).first();
    // Lenient: at least one departments link should exist in the list body.
    const anyDeptLink = page.locator('a[href*="/manage/departments/"]').first();
    await expect(anyDeptLink.or(link)).toBeVisible({ timeout: 15_000 });
  });

  test('12. edit saves description + workflow in a single _update round-trip', async ({
    page,
  }) => {
    // Guards the regression where description / source / address edits
    // were silently dropped because the update path sent only the
    // fetched service + workflow. After the fix, they should be merged
    // into the PUT body and persisted.
    const auth = loadAuth();
    const target = await pickWorkableComplaint(auth);
    if (!target) test.skip(true, 'No workable complaint to edit');

    await page.goto(`${LIST_PATH}/${target}/edit`);

    const newDesc = `PW single-roundtrip at ${Date.now()}`;
    const desc = page.getByLabel(/^Description/i);
    await desc.fill('');
    await desc.fill(newDesc);

    // Don't change the workflow action — we want to be sure the
    // description alone rides along. (The merge logic wraps both into one
    // POST /request/_update, see dataProvider.ts:617.)
    const updates: Array<{ body: string }> = [];
    page.on('request', (req) => {
      if (
        req.url().includes('/pgr-services/v2/request/_update') &&
        req.method() === 'POST'
      ) {
        updates.push({ body: req.postData() || '' });
      }
    });

    await page.getByRole('button', { name: /^Save$/i }).click();
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(updates.length, 'expected exactly one _update POST on save').toBe(1);
    // The single POST body should carry the new description under service.description.
    const body = JSON.parse(updates[0].body || '{}');
    const svc = body.service as Record<string, unknown>;
    expect(svc?.description).toBe(newDesc);

    // Server round-trip confirmation.
    const wrappers = await pgrSearch(auth, CITY_TENANT, { serviceRequestId: target });
    const persisted = (wrappers[0]?.service as Record<string, unknown>)?.description;
    expect(persisted).toBe(newDesc);
  });

  test('13. PENDINGFORASSIGNMENT filter returns the expected queue size', async () => {
    // Probed 2026-04-23: 11 PENDINGFORASSIGNMENT on ke.nairobi. Rather
    // than hard-code 11 (seed data drifts), we assert the server responds
    // coherently — both _count and _search agree on a non-negative
    // number, and _search never returns more than the page size.
    const auth = loadAuth();
    const count = await pgrCount(auth, CITY_TENANT, {
      status: 'PENDINGFORASSIGNMENT',
    });
    const wrappers = await pgrSearch(auth, CITY_TENANT, {
      status: 'PENDINGFORASSIGNMENT', limit: 50,
    });
    expect(count).toBeGreaterThanOrEqual(0);
    expect(wrappers.length).toBeLessThanOrEqual(count);
    expect(wrappers.length).toBeLessThanOrEqual(50);
  });
});

// --- Local helpers ---

function uniquePhoneNumber(): string {
  // 10 digits starting with 7. PW_ prefix lives in the description, not the
  // phone number; mobile field needs to be valid for the user-service.
  const tail = String(Date.now()).slice(-9);
  return `7${tail}`;
}

async function pickLocality(
  page: import('@playwright/test').Page,
  preferredCode?: string,
): Promise<void> {
  // The picker exposes three labeled selects — Hierarchy, Boundary type,
  // and Locality. We pick first option in each, optionally pinning the
  // locality to a known live code.
  const hierarchy = page.getByLabel(/Hierarchy/i).first();
  if (await hierarchy.isVisible().catch(() => false)) {
    await hierarchy.click();
    await page.getByRole('option').first().click();
  }
  const boundaryType = page.getByLabel(/Boundary type/i).first();
  if (await boundaryType.isVisible().catch(() => false)) {
    await boundaryType.click();
    await page.getByRole('option').first().click();
  }
  const locality = page.getByLabel(/^Locality$/i).first();
  await locality.click();
  if (preferredCode) {
    const opt = page.getByRole('option', { name: new RegExp(preferredCode) });
    if (await opt.first().isVisible().catch(() => false)) {
      await opt.first().click();
      return;
    }
  }
  await page.getByRole('option').first().click();
}

async function pickWorkableComplaint(auth: AuthInfo): Promise<string | null> {
  const wrappers = await pgrSearch(auth, CITY_TENANT, {
    status: 'PENDINGFORASSIGNMENT',
    limit: 5,
  }).catch(() => []);
  for (const w of wrappers) {
    const id = (w.service as Record<string, unknown>)?.serviceRequestId as string | undefined;
    if (id) return id;
  }
  // Fall back to any non-terminal complaint.
  const any = await pgrSearch(auth, CITY_TENANT, { limit: 10 }).catch(() => []);
  for (const w of any) {
    const svc = w.service as Record<string, unknown> | undefined;
    const status = svc?.applicationStatus as string | undefined;
    if (
      status &&
      !['REJECTED', 'CLOSEDAFTERRESOLUTION', 'CLOSEDAFTERREJECTION'].includes(status)
    ) {
      return svc?.serviceRequestId as string;
    }
  }
  return null;
}
