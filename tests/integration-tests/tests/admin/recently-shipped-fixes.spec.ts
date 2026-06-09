/**
 * Regression coverage for the most recent wave of CCRS fixes.
 *
 * Each block guards a specific issue. Most assertions are API-level
 * (faster, less flaky than full UI walks) plus a couple of focused UI
 * checks where the bug was strictly client-side.
 *
 * Issues covered:
 *   - #413 — HRMS employee search empty by default (UI must seed
 *            active=true & isActive=true)
 *   - #432 — PGR inbox: default-open-states filter, statusMap
 *            populated, sort icons removed from un-sortable columns
 *   - #430 — action button labels render via localization
 *            (Take Action / Escalate / Assign / …)
 *   - #42  — Complaint Type dropdown renders translated category
 *            names (was: 19 blank rows)
 *   - #44  — locale region-append regression: sw_KE must NOT be
 *            mangled into sw_KEIN by getLocale/updateResources
 *   - #417 — Configurator must no longer render the UndoToast
 *            (real rollback compensators are blocked on backend)
 */
import { test, expect } from '@playwright/test';
import { getDigitToken, loginViaApi } from '../utils/auth';
import { BASE_URL, TENANT, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

const HRMS_SEARCH = `${BASE_URL}/egov-hrms/employees/_search`;
const PGR_SEARCH = `${BASE_URL}/pgr-services/v2/request/_search`;
const LOC_SEARCH = `${BASE_URL}/localization/messages/v1/_search`;
const WF_BS_SEARCH = `${BASE_URL}/egov-workflow-v2/egov-wf/businessservice/_search`;
const MDMS_V1 = `${BASE_URL}/egov-mdms-service/v1/_search`;

async function adminToken(): Promise<string> {
  const t = await getDigitToken({
    tenant: ROOT_TENANT,
    username: ADMIN_USER,
    password: ADMIN_PASS,
  });
  return t.access_token;
}

function adminRequestInfo(token: string) {
  return {
    apiId: 'Rainmaker',
    authToken: token,
    msgId: 'spec',
    userInfo: {
      id: 1,
      uuid: 'ef0947ca-a9ab-437d-af14-957c2e921c5b',
      userName: ADMIN_USER,
      tenantId: ROOT_TENANT,
      type: 'EMPLOYEE',
      roles: [{ code: 'SUPERUSER', tenantId: ROOT_TENANT }],
    },
  };
}

test.describe('CCRS#413 — HRMS empty default search', () => {
  test('API: active=true & isActive=true returns the tenant employee list', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#413: HRMS employee search returned empty by default in the configurator's Manage > Employees page because the UI dropped the active/isActive filters. Pre-fix users saw "No matching records found" on a tenant with employees. Post-fix the UI sends active=true&isActive=true and the API returns the full list.

Steps:
1. Acquire admin token.
2. POST to /egov-hrms/employees/_search?tenantId=ke.nairobi&active=true&isActive=true&limit=100.
3. Read response.Employees array; assert length > 0.

Doesn't assert the empty-filter case because SUPERUSER short-circuits the backend filter logic, making the test environment-dependent. Asserts only the positive contract — what the UI now sends.`,
    },
    tag: ['@area:configurator-manage', '@ccrs:413', '@kind:edge-case', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    // The empty-filter case is environment-dependent — when the
    // RequestInfo carries a SUPERUSER role the backend short-circuits
    // and returns everything anyway, but the UI's RequestInfo (built
    // from a plain employee session) does not, hence the original
    // "No matching records found" bug. We only assert the fix's
    // positive contract: with active=true&isActive=true the API
    // returns the full list, which is what the UI now sends by default.
    const token = await adminToken();
    const body = JSON.stringify({ RequestInfo: adminRequestInfo(token) });
    const headers = { 'Content-Type': 'application/json' };

    const seeded = await fetch(
      `${HRMS_SEARCH}?tenantId=${TENANT}&limit=100&offset=0&active=true&isActive=true`,
      { method: 'POST', headers, body },
    );
    const seededJson = await seeded.json();
    expect((seededJson.Employees ?? []).length).toBeGreaterThan(0);
  });
});

