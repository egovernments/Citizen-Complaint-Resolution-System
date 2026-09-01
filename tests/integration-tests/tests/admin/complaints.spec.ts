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
  buildRequestInfo,
  type AuthInfo,
} from '../utils/manage/api';
import { cleanupPgrComplaints } from '../utils/manage/teardown';
import { seedComplaintAsCitizen } from '../utils/seed';
import { BASE_URL, generateCitizenPhone, ROOT_TENANT, TENANT, LOCALITY_CODE, SERVICE_CODE } from '../utils/env';

// Tenant identifiers come from env so the suite runs on any deployment.
// TENANT_CODE is the STATE/root tenant (citizen tenantId); CITY_TENANT is the
// configured city (DIGIT_TENANT) — no hardcoded ke / ke.nairobi.
const TENANT_CODE = ROOT_TENANT;
const CITY_TENANT = TENANT;

const LIST_PATH = '/configurator/manage/complaints';
const CREATE_PATH = `${LIST_PATH}/create`;

const createdComplaints = new Set<string>();
// Complaints already handed out by pickWorkableComplaint(). pgr-services' read
// model does not reflect a write immediately (and, until the locality-wipe bug
// is fixed, may never reflect it at all), so a second caller asking the same
// `status: PENDINGFORASSIGNMENT` query gets the same complaint back, loads a
// stale status, offers ASSIGN, and egov-workflow-v2 — which IS up to date —
// rejects it with `INVALID ACTION`. Never hand the same complaint out twice.
const consumedComplaints = new Set<string>();

/**
 * Choose the human ASSIGN action in the Take-Action select.
 *
 * Anchored deliberately: from PENDINGFORASSIGNMENT the PGR workflow also offers
 * `ASSIGNEDBYAUTOESCALATION` (roles: [AUTO_ESCALATE]) and the UI lists it BEFORE
 * `ASSIGN`, so a loose /assign/i picks the system-only transition. No human role
 * holds AUTO_ESCALATE, so the _update then 400s with `INVALID ROLE`. Anchoring on
 * ^ also keeps `Reassign to Employee` out.
 *
 * Asserts on the option's text so a future label change fails loudly here rather
 * than silently selecting a neighbouring action.
 */
async function chooseAssignAction(page: import('@playwright/test').Page) {
  const option = page.getByRole('option', { name: /^Assign to Employee/i }).first();
  await expect(
    option,
    'the Take-Action select should offer an "Assign to Employee" option',
  ).toBeVisible({ timeout: 20_000 });
  await option.click({ timeout: 20_000 });
}

let liveServiceCode: string | null = null;
let lmeAssigneeUuid: string | null = null;
let lmeAssigneeName: string | null = null;
let liveBoundaryCode: string | null = null;

