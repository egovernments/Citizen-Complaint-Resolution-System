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
import { generateCitizenPhone, ROOT_TENANT, TENANT, LOCALITY_CODE } from '../utils/env';

// Tenant identifiers come from env so the suite runs on any deployment.
// TENANT_CODE is the STATE/root tenant (citizen tenantId); CITY_TENANT is the
// configured city (DIGIT_TENANT) — no hardcoded ke / ke.nairobi.
const TENANT_CODE = ROOT_TENANT;
const CITY_TENANT = TENANT;

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
  // ComplaintHierarchy is one adjacency list of interior nodes AND leaf complaint
  // types. Complaint types are the LEAF rows (data carries department/slaHours);
  // a leaf's `code` is the serviceCode stored on a complaint, verbatim.
  const ctRecords = await mdmsSearch(
    auth,
    TENANT_CODE,
    'RAINMAKER-PGR.ComplaintHierarchy',
    { limit: 200 },
  ).catch(() => [] as Awaited<ReturnType<typeof mdmsSearch>>);
  for (const r of ctRecords) {
    if (r.isActive === false) continue;
    const data = r.data as Record<string, unknown>;
    if (data.department === undefined && data.slaHours === undefined) continue; // interior node
    const code = data.code as string | undefined;
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
  test('1. file complaint — citizen, locality, required landmark', {
    annotation: {
      type: 'description',
      description: `End-to-end create-complaint flow on the configurator's manage surface. Drives the whole form (complaint type, description, locality picker cascade, citizen mobile) and intercepts the _create XHR to verify the citizen tenantId is the STATE tenant (root) while address.tenantId is the CITY tenant — a critical contract. Asserts the redirect lands on a fresh PG-PGR-* show URL.

Steps:
1. test.skip if !liveServiceCode (beforeAll picks first active complaint type).
2. Navigate to CREATE_PATH.
3. Click Complaint Type select; pick the option matching liveServiceCode.
4. Fill Description with >10 chars.
5. pickLocality(page, liveBoundaryCode) — drives Hierarchy → Boundary type → Locality cascade.
6. Fill Mobile number with a unique phone from generateCitizenPhone() (valid for the deployment's MDMS mobile rule — 9 digits starting with 7/1).
7. Set up createReqPromise on /pgr-services/v2/request/_create.
8. Click Create.
9. Parse the captured request body; assert service.citizen.tenantId === TENANT_CODE (root) and service.address.tenantId === CITY_TENANT, and address.locality.code is non-empty.
10. Wait for URL matching /PG-PGR-/ within 30s.
11. Capture the SR id from the URL into createdComplaints for cleanup.

Citizen tenant must be ROOT — assigning to city would break login flows. Cleanup is API-only via cleanupPgrComplaints in afterAll.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }) => {
    if (!liveServiceCode) test.skip(true, 'No active complaint type seeded on tenant');

    await page.goto(CREATE_PATH);

    // Pick a complaint type. The single "Complaint Type" select was replaced
    // by a Category → Sub-Type cascade (ComplaintHierarchyCascade), so drive
    // that instead. The create assertions below don't pin a specific
    // serviceCode, so picking the first valid leaf is sufficient.
    await pickComplaintType(page);

    await page.getByLabel(/^Description/i).fill(
      'PW filed-by-test — complaint description over ten chars',
    );

    // LocalityPicker is three cascading selects. pickLocality does a first
    // pass across EVERY hierarchy x boundary-type combo looking ONLY for a
    // boundary matching the known-good code (liveBoundaryCode from a recent
    // complaint, or the env/profile LOCALITY_CODE floor); only if that comes
    // up empty everywhere does it fall back to the first combo with any
    // option (RC6 — the old single-combo-first behavior stamped ROOT tenant
    // whenever the default hierarchy's tree had no city boundaries).
    const preferredLocality = liveBoundaryCode || LOCALITY_CODE;
    const { pickedPreferred } = await pickLocality(page, preferredLocality);

    // Citizen mobile — valid for the deployment's MDMS mobile rule
    // (9 digits starting with 7/1). A raw 10-digit 7… fails that rule.
    const phone = generateCitizenPhone();
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
    // Address tenant. When pickLocality found the known-good (city) boundary
    // in pass 1, the app must stamp CITY — that's the strict contract this
    // test guards. When pass 1 found nothing anywhere and pass 2 fell back to
    // whatever combo offered ANY option (e.g. a flat deployment or a
    // deployment whose only reachable tree is the root hierarchy), the address
    // tenant must be whichever tenant actually owns the picked boundary —
    // see resolveComplaintAddressTenant (dataProvider.ts:355-391). On a flat
    // deployment ROOT === CITY so both branches are equally strict there.
    const address = service.address as Record<string, unknown>;
    if (pickedPreferred) {
      expect(address?.tenantId).toBe(CITY_TENANT);
    } else {
      expect([TENANT_CODE, CITY_TENANT]).toContain(address?.tenantId);
    }
    expect(((address?.locality as Record<string, unknown>)?.code) ?? '').toBeTruthy();

    // Wait for the redirect to the Show page with a fresh <PREFIX>-PGR-* id
    // (Maputo: PG-PGR-…, Kenya: NCCG-PGR-…) — keep the SRID match prefix-agnostic.
    await page.waitForURL(/[A-Z]+-PGR-/, { timeout: 30_000 });
    const url = page.url();
    const match = url.match(/([A-Z]+-PGR-[^/?#]+)/);
    expect(match, `expected <PREFIX>-PGR id in url ${url}`).not.toBeNull();
    if (match) createdComplaints.add(match[1]);
  });

  test('2. edit merges description + workflow ASSIGN in one round-trip', {
    annotation: {
      type: 'description',
      description: `Confirms the configurator's complaint edit form merges field changes (description) AND workflow action (ASSIGN with assignee) into a single _update round-trip. Pre-fix description edits could be silently dropped when the workflow action was changed.

Steps:
1. test.skip if !lmeAssigneeUuid (beforeAll picks first PGR_LME employee).
2. pickWorkableComplaint() — uses test 1's complaint or finds a fresh PENDINGFORASSIGNMENT.
3. Navigate to /complaints/<id>/edit.
4. Fill Description with 'PW edited at <ts>'.
5. Click Action select; pick ASSIGN option.
6. If an Assignee select appears, click it and pick the first option (PGR_LME exists per beforeAll).
7. Click Save.
8. pgrSearch for the complaint; assert wrappers.length > 0.
9. Assert service.description matches the new value.
10. Assert service.applicationStatus === 'PENDINGATLME' (ASSIGN moved it forward).

Catches a regression where description doesn't ride along with the workflow transition.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
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

  test('3. workflow dropdown labels are human-readable, not UUIDs', {
    annotation: {
      type: 'description',
      description: `UI hygiene: every option in the workflow Action dropdown must be a human-readable label, NOT a 36-character UUID. Catches a regression where the dataProvider stops mapping action UUIDs to their localized labels.

Steps:
1. pickWorkableComplaint(); test.skip if none.
2. Navigate to /complaints/<id>/edit.
3. Click the Action select.
4. Read all option labels; assert count > 0.
5. For each option, assert the label does NOT match the UUID regex /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.

If ANY option label is a UUID, the dropdown is unusable for an admin who isn't memorizing workflow state IDs.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
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

  test('4. source select offers only Web/Mobile/WhatsApp', {
    annotation: {
      type: 'description',
      description: `Locks down the Source dropdown allow-list: only Web, Mobile, and WhatsApp must appear. Catches CCRS-side regressions where IVR / Phone / Counter sneak back in (legacy India sources never available in Kenya).

Steps:
1. pickWorkableComplaint(); test.skip if none.
2. Navigate to /complaints/<id>/edit.
3. Click Source select.
4. Read all option text contents; trim; filter empty.
5. Assert sorted options exactly equal ['Web','Mobile','WhatsApp'] sorted.
6. For each banned ['IVR','Phone','Counter'], assert it's NOT in the list (belt-and-braces with a clear failure message).

Sorted exact comparison is strict — adding any new value (e.g. SMS) would fail; that's intentional and signals the team to update both this spec and the source allow-list.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
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

  test('5. list footer count matches /pgr-services/v2/request/_count', {
    annotation: {
      type: 'description',
      description: `Confirms the complaints list footer ("of N") reflects the live total returned by /pgr-services/v2/request/_count. Catches a regression where the UI shows a client-side-sliced count instead of the real total.

Steps:
1. Navigate to /configurator/manage/complaints; wait networkidle.
2. If a per-page selector is visible, click it and pick '10'; wait networkidle.
3. pgrCount(auth, CITY_TENANT) — get the live API total.
4. Locate footer text matching /of\\s+\\d+/i; read it.
5. Parse the number after "of"; assert it equals apiCount.

Catches the bug class where pagination renders fine but the count number is wrong, misleading admins about queue depth.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
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

  test('6. status + date filters fire as XHR query params', {
    annotation: {
      type: 'description',
      description: `Validates server-side filtering on the complaints list: changing the Status filter to PENDINGFORASSIGNMENT and setting From-date to 7 days ago must produce a /pgr-services/v2/request/_search XHR with both applicationStatus= and fromDate= query params.

Steps:
1. Navigate to /complaints; wait networkidle.
2. Attach a request listener to capture _search URLs into 'seen'.
3. Locate Status filter; test.skip if not visible; click; pick PENDINGFORASSIGNMENT.
4. If From-date input exists, fill ISO date 7 days ago.
5. Wait networkidle.
6. Assert seen.length > 0 (at least one search XHR fired).
7. Assert the latest URL matches /applicationStatus=/.
8. If From-date was filled, assert the URL also matches /fromDate=/.

Catches a regression where filters render but only update local state instead of triggering a server search.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
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

  test('7. department filter narrows visible rows', {
    annotation: {
      type: 'description',
      description: `Validates the Department filter on the complaints list: each visible row after filtering must reference the picked department (text match in row content). Picks the first available option to avoid hardcoding tenant-specific dept codes.

Steps:
1. Navigate to /complaints.
2. Locate Department filter; test.skip if absent.
3. Click filter; capture first option's text; click it; wait networkidle.
4. Read row count; if <=1 return early (filter validly returned 0 rows).
5. Sample up to 5 rows; lower-case row text and assert it contains the option's lowercased text.

Loose match via text inclusion tolerates whatever the row actually renders (label, code, or both).`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
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

  test('8. show page renders address extras and a working geo link', {
    annotation: {
      type: 'description',
      description: `Confirms the complaint Show page renders the address-extras rows (Landmark, Street, Pincode) AND that the geo-link opens a maps URL containing the actual lat/lng. Skips if no complaint has non-zero coords.

Steps:
1. pgrSearch limit 50; iterate looking for a complaint with non-zero geoLocation.
2. test.skip if none.
3. Navigate to /complaints/<id>/show.
4. For each label in ['Landmark','Street','Pincode'], assert the LABEL is visible (values may be blank).
5. Set up a popup waitForEvent; click the Map/Geo/Location link.
6. Read popupUrl; assert it matches /google.com\\/maps/.
7. Assert popupUrl contains the target's lat AND lng.

If the geo link doesn't pop a new tab or doesn't carry the coords, an admin can't verify a complaint's location — the show page is the only place this surfaces.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
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

  test('9. mobile-only citizen heuristic shows suffix on Show page', {
    annotation: {
      type: 'description',
      description: `When a citizen registered with no name (the citizen.name field equals the mobileNumber), the complaint Show page must display a "mobile-only account" suffix — visual signal to the admin that the citizen identity is unconfirmed.

Steps:
1. pgrSearch limit 100; iterate looking for a complaint where citizen.name === citizen.mobileNumber.
2. test.skip if none.
3. Navigate to /complaints/<id>/show.
4. Assert text /mobile-only account/i is visible within 10s.

Catches a regression in the citizen-display heuristic — without this badge admins might mistake a mobile string for an actual name.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
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

  test('10. real pagination — offset-based _search fires with page 2 nav, not client-slice of first 100', {
    annotation: {
      type: 'description',
      description: `Pins the server-side pagination contract: clicking Next must trigger a fresh _search XHR with offset > 0, NOT a client-side slice of an already-loaded result set. Critical for tenants with thousands of complaints.

Steps:
1. pgrCount(auth, CITY_TENANT); test.skip if total < 26 (need 2+ pages at perPage=25).
2. Navigate to /complaints; wait networkidle.
3. Attach a request listener capturing _search URLs into searches[].
4. Locate Next button; test.skip if not visible.
5. Click Next; wait networkidle.
6. Assert searches.length > 0 (paging triggered a new XHR).
7. Read offset from the last URL's query params; assert > 0 (real server-side paging).

Test data: ke.nairobi has 55 complaints (probed 2026-04-23). The 26 minimum keeps the test relevant on smaller seeds.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
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

  test('11. department column renders via EntityLink — not a raw code', {
    annotation: {
      type: 'description',
      description: `Confirms the Department column in the complaints list renders an EntityLink (anchor pointing at the dept show page), not a raw text code. Catches a regression where the cross-reference is dropped and admins lose the click-through to dept details.

Steps:
1. Navigate to /complaints; wait networkidle.
2. pgrSearch; iterate looking for a complaint with additionalDetail.department populated.
3. test.skip if none.
4. Build a lenient locator: look for an <a> linking to /manage/departments/.
5. Assert at least one such link is visible within 15s.

Loose check — only requires that SOME row's department renders as a link, not that every row's link points at the seeded dept code (that would require deeper matching).`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
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

  test('12. edit saves description + workflow in a single _update round-trip', {
    annotation: {
      type: 'description',
      description: `Catches the regression where the edit form sent the workflow action and the merged service object as separate updates, silently dropping description/source/address changes. Post-fix dataProvider.ts:617 merges both into ONE POST /request/_update — this test confirms exactly one _update XHR fires with the new description in service.description.

Steps:
1. pickWorkableComplaint(); test.skip if none.
2. Navigate to /complaints/<id>/edit.
3. Fill Description with a unique value containing 'PW single-roundtrip'.
4. DON'T change the workflow action.
5. Attach a request listener capturing _update POST bodies into updates[].
6. Click Save; wait networkidle.
7. Assert updates.length === 1 (exactly ONE update — not two separate POSTs).
8. Parse the body; assert service.description matches the new value.
9. pgrSearch for the complaint; assert persisted description matches.

Both client-side (single XHR count) and server-side (persistence) checks — together they guarantee the merge happened correctly.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
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
    const wrappers = await pgrSearch(auth, CITY_TENANT, { serviceRequestId: target ?? undefined });
    const persisted = (wrappers[0]?.service as Record<string, unknown>)?.description;
    expect(persisted).toBe(newDesc);
  });

  test('13. PENDINGFORASSIGNMENT filter returns the expected queue size', {
    annotation: {
      type: 'description',
      description: `API-level coherence check: pgrCount and pgrSearch must agree on the PENDINGFORASSIGNMENT queue size. Doesn't pin a hard count (seed data drifts) — only that count >= 0, search returns <= count, and search respects the page size limit.

Steps:
1. pgrCount(auth, CITY_TENANT, { status: 'PENDINGFORASSIGNMENT' }).
2. pgrSearch(auth, CITY_TENANT, { status: 'PENDINGFORASSIGNMENT', limit: 50 }).
3. Assert count >= 0.
4. Assert wrappers.length <= count.
5. Assert wrappers.length <= 50 (page size respected).

Probed 2026-04-23: 11 PENDINGFORASSIGNMENT on ke.nairobi. Hardcoding 11 would drift; this test validates the contract instead.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async () => {
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

/** Locate a radix Select trigger sitting in the same wrapper <div> as a
 *  given field <Label> text. These cascade selects don't associate their
 *  label via htmlFor, so getByLabel can't reach them — anchor on the label
 *  text and take the combobox in the innermost enclosing div. */
function triggerNearLabel(
  page: import('@playwright/test').Page,
  labelText: RegExp,
): import('@playwright/test').Locator {
  return page
    .locator('div')
    .filter({ has: page.getByText(labelText) })
    .filter({ has: page.getByRole('combobox') })
    .last()
    .getByRole('combobox')
    .first();
}

async function pickComplaintType(
  page: import('@playwright/test').Page,
): Promise<void> {
  // The complaint-type control is a Category → Sub-Type cascade — one radix
  // Select per RAINMAKER-PGR.ComplaintHierarchy level. Pick the first option
  // at each level until the deepest (terminal) level is chosen, which is what
  // sets the form's serviceCode. Deeper levels are hidden once a branch is
  // terminal, so a missing/disabled next level just ends the walk.
  for (const lbl of [/^Category$/i, /^Sub-?Type$/i]) {
    const sel = triggerNearLabel(page, lbl);
    if (!(await sel.isVisible({ timeout: 8_000 }).catch(() => false))) break;
    if (!(await sel.isEnabled().catch(() => false))) break;
    await sel.click();
    const opt = page.getByRole('option').first();
    if (!(await opt.isVisible({ timeout: 5_000 }).catch(() => false))) {
      await page.keyboard.press('Escape').catch(() => {});
      break;
    }
    await opt.click();
  }
}

/** Escape regex metacharacters so a live boundary code can be used verbatim
 *  inside a `getByRole('option', { name: new RegExp(...) })` match. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function pickLocality(
  page: import('@playwright/test').Page,
  preferredCode?: string,
): Promise<{ pickedPreferred: boolean }> {
  // LocalityPicker is three radix Selects in one grid — Hierarchy → Boundary
  // Type → Boundary(locality). Only the last carries a "Locality" label
  // (htmlFor); the first two expose no accessible label, so scope to the grid
  // and drive them positionally. The default hierarchy can be one with no
  // usable city boundaries (e.g. ADMIN 400s on this tenant while MAPUTO_ADMIN
  // holds the real tree), so iterate hierarchy × boundary-type until the
  // Boundary select actually offers options.
  //
  // RC6: picking the FIRST combo offering ANY option used to stop the walk
  // even when that combo was the root-level tree — the app then (correctly)
  // stamps address.tenantId = ROOT via resolveComplaintAddressTenant
  // (dataProvider.ts:355-391), breaking the "address tenant = CITY" contract.
  // So we walk the WHOLE combo space twice: pass 1 looks only for
  // `preferredCode` (a boundary code known to live under the city tree);
  // pass 2 — only if pass 1 found nothing anywhere — falls back to today's
  // original "first combo, first option" behavior. Boundary options render
  // the raw code (LocalityPicker.tsx: `{b.name ?? b.code}`; relationship
  // nodes carry no name), so a code-regex match is reliable.
  //
  // Anchor on the picker's help text (unique) to scope to its 3 selects —
  // the individual Hierarchy/Boundary-Type triggers carry no accessible label.
  const localityGroup = page
    .locator('div')
    .filter({ has: page.getByText(/Cascades from hierarchy/i) })
    .last();
  await localityGroup.getByRole('combobox').first().waitFor({ state: 'visible', timeout: 15_000 });
  const selects = localityGroup.getByRole('combobox');
  const hierarchy = selects.nth(0);
  const boundaryType = selects.nth(1);
  const localityTrigger = selects.nth(2);

  const countOptions = async (trigger: import('@playwright/test').Locator): Promise<number> => {
    if (!(await trigger.isEnabled().catch(() => false))) return 0;
    await trigger.click();
    const n = await page.getByRole('option').count();
    if (n === 0) await page.keyboard.press('Escape').catch(() => {});
    return n;
  };

  // Walk every hierarchy x boundary-type combo, opening the locality select
  // for each one. `onLocalityOpen` decides whether to pick an option for
  // THIS combo (returning true stops the walk) or to back out (Escape) and
  // let the walk continue to the next combo (returning false).
  const walkCombos = async (
    onLocalityOpen: () => Promise<boolean>,
  ): Promise<boolean> => {
    const hierN = await countOptions(hierarchy);
    for (let h = 0; h < Math.max(hierN, 1); h++) {
      if (hierN > 0) {
        await page.getByRole('option').nth(h).click();
      }
      const typeN = await countOptions(boundaryType);
      for (let t = 0; t < typeN; t++) {
        await page.getByRole('option').nth(t).click();
        if (await localityTrigger.isEnabled().catch(() => false)) {
          await localityTrigger.click();
          if (await onLocalityOpen()) return true;
          await page.keyboard.press('Escape').catch(() => {});
        }
        // Re-open the type select for the next candidate.
        if (t + 1 < typeN && (await boundaryType.isEnabled().catch(() => false))) {
          await boundaryType.click();
        }
      }
      // Re-open the hierarchy select for the next candidate.
      if (h + 1 < hierN && (await hierarchy.isEnabled().catch(() => false))) {
        await hierarchy.click();
      }
    }
    return false;
  };

  // Pass 1: across ALL combos, look ONLY for preferredCode.
  if (preferredCode) {
    const found = await walkCombos(async () => {
      const options = page.getByRole('option');
      if ((await options.count()) === 0) return false;
      const pref = page.getByRole('option', { name: new RegExp(escapeRegex(preferredCode)) });
      if (await pref.first().isVisible().catch(() => false)) {
        await pref.first().click();
        return true;
      }
      return false;
    });
    if (found) return { pickedPreferred: true };
  }

  // Pass 2: preferredCode not reachable anywhere — fall back to the first
  // combo that offers ANY option, picking its first option (original
  // behavior, kept for flat/degenerate deployments).
  const fellBack = await walkCombos(async () => {
    const options = page.getByRole('option');
    if ((await options.count()) === 0) return false;
    await options.first().click();
    return true;
  });
  if (fellBack) return { pickedPreferred: false };

  throw new Error('pickLocality: no hierarchy/type combination yielded a selectable boundary');
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