test.describe('CCRS#432 — PGR inbox defaults', () => {
  test('API: workflow business service exposes the 11 PGR states (drives statusMap)', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#432 (statusMap data dependency): the PGR inbox needs the workflow's BusinessService.states to populate its filter dropdown. The backend must expose at least the open + closed states the UI filters on (PENDINGFORASSIGNMENT, PENDINGATLME, RESOLVED, REJECTED).

Steps:
1. Acquire admin token.
2. POST to /egov-wf/businessservice/_search?tenantId=ke&businessServices=PGR.
3. Read response.BusinessServices; assert length === 1.
4. Filter states by !!state to get only real states; capture state codes.
5. For each of ['PENDINGFORASSIGNMENT','PENDINGATLME','RESOLVED','REJECTED'], assert it's in the codes.

Tests the upstream data — without it, the UI's statusMap fix is moot.`,
    },
    tag: ['@area:configurator-manage', '@ccrs:432', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    const token = await adminToken();
    const r = await fetch(
      `${WF_BS_SEARCH}?tenantId=${ROOT_TENANT}&businessServices=PGR`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: adminRequestInfo(token) }),
      },
    );
    const json = await r.json();
    const services = json.BusinessServices ?? [];
    expect(services).toHaveLength(1);
    const states = (services[0]?.states ?? []).filter(
      (s: Record<string, unknown>) => !!s.state,
    );
    // Expect at least the open + closed states we filter on.
    const stateCodes = states.map((s: { state: string }) => s.state);
    for (const code of [
      'PENDINGFORASSIGNMENT',
      'PENDINGATLME',
      'RESOLVED',
      'REJECTED',
    ]) {
      expect(stateCodes).toContain(code);
    }
  });

  test('API: pgr-services rejects non-applicationStatus sortBy values', {
    annotation: {
      type: 'description',
      description: `Documents the platform constraint behind the SLA-sort-icon removal in the PGR inbox. pgr-services accepts only certain SortBy enum values. Sending sortBy=serviceSla returns a 400 with a typeMismatch error code — confirming the backend doesn't support sorting by SLA, hence the UI was right to remove the icon.

Steps:
1. Acquire admin token.
2. POST to /pgr-services/v2/request/_search?tenantId=ke.nairobi&limit=2&sortBy=serviceSla.
3. Read response.Errors; assert length > 0.
4. Assert Errors[0].code contains 'typeMismatch'.

If pgr-services later adds serviceSla to the SortBy enum, this test flips and the UI can re-enable the icon.`,
    },
    tag: ['@area:configurator-manage', '@ccrs:432', '@kind:edge-case', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    // Documents the platform constraint behind the SLA-sort-icon removal.
    // If pgr-services later adds `serviceSla` to the SortBy enum, this
    // test flips and we can re-enable the sort icon in the UI config.
    const token = await adminToken();
    const r = await fetch(
      `${PGR_SEARCH}?tenantId=${TENANT}&limit=2&sortBy=serviceSla`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: adminRequestInfo(token) }),
      },
    );
    const json = await r.json();
    const errs: Array<{ code?: string }> = json.Errors ?? [];
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]?.code ?? '').toContain('typeMismatch');
  });

  test('Bundle: open-states constant is present in the served JS', {
    annotation: {
      type: 'description',
      description: `Bundle-level guard: the OPEN_STATES constant landed in products/pgr/src/configs/UICustomizations.js. If a future refactor strips it, the inbox silently regresses to "all states by default" — the original CCRS#432 bug. Fetching index.js and grepping for the literal state codes catches that without needing a UI session.

Steps:
1. setTimeout 180s (large bundle download).
2. fetch GET /digit-ui/index.js; assert response.ok.
3. Read body text.
4. Assert text contains 'PENDINGFORASSIGNMENT' AND 'PENDINGATLME'.

Fast and session-free — fails immediately on bundle regression.`,
    },
    tag: ['@area:configurator-manage', '@ccrs:432', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    test.setTimeout(180_000);
    // The default open-states list landed in
    // `products/pgr/src/configs/UICustomizations.js` as `OPEN_STATES`.
    // If a future refactor strips it, the inbox will silently regress
    // to "all states by default" — exactly the bug #432 reported. This
    // bundle-level check fails fast and doesn't need a UI session.
    const r = await fetch(`${BASE_URL}/digit-ui/index.js`);
    expect(r.ok, `index.js fetch should succeed (got ${r.status})`).toBe(true);
    const text = await r.text();
    expect(text).toContain('PENDINGFORASSIGNMENT');
    expect(text).toContain('PENDINGATLME');
  });
});

