/**
 * MUTATING e2e for the CRS Escalation Settings page — the operator journey
 * of configuring ROLE escalation through the REAL UI, against LIVE Bomet.
 *
 * Sibling of the read-only escalation-settings.spec.ts: that one proves
 * the page renders; this one proves an operator can actually drive the
 * "Escalate complaints nobody has picked up" feature end to end:
 *
 *   0. (API) Snapshot the PRODUCTION-SHARED CRS.EscalationPolicy row,
 *      seed a test-scoped CRS.CategorySLA tuple (15 s level SLA) and file
 *      ONE unassigned complaint at the fixture tenant ke.etoeroles
 *      carrying the tuple — filed FIRST so it ages past its SLA while the
 *      UI part runs.
 *   1. (UI) Login as ADMIN@ke in Management mode → /manage/escalation-settings.
 *   2. (UI) Enable the feature: check the box, set the PENDINGFORASSIGNMENT
 *      acting role to E2E_ROLE3, add ladder step E2E_ROLE3 → E2E_SUP1, max
 *      per scan 10, Save — assert the read-after-write "Saved ✓ verified"
 *      toast (PolicyCard's exact success copy).
 *   3. (API) Assert the saved row carries the EXACT roleEscalation object
 *      (the UI writes precisely what the backend scheduler reads) and that
 *      every pre-existing policy field survived.
 *   4. (UI) "Run a test scan (changes nothing)" on the Verify card: tiles
 *      render, "Would escalate now" >= 1 (the seeded fixture complaint),
 *      last-run timestamp shows, and the NO_ROLE_SUPERVISOR reason row
 *      appears with its plain-language copy (production ke.bomet
 *      complaints resolve E2E_ROLE3 to ZERO holders, so they skip — the
 *      safety property that makes this spec runnable against production).
 *   5. (UI, stretch) Pinned-person table: add a row for E2E_SUP1 / ALL /
 *      E2E_SUP1_HOLDER's uuid and click "Look up". KNOWN LIMITATION: the
 *      page looks the employee up at the PAGE tenant (state level, ke) but
 *      the fixture employee lives at the CITY tenant ke.etoeroles — the
 *      lookup cannot find it. We assert the failure UX is graceful
 *      ("No active employee found…" / "Look-up failed…") and that the
 *      Save-pin gate stays closed; the row is then removed unsaved.
 *   6. (UI) Disable: uncheck the box, Save, toast again; (API) enabled:false
 *      persisted (the maps survive — re-enabling restores them).
 *   7. afterAll (API, belt-and-braces): restore the policy snapshot
 *      byte-identically (canonical-JSON compare — Postgres jsonb does not
 *      preserve key order) + verify, deactivate the tuple row, log SRIDs.
 *
 * SAFETY (verified against live Bomet before this spec was written):
 *   - The E2E_* role codes have ZERO holders at production ke.bomet, so
 *     during the enabled window every production complaint that reaches
 *     the role path terminates in a NO_ROLE_SUPERVISOR skip — no
 *     production mutation is possible, and the UI scan is dryRun anyway.
 *   - CRS.EscalationPolicy is the ONLY production-shared row this spec
 *     touches; it is snapshotted before any change and restored in
 *     afterAll even when a mid-spec assertion failed.
 *   - The 15 s SLA lives on a tuple (E2E-UIFLOW/EscalationTest/UiFlow)
 *     that only this spec's complaint carries — it cannot leak onto
 *     production complaints.
 *
 * PACING RULE (binding, inherited from the API-level role-flow sibling
 * tests/integration-tests/tests/lifecycle/pgr-escalation-role-flow.spec.ts):
 * 15 s tuple SLA, a full 60 s before asking the scan for a verdict, 10 s
 * persister settles, generous timeouts. The suite legitimately takes 10+
 * minutes — determinism beats speed.
 *
 * Fixture (see tests/integration-tests/scripts/setup-role-fixture.mjs):
 *   ke.etoeroles — locality ETOEROLES_WARD_1, serviceCode
 *   ObsoleteOrDamagedPipeline; E2E_SUP1 has exactly ONE holder
 *   (E2E_SUP1_HOLDER cc50856b-1003-4b32-bb1a-d37f917e1794), so the ladder
 *   step E2E_ROLE3 → E2E_SUP1 resolves deterministically (R2 exactly-one).
 *
 * Run:
 *   cd configurator
 *   E2E_BASE_URL=https://bometfeedbackhub.digit.org/configurator \
 *     E2E_TENANT=ke E2E_USERNAME=ADMIN E2E_PASSWORD=eGov@123 \
 *     npx playwright test --config e2e/playwright.config.ts \
 *     e2e/escalation-settings-flow.spec.ts --reporter=line
 */

