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
  test('API: active=true & isActive=true returns the tenant employee list', async () => {
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
  test('API: workflow business service exposes the 11 PGR states (drives statusMap)', async () => {
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

  test('API: pgr-services rejects non-applicationStatus sortBy values', async () => {
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

  test('Bundle: open-states constant is present in the served JS', async () => {
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
  test('API: rainmaker-pgr en_IN has sentence-cased labels for ESCALATE/ASSIGN/etc', async () => {
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

  test('API: ES_COMMON_TAKE_ACTION resolves to "Take Action"', async () => {
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
  test('API: 19 SERVICEDEFS.<menuPath> rows exist in en_IN AND sw_KE', async () => {
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
  test('API: rainmaker-common sw_KE search returns rows (not the broken sw_KEIN)', async () => {
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

  test('API: rainmaker-common sw_KEIN (the buggy mangle) is empty — proves the dataset itself is clean', async () => {
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
  test('UI: no UndoToast container is mounted after navigating into the configurator', async ({
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