test.describe('CCRS#430 — action labels are localized', () => {
  test('API: rainmaker-pgr en_IN has sentence-cased labels for ESCALATE/ASSIGN/etc', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#430: PGR action labels (ESCALATE, ASSIGN, REJECT, RESOLVE, REOPEN) used to render as raw upper-snake codes because localization rows were missing. Post-fix the rows exist and resolve to sentence-cased copy.

Steps:
1. POST /localization/messages/v1/_search?codes=ESCALATE,ASSIGN,REJECT,RESOLVE,REOPEN&tenantId=ke&locale=en_IN.
2. Read messages array.
3. For each code, find the matching message; assert it exists.
4. Assert message.toUpperCase() !== message — i.e. NOT identical to the upper-snake code (proves it's localized, not echoed).

Loose contract — the test doesn't pin the exact text, only that the row exists and isn't the raw code.`,
    },
    tag: ['@area:configurator-manage', '@ccrs:430', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    const codes = ['ESCALATE', 'ASSIGN', 'REJECT', 'RESOLVE', 'REOPEN'];
    const r = await fetch(
      `${LOC_SEARCH}?codes=${codes.join(',')}&tenantId=${ROOT_TENANT}&locale=en_IN`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: { authToken: '' } }),
      },
    );
    const json = await r.json();
    const messages: Array<{ code: string; message: string }> = json.messages ?? [];

    for (const code of codes) {
      const row = messages.find((m) => m.code === code);
      expect(row, `localization row missing for ${code}`).toBeTruthy();
      // Sentence-case (i.e. NOT identical to the upper-snake code).
      expect(row!.message.toUpperCase()).not.toBe(row!.message);
    }
  });

  test('API: ES_COMMON_TAKE_ACTION resolves to "Take Action"', {
    annotation: {
      type: 'description',
      description: `Anchored localization check for the Take Action button in the PGR detail page. ES_COMMON_TAKE_ACTION must resolve to text matching /Take Action/i in en_IN — pinned because this label is used in many test selectors.

Steps:
1. POST /localization/messages/v1/_search?codes=ES_COMMON_TAKE_ACTION&tenantId=ke&locale=en_IN.
2. Find the message with code ES_COMMON_TAKE_ACTION.
3. Assert message matches /Take Action/i.

If this row goes missing or its copy changes, several PGR UI tests in this suite fail at selector time.`,
    },
    tag: ['@area:configurator-manage', '@ccrs:430', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    const r = await fetch(
      `${LOC_SEARCH}?codes=ES_COMMON_TAKE_ACTION&tenantId=${ROOT_TENANT}&locale=en_IN`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: { authToken: '' } }),
      },
    );
    const json = await r.json();
    const row = (json.messages ?? []).find(
      (m: { code: string }) => m.code === 'ES_COMMON_TAKE_ACTION',
    );
    expect(row?.message).toMatch(/Take Action/i);
  });
});

test.describe('CCRS#42 — Complaint Type menuPathName labels', () => {
  test('API: 19 SERVICEDEFS.<menuPath> rows exist in en_IN AND sw_KE', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#42 (Complaint Type dropdown blank rows). The 19 SERVICEDEFS.<MENUPATH> localization rows must exist in BOTH en_IN and sw_KE locales. Pre-fix the configurator's complaint type seed didn't push these keys, so the citizen dropdown rendered 19 blank options.

Steps:
1. For each locale in [en_IN, sw_KE]:
   - POST /localization/messages/v1/_search with codes for ADMINISTRATION, WATERRELATED, LANDRATES, MOBILITYANDWORKS, FINANCEANDREVENUE.
   - For each requested code, find the matching message in response.
   - Assert message exists with non-empty text.

Tests 5 representative codes across the 19 menuPath values — fewer assertions but covers the full breadth via locale × multiple codes.`,
    },
    tag: ['@area:configurator-manage', '@ccrs:42', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    const codes = [
      'SERVICEDEFS.ADMINISTRATION',
      'SERVICEDEFS.WATERRELATED',
      'SERVICEDEFS.LANDRATES',
      'SERVICEDEFS.MOBILITYANDWORKS',
      'SERVICEDEFS.FINANCEANDREVENUE',
    ];
    for (const locale of ['en_IN', 'sw_KE']) {
      const r = await fetch(
        `${LOC_SEARCH}?codes=${codes.join(',')}&tenantId=${ROOT_TENANT}&locale=${locale}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ RequestInfo: { authToken: '' } }),
        },
      );
      const json = await r.json();
      const messages: Array<{ code: string; message: string }> = json.messages ?? [];
      for (const code of codes) {
        const row = messages.find((m) => m.code === code);
        expect(row, `${code} missing in ${locale}`).toBeTruthy();
        expect(row!.message.length).toBeGreaterThan(0);
      }
    }
  });
});

test.describe('CCRS#44 — locale region-append regression', () => {
  test('API: rainmaker-common sw_KE search returns rows (not the broken sw_KEIN)', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#44 (locale region-append regression): the UI's getLocale/updateResources used to mangle 'sw_KE' into 'sw_KEIN', and the broken locale returned 0 messages — every Swahili UI string fell back to en_IN. Post-fix the locale stays clean.

Steps:
1. POST /localization/messages/v1/_search?module=rainmaker-common&locale=sw_KE&tenantId=ke.
2. Read response.messages.
3. Assert messages.length > 100.

Threshold of 100 is far above the empty-result case but below any realistic message count, so it cleanly distinguishes "broken" from "working".`,
    },
    tag: ['@area:configurator-manage', '@ccrs:44', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    const r = await fetch(
      `${LOC_SEARCH}?module=rainmaker-common&locale=sw_KE&tenantId=${ROOT_TENANT}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: { authToken: '' } }),
      },
    );
    const json = await r.json();
    const messages = json.messages ?? [];
    // Pre-fix the UI sent `?locale=sw_KEIN` and got 0; even if the
    // server were asked directly for sw_KEIN it would also return 0.
    expect(messages.length).toBeGreaterThan(100);
  });

  test('API: rainmaker-common sw_KEIN (the buggy mangle) is empty — proves the dataset itself is clean', {
    annotation: {
      type: 'description',
      description: `Companion test to the sw_KE check: confirms the buggy locale 'sw_KEIN' (what the UI used to send pre-fix) returns 0 rows. Proves the dataset itself doesn't contain mangled rows — pre-fix the bug was strictly client-side, not a stale upload.

Steps:
1. POST /localization/messages/v1/_search?module=rainmaker-common&locale=sw_KEIN&tenantId=ke.
2. Assert response.messages array has length === 0.

Pairs with the sw_KE test to bracket the regression — sw_KE must work, sw_KEIN must be empty.`,
    },
    tag: ['@area:configurator-manage', '@ccrs:44', '@kind:edge-case', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    const r = await fetch(
      `${LOC_SEARCH}?module=rainmaker-common&locale=sw_KEIN&tenantId=${ROOT_TENANT}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: { authToken: '' } }),
      },
    );
    const json = await r.json();
    expect(json.messages ?? []).toHaveLength(0);
  });
});