import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = process.env.E2E_BASE_URL
  || process.env.BASE_URL
  || 'https://bometfeedbackhub.digit.org/configurator';
/** Kong-fronted API base — the configurator and the APIs share the domain. */
const API_BASE = BASE_URL.replace(/\/configurator\/?$/, '');
const TENANT = process.env.E2E_TENANT || 'ke';            // state/root tenant
const USERNAME = process.env.E2E_USERNAME || 'ADMIN';
const PASSWORD = process.env.E2E_PASSWORD || 'eGov@123';

/** Fixture city tenant (setup-role-fixture.mjs) — where the complaint files. */
const FIXTURE_TENANT = process.env.E2E_FIXTURE_TENANT || 'ke.etoeroles';
const FIXTURE_LOCALITY = process.env.E2E_FIXTURE_LOCALITY || 'ETOEROLES_WARD_1';
const SERVICE_CODE = process.env.E2E_SERVICE_CODE || 'ObsoleteOrDamagedPipeline';

/** Roles under test (fixture-only; ZERO holders at production ke.bomet). */
const ACTING_ROLE = 'E2E_ROLE3';
const LADDER_TARGET_ROLE = 'E2E_SUP1';
/** E2E_SUP1_HOLDER @ ke.etoeroles — the stretch lookup's employee id. */
const SUP1_HOLDER_UUID = 'cc50856b-1003-4b32-bb1a-d37f917e1794';
const MAX_PER_SCAN = '10';

// Test-scoped SLA tuple — only complaints carrying these three keys in
// additionalDetail ever match the seeded CategorySLA row.
const TUPLE = { path: 'E2E-UIFLOW', category: 'EscalationTest', subcategoryL1: 'UiFlow' };
const TUPLE_UID = `${TUPLE.path}.${TUPLE.category}.${TUPLE.subcategoryL1}`;
const CATEGORY_SLA_SCHEMA = 'CRS.CategorySLA';
/** 0.00417 h ≈ 15 s (level cells are HOURS, must be > 0). */
const SLA_HOURS_L0 = 0.00417;

const POLICY_SCHEMA = 'CRS.EscalationPolicy';
const POLICY_UID = 'default';
const PENDINGFORASSIGNMENT = 'PENDINGFORASSIGNMENT';

// Pacing (binding — see header).
const PERSISTER_WAIT_MS = 10_000;
const SLA_ELAPSE_WAIT_MS = 60_000;

const TS = Date.now();
const RUN_TAG = `PW_CRS_ESC_FLOW_${String(TS).slice(-6)}`;
/** 9-digit Kenya-valid citizen mobile (7-prefix), unique per run. */
const CITIZEN_MOBILE = `7${String(TS).slice(-8)}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// API plumbing (fetch-based, mirrors the API-level role-flow sibling — kept
// local so this spec stays independently runnable).
// ---------------------------------------------------------------------------

async function oauth(tenantId: string): Promise<{ token: string; userInfo: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE}/user/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'password', scope: 'read',
      username: USERNAME, password: PASSWORD, tenantId, userType: 'EMPLOYEE',
    }),
  });
  const data: any = await res.json();
  if (!data.access_token) {
    throw new Error(`oauth ${USERNAME}@${tenantId} failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { token: data.access_token, userInfo: data.UserRequest };
}

async function api(path: string, body: unknown, ctx: string): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  const errors = data?.Errors || data?.errors;
  if ((!res.ok && res.status !== 202) || (Array.isArray(errors) && errors.length)) {
    const msg = Array.isArray(errors)
      ? errors.map((e: any) => `${e.code}: ${e.message}`).join('; ')
      : `HTTP ${res.status} ${text.slice(0, 400)}`;
    throw new Error(`${ctx} → ${msg}`);
  }
  return data;
}