// Default mode (not serial): with workers=1 the tests still run in file order,
// but a single failure no longer cascade-skips the rest — each test seeds/finds
// its own complaint (pickWorkableComplaint) and reports independently.
test.describe.configure({ mode: 'default' });

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
  const leafCodes: string[] = [];
  for (const r of ctRecords) {
    if (r.isActive === false) continue;
    const data = r.data as Record<string, unknown>;
    if (data.department === undefined && data.slaHours === undefined) continue; // interior node
    const code = data.code as string | undefined;
    if (code) leafCodes.push(code);
  }
  // Prefer the deployment's SEED serviceCode: resolveSeedPlan picks it precisely
  // because a PGR_LME employee holds its department, so a complaint filed with it
  // is actually ASSIGNable. A random first leaf is often a test-junk type whose
  // department no employee holds — the ASSIGN then 400s and tests 2/12 fail.
  liveServiceCode = leafCodes.includes(SERVICE_CODE) ? SERVICE_CODE : (leafCodes[0] ?? liveServiceCode);

  // --- Pick an HRMS employee with PGR_LME role for ASSIGN test ---
  const employees = await employeeSearch(auth, CITY_TENANT, {
    roles: ['PGR_LME'],
    limit: 100,
  }).catch(() => [] as Record<string, unknown>[]);
  // Prefer an employee whose HRMS department matches the complaint type we file
  // with. pgr-services validates the assignee's department against the
  // complaint's, and the configurator's assignee dropdown is NOT yet filtered by
  // department (product gap — pending the ABAC work), so it happily offers staff
  // the backend will reject. Picking a department-valid assignee keeps this test
  // measuring the edit/merge behaviour rather than that known gap.
  const wantedDept = liveServiceCode
    ? ((ctRecords.find((r) => (r.data as Record<string, unknown>)?.code === liveServiceCode)
        ?.data as Record<string, unknown> | undefined)?.department as string | undefined)
    : undefined;
  const deptOf = (e: Record<string, unknown>): string[] =>
    ((e.assignments as Record<string, unknown>[] | undefined) ?? [])
      .map((a) => String(a.department ?? ''));
  const preferred = wantedDept
    ? employees.find((e) => deptOf(e).includes(wantedDept))
    : undefined;
  for (const e of [preferred, ...employees].filter(Boolean) as Record<string, unknown>[]) {
    const user = e.user as Record<string, unknown> | undefined;
    const uuid = (user?.uuid as string) || (e.uuid as string);
    const name = (user?.name as string) || (e.code as string);
    if (uuid) { lmeAssigneeUuid = uuid; lmeAssigneeName = name ?? null; break; }
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

    // Pick ASSIGN action FIRST — choosing an action calls setValue() on
    // assignee/rating and re-renders the Workflow section; the assignee/cascade
    // widgets can reset sibling inputs on mount, so fill the description LAST
    // (right before Save) to guarantee its value is what gets submitted.
    // These custom selects have NO <label> association, so getByLabel never
    // matches them — locate by the combobox's own visible text instead.
    const actionSelect = page.getByRole('combobox').filter({ hasText: /select action/i }).first();
    await actionSelect.waitFor({ state: 'visible', timeout: 20_000 });
    await actionSelect.scrollIntoViewIfNeeded().catch(() => {});
    // force: the trigger is visible but Playwright's actionability check can hang
    // on this custom select (overlay/pointer-events during the record load).
    await actionSelect.click({ timeout: 20_000, force: true });
    await chooseAssignAction(page);

    // The assignee picker may render only after ASSIGN is chosen.
    // These custom selects render WITHOUT a <label> association, so getByLabel
    // never matches them — locate by role + accessible name (same pattern the
    // Status/Department filters needed).
    const assigneeSelect = page.getByRole('combobox').filter({ hasText: /select employee/i }).first();
    if (await assigneeSelect.isVisible().catch(() => false)) {
      await assigneeSelect.click();
      // Click the first available employee option — we already validated
      // a PGR_LME exists in beforeAll, so there will be options.
      // Pick the department-valid assignee resolved in beforeAll. The dropdown is
      // not department-filtered yet (product gap), so 'first option' can be a
      // employee whose department pgr-services will reject with a 400.
      const wanted = lmeAssigneeName
        ? page.getByRole('option', { name: new RegExp(lmeAssigneeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first()
        : null;
      if (wanted && await wanted.count() > 0) await wanted.click();
      else await page.getByRole('option').first().click();
    }

    const desc = page.getByLabel(/^Description/i);
    await desc.fill('');
    await desc.fill(newDesc);
    await desc.blur();

    // Wait for the _update to actually complete before searching — otherwise the
    // assertion races the XHR and reads the pre-edit description.
    const [updResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/pgr-services/v2/request/_update') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      page.getByRole('button', { name: /^Save$/i }).click(),
    ]);
    expect(updResp.status(), 'PGR _update should succeed').toBe(200);
    // Assert on the _update RESPONSE (the write's source of truth) rather than a
    // fresh _search — pgr-services' search index lags the write by a beat, so an
    // immediate re-search reads the pre-edit value and the test flakes.
    const updBody = await updResp.json();
    const svc = (updBody.ServiceWrappers?.[0]?.service ?? {}) as Record<string, unknown>;
    expect(svc.description, 'edited description merged into the ASSIGN _update').toBe(newDesc);
    expect(svc.applicationStatus, 'ASSIGN moved it to PENDINGATLME').toBe('PENDINGATLME');
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

    // The footer "of N" reflects the live TOTAL regardless of page size, so we
    // don't touch the per-page selector (its option widget varies by build and
    // isn't needed to validate the count).

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

  test('6. status filter fires as an XHR query param', {
    annotation: {
      type: 'description',
      description: `Validates server-side status filtering on the complaints list: changing the Status filter to "Pending Assignment" must produce a /pgr-services/v2/request/_search XHR carrying applicationStatus=PENDINGFORASSIGNMENT.

Steps:
1. Navigate to /complaints; wait for the first data row.
2. Attach a request listener capturing _search URLs into 'seen'.
3. Locate the Status filter (radix combobox — matched by its trigger TEXT, see below); assert it is visible.
4. Click it and pick the option whose id is PENDINGFORASSIGNMENT (label "Pending Assignment").
5. expect.poll until a _search URL carrying applicationStatus= is observed, then assert the value is PENDINGFORASSIGNMENT.

Two selector notes, both learned the hard way:
- The radix SelectTrigger has NO accessible name, so getByRole('combobox', { name: /^Status$/ }) matches NOTHING. That silently drove this test into test.skip() for its whole life. Match on trigger text instead.
- waitForLoadState('networkidle') resolves in ~0.2ms after an SPA click (no navigation occurs), so it cannot be used to wait for the refire. Poll the captured URLs instead.

The From/To date half of this test now lives in test 6b — it is a genuinely separate contract and it is currently broken app-side, so bundling the two hid a working assertion behind a failing one.

Catches a regression where the status filter renders but only updates local state instead of triggering a server search.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(LIST_PATH);
    await expect(page.getByRole('row').nth(1)).toBeVisible({ timeout: 30_000 });

    const seen: string[] = [];
    page.on('request', (req: Request) => {
      const url = req.url();
      if (/\/pgr-services\/v2\/request\/_search/.test(url)) seen.push(url);
    });

    const statusFilter = page.getByRole('combobox').filter({ hasText: /^Status$/ }).first();
    await expect(
      statusFilter,
      'the complaints list must render a Status filter',
    ).toBeVisible({ timeout: 15_000 });
    await statusFilter.click();

    // The option LABEL is the human name ("Pending Assignment"); the id it sets
    // is PENDINGFORASSIGNMENT. Anchor on the label, assert on the emitted param.
    const pendingOption = page
      .getByRole('option')
      .filter({ hasText: /^Pending Assignment$/i })
      .first();
    await expect(
      pendingOption,
      'the Status filter must offer the PENDINGFORASSIGNMENT state',
    ).toBeVisible({ timeout: 15_000 });
    await pendingOption.click();

    await expect
      .poll(() => seen.filter((u) => /[?&]applicationStatus=/.test(u)).length, {
        timeout: 25_000,
        message:
          'changing Status must refire /pgr-services/v2/request/_search with an applicationStatus= query param',
      })
      .toBeGreaterThan(0);

    const filtered = seen.filter((u) => /[?&]applicationStatus=/.test(u));
    expect(
      filtered[filtered.length - 1],
      'the emitted applicationStatus must be the state the operator picked',
    ).toMatch(/[?&]applicationStatus=PENDINGFORASSIGNMENT(&|$)/);
  });

  test('6b. From-date filter fires as a fromDate XHR query param', {
    annotation: {
      type: 'description',
      description: `Validates server-side DATE filtering on the complaints list: adding the "From" filter and setting it to 7 days ago must produce a /pgr-services/v2/request/_search XHR carrying a fromDate= query param.

Steps:
1. Navigate to /complaints; wait for the first data row.
2. Click "Add filter" and choose "From" (fromDate is NOT alwaysOn in ComplaintList.tsx, so it only exists once added — this is why the old bundled test never exercised it).
3. Attach a request listener capturing _search URLs.
4. Fill the date input with ISO(now - 7d). DateFilterInput DOES associate its <label htmlFor>, so getByLabel(/^From$/) reaches it once shown.
5. expect.poll until _search refires at all (proves the filter form reacted).
6. Assert one of the refired URLs carries fromDate=.

Split out of test 6 deliberately: the status half passes and the date half does not, and a single bundled test would have masked the working half behind the broken one. Do NOT relax step 6 to make this green — see the failure message for the mechanism.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(LIST_PATH);
    await expect(page.getByRole('row').nth(1)).toBeVisible({ timeout: 30_000 });

    // fromDate is not alwaysOn — surface it through the Add-filter popover.
    const addFilter = page.getByRole('button', { name: /^Add filter$/i }).first();
    await expect(
      addFilter,
      'the complaints list must offer an "Add filter" control for the non-alwaysOn filters',
    ).toBeVisible({ timeout: 15_000 });
    await addFilter.click();
    const fromEntry = page
      .locator('[data-radix-popper-content-wrapper]')
      .getByRole('button', { name: /^From$/ })
      .first();
    await expect(
      fromEntry,
      'the Add-filter menu must offer the "From" date filter',
    ).toBeVisible({ timeout: 15_000 });
    await fromEntry.click();

    const fromInput = page.getByLabel(/^From$/i).first();
    await expect(fromInput, 'the From date input must mount once added').toBeVisible({
      timeout: 15_000,
    });

    const seen: string[] = [];
    page.on('request', (req: Request) => {
      const url = req.url();
      if (/\/pgr-services\/v2\/request\/_search/.test(url)) seen.push(url);
    });

    const iso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await fromInput.fill(iso);

    // The grid debounces (DigitList setFilters(..., undefined, true)), so never
    // read immediately — poll until the refire lands.
    await expect
      .poll(() => seen.length, {
        timeout: 25_000,
        message: 'setting the From date must refire /pgr-services/v2/request/_search',
      })
      .toBeGreaterThan(0);

    expect(
      seen.some((u) => /[?&]fromDate=/.test(u)),
      `the From date must reach pgr-services as a fromDate= query param, but no refired _search carried one. ` +
        `Observed: ${JSON.stringify(seen)}. ` +
        `APP BUG — DateFilterInput drives an <input type="date">, so react-hook-form stores fromDate as the STRING "${iso}", ` +
        `while dataProvider.ts getList() gates on \`typeof filter.fromDate === 'number'\` and therefore drops it. ` +
        `Do not weaken this assertion; parse the date input to epoch-ms (or widen the type guard) in the provider.`,
    ).toBe(true);
  });

  test('7. department filter narrows visible rows', {
    annotation: {
      type: 'description',
      description: `Validates the Department filter on the complaints list actually NARROWS the grid: after picking a department, the rows still on screen must be exactly the rows that already carried that department.

Steps:
1. Navigate to /complaints; wait for rows and let them settle (the grid debounces).
2. Read the Department column of every visible row -> deptsBefore.
3. Open the Department filter and read its options, dropping "All" (that option CLEARS the filter — selecting it can never narrow anything, so iterating it would guarantee a vacuous pass).
4. Pick the department with the FEWEST rows on the current page — that maximises the observable narrowing. Skip if it would not narrow at all (a real data gap, not a pass).
5. expect.poll the Department column until it equals exactly the subset of deptsBefore that carried the picked department.

Selector note: the radix SelectTrigger has NO accessible name, so getByRole('combobox', { name: /^Department/ }) matched nothing and this test skipped itself for its whole life.

The assertion is an exact array equality against a pre-filter measurement — it cannot pass unless the filter genuinely removed the non-matching rows.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(LIST_PATH);
    const rows = page.getByRole('row');
    await expect(rows.nth(1)).toBeVisible({ timeout: 30_000 });

    const headers = (await rows.nth(0).getByRole('columnheader').allTextContents()).map((h) =>
      h.trim(),
    );
    const deptCol = headers.findIndex((h) => /^department$/i.test(h));
    expect(deptCol, `complaints grid must render a Department column, got ${JSON.stringify(headers)}`)
      .toBeGreaterThanOrEqual(0);

    /** The Department cell of every DATA row, top to bottom. */
    const readDepartments = async (): Promise<string[]> => {
      const n = await rows.count();
      const out: string[] = [];
      for (let i = 1; i < n; i++) {
        out.push(((await rows.nth(i).getByRole('cell').nth(deptCol).textContent()) || '').trim());
      }
      return out;
    };

    /** Read until two consecutive reads agree — the grid debounces its refetch,
     *  so a single immediate read regularly catches a half-rendered page. */
    const settledDepartments = async (): Promise<string[]> => {
      let prev = '';
      await expect
        .poll(
          async () => {
            const cur = JSON.stringify(await readDepartments());
            const stable = cur === prev && cur !== '[]';
            prev = cur;
            return stable;
          },
          { timeout: 30_000, intervals: [800], message: 'complaints grid rows must settle' },
        )
        .toBe(true);
      return JSON.parse(prev) as string[];
    };

    const before = await settledDepartments();
    expect(before.length, 'need at least one complaint on page 1 to test narrowing').toBeGreaterThan(0);

    const filter = page.getByRole('combobox').filter({ hasText: /^Department$/ }).first();
    await expect(
      filter,
      'the complaints list must render a Department filter',
    ).toBeVisible({ timeout: 15_000 });
    await filter.click();

    // "All" is the clear-the-filter sentinel (ReferenceFilterInput maps it to
    // ''), so it is never a narrowing case — iterating it is a guaranteed
    // vacuous pass. Drop it.
    const choices = (await page.getByRole('option').allTextContents())
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !/^all$/i.test(t));
    expect(choices.length, 'the departments reference list must offer at least one department')
      .toBeGreaterThan(0);

    const occurrences = (d: string) => before.filter((v) => v === d).length;
    const target = choices
      .slice()
      .sort((a, b) => occurrences(a) - occurrences(b) || a.localeCompare(b))[0];
    const expectedAfter = before.filter((v) => v === target);
    expect(
      expectedAfter.length,
      `every department option matches every row on page 1 (${JSON.stringify(before)}) — ` +
        'no option could narrow anything, so this deployment cannot prove the filter works',
    ).toBeLessThan(before.length);

    await page
      .getByRole('option', { name: new RegExp(`^${escapeRegex(target)}$`) })
      .first()
      .click();

    await expect
      .poll(readDepartments, {
        timeout: 30_000,
        intervals: [800],
        message:
          `selecting Department="${target}" must leave ONLY that department's rows. ` +
          `Page 1 held ${JSON.stringify(before)}, so the grid must narrow to ${JSON.stringify(expectedAfter)}. ` +
          'If the grid is byte-identical to the unfiltered one, the filter is not filtering — ' +
          'ComplaintList.tsx declares source="additionalDetail.department", react-hook-form (inside FilterLiveForm) ' +
          "NESTS that dotted path into params.filter as { additionalDetail: { department } }, while dataProvider.ts " +
          "getList() reads the FLAT key filter['additionalDetail.department'] and gets undefined, so the client-side " +
          'filter never runs. Do not weaken this assertion.',
      })
      .toEqual(expectedAfter);
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
    for (const label of ['Landmark', 'Street', 'Pincode', 'Geo']) {
      const row = page.getByText(new RegExp(`^${label}$`, 'i')).first();
      // Some may be blank — just assert the LABEL renders.
      await expect(row).toBeVisible();
    }

    // Geo link — a target="_blank" anchor to google.com/maps?q=lat,lng.
    //
    // Located by href, NOT by accessible name. The anchor's accessible name is the
    // coordinate pair itself ("-25.969200, 32.573200"); the word "Geo" is only the
    // <dt> label of the FieldRow (admin/fields/FieldSection.tsx), a plain sibling
    // with no aria association to the <a> in the adjacent <dd>. The previous
    // `getByRole('link', { name: /map|geo|location/i })` matched ZERO links, so the
    // click hung on an unresolvable locator and the popup wait timed out first —
    // reporting a failure identical whether the feature worked or not. It works.
    const geoLink = page.locator('a[href*="google.com/maps"]').first();
    await expect(
      geoLink,
      'the Geo row must render a maps link for a complaint with coordinates',
    ).toBeVisible({ timeout: 15_000 });

    // Assert the URL BEFORE clicking, so a placeholder href (e.g. ?q=0,0) fails even
    // though a tab would still open. Single combined match: two separate substring
    // checks can both pass on a URL that merely contains each number somewhere.
    expect(
      await geoLink.getAttribute('href'),
      "geo link must point at the complaint's real coordinates",
    ).toContain(`?q=${target!.lat},${target!.lng}`);
    expect(
      await geoLink.getAttribute('target'),
      'geo link must open in a new tab',
    ).toBe('_blank');

    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 10_000 }),
      geoLink.click(),
    ]);

    const popupUrl = popup.url();
    expect(popupUrl).toMatch(/google\.com\/maps/);
    expect(popupUrl).toContain(`${target!.lat},${target!.lng}`);
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
    // Wait for the REQUEST, not for a load state. Clicking Next in an SPA performs
    // no navigation, and the page's `networkidle` already fired during goto(), so
    // waitForLoadState('networkidle') returns in ~0.2 ms — before React has even
    // dispatched the refetch. The old assertion was therefore reading `searches`
    // while it was still empty, and reported "pagination is not server-side" on a
    // grid that pages perfectly well.
    await Promise.all([
      page.waitForRequest(
        (r) => r.url().includes('/pgr-services/v2/request/_search'),
        { timeout: 15_000 },
      ),
      nextBtn.click(),
    ]);
    await expect
      .poll(() => searches.length, {
        message: 'paging should trigger a fresh _search XHR',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    // The last search's offset should be > 0 — i.e. real server-side paging.
    const last = searches[searches.length - 1];
    const offset = Number(last.searchParams.get('offset') || '0');
    expect(offset, 'offset on second page should be > 0').toBeGreaterThan(0);
  });

  test('11. department column renders the readable department name, not a raw code', {
    annotation: {
      type: 'description',
      description: `Confirms the Department column in the complaints list renders an EntityLink (anchor pointing at the dept show page), not a raw text code. Catches a regression where the cross-reference is dropped and admins lose the click-through to dept details.

Steps:
1. Navigate to /complaints; wait networkidle.
2. pgrSearch; iterate looking for a complaint with additionalDetail.department populated.
3. test.skip if none.
4. Resolve that department's display name from common-masters.Department.
5. Assert the grid's row text contains the readable display name.

Product decision (2026-07-26): there is no departments page, so the column is NOT expected to be a link. The requirement is that it reads as a human-readable name rather than a raw identifier — the stored value should be the code, the rendered value the name.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }) => {
    await page.goto(LIST_PATH);
    await page.waitForLoadState('networkidle').catch(() => {});

    const auth = loadAuth();

    // Resolve the departments master FIRST so we can prefer a complaint whose
    // department actually resolves to a display name.
    //
    // isActive:true is load-bearing here: this deployment carries 225+
    // department records of which only 3 are real — the rest are soft-deleted
    // PW_ scratch rows left by previous suite runs. An unfiltered page of 200
    // is entirely junk, the real rows sort past the page boundary, and the
    // lookup below found nothing even though the department exists. Pushing
    // isActive to the server paginates over the ACTIVE set instead.
    const deptRecords = await mdmsSearch(auth, TENANT_CODE, 'common-masters.Department', {
      limit: 500,
      isActive: true,
    }).catch(() => [] as Awaited<ReturnType<typeof mdmsSearch>>);
    const resolveDeptName = (code: string): string | undefined => {
      const match = deptRecords.find((r) => {
        const d = r.data as Record<string, unknown>;
        return d?.code === code || r.uniqueIdentifier === code || d?.name === code;
      });
      return (match?.data as Record<string, unknown> | undefined)?.name as string | undefined;
    };

    // Find a complaint whose additionalDetail.department is populated so
    // we know the column has something to render. Prefer one whose department
    // still resolves in the master — scratch complaints from earlier runs can
    // point at departments that have since been soft-deleted.
    const wrappers = await pgrSearch(auth, CITY_TENANT, { limit: 50 });
    let deptCode: string | null = null;
    let fallbackDeptCode: string | null = null;
    for (const w of wrappers) {
      const svc = w.service as Record<string, unknown> | undefined;
      const add = svc?.additionalDetail as Record<string, unknown> | undefined;
      const d = add?.department as string | undefined;
      if (!d) continue;
      if (fallbackDeptCode === null) fallbackDeptCode = d;
      if (resolveDeptName(d)) { deptCode = d; break; }
    }
    if (!deptCode) deptCode = fallbackDeptCode;
    if (!deptCode) test.skip(true, 'No complaint with additionalDetail.department on tenant');

    // Product decision (2026-07-26): there is NO departments page to link to, so
    // the column is not expected to be an anchor. What it MUST do is render the
    // department in a human-readable form — the display name, not a raw code —
    // even though the underlying record should store the code as the identifier.
    const rowsText = (await page.getByRole('row').allTextContents()).join(' | ');
    expect(rowsText, 'complaints list rendered rows').toBeTruthy();

    // Resolve the department's display name from the departments master (read
    // above), then assert the grid shows THAT (not the raw code).
    // Deployment-agnostic: the name comes from the tenant's own master, never
    // a hardcoded literal.
    const displayName = resolveDeptName(deptCode!);
    if (!displayName) test.skip(true, `department '${deptCode}' not found in common-masters.Department — cannot resolve its display name`);

    expect(
      rowsText.includes(displayName!),
      `Department column should show the readable name "${displayName}" (rows: ${rowsText.slice(0, 300)})`,
    ).toBe(true);
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

    // A PGR field edit still needs a valid workflow action — the API defaults to
    // ASSIGN, which is only valid from PENDINGFORASSIGNMENT and needs an assignee.
    // Drive a real ASSIGN and confirm the description rides along in the SAME
    // _update round-trip (the point of this test).
    // These custom selects have NO <label> association, so getByLabel never
    // matches them — locate by the combobox's own visible text instead.
    const actionSelect = page.getByRole('combobox').filter({ hasText: /select action/i }).first();
    await actionSelect.waitFor({ state: 'visible', timeout: 20_000 });
    await actionSelect.scrollIntoViewIfNeeded().catch(() => {});
    // force: the trigger is visible but Playwright's actionability check can hang
    // on this custom select (overlay/pointer-events during the record load).
    await actionSelect.click({ timeout: 20_000, force: true });
    await chooseAssignAction(page);
    const assigneeSelect = page.getByRole('combobox').filter({ hasText: /select employee/i }).first();
    if (await assigneeSelect.isVisible().catch(() => false)) {
      await assigneeSelect.click();
      // Pick the department-valid assignee resolved in beforeAll. The dropdown is
      // not department-filtered yet (product gap), so 'first option' can be a
      // employee whose department pgr-services will reject with a 400.
      const wanted = lmeAssigneeName
        ? page.getByRole('option', { name: new RegExp(lmeAssigneeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first()
        : null;
      if (wanted && await wanted.count() > 0) await wanted.click();
      else await page.getByRole('option').first().click();
    }
    const desc = page.getByLabel(/^Description/i);
    await desc.fill('');
    await desc.fill(newDesc);
    await desc.blur();

    const updates: Array<{ body: string }> = [];
    page.on('request', (req) => {
      if (
        req.url().includes('/pgr-services/v2/request/_update') &&
        req.method() === 'POST'
      ) {
        updates.push({ body: req.postData() || '' });
      }
    });

    const [upd12] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/pgr-services/v2/request/_update') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      page.getByRole('button', { name: /^Save$/i }).click(),
    ]);
    expect(upd12.status(), 'PGR _update should succeed').toBe(200);

    expect(updates.length, 'expected exactly one _update POST on save').toBe(1);
    // The single POST body should carry the new description under service.description.
    const body = JSON.parse(updates[0].body || '{}');
    expect((body.service as Record<string, unknown>)?.description).toBe(newDesc);

    // Persisted per the _update RESPONSE (source of truth; the search index lags).
    const respBody = await upd12.json();
    const persisted = (respBody.ServiceWrappers?.[0]?.service as Record<string, unknown>)?.description;
    expect(persisted).toBe(newDesc);
  });

  test('13. PENDINGFORASSIGNMENT filter returns the expected queue size', {
    annotation: {
      type: 'description',
      description: `API-level check that the PENDINGFORASSIGNMENT status filter returns a REAL, verifiable queue size — not merely a self-consistent one.

The previous version asserted count >= 0, wrappers.length <= count and wrappers.length <= 50. All three are tautologies (counts are always >= 0; 0 <= N always holds; 50 was the limit it had just passed), so despite the title nothing asserted a size and the test could not fail. Note pgrCount() returns 0 for any non-numeric body, so even a broken endpoint kept it green.

Steps:
1. total  = pgrCount(CITY_TENANT)                            — every complaint on the tenant.
2. queue  = pgrCount(CITY_TENANT, { status: PENDINGFORASSIGNMENT }).
3. Assert 0 < queue <= total. A non-empty queue is a real precondition of this suite: lifecycle.setup.ts seeds a PENDINGFORASSIGNMENT complaint every run and pickWorkableComplaint() consumes them, so an empty queue means the filter (or the seed) is broken.
4. Page the filtered search (the deployment caps one _search page at 200 rows regardless of limit) and assert the DISTINCT serviceRequestIds collected equal 'queue' exactly, every row PENDINGFORASSIGNMENT — the server must surface the whole queue, nothing else, nothing twice.
5. Assert the page size is honoured EXACTLY: pgrSearch(status, limit 25).length === min(25, queue).
6. Independent recount: sweep the UNFILTERED complaint list page by page and count PENDINGFORASSIGNMENT locally; assert it equals 'queue'. This is the only assertion here that cannot be satisfied by an internally-consistent-but-wrong server (skipped, with an annotation, on tenants too large to sweep).

Mutation-proven: flipping the status to a nonsense state drops 'queue' to 0 and step 3 fails; stubbing pgrSearch to [] fails step 4.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async () => {
    const auth = loadAuth();
    const QUEUE_STATUS = 'PENDINGFORASSIGNMENT';
    const SWEEP_PAGE = 100;
    // Above this, the unfiltered sweep costs more than it is worth; steps 3-5
    // still carry the test.
    const SWEEP_LIMIT = 2_000;

    const total = await pgrCount(auth, CITY_TENANT);
    const queue = await pgrCount(auth, CITY_TENANT, { status: QUEUE_STATUS });

    expect(total, `tenant ${CITY_TENANT} must hold complaints to measure a queue against`)
      .toBeGreaterThan(0);
    expect(
      queue,
      `the ${QUEUE_STATUS} queue must be non-empty — lifecycle.setup.ts seeds one every run, ` +
        'so 0 means either the status filter or the seed is broken',
    ).toBeGreaterThan(0);
    expect(queue, 'a filtered queue can never exceed the tenant total').toBeLessThanOrEqual(total);

    // The filtered search must surface the WHOLE queue and nothing but the
    // queue. Paged, not one giant limit: the deployment caps a single _search
    // page (bomet returns at most 200 rows however large the limit), so a
    // one-shot fetch conflates "filter is broken" with "page cap reached".
    // Distinct srids also catch overlapping pages, which rows.length never did.
    const QUEUE_PAGE = 100;
    const seenSrids = new Set<string>();
    for (let offset = 0; offset < queue + QUEUE_PAGE; offset += QUEUE_PAGE) {
      const page = await pgrSearch(auth, CITY_TENANT, {
        status: QUEUE_STATUS,
        limit: QUEUE_PAGE,
        offset,
      });
      if (page.length === 0) break;
      for (const w of page) {
        const svc = w.service as Record<string, unknown> | undefined;
        expect(
          String(svc?.applicationStatus ?? ''),
          `_search must return ONLY ${QUEUE_STATUS} complaints`,
        ).toBe(QUEUE_STATUS);
        const srid = String(svc?.serviceRequestId ?? '');
        expect(srid, 'every returned record must carry a serviceRequestId').toBeTruthy();
        seenSrids.add(srid);
      }
      if (page.length < QUEUE_PAGE) break;
    }
    expect(
      seenSrids.size,
      `paging the ${QUEUE_STATUS} filter must surface every complaint _count promised ` +
        `(${queue}), each exactly once`,
    ).toBe(queue);

    // Page size honoured exactly — not "at most".
    const pageSize = 25;
    const firstPage = await pgrSearch(auth, CITY_TENANT, { status: QUEUE_STATUS, limit: pageSize });
    expect(firstPage.length, `limit=${pageSize} must yield exactly min(limit, queue) rows`).toBe(
      Math.min(pageSize, queue),
    );

    // Independent recount from the UNFILTERED list — the server's own filter is
    // not allowed to be the only witness to its own size.
    if (total > SWEEP_LIMIT) {
      test.info().annotations.push({
        type: 'note',
        description: `unfiltered recount skipped: ${total} complaints on ${CITY_TENANT} exceeds the ${SWEEP_LIMIT} sweep cap`,
      });
      return;
    }
    let recount = 0;
    let swept = 0;
    for (let offset = 0; offset < total; offset += SWEEP_PAGE) {
      const page = await pgrSearch(auth, CITY_TENANT, { limit: SWEEP_PAGE, offset });
      if (page.length === 0) break;
      swept += page.length;
      for (const w of page) {
        const status = (w.service as Record<string, unknown> | undefined)?.applicationStatus;
        if (status === QUEUE_STATUS) recount += 1;
      }
    }
    expect(swept, 'the unfiltered sweep must reach every complaint _count reported').toBe(total);
    expect(
      recount,
      `counting ${QUEUE_STATUS} by hand across all ${total} complaints must reproduce the ` +
        'size the server reports for the filtered query',
    ).toBe(queue);
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
    limit: 50,
  }).catch(() => []);
  // Prefer a complaint filed under the deployment's SEED serviceCode: its
  // department is one a PGR_LME employee actually holds, so an ASSIGN succeeds.
  // A random PFA complaint is often an old test-junk type whose department no
  // employee holds — ASSIGN then 400s (pgr-services NPEs on the mismatch).
  const idOf = (w: { service?: unknown }) =>
    (w.service as Record<string, unknown> | undefined)?.serviceRequestId as string | undefined;
  const claim = (id: string | undefined): string | null => {
    if (!id || consumedComplaints.has(id)) return null;
    consumedComplaints.add(id);
    return id;
  };

  // Scavenge ONLY a complaint whose live WORKFLOW state agrees with pgr's.
  //
  // pgr-services' `applicationStatus` cannot be trusted on this deployment. The
  // configurator's complaint edit submits `address.locality.code: null`; pgr
  // answers 200 and publishes, then egov-persister rejects the row on a NOT NULL
  // constraint and the shared transaction rolls the service row back too. The
  // result is a "zombie": egov-workflow-v2 has advanced to PENDINGATLME while the
  // pgr read model still reports PENDINGFORASSIGNMENT, permanently.
  //
  // Measured on mz.maputo: 23 of 211 PENDINGFORASSIGNMENT complaints were zombies,
  // with 15 distinct ids producing `INVALID ACTION` in a five-hour window. Handing
  // one to a test yields exactly that 400 — the UI loads the stale status, offers
  // ASSIGN, and workflow (which IS up to date) refuses it.
  //
  // Crucially, a PASSING edit test mints a new zombie, so this poisons itself: the
  // same spec alternates green and red depending on whether the newest candidate
  // happens to be a fresh seed or a corpse from the previous run.
  const wfAgrees = async (srid: string): Promise<boolean> => {
    try {
      const r = await fetch(
        `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?tenantId=${CITY_TENANT}` +
          `&businessIds=${encodeURIComponent(srid)}&history=false`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ RequestInfo: buildRequestInfo(auth) }),
        },
      );
      if (!r.ok) return false;
      const j = (await r.json()) as { ProcessInstances?: Array<{ state?: { applicationStatus?: string } }> };
      const state = j.ProcessInstances?.[0]?.state?.applicationStatus;
      // No workflow record yet == freshly filed and not desynced.
      return state === undefined || state === 'PENDINGFORASSIGNMENT';
    } catch {
      return false;
    }
  };

  for (const w of wrappers) {
    if ((w.service as Record<string, unknown>)?.serviceCode !== SERVICE_CODE) continue;
    const id = idOf(w);
    if (!id || consumedComplaints.has(id)) continue;
    if (!(await wfAgrees(id))) continue; // zombie — skip it
    const claimed = claim(id);
    if (claimed) return claimed;
  }

  // No unconsumed, workflow-consistent complaint of the seed serviceCode — file a
  // fresh one rather than scavenging.
  //
  // Scavenging is actively harmful here: most PENDINGFORASSIGNMENT complaints on
  // a long-lived box are filed against `PW*` junk complaint types other runs
  // created, whose department no employee holds. ASSIGN on one of those 400s in
  // pgr-services, which reads as a workflow bug and is really just bad test data.
  // Seeding gives every caller a complaint of the SEED serviceCode, whose
  // department the resolved PGR_LME assignee actually holds.
  try {
    const seeded = await seedComplaintAsCitizen({
      serviceCode: SERVICE_CODE,
      localityCode: LOCALITY_CODE,
      description: `complaints.spec seed — ${new Date().toISOString()}`,
    });
    createdComplaints.add(seeded.srid);
    const id = claim(seeded.srid);
    if (id) return id;
  } catch {
    // Fall through to scavenging — better a flaky complaint than no coverage.
  }

  for (const w of wrappers) {
    const id = claim(idOf(w));
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
      const id = claim(svc?.serviceRequestId as string | undefined);
      if (id) return id;
    }
  }
  return null;
}