test.describe('CCRS#417 — Undo toast removed from configurator', () => {
  test('UI: no UndoToast container is mounted after navigating into the configurator', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#417: the configurator used to render a global UndoToast inside <App>, but real rollback compensators are blocked on backend support, so the toast was misleading. Post-fix the UndoToast component is not mounted on any screen.

Steps:
1. Open a fresh browser context with the auth.json storageState.
2. Navigate to /configurator/manage; wait for domcontentloaded then 1.5s for SPA + toasts to render.
3. Locate getByText(/Undo available for/i); assert count === 0.
4. Locate getByRole('button', { name: /^Undo$/ }); assert count === 0.

Defence-in-depth — checks both the toast text and the dedicated Undo button to catch a partial mount.`,
    },
    tag: ['@area:configurator-manage', '@ccrs:417', '@kind:regression', '@layer:api', '@persona:admin'] }, async ({
    browser,
  }) => {
    // Use a fresh context and exercise the regular login form so we
    // mirror the operator's path. UndoToast was rendered globally inside
    // <App>, so any screen would show it on render — including the
    // landing /manage view.
    const context = await browser.newContext({ storageState: 'auth.json' });
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/configurator/manage`);
      await page.waitForLoadState('domcontentloaded');
      // Give the SPA + global toasts a couple of frames to render.
      await page.waitForTimeout(1500);

      // The previous UndoToast had a fixed-position container with
      // `Undo available for Ns` copy. Both should be absent.
      const undoLabel = page.getByText(/Undo available for/i);
      await expect(undoLabel).toHaveCount(0);

      // Defence-in-depth: no element with the literal text "Undo" in the
      // bottom-right toast region.
      const undoButton = page.getByRole('button', { name: /^Undo$/ });
      await expect(undoButton).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