function requestInfo(token: string, userInfo: Record<string, unknown>) {
  return { apiId: 'Rainmaker', ver: '1.0', ts: Date.now(), msgId: RUN_TAG, authToken: token, userInfo };
}

async function pollUntil<T>(desc: string, fn: () => Promise<T | null | undefined | false>,
  { timeoutMs = 60_000, intervalMs = 3_000 } = {}): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = await fn();
    if (out) return out as T;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${desc} (${timeoutMs / 1000}s)`);
    await sleep(intervalMs);
  }
}

/** Canonical JSON (recursively sorted object keys) — Postgres jsonb does not
 * preserve key order, so "byte-identical" restore is verified canonically. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// --- MDMS v2 ---------------------------------------------------------------

async function mdmsSearchRow(token: string, userInfo: Record<string, unknown>,
  schemaCode: string, uniqueIdentifier: string): Promise<any | undefined> {
  const data = await api('/mdms-v2/v2/_search', {
    RequestInfo: requestInfo(token, userInfo),
    MdmsCriteria: { tenantId: TENANT, schemaCode, uniqueIdentifiers: [uniqueIdentifier], limit: 10 },
  }, `${schemaCode} _search`);
  return (data.mdms ?? [])[0];
}

async function mdmsUpdateRow(token: string, userInfo: Record<string, unknown>,
  schemaCode: string, record: any, data: Record<string, unknown>, recordActive: boolean): Promise<void> {
  await api(`/mdms-v2/v2/_update/${encodeURIComponent(schemaCode)}`, {
    RequestInfo: requestInfo(token, userInfo),
    Mdms: { ...record, data, isActive: recordActive },
  }, `${schemaCode} _update`);
}

/** Create-or-update an MDMS row to ACTIVE (search-first; phantom-200 aware). */
async function mdmsUpsertActiveRow(token: string, userInfo: Record<string, unknown>,
  schemaCode: string, uniqueIdentifier: string, data: Record<string, unknown>): Promise<void> {
  const existing = await mdmsSearchRow(token, userInfo, schemaCode, uniqueIdentifier);
  if (existing) {
    await mdmsUpdateRow(token, userInfo, schemaCode, existing, data, true);
    console.log(`[seed] ${schemaCode}/${uniqueIdentifier} existed (isActive=${existing.isActive}) — updated to active`);
    return;
  }
  const created = await api(`/mdms-v2/v2/_create/${encodeURIComponent(schemaCode)}`, {
    RequestInfo: requestInfo(token, userInfo),
    Mdms: { tenantId: TENANT, schemaCode, uniqueIdentifier, data, isActive: true },
  }, `${schemaCode} _create`);
  if (!created.mdms || created.mdms.length === 0) {
    // MDMS phantom-200: duplicate create acks with an empty mdms array.
    console.log(`[seed] ${schemaCode} _create phantom-200 — switching to update`);
    const record = await pollUntil(`${schemaCode}/${uniqueIdentifier} re-search`, () =>
      mdmsSearchRow(token, userInfo, schemaCode, uniqueIdentifier));
    await mdmsUpdateRow(token, userInfo, schemaCode, record, data, true);
  } else {
    console.log(`[seed] ${schemaCode}/${uniqueIdentifier} created (id=${created.mdms[0].id})`);
  }
}

/** The seeded CategorySLA tuple data while the test is live. */
function activeTupleData(): Record<string, unknown> {
  return { ...TUPLE, slaHoursByState: {}, slaHoursByLevel: [SLA_HOURS_L0], isActive: true };
}

// --- PGR ---------------------------------------------------------------------

/** File the unassigned fixture complaint at ke.etoeroles carrying the tuple.
 * PGR _create needs a CITY-tenant ADMIN token (a root-ke token gets
 * INVALID ROLE on the workflow APPLY transition). */
async function createFixtureComplaint(cityToken: string, cityUserInfo: Record<string, unknown>): Promise<string> {
  const data = await api('/pgr-services/v2/request/_create', {
    RequestInfo: requestInfo(cityToken, cityUserInfo),
    service: {
      tenantId: FIXTURE_TENANT,
      serviceCode: SERVICE_CODE,
      description: `E2E UI-flow escalation complaint (${RUN_TAG}) — safe to ignore`,
      address: {
        tenantId: FIXTURE_TENANT,
        locality: { code: FIXTURE_LOCALITY, name: FIXTURE_LOCALITY },
        city: FIXTURE_TENANT,
        // geoLocation MUST be an object — the persister crashes on null.
        geoLocation: { latitude: 0, longitude: 0 },
      },
      citizen: {
        name: 'E2E UiFlow Citizen',
        mobileNumber: CITIZEN_MOBILE,
        userName: CITIZEN_MOBILE,
        type: 'CITIZEN',
        tenantId: TENANT,
        roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: TENANT }],
      },
      source: 'web',
      active: true,
      // Strategy-A tuple: the scheduler extracts these three keys from
      // additionalDetail and matches the seeded CategorySLA row.
      additionalDetail: { ...TUPLE },
    },
    workflow: { action: 'APPLY' },
  }, 'PGR _create');
  const srid = data.ServiceWrappers?.[0]?.service?.serviceRequestId;
  if (!srid) throw new Error(`PGR _create returned no serviceRequestId: ${JSON.stringify(data).slice(0, 400)}`);
  return srid;
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

async function loginAsManagement(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  const managementBtn = page.getByRole('button', { name: /Management/i }).first();
  await managementBtn.click({ timeout: 10_000 });

  const tenantInput = page.locator('#tenantCode');
  if (await tenantInput.count()) await tenantInput.fill(TENANT);
  const usernameInput = page.locator('#username');
  if (await usernameInput.count() && (await usernameInput.inputValue()) !== USERNAME) {
    await usernameInput.fill(USERNAME);
  }
  const passwordInput = page.locator('#password');
  if (await passwordInput.count() && !(await passwordInput.inputValue())) {
    await passwordInput.fill(PASSWORD);
  }
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/manage(\/|$)/, { timeout: 30_000 });
}

/** Read a Verify-card tile's numeric value by its label. */
async function tileValue(page: Page, label: string): Promise<number> {
  const tile = page.locator('div.rounded-md.border').filter({
    has: page.getByText(label, { exact: true }),
  });
  await expect(tile, `tile "${label}" must render`).toBeVisible();
  const raw = (await tile.locator('p').first().innerText()).trim();
  const n = Number(raw);
  expect(Number.isFinite(n), `tile "${label}" must show a number (got "${raw}")`).toBe(true);
  return n;
}

// ---------------------------------------------------------------------------
// The journey (serial; one shared page — the operator never leaves the tab)
// ---------------------------------------------------------------------------

test.describe.serial('Escalation Settings — UI-driven role-escalation configuration flow', () => {
  let page: Page;

  // API actors.
  let rootToken: string;
  let rootUserInfo: Record<string, unknown>;

  // Cleanup bookkeeping — flags set BEFORE each write fires so a
  // failed-but-maybe-applied write still gets restored/deactivated.
  let policySnapshotData: Record<string, unknown> | undefined;
  let policySnapshotActive = true;
  let policyMayBeMutated = false; // the UI save is the mutation — set when the journey starts
  let tupleTouched = false;

  let fixtureSrid: string | undefined;
  let complaintCreatedAtMs = 0;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(420_000);

    // Same cool-down the sibling configurator specs use — Kong's auth-flow
    // rate limit trips when Playwright suites chain back-to-back.
    await sleep(90_000);

    // --- API pre-flight -----------------------------------------------------
    const root = await oauth(TENANT);
    rootToken = root.token;
    rootUserInfo = root.userInfo;

    // Snapshot the PRODUCTION-SHARED policy row FIRST (deep copy, logged for
    // manual repair). Refuse to run over a live rollout.
    const policyRecord = await mdmsSearchRow(rootToken, rootUserInfo, POLICY_SCHEMA, POLICY_UID);
    expect(
      policyRecord,
      `${POLICY_SCHEMA}/${POLICY_UID} must already exist at ${TENANT} — this spec drives the UI over the existing singleton`,
    ).toBeTruthy();
    policySnapshotData = JSON.parse(JSON.stringify(policyRecord.data));
    policySnapshotActive = policyRecord.isActive !== false;
    console.log(`[policy] snapshot (afterAll restore payload): ${JSON.stringify(policySnapshotData)}`);
    expect(
      (policySnapshotData as any)?.roleEscalation?.enabled !== true,
      'pre-existing policy must not already have roleEscalation enabled — refusing to clobber a live rollout',
    ).toBe(true);

    // Seed the test-scoped 15 s SLA tuple.
    tupleTouched = true;
    await mdmsUpsertActiveRow(rootToken, rootUserInfo, CATEGORY_SLA_SCHEMA, TUPLE_UID, activeTupleData());

    // File the fixture complaint NOW so it ages past its 15 s SLA while the
    // UI journey below runs. Needs the CITY-tenant ADMIN token.
    const city = await oauth(FIXTURE_TENANT);
    fixtureSrid = await createFixtureComplaint(city.token, city.userInfo);
    complaintCreatedAtMs = Date.now();
    console.log(`[fixture] complaint ${fixtureSrid} filed at ${FIXTURE_TENANT} (unassigned, tuple ${TUPLE_UID})`);

    // Persister settle, then prove both seeds are live (the tuple row active
    // on the v2 read; the complaint searchable with the tuple intact).
    await sleep(PERSISTER_WAIT_MS);
    const tupleLive = await mdmsSearchRow(rootToken, rootUserInfo, CATEGORY_SLA_SCHEMA, TUPLE_UID);
    expect(tupleLive?.isActive, 'seeded tuple record must be active').toBe(true);
    expect(tupleLive?.data?.slaHoursByLevel?.[0], 'level-0 SLA cell must be the seeded value').toBe(SLA_HOURS_L0);

    const wrapper = await pollUntil(`complaint ${fixtureSrid} searchable`, async () => {
      const res = await api(
        `/pgr-services/v2/request/_search?tenantId=${FIXTURE_TENANT}&serviceRequestId=${encodeURIComponent(fixtureSrid!)}`,
        { RequestInfo: requestInfo(rootToken, rootUserInfo) },
        'PGR _search',
      );
      return (res.ServiceWrappers ?? [])[0];
    });
    expect(wrapper.service?.applicationStatus).toBe(PENDINGFORASSIGNMENT);
    expect(wrapper.service?.additionalDetail?.path, 'tuple must survive PGR enrichment').toBe(TUPLE.path);
    console.log(`[fixture] complaint live: status=${wrapper.service?.applicationStatus}`);

    // One page for the whole journey.
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    // CLEANUP — belt-and-braces API restore, runs even when a mid-spec
    // assertion failed. Failures are collected so every step always runs.
    test.setTimeout(600_000);
    const failures: string[] = [];

    try { await page?.close(); } catch { /* page may never have opened */ }

    // Fresh token — the journey runs long enough to age the original.
    try {
      const fresh = await oauth(TENANT);
      rootToken = fresh.token;
      rootUserInfo = fresh.userInfo;
    } catch (err) {
      console.log(`[cleanup] token re-mint failed (continuing with original): ${(err as Error).message}`);
    }

    // 1. Restore the policy snapshot (the only production-shared row) WITH
    //    DRIFT DEFENSE: MDMS writes ride Kafka → egov-persister, and a
    //    redelivered earlier write can be re-applied AFTER the restore —
    //    OBSERVED LIVE on Bomet: the spec's own enable-write reappeared on
    //    the row ~60 s after a read-verified restore. So a single
    //    restore+verify is not enough; re-assert the snapshot whenever the
    //    row drifts and only declare success after the row has stayed
    //    canonically identical for >= 3 consecutive reads spanning the
    //    redelivery window (>= 120 s).
    if (policyMayBeMutated && policySnapshotData && rootToken) {
      try {
        const want = canonicalJson(policySnapshotData);
        const record = await mdmsSearchRow(rootToken, rootUserInfo, POLICY_SCHEMA, POLICY_UID);
        if (!record) throw new Error('policy row not found on re-search');
        if (canonicalJson(record.data) !== want || record.isActive !== policySnapshotActive) {
          await mdmsUpdateRow(rootToken, rootUserInfo, POLICY_SCHEMA, record, policySnapshotData, policySnapshotActive);
          console.log(`[cleanup] ${POLICY_SCHEMA} restored to snapshot`);
        }
        const start = Date.now();
        let stableReads = 0;
        while (Date.now() - start < 300_000) {
          await sleep(PERSISTER_WAIT_MS);
          const live = await mdmsSearchRow(rootToken, rootUserInfo, POLICY_SCHEMA, POLICY_UID);
          if (live && canonicalJson(live.data) === want && live.isActive === policySnapshotActive) {
            stableReads++;
          } else {
            console.log(`[cleanup] policy DRIFTED at +${Math.round((Date.now() - start) / 1000)}s `
              + `(redelivered write?) — re-restoring; live roleEscalation=${JSON.stringify(live?.data?.roleEscalation)}`);
            stableReads = 0;
            await mdmsUpdateRow(rootToken, rootUserInfo, POLICY_SCHEMA, live ?? record, policySnapshotData, policySnapshotActive);
          }
          if (stableReads >= 3 && Date.now() - start >= 120_000) break;
        }
        if (stableReads >= 3) {
          console.log(`[cleanup] verified: policy canonically identical to the snapshot and stable for ${stableReads} reads`);
        } else {
          failures.push('policy restore NOT VERIFIED — row did not stabilise on the snapshot within 300s');
        }
      } catch (err) {
        failures.push(`policy restore FAILED: ${(err as Error).message}`);
      }
    }

    // 2. Deactivate the seeded tuple row (record + data level). Runs after
    //    the policy stability window, so a redelivered tuple-seed write
    //    would already have landed; one final read confirms it stayed off.
    if (tupleTouched && rootToken) {
      try {
        const record = await mdmsSearchRow(rootToken, rootUserInfo, CATEGORY_SLA_SCHEMA, TUPLE_UID);
        if (record && (record.isActive !== false || record.data?.isActive !== false)) {
          await mdmsUpdateRow(rootToken, rootUserInfo, CATEGORY_SLA_SCHEMA, record,
            { ...activeTupleData(), isActive: false }, false);
          console.log(`[cleanup] ${CATEGORY_SLA_SCHEMA} ${TUPLE_UID} deactivated`);
        }
        await sleep(PERSISTER_WAIT_MS);
        const live = await mdmsSearchRow(rootToken, rootUserInfo, CATEGORY_SLA_SCHEMA, TUPLE_UID);
        if (live && live.isActive !== false) {
          failures.push(`tuple deactivate NOT VERIFIED — record still active: ${JSON.stringify(live.data)}`);
        } else {
          console.log(`[cleanup] verified: tuple row inactive`);
        }
      } catch (err) {
        failures.push(`tuple deactivate FAILED: ${(err as Error).message}`);
      }
    }

    console.log(`[traceability] run tag:           ${RUN_TAG}`);
    console.log(`[traceability] fixture complaint: ${fixtureSrid ?? '(not created)'} @ ${FIXTURE_TENANT}`);

    if (failures.length > 0) {
      throw new Error(
        `CLEANUP FAILURES — production MDMS state may need manual repair: ${failures.join('; ')}. ` +
        `Policy snapshot for manual restore (tenant ${TENANT}, schema ${POLICY_SCHEMA}, uid ${POLICY_UID}): ` +
        JSON.stringify(policySnapshotData),
      );
    }
  });

  test('1 — UI login (Management, tenant ke) and open /manage/escalation-settings', async () => {
    test.info().annotations.push({ type: 'run-tag', description: RUN_TAG });
    test.setTimeout(120_000);

    await loginAsManagement(page);
    await page.goto(`${BASE_URL}/manage/escalation-settings`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /Escalation Settings/i })).toBeVisible();
    // The page resolves the policy at the STATE tenant and says so.
    await expect(page.getByText(new RegExp(`apply to the whole deployment \\(tenant: ${TENANT}\\)`))).toBeVisible();
    // .first(): RecentChangesCard labels policy audit entries with the same
    // friendly name, so the exact text can appear more than once.
    await expect(page.getByText('Escalation behaviour', { exact: true }).first()).toBeVisible();
  });

  test('2 — UI-enable: acting role, ladder step, max per scan, Save → "Saved ✓ verified"', async () => {
    test.setTimeout(120_000);
    policyMayBeMutated = true; // from here on, afterAll must restore

    // Opt in.
    const enableBox = page.getByLabel('Escalate complaints nobody has picked up');
    await expect(enableBox).not.toBeChecked();
    await enableBox.check();

    // Enable-flow guardrail shows before anything is mapped.
    await expect(page.getByText('Run a test scan first')).toBeVisible();

    // Acting role for the watched PENDINGFORASSIGNMENT status.
    await page.getByLabel(`Acting role for ${PENDINGFORASSIGNMENT}`).fill(ACTING_ROLE);

    // Ladder step E2E_ROLE3 → E2E_SUP1.
    await page.getByRole('button', { name: 'Add a ladder step' }).click();
    await page.getByLabel('Ladder acting role').fill(ACTING_ROLE);
    await page.getByLabel(`Role that ${ACTING_ROLE} escalates to`).fill(LADDER_TARGET_ROLE);

    // Limit per scan.
    await page.locator('#esc-role-max-scan').fill(MAX_PER_SCAN);

    await page.screenshot({ path: '/tmp/ui-flow-1-enabled-form.png', fullPage: true });

    // Save → PolicyCard's read-after-write verification toast. The exact
    // success copy is 'Saved ✓ verified' / 'Escalation behaviour updated.';
    // 'Saved but not yet visible' would mean the persister lagged — a fail.
    // exact: true — radix's aria-live announcer span duplicates the toast
    // text ("Notification Saved ✓ verified…"), which trips strict mode on
    // substring matches.
    await page.getByRole('button', { name: 'Save behaviour' }).click();
    await expect(page.getByText('Saved ✓ verified', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Escalation behaviour updated.', { exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/ui-flow-2-saved-toast.png', fullPage: true });
  });

  test('3 — API: the saved row carries the exact roleEscalation object; prior fields intact', async () => {
    test.setTimeout(60_000);

    // The UI already proved read-after-write; a short poll keeps this
    // assertion robust against persister jitter anyway.
    const live = await pollUntil('policy row with enabled roleEscalation', async () => {
      const row = await mdmsSearchRow(rootToken, rootUserInfo, POLICY_SCHEMA, POLICY_UID);
      return row?.data?.roleEscalation?.enabled === true ? row : null;
    }, { timeoutMs: 30_000 });

    // The exact object the backend scheduler will read — proves the UI
    // writes precisely what fetchCrsEscalationPolicy consumes.
    expect(live.data.roleEscalation).toEqual({
      enabled: true,
      actingRoleByState: { [PENDINGFORASSIGNMENT]: ACTING_ROLE },
      supervisorRoleByRole: { [ACTING_ROLE]: LADDER_TARGET_ROLE },
      maxPerScan: Number(MAX_PER_SCAN),
    });

    // Every pre-existing policy field must have survived the UI save.
    for (const key of Object.keys(policySnapshotData as object)) {
      expect(
        canonicalJson(live.data[key]),
        `pre-existing policy field '${key}' must be preserved by the UI save`,
      ).toBe(canonicalJson((policySnapshotData as any)[key]));
    }
    console.log(`[api-assert] roleEscalation persisted exactly: ${JSON.stringify(live.data.roleEscalation)}`);
  });

  test('4 — UI test scan: "Would escalate now" >= 1, last-run stamp, NO_ROLE_SUPERVISOR copy', async () => {
    test.setTimeout(300_000);

    // PACING: the fixture complaint's 15 s SLA must be unambiguously
    // breached — wait out the full 60 s window since creation (the UI steps
    // usually cover it; this guard makes it deterministic).
    const remaining = complaintCreatedAtMs + SLA_ELAPSE_WAIT_MS - Date.now();
    if (remaining > 0) {
      console.log(`[pacing] waiting ${Math.ceil(remaining / 1000)}s more so the fixture complaint is breached…`);
      await sleep(remaining);
    }

    // Run the dry scan from the Verify card (state tenant, changes nothing).
    await page.getByRole('button', { name: 'Run a test scan (changes nothing)' }).click();

    // Tiles render once the scan returns — the deployment-wide scan walks
    // every open complaint, so give it a generous window.
    await expect(page.getByText('Open complaints scanned', { exact: true })).toBeVisible({ timeout: 180_000 });

    const scanned = await tileValue(page, 'Open complaints scanned');
    const wouldEscalate = await tileValue(page, 'Would escalate now');
    const needsAttention = await tileValue(page, 'Needs attention');
    console.log(`[scan] scanned=${scanned} wouldEscalate=${wouldEscalate} needsAttention=${needsAttention}`);

    // The seeded fixture complaint (breached, unassigned, acting role
    // E2E_ROLE3 → ladder E2E_SUP1 → exactly one holder at ke.etoeroles).
    expect(wouldEscalate, 'the seeded fixture complaint must be a would-escalate').toBeGreaterThanOrEqual(1);
    expect(scanned).toBeGreaterThanOrEqual(1);

    // Last-run timestamp renders.
    await expect(page.getByText(/Last run /)).toBeVisible();

    // Production safety is VISIBLE in the scan: ke.bomet complaints resolve
    // E2E_ROLE3 to zero holders → NO_ROLE_SUPERVISOR skip, rendered with the
    // plain-language dictionary copy (skipReasonCopy.ts).
    await expect(page.getByText('NO_ROLE_SUPERVISOR', { exact: true })).toBeVisible();
    await expect(page.getByText(/No one matched as the escalation target/)).toBeVisible();

    await page.screenshot({ path: '/tmp/ui-flow-3-verify-tiles.png', fullPage: true });
  });

  test('5 — stretch: pinned-person lookup for a city-tenant employee degrades gracefully', async () => {
    test.setTimeout(120_000);

    // The pin table lives inside the role-escalation block (still enabled).
    await page.getByRole('button', { name: 'Pin a person' }).click();

    // `.last()` — defensive against rows a previous run may have left saved.
    await page.getByLabel('Pinned role').last().fill(LADDER_TARGET_ROLE);
    const deptInput = page.getByLabel('Pinned department (ALL for every department)').last();
    if ((await deptInput.inputValue()) !== 'ALL') await deptInput.fill('ALL');
    await page.getByLabel('Pinned employee ID').last().fill(SUP1_HOLDER_UUID);
    await page.getByRole('button', { name: 'Look up' }).last().click();

    // KNOWN LIMITATION (documented, not forced): RoleSupervisorsTable.lookUp
    // searches HRMS at the PAGE tenant — here the state tenant `ke` — but
    // E2E_SUP1_HOLDER is an employee of the CITY tenant ke.etoeroles, so the
    // lookup cannot resolve it. The page must degrade gracefully: a clear
    // not-found/error message and a still-disabled "Save pin" button (the
    // save gate requires a successful lookup of the exact ID).
    const found = page.getByText(`✓ E2E Sup1 Holder`);
    const notFound = page.getByText('No active employee found with this ID.');
    const lookupErr = page.getByText('Look-up failed — try again.');
    await expect(found.or(notFound).or(lookupErr).first()).toBeVisible({ timeout: 30_000 });

    await page.screenshot({ path: '/tmp/ui-flow-4-pin-lookup.png', fullPage: true });

    if (await found.count()) {
      // If a future build resolves city-tenant employees, the gate opens —
      // record it; we still do not save (pins are out of this spec's scope).
      console.log('[stretch] lookup RESOLVED the city-tenant employee — limitation no longer applies');
    } else {
      const which = (await notFound.count()) ? 'not-found message' : 'lookup-error message';
      console.log(`[stretch] graceful degradation confirmed (${which}); Save pin stays disabled — `
        + 'KNOWN LIMITATION: the pin lookup searches the state tenant, not city tenants');
      await expect(page.getByRole('button', { name: 'Save pin' }).last()).toBeDisabled();
    }

    // Leave the form clean: remove the unsaved pin row.
    await page.getByRole('button', { name: `Remove unsaved pin ${LADDER_TARGET_ROLE}` }).click();
  });

  test('6 — UI-disable: uncheck, Save, toast; API: enabled:false persisted', async () => {
    test.setTimeout(120_000);

    const enableBox = page.getByLabel('Escalate complaints nobody has picked up');
    await expect(enableBox).toBeChecked();
    await enableBox.uncheck();

    await page.getByRole('button', { name: 'Save behaviour' }).click();
    await expect(page.getByText('Saved ✓ verified', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: '/tmp/ui-flow-5-disabled.png', fullPage: true });

    // Once the record carries the object, disabling persists an explicit
    // enabled:false (the maps survive so re-enabling restores them).
    const live = await pollUntil('policy row with disabled roleEscalation', async () => {
      const row = await mdmsSearchRow(rootToken, rootUserInfo, POLICY_SCHEMA, POLICY_UID);
      return row?.data?.roleEscalation?.enabled === false ? row : null;
    }, { timeoutMs: 30_000 });
    expect(live.data.roleEscalation.enabled).toBe(false);
    console.log(`[api-assert] disabled persisted: ${JSON.stringify(live.data.roleEscalation)}`);
  });
});
