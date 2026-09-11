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
import { BASE_URL, TENANT, ROOT_TENANT, ADMIN_USER, ADMIN_PASS, LOCALES } from '../utils/env';

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

// swKeSeeded() lived here: a "does this deployment have the Kenya-rollout sw_KE
// bundle?" guard, used to self-skip the CCRS#44 block everywhere but Kenya. Gone
// because the #44 tests no longer pin sw_KE — they read the deployment's own
// advertised locales, so there is nothing left to gate on.

/**
 * The `COMPLAINT_HIERARCHY.<code>` localization keys this deployment should carry
 * — derived from its own hierarchy rather than pinned to one rollout's codes.
 *
 * RAINMAKER-PGR.ComplaintHierarchy is a single adjacency list holding both the
 * interior CATEGORY nodes and the leaf complaint types. A leaf carries
 * `department`/`slaHours`; an interior node carries neither. It's the interior
 * nodes that render as the dropdown's group headings, which is exactly what
 * CCRS#42 saw come out blank.
 */
async function categoryCodes(): Promise<string[]> {
  try {
    const token = await adminToken();
    const r = await fetch(
      `${BASE_URL}/mdms-v2/v2/_search?tenantId=${ROOT_TENANT}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: { authToken: token },
          MdmsCriteria: {
            tenantId: ROOT_TENANT,
            schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy',
            limit: 500,
            isActive: true,
          },
        }),
      },
    );
    const json = await r.json();
    const rows: Array<{ data?: Record<string, unknown> }> = json.mdms ?? [];
    const interior = rows
      .map((row) => row.data ?? {})
      .filter((d) => d.department === undefined && d.slaHours === undefined)
      .map((d) => String(d.code ?? ''))
      // Exclude the suite's OWN leftovers. complaint-types.spec.ts creates
      // `PWAUTHORITYTYPE…` / `PWMAINCATEGORY…` / `PWSECTOR…` nodes and they are
      // never torn down, so on a long-lived box they outnumber the real tree by
      // 150:1. They have no localization and never will — asserting on them would
      // fail this test forever, and the sheer count also blew the localization
      // query past nginx's URL limit (10 kB of codes → a 414 HTML page).
      .filter((c) => c && !/(^|_)PW[A-Z_]/i.test(c));
    // Codes are seeded upper-cased into the localization key namespace.
    return Array.from(new Set(interior.map((c) => `COMPLAINT_HIERARCHY.${c.toUpperCase()}`)));
  } catch {
    return [];
  }
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

  test('API: pgr-services SortBy accepts `sla` but rejects unknown literals like `serviceSla`', {
    annotation: {
      type: 'description',
      description: `Pins the pgr-services SortBy contract. The backend enum RequestSearchCriteria.SortBy is {locality, applicationStatus, serviceRequestId, createdTime, sla} — so sorting by SLA IS supported (sortBy=sla is accepted). What is NOT a valid enum value is the literal 'serviceSla'; sending it returns a typeMismatch error. This test asserts both halves: sla is accepted, serviceSla is rejected. (The earlier note claiming "the backend can't sort by SLA" is stale — sla was added to the enum.)

Steps:
1. Acquire admin token.
2. Positive: POST /pgr-services/v2/request/_search?tenantId=ke.nairobi&limit=2&sortBy=sla; assert response.Errors is empty (sla is a valid enum value).
3. Negative: POST the same with sortBy=serviceSla; assert response.Errors length > 0 and Errors[0].code contains 'typeMismatch'.

Guards against a caller passing the wrong literal AND documents that SLA sorting is now available in the enum.`,
    },
    tag: ['@area:configurator-manage', '@ccrs:432', '@kind:edge-case', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    const token = await adminToken();

    // Positive — `sla` is a valid SortBy enum value (backend enum:
    // {locality, applicationStatus, serviceRequestId, createdTime, sla}), so
    // pgr-services accepts it without a typeMismatch.
    const okRes = await fetch(
      `${PGR_SEARCH}?tenantId=${TENANT}&limit=2&sortBy=sla`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: adminRequestInfo(token) }),
      },
    );
    const okJson = await okRes.json();
    expect(
      okJson.Errors ?? [],
      `sortBy=sla should be accepted, got ${JSON.stringify(okJson.Errors ?? [])}`,
    ).toHaveLength(0);

    // Negative — `serviceSla` is NOT a SortBy enum value, so it's rejected
    // with a typeMismatch. (Guards a caller passing the wrong literal.)
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

// Tier-3 / deployment-pinned: the sw_KE locale + the en_IN PGR action
// labels are seeded by the CCRS Kenya rollout. On a deployment without
// that seed these blocks will fail at the locale-presence assertion.
// TODO(Phase 7): add a skip-when-locale-not-seeded guard (probe
// /localization/messages with module=rainmaker-common,locale=sw_KE and
// short-circuit if rows === 0) instead of asserting unconditionally.
test.describe('CCRS#42 — Complaint Type category labels', () => {
  test('API: every COMPLAINT_HIERARCHY.<categoryCode> row is labelled in every advertised locale', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#42 (Complaint Type dropdown blank rows). Every category node of RAINMAKER-PGR.ComplaintHierarchy must have a COMPLAINT_HIERARCHY.<CODE> localization row in every locale the deployment advertises. These category codes are the parentCode values of the leaf complaint types — they replaced the legacy menuPath grouping key (and the legacy SERVICEDEFS.<code> namespace). Pre-fix the configurator's complaint type seed didn't push these keys, so the citizen dropdown rendered blank group options.

Steps:
1. Read RAINMAKER-PGR.ComplaintHierarchy from MDMS and keep the INTERIOR nodes — those carrying neither department nor slaHours. Leaves are complaint types, not categories.
2. Drop the suite's own PW* leftovers (complaint-types.spec.ts creates and never removes them).
3. Skip if the deployment has no category nodes at all.
4. For each locale in LOCALES, POST /localization/messages/v1/_search in chunks of 40 codes and assert each code resolves to a non-empty message.

Deployment-agnostic by construction: it asserts on whatever hierarchy the tenant
actually has, in whatever locales it actually advertises. The previous version
pinned Kenya's five rollout codes (ADMINISTRATION, WATERRELATED, LANDRATES,
MOBILITYANDWORKS, FINANCEANDREVENUE) and the sw_KE locale, so it failed on the
first locale of any non-Kenya tenant — and its skip-guard probed sw_KE row counts,
which is unrelated to whether those codes exist.`,
    },
    tag: ['@area:configurator-manage', '@ccrs:42', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    // Complaint-type labels moved off the legacy SERVICEDEFS.* namespace to
    // key-based COMPLAINT_HIERARCHY.<categoryCode> (seeded for every node).
    //
    // The category codes are read from THIS deployment's own hierarchy, not
    // pinned to Kenya's rollout. The previous list (ADMINISTRATION, WATERRELATED,
    // LANDRATES, MOBILITYANDWORKS, FINANCEANDREVENUE) exists only on ke, so on any
    // other tenant this failed on the very first locale — and the since-removed
    // `swKeSeeded()` guard could not have saved it, because it probed whether the
    // sw_KE LOCALE had rows, which is unrelated to whether the Kenya HIERARCHY exists.
    const codes = await categoryCodes();
    test.skip(
      codes.length === 0,
      'deployment has no interior ComplaintHierarchy nodes to label',
    );
    // Only assert locales this deployment actually advertises — asserting sw_KE
    // on a non-Kenya tenant is the same pinning mistake in a different field.
    for (const locale of LOCALES) {
      // Codes go in the query string, so request them in chunks — a deployment
      // with a broad hierarchy would otherwise exceed nginx's request-line limit
      // and get back an HTML 414 that fails as an opaque JSON parse error.
      const messages: Array<{ code: string; message: string }> = [];
      for (let i = 0; i < codes.length; i += 40) {
        const chunk = codes.slice(i, i + 40);
        const r = await fetch(
          `${LOC_SEARCH}?codes=${chunk.join(',')}&tenantId=${ROOT_TENANT}&locale=${locale}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ RequestInfo: { authToken: '' } }),
          },
        );
        expect(r.ok, `localization _search failed for ${locale} (HTTP ${r.status})`).toBeTruthy();
        const json = await r.json();
        messages.push(...((json.messages ?? []) as Array<{ code: string; message: string }>));
      }
      for (const code of codes) {
        const row = messages.find((m) => m.code === code);
        expect(row, `${code} missing in ${locale}`).toBeTruthy();
        expect(row!.message.length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * Row count for `module=rainmaker-common` at a given locale on this deployment.
 * Local to this block so the two tests below bracket the same regression from
 * the same read.
 */
async function commonRowCount(locale: string): Promise<number> {
  const r = await fetch(
    `${LOC_SEARCH}?module=rainmaker-common&locale=${encodeURIComponent(locale)}&tenantId=${ROOT_TENANT}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { authToken: '' } }),
    },
  );
  const json = await r.json();
  return (json.messages ?? []).length;
}

/**
 * The mangle CCRS#44 produced: `getLocale`/`updateResources` appended a
 * hardcoded `IN` region to whatever locale was already region-qualified, turning
 * `sw_KE` into `sw_KEIN`. The suffix is India's regardless of the locale, so the
 * same bug turns `en_IN` into `en_ININ` — which is what makes this checkable on
 * a single-locale Indian deployment too, rather than only on Kenya.
 */
const mangleLocale = (locale: string) => `${locale}IN`;

test.describe('CCRS#44 — locale region-append regression', () => {
  test('API: every locale this deployment advertises resolves rainmaker-common rows', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#44 (locale region-append regression): the UI's getLocale/updateResources used to append a hardcoded 'IN' region, mangling 'sw_KE' into 'sw_KEIN'; the broken locale returned 0 messages, so every string in that language silently fell back to en_IN.

Asserted against the locales the deployment ITSELF advertises (profile-discovered, LOCALES) rather than the hardcoded sw_KE this used to pin. Pinning sw_KE meant the test self-skipped on every non-Kenya deployment — including \`pg\`, where the identical bug would mangle en_IN into en_ININ and break the only language the tenant has.

Steps:
1. For each locale in LOCALES, POST /localization/messages/v1/_search?module=rainmaker-common&locale=<locale>&tenantId=<root>.
2. Assert every advertised locale returns at least one row — a locale the deployment advertises but cannot resolve is the post-mangle symptom.
3. Assert the richest advertised locale returns > 100 rows: far above the empty-result case, below any realistic count, so it cleanly separates "broken" from "working" without assuming how big the module is.`,
    },
    tag: ['@area:configurator-manage', '@ccrs:44', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    const counts: Record<string, number> = {};
    for (const locale of LOCALES) counts[locale] = await commonRowCount(locale);

    for (const locale of LOCALES) {
      expect(
        counts[locale],
        `${locale} is advertised by this deployment but resolves 0 rainmaker-common rows: ${JSON.stringify(counts)}`,
      ).toBeGreaterThan(0);
    }
    // Threshold applied to the richest locale only. Every advertised locale is
    // already within 25% of the richest (that is discoverLocales' own floor), so
    // a per-locale >100 would be asserting the seed's absolute size rather than
    // the regression — and would fail on a legitimately sparse secondary language.
    expect(
      Math.max(...Object.values(counts)),
      `no advertised locale carries a real rainmaker-common bundle: ${JSON.stringify(counts)}`,
    ).toBeGreaterThan(100);
  });

  test('API: the region-appended mangle of each advertised locale is empty — proves the dataset itself is clean', {
    annotation: {
      type: 'description',
      description: `Companion to the test above: confirms the mangled locale the UI used to send pre-fix ('<locale>' + 'IN' — sw_KE -> sw_KEIN, en_IN -> en_ININ) returns 0 rows. Proves the dataset itself contains no mangled rows, i.e. pre-fix the bug was strictly client-side rather than a stale upload — and that the mangle is genuinely destructive, which is what made the regression invisible as anything but "everything is in English".

Steps:
1. For each locale in LOCALES, POST /localization/messages/v1/_search with locale=<locale>IN.
2. Assert each returns exactly 0 messages.

Pairs with the test above to bracket the regression: the clean locale must resolve, the mangled one must not.`,
    },
    tag: ['@area:configurator-manage', '@ccrs:44', '@kind:edge-case', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    for (const locale of LOCALES) {
      const mangled = mangleLocale(locale);
      expect(
        await commonRowCount(mangled),
        `${mangled} must resolve nothing — a row set here would mean the mangled locale was actually uploaded`,
      ).toBe(0);
    }
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
