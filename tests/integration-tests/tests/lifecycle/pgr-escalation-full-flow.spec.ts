/**
 * PGR escalation chain — FULL-FLOW E2E on live Bomet.
 *
 * Drives the complete escalation lifecycle end-to-end against a live
 * deployment, using a test-scoped CRS.CategorySLA row (NOT the global v0
 * EscalationConfig) so production complaints are never affected:
 *
 *   0. Pre-flight: resolve PHASE0_SUB2 + its reportingTo supervisor from HRMS
 *   1. Seed (upsert) a CRS.CategorySLA row at the STATE tenant for the tuple
 *      (E2E-FULLFLOW, EscalationTest, AutoFlow) with slaHoursByLevel [0.00417]
 *      (~15 s) — the scheduler's highest-precedence source (CRS.CategorySLA.level)
 *   2. Cron-phase calibration: a sentinel complaint detects when the
 *      background @Scheduled scan last fired, giving the main flow a
 *      guaranteed cron-free window (see test 2's description for why)
 *   3. Citizen files the main complaint carrying the tuple in additionalDetail
 *   4. ASSIGN via raw workflow /process/_transition with the canonical
 *      'assignes' key (issue #1674)
 *   5. Persistence regression read: /process/_search shows the assignee
 *   6. After a full 60 s, dryRun /escalation/_trigger: WOULD_ESCALATE with
 *      slaSource CRS.CategorySLA.level, zero mutations
 *   7. Real /escalation/_trigger: ESCALATED / SUCCESS / same slaSource
 *   8. Post-conditions: PENDINGATSUPERVISOR, escalationLevel 1, SLA clock
 *      reset, ESCALATE ProcessInstance assigned to the HRMS supervisor
 *   9. OTEL: the real trigger's trace carries the scan-span aggregates plus
 *      an 'escalation.complaint' CHILD span for our srid with its slaSource
 *  10. afterAll: deactivate the seeded CategorySLA row (tuple-scoped cleanup)
 *
 * Required env (defaults in ../utils/env.ts):
 *   BASE_URL       e.g. https://bometfeedbackhub.digit.org
 *   DIGIT_TENANT   e.g. ke.bomet   (ROOT_TENANT derived: ke)
 *   SERVICE_CODE   a complaint type live on the tenant, e.g. ObsoleteOrDamagedPipeline
 *   LOCALITY_CODE  a leaf boundary on the tenant, e.g. BOMET_BOMET_EAST_CHEMANER
 *   DIGIT_USERNAME / DIGIT_PASSWORD          ADMIN at ROOT_TENANT (default ADMIN/eGov@123)
 *   PHASE0_SUB2_PREFIX                       HRMS code prefix of the chain subordinate (default PHASE0_SUB2)
 *   PHASE0_SUP_PASSWORD                      supervisor login password (default eGov@123)
 *
 * Run:
 *   BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.bomet \
 *   LOCALITY_CODE=BOMET_BOMET_EAST_CHEMANER SERVICE_CODE=ObsoleteOrDamagedPipeline \
 *   npx playwright test tests/lifecycle/pgr-escalation-full-flow.spec.ts --reporter=line
 *
 * PACING RULE: every wait below is generous on purpose (10 s for async
 * persistence, 60 s for a 15 s SLA, a full cron period for calibration).
 * Determinism beats speed — the suite legitimately takes several minutes.
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import {
  BASE_URL, TENANT, ROOT_TENANT,
  ADMIN_USER, ADMIN_PASS, FIXED_OTP, DEFAULT_PASSWORD,
  SERVICE_CODE, LOCALITY_CODE,
  generateCitizenPhone,
} from '../utils/env';
import {
  extractTraceIdFromBometLogs,
  getTempoTrace,
  findSpansByAttribute,
  getAttr,
} from '../utils/tempo';

const CITIZEN_PHONE = generateCitizenPhone();
const CITIZEN_NAME = 'E2E Escalation Full-Flow Citizen';

/** HRMS code prefix used to locate the chain subordinate on the tenant. */
const PHASE0_SUB2_PREFIX = process.env.PHASE0_SUB2_PREFIX || 'PHASE0_SUB2';
const PHASE0_SUP_PASSWORD = process.env.PHASE0_SUP_PASSWORD || DEFAULT_PASSWORD;

// ---------------------------------------------------------------------------
// Test-scoped SLA tuple. The scheduler's Strategy-A tuple extraction reads
// (path, category, subcategoryL1) from service.additionalDetail, so ONLY
// complaints created by this spec ever match the seeded CategorySLA row.
// This is what makes the spec cron-safe for production data: we never touch
// the global v0 EscalationConfig the way the sibling trigger spec does.
// ---------------------------------------------------------------------------
const TUPLE = { path: 'E2E-FULLFLOW', category: 'EscalationTest', subcategoryL1: 'AutoFlow' };
// mdms-v2 derives uniqueIdentifier from the schema's x-unique fields joined
// with '.', so this row is addressable as path.category.subcategoryL1.
const TUPLE_UID = `${TUPLE.path}.${TUPLE.category}.${TUPLE.subcategoryL1}`;
const CATEGORY_SLA_SCHEMA = 'CRS.CategorySLA';
/** 0.00417 h ≈ 15 s. Per-level cells are HOURS and must be > 0 (levelCellToMillis). */
const SLA_HOURS_L0 = 0.00417;

// Pacing (see PACING RULE in the header).
/** MDMS + PGR + workflow writes are all Kafka → egov-persister async. */
const PERSISTER_WAIT_MS = 10_000;
/** Generous margin over the ~15 s seeded SLA before asking for a verdict. */
const SLA_ELAPSE_WAIT_MS = 60_000;
/**
 * pgr.escalation.interval.ms is 300 s on Bomet (fixedDelay). One full period
 * + scan time + persister/poll lag with margin: if a sentinel complaint is
 * not escalated by the cron within this budget, the cron cannot escalate at
 * all on this deployment (and therefore cannot race the main flow either).
 */
const CRON_OBSERVE_TIMEOUT_MS = 390_000;
const CRON_POLL_INTERVAL_MS = 10_000;

// Workflow application statuses observed on the PGR business service.
const PENDINGFORASSIGNMENT = 'PENDINGFORASSIGNMENT';
const PENDINGATLME = 'PENDINGATLME';
const PENDINGATSUPERVISOR = 'PENDINGATSUPERVISOR';

const SLA_SOURCE_CATEGORY_LEVEL = 'CRS.CategorySLA.level';

// ---------------------------------------------------------------------------
// Local helpers (kept here, not factored into utils/, so this spec stays
// independently runnable and easy to diff against its siblings).
// ---------------------------------------------------------------------------

async function assertOk(resp: Response, ctx: string): Promise<any> {
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`${ctx}: HTTP ${resp.status} — ${JSON.stringify(body).slice(0, 800)}`);
  }
  return body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function registerCitizen(phone: string): Promise<{ token: string; userInfo: Record<string, unknown> }> {
  await fetch(`${BASE_URL}/user-otp/v1/_send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otp: { mobileNumber: phone, tenantId: ROOT_TENANT, type: 'login', userType: 'CITIZEN' },
    }),
  });

  const tokenReq = () => fetch(`${BASE_URL}/user/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
    },
    body: new URLSearchParams({
      grant_type: 'password', username: phone, password: FIXED_OTP,
      tenantId: ROOT_TENANT, scope: 'read', userType: 'CITIZEN',
    }).toString(),
  });

  let resp = await tokenReq();
  if (!resp.ok) {
    await fetch(`${BASE_URL}/user/citizen/_create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker' },
        user: {
          name: CITIZEN_NAME, userName: phone, mobileNumber: phone,
          password: DEFAULT_PASSWORD, tenantId: ROOT_TENANT, type: 'CITIZEN',
          roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: ROOT_TENANT }],
          otpReference: FIXED_OTP,
        },
      }),
    });
    resp = await tokenReq();
  }
  const data: any = await resp.json();
  return { token: data.access_token, userInfo: data.UserRequest };
}

async function searchEmployees(token: string, tenantId: string): Promise<any[]> {
  const resp = await fetch(
    `${BASE_URL}/egov-hrms/employees/_search?tenantId=${tenantId}&offset=0&limit=100`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token } }),
    },
  );
  const data = await assertOk(resp, 'HRMS employees/_search');
  return data.Employees || [];
}

async function fetchComplaint(token: string, userInfo: Record<string, unknown>, srid: string): Promise<any> {
  const resp = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${srid}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo } }),
    },
  );
  const data = await assertOk(resp, `PGR _search ${srid}`);
  return data.ServiceWrappers?.[0]?.service;
}

/** Latest (non-history) ProcessInstance — the exact read EscalationService.getCurrentAssignees does first. */
async function fetchLatestProcessInstance(token: string, userInfo: Record<string, unknown>, srid: string): Promise<any> {
  const resp = await fetch(
    `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?tenantId=${TENANT}&businessIds=${srid}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo } }),
    },
  );
  const data = await assertOk(resp, `workflow process/_search ${srid}`);
  return (data.ProcessInstances ?? [])[0];
}

async function createComplaint(
  citizenToken: string,
  citizenUserInfo: Record<string, unknown>,
  description: string,
): Promise<any> {
  const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${citizenToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: citizenToken, userInfo: citizenUserInfo },
      service: {
        tenantId: TENANT,
        serviceCode: SERVICE_CODE,
        description,
        source: 'web',
        address: {
          city: TENANT,
          locality: { code: LOCALITY_CODE },
          // geoLocation MUST be an object — the persister crashes on null (PathNotFoundException)
          geoLocation: { latitude: 0, longitude: 0 },
        },
        citizen: { name: CITIZEN_NAME, mobileNumber: CITIZEN_PHONE },
        // Strategy-A tuple: the scheduler's extractCategoryTuple reads these
        // three keys from additionalDetail and matches them against the
        // CategorySLA row this spec seeds. PGR enriches this blob (adds
        // department/serviceName) but preserves our keys.
        additionalDetail: { ...TUPLE },
      },
      workflow: { action: 'APPLY', verificationDocuments: [] },
    }),
  });
  const data = await assertOk(resp, 'PGR _create');
  return data.ServiceWrappers[0].service;
}

/**
 * ASSIGN via the raw workflow /process/_transition, NOT pgr _update.
 * Two deliberate choices:
 *  - The body key is the CANONICAL 'assignes' — that is the workflow API's
 *    actual @JsonProperty. Sending the correctly-spelt 'assignees' is
 *    silently dropped on stacks without the JsonAlias fix (issue #1674);
 *    this spec's step 4 is the regression read for that fix.
 *  - PGR _update wraps self-loop transitions and can drop assignes entirely
 *    (see pgr-sla-auto-escalate.spec.ts) — the raw transition is the only
 *    path that reliably populates processInstance.assignes, which is the
 *    read the escalation scheduler itself depends on.
 * NOTE: a raw transition does NOT run pgr-services' _update, so the PGR
 * row's applicationStatus stays at its create-time value (PENDINGFORASSIGNMENT)
 * while the workflow ProcessInstance — the state machine of record — moves
 * to PENDINGATLME. Both are asserted where relevant below.
 */
async function assignComplaint(
  token: string,
  userInfo: Record<string, unknown>,
  srid: string,
  assigneeUuid: string,
  comment: string,
): Promise<any> {
  const resp = await fetch(`${BASE_URL}/egov-workflow-v2/egov-wf/process/_transition`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo },
      ProcessInstances: [{
        tenantId: TENANT,
        businessService: 'PGR',
        businessId: srid,
        moduleName: 'PGR',
        action: 'ASSIGN',
        comment,
        assignes: [{ uuid: assigneeUuid }],
      }],
    }),
  });
  const data = await assertOk(resp, `workflow ASSIGN ${srid}`);
  return (data.ProcessInstances ?? [])[0];
}

// --- MDMS v2 helpers (seed / verify / deactivate the CategorySLA row) -------

async function mdmsSearchTupleRow(token: string): Promise<any | undefined> {
  const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token, ts: Date.now() },
      MdmsCriteria: {
        // The scheduler reads CRS masters at the STATE tenant (see
        // EscalationScheduler.fetchMdmsModule → getStateLevelTenant), so the
        // row must live at ROOT_TENANT, not the city tenant.
        tenantId: ROOT_TENANT,
        schemaCode: CATEGORY_SLA_SCHEMA,
        uniqueIdentifiers: [TUPLE_UID],
        limit: 10,
      },
    }),
  });
  const body = await assertOk(resp, 'CategorySLA _search');
  return (body.mdms ?? [])[0];
}

/** mdms-v2 _update: requires the full Mdms record (id + auditDetails) PLUS schemaCode in the URL. */
async function mdmsUpdateRow(
  token: string,
  userInfo: Record<string, unknown>,
  record: any,
  data: Record<string, unknown>,
  recordActive: boolean,
): Promise<void> {
  const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_update/${encodeURIComponent(CATEGORY_SLA_SCHEMA)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo, ts: Date.now() },
      Mdms: { ...record, data, isActive: recordActive },
    }),
  });
  if (!resp.ok && resp.status !== 202) {
    const text = await resp.text();
    throw new Error(`CategorySLA _update: HTTP ${resp.status} — ${text.slice(0, 500)}`);
  }
  // 200/202 = accepted; persister writes asynchronously — callers re-search.
}

/** The data payload of the seeded row while the test is live. */
function activeTupleData(): Record<string, unknown> {
  return {
    ...TUPLE,
    // No per-state cells: the per-level cell must be the layer that answers,
    // proving slaSource === 'CRS.CategorySLA.level' (the cascade's top).
    slaHoursByState: {},
    slaHoursByLevel: [SLA_HOURS_L0],
    // Scheduler-side soft-delete flag: resolveSlaHours skips rows whose
    // DATA-level isActive is false, so cleanup flips this too.
    isActive: true,
  };
}

test.describe.serial('PGR escalation full flow on Bomet (seeded CategorySLA → dryRun → escalate)', () => {
  let adminToken: string;
  let adminUserInfo: Record<string, unknown>;
  let supToken: string;
  let supUserInfo: Record<string, unknown>;
  let citizenToken: string;
  let citizenUserInfo: Record<string, unknown>;

  // Resolved at runtime from HRMS — no hardcoded uuids anywhere.
  let sub2Uuid: string;
  let supervisorUuid: string;
  let supervisorUsername: string;
  let chainMissing = false;
  let chainMissingMsg = '';

  let seededRowLive = false;
  let sentinelSrid: string;
  let serviceRequestId: string;
  let assignedAtMs: number;
  let postAssignPgrStatus: string;
  let preTriggerLastModified: number;

  test.beforeAll(async () => {
    test.setTimeout(90_000);

    // ADMIN at the root tenant — carries SUPERUSER for /escalation/_trigger
    // and MDMS write access for the CategorySLA seed.
    const adminResp = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    adminToken = adminResp.access_token;
    adminUserInfo = adminResp.UserRequest as Record<string, unknown>;
    expect(adminToken, `ADMIN/${ROOT_TENANT} token must mint`).toBeTruthy();

    // Citizen via the mock-OTP path (fixed 123456 on Bomet/Nairobi).
    const cit = await registerCitizen(CITIZEN_PHONE);
    citizenToken = cit.token;
    citizenUserInfo = cit.userInfo;
    expect(citizenToken, 'citizen OTP login must mint').toBeTruthy();
  });

  test.afterAll(async () => {
    // CLEANUP — must run even when a mid-spec assertion failed. Deactivate
    // the seeded CategorySLA row at BOTH levels: record-level isActive
    // (hides it from the scheduler's v1 read, which only returns active
    // records) and data-level isActive (resolveSlaHours' own guard). The
    // test complaints themselves stay, consistent with the sibling specs.
    if (adminToken) {
      try {
        const record = await mdmsSearchTupleRow(adminToken);
        if (record) {
          await mdmsUpdateRow(adminToken, adminUserInfo, record, { ...activeTupleData(), isActive: false }, false);
          console.log(`[cleanup] CategorySLA ${TUPLE_UID} deactivated`);
        }
      } catch (err) {
        console.log(`[cleanup] FAILED to deactivate CategorySLA ${TUPLE_UID}: ${(err as Error).message}`);
      }
    }
    console.log(`[traceability] sentinel complaint: ${sentinelSrid ?? '(not created)'}`);
    console.log(`[traceability] main complaint:     ${serviceRequestId ?? '(not created)'}`);
  });

  test('0 — pre-flight: resolve PHASE0_SUB2 + reportingTo supervisor from HRMS', {
    annotation: {
      type: 'description',
      description: `Resolves the escalation chain entirely at runtime — no hardcoded uuids. Searches HRMS on the city tenant for the employee whose code starts with ${PHASE0_SUB2_PREFIX}, requires its current assignment to carry a reportingTo uuid (the supervisor the scheduler will escalate to), and resolves the supervisor's own HRMS record for its login username. Skips the whole suite with a clear message when the chain is missing (deployment not seeded with the Phase-0 hierarchy). Also mints the supervisor's employee token, which is the GRO-role session used for the ASSIGN transition (ADMIN at the root tenant does not carry city-level PGR roles).`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:cross'] }, async () => {
    const employees = await searchEmployees(adminToken, TENANT);

    const sub2 = employees.find((e: any) => String(e.code || '').startsWith(PHASE0_SUB2_PREFIX));
    const sub2Assignment = (sub2?.assignments || []).find((a: any) => a.isCurrentAssignment);
    if (!sub2 || !sub2Assignment?.reportingTo) {
      chainMissing = true;
      chainMissingMsg = !sub2
        ? `No HRMS employee with code prefix '${PHASE0_SUB2_PREFIX}' on ${TENANT} — Phase-0 chain not seeded`
        : `HRMS employee ${sub2.code} has no reportingTo on its current assignment — escalation target unresolvable`;
      test.skip(true, chainMissingMsg);
      return;
    }
    sub2Uuid = sub2.uuid;
    supervisorUuid = sub2Assignment.reportingTo;

    const supervisor = employees.find((e: any) => e.uuid === supervisorUuid);
    if (!supervisor) {
      chainMissing = true;
      chainMissingMsg = `reportingTo ${supervisorUuid} of ${sub2.code} not found among HRMS employees on ${TENANT}`;
      test.skip(true, chainMissingMsg);
      return;
    }
    supervisorUsername = supervisor.code;
    console.log(`HRMS chain: ${sub2.code} (${sub2Uuid}) → reportingTo ${supervisor.code} (${supervisorUuid})`);

    // Supervisor session at the CITY tenant — carries GRO, which the
    // workflow's ASSIGN action requires.
    const supResp = await getDigitToken({ tenant: TENANT, username: supervisorUsername, password: PHASE0_SUP_PASSWORD });
    supToken = supResp.access_token;
    supUserInfo = supResp.UserRequest as Record<string, unknown>;
    expect(supToken, `supervisor ${supervisorUsername} token must mint on ${TENANT}`).toBeTruthy();
  });

  test('1 — seed test-scoped CRS.CategorySLA row (upsert, persister-verified)', {
    annotation: {
      type: 'description',
      description: `Upserts the CategorySLA row for the test tuple at the STATE tenant with slaHoursByLevel [${SLA_HOURS_L0}] (~15 s for level 0). Search-first: if the row exists (any active state — a previous run's cleanup leaves it deactivated) it is UPDATED back to active; only a genuinely missing row is created, and a phantom-200 create (duplicate create returns HTTP 200 with an empty mdms array) flips to the update path. After the write, sleeps ${PERSISTER_WAIT_MS / 1000}s (MDMS persistence is Kafka → egov-persister, async) and re-verifies through BOTH read paths: mdms-v2 /v2/_search (what this spec wrote) and the v1 /egov-mdms-service/v1/_search module read (the exact path EscalationScheduler.fetchCrsCategorySla uses — v1 only returns record-level-active rows, which is also why cleanup deactivates at the record level).

Seeding a tuple-scoped row instead of patching the global v0 EscalationConfig is what makes this spec safe to run against production: the 15 s SLA can only ever apply to complaints carrying this spec's additionalDetail tuple.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(chainMissing, chainMissingMsg);
    test.setTimeout(60_000);

    const existing = await mdmsSearchTupleRow(adminToken);
    if (existing) {
      await mdmsUpdateRow(adminToken, adminUserInfo, existing, activeTupleData(), true);
      console.log(`CategorySLA ${TUPLE_UID} existed (recordActive=${existing.isActive}) — updated to active, slaHoursByLevel=[${SLA_HOURS_L0}]`);
    } else {
      const createResp = await fetch(`${BASE_URL}/mdms-v2/v2/_create/${encodeURIComponent(CATEGORY_SLA_SCHEMA)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo, ts: Date.now() },
          Mdms: {
            tenantId: ROOT_TENANT,
            schemaCode: CATEGORY_SLA_SCHEMA,
            uniqueIdentifier: TUPLE_UID,
            data: activeTupleData(),
            isActive: true,
          },
        }),
      });
      const createBody = await assertOk(createResp, 'CategorySLA _create');
      if (!createBody.mdms || createBody.mdms.length === 0) {
        // MDMS phantom-200: duplicate create acks with an empty mdms array.
        // Treat as "exists" and switch to the update path.
        console.log('CategorySLA _create returned phantom-200 (empty mdms) — switching to update');
        const record = await mdmsSearchTupleRow(adminToken);
        expect(record, 'phantom-200 implies the row exists, but re-search found nothing').toBeTruthy();
        await mdmsUpdateRow(adminToken, adminUserInfo, record, activeTupleData(), true);
      } else {
        console.log(`CategorySLA ${TUPLE_UID} created (id=${createBody.mdms[0].id})`);
      }
    }

    // Persister is async (write acked → Kafka → egov-persister → Postgres):
    // wait, then prove the row is actually live before relying on it.
    await sleep(PERSISTER_WAIT_MS);

    const live = await mdmsSearchTupleRow(adminToken);
    expect(live, 'seeded CategorySLA row must be searchable after persister wait').toBeTruthy();
    expect(live.isActive, 'record-level isActive must be true (v1 read filters on it)').toBe(true);
    expect(live.data?.isActive, 'data-level isActive must be true (scheduler-side guard)').toBe(true);
    expect(live.data?.slaHoursByLevel?.[0], 'level-0 SLA cell must be the seeded value').toBe(SLA_HOURS_L0);

    // Second read path: the scheduler consumes this row via MDMS v1
    // (fetchMdmsModule with module CRS / master CategorySLA at the state
    // tenant). Verify the row is visible there too — a v1-invisible row
    // would make the dry-run silently fall back to a lower SLA source.
    const v1Resp = await fetch(`${BASE_URL}/egov-mdms-service/v1/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken },
        MdmsCriteria: {
          tenantId: ROOT_TENANT,
          moduleDetails: [{ moduleName: 'CRS', masterDetails: [{ name: 'CategorySLA' }] }],
        },
      }),
    });
    const v1Body = await assertOk(v1Resp, 'CategorySLA v1 _search (scheduler read path)');
    const v1Rows: any[] = v1Body?.MdmsRes?.CRS?.CategorySLA ?? [];
    const v1Row = v1Rows.find((r) =>
      r.path === TUPLE.path && r.category === TUPLE.category && r.subcategoryL1 === TUPLE.subcategoryL1);
    expect(v1Row, `seeded row must be visible on the scheduler's v1 read path; v1 returned ${v1Rows.length} rows`).toBeTruthy();
    expect(v1Row.slaHoursByLevel?.[0]).toBe(SLA_HOURS_L0);

    seededRowLive = true;
    console.log(`CategorySLA ${TUPLE_UID} live on both read paths (v2 + scheduler v1)`);
  });

  test('2 — cron-phase calibration: sentinel complaint pins the scheduler tick', {
    annotation: {
      type: 'description',
      description: `The background @Scheduled scan (pgr.escalation.interval.ms = 300 s on Bomet) runs the SAME code path as /escalation/_trigger, and the workflow's ESCALATE action grants role SYSTEM — so once the main complaint is assigned and its 15 s SLA breaches, a cron tick landing inside the main flow's ~75 s window would escalate it FIRST and break every dryRun/trigger assertion afterwards (~20% flake without this step).

Calibration: create + assign a sentinel complaint carrying the same SLA tuple, then poll its latest ProcessInstance until the cron escalates it. The moment that is observed, a cron tick has JUST completed — giving the main flow a guaranteed quiet window of nearly a full period (≥ ~280 s, ~4x what it needs). If the sentinel is NOT escalated within a full period + margin (${CRON_OBSERVE_TIMEOUT_MS / 1000}s), the cron provably cannot escalate on this deployment (disabled, or its SYSTEM transition is rejected) — in which case there is no race at all and the main flow proceeds directly. Either branch is deterministic; this test never fails on the timeout itself.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(chainMissing, chainMissingMsg);
    // One full cron period + margin, plus create/assign overhead.
    test.setTimeout(CRON_OBSERVE_TIMEOUT_MS + 60_000);
    expect(seededRowLive, 'seed step must have completed').toBe(true);

    const sentinel = await createComplaint(
      citizenToken, citizenUserInfo,
      `E2E full-flow CRON SENTINEL — safe to ignore — ${new Date().toISOString()}`,
    );
    sentinelSrid = sentinel.serviceRequestId;
    console.log(`[${sentinelSrid}] sentinel created`);

    const pi = await assignComplaint(
      supToken, supUserInfo, sentinelSrid, sub2Uuid,
      'E2E full-flow cron sentinel — assigning so the background scheduler can pick it up',
    );
    expect(pi?.state?.applicationStatus, 'sentinel ASSIGN must land').toBe(PENDINGATLME);
    console.log(`[${sentinelSrid}] sentinel assigned to ${sub2Uuid}; observing background scheduler (≤${CRON_OBSERVE_TIMEOUT_MS / 1000}s)…`);

    const deadline = Date.now() + CRON_OBSERVE_TIMEOUT_MS;
    let cronObserved = false;
    while (Date.now() < deadline) {
      // Modest poll interval — keeps us well inside Kong rate limits.
      await sleep(CRON_POLL_INTERVAL_MS);
      const latest = await fetchLatestProcessInstance(supToken, supUserInfo, sentinelSrid);
      if (latest?.action === 'ESCALATE') {
        cronObserved = true;
        console.log(`[${sentinelSrid}] cron escalated the sentinel (comment: "${latest.comment}") — quiet window starts NOW`);
        break;
      }
      const remaining = Math.round((deadline - Date.now()) / 1000);
      if (remaining % 60 < CRON_POLL_INTERVAL_MS / 1000) console.log(`  …waiting for cron tick, ~${remaining}s budget left`);
    }

    if (!cronObserved) {
      console.log(
        `[${sentinelSrid}] cron did NOT escalate the sentinel within ${CRON_OBSERVE_TIMEOUT_MS / 1000}s — ` +
        'the background scheduler cannot escalate on this deployment, so it cannot race the main flow either. Proceeding.',
      );
    }
  });

  test('3 — citizen files the main complaint carrying the SLA tuple', {
    annotation: {
      type: 'description',
      description: `Files the complaint whose escalation this spec actually asserts. Same auth + body shape as the sibling specs (SERVICE_CODE/LOCALITY_CODE from env), plus service.additionalDetail = the (path, category, subcategoryL1) tuple so the scheduler's Strategy-A extraction (extractCategoryTuple reads additionalDetail first) resolves the seeded 15 s CategorySLA row. Asserts creation, PENDINGFORASSIGNMENT, and that PGR's enrichment preserved the tuple keys.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:citizen'] }, async () => {
    test.skip(chainMissing, chainMissingMsg);

    const svc = await createComplaint(
      citizenToken, citizenUserInfo,
      `E2E escalation full-flow — ${new Date().toISOString()}`,
    );
    serviceRequestId = svc.serviceRequestId;
    expect(serviceRequestId).toBeTruthy();
    expect(svc.applicationStatus).toBe(PENDINGFORASSIGNMENT);
    // PGR enriches additionalDetail (department, serviceName) — our tuple
    // keys must survive that merge or the SLA lookup will miss.
    expect(svc.additionalDetail?.path).toBe(TUPLE.path);
    expect(svc.additionalDetail?.category).toBe(TUPLE.category);
    expect(svc.additionalDetail?.subcategoryL1).toBe(TUPLE.subcategoryL1);
    console.log(`[${serviceRequestId}] created → ${PENDINGFORASSIGNMENT}, tuple intact`);
  });

  test('4 — ASSIGN to PHASE0_SUB2 via /process/_transition with canonical "assignes"', {
    annotation: {
      type: 'description',
      description: `Supervisor (GRO) transitions the workflow with action ASSIGN and the canonical 'assignes' body key — the API's actual @JsonProperty; the correctly-spelt 'assignees' is silently dropped on stacks without the JsonAlias fix (issue #1674). Asserts HTTP 200 and that the transition's resulting workflow state is PENDINGATLME (the state the ESCALATE action hangs off). Also records the post-assign PGR-row status: a raw workflow transition does NOT run pgr _update, so the PGR row's applicationStatus stays PENDINGFORASSIGNMENT — the ProcessInstance is the state machine of record. Step 6 asserts "unchanged" against this observed value.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:employee'] }, async () => {
    test.skip(chainMissing, chainMissingMsg);

    const pi = await assignComplaint(
      supToken, supUserInfo, serviceRequestId, sub2Uuid,
      'E2E full-flow — assigning to PHASE0_SUB2 so the seeded SLA can breach',
    );
    assignedAtMs = Date.now();

    expect(pi, 'transition must return a ProcessInstance').toBeTruthy();
    expect(pi.action).toBe('ASSIGN');
    expect(pi.state?.applicationStatus, 'ASSIGN must move the workflow to PENDINGATLME').toBe(PENDINGATLME);
    const piAssignees = (pi.assignes ?? []).map((a: any) => a?.uuid);
    expect(piAssignees, 'transition response must echo the assignee').toContain(sub2Uuid);
    console.log(`[${serviceRequestId}] ASSIGNED to ${sub2Uuid} → workflow ${PENDINGATLME}`);

    // Observe (not assume) what the PGR row says post-assign — raw workflow
    // transitions don't touch it, so this stays PENDINGFORASSIGNMENT.
    const svc = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
    postAssignPgrStatus = svc.applicationStatus;
    console.log(`[${serviceRequestId}] PGR row status post-assign: ${postAssignPgrStatus} (PI is the state of record)`);
  });

  test('5 — persistence regression (#1674): /process/_search returns the assignee', {
    annotation: {
      type: 'description',
      description: `The regression read for the #1674 fix: before the JsonAlias fix, the assignee sent on the transition was acknowledged but never persisted, so every subsequent read returned an empty assignes array and the scheduler skipped the complaint with NO_ASSIGNEES forever. Waits ${PERSISTER_WAIT_MS / 1000}s (workflow writes persist via Kafka → egov-persister, async), then performs the EXACT read EscalationService.getCurrentAssignees does first — the latest non-history ProcessInstance — and asserts it carries PHASE0_SUB2.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(chainMissing, chainMissingMsg);
    test.setTimeout(60_000);

    // Persister-async: the transition response was synchronous but the PI
    // row lands in Postgres via Kafka — give it a generous window.
    await sleep(PERSISTER_WAIT_MS);

    const latest = await fetchLatestProcessInstance(supToken, supUserInfo, serviceRequestId);
    expect(latest, 'latest ProcessInstance must exist').toBeTruthy();
    expect(latest.action).toBe('ASSIGN');
    const assignees = (latest.assignes ?? []).map((a: any) => a?.uuid);
    expect(
      assignees,
      `persisted PI must carry the assignee (issue #1674 regression — got assignes=${JSON.stringify(latest.assignes)})`,
    ).toContain(sub2Uuid);
    console.log(`[${serviceRequestId}] persisted PI carries assignee ${sub2Uuid} — #1674 read path OK`);
  });

  test('6 — dryRun preview: WOULD_ESCALATE from CRS.CategorySLA.level, zero mutations', {
    annotation: {
      type: 'description',
      description: `Waits out the remainder of a FULL ${SLA_ELAPSE_WAIT_MS / 1000}s since the assign (generous margin over the ~15 s seeded SLA — flaky timing is worse than a slow test), then POSTs /pgr-services/escalation/_trigger with dryRun:true scoped to the main srid as ADMIN (SUPERUSER guard; the endpoint auto-injects AUTO_ESCALATE).

Asserts the verdict: scanned 1, wouldEscalate 1, escalated 0, details[0].action WOULD_ESCALATE with reason SUCCESS, and slaSource === '${SLA_SOURCE_CATEGORY_LEVEL}' — proving the per-level CategorySLA cell beat every other source in the five-layer cascade. Then proves zero mutations: the PGR row's applicationStatus is unchanged from the value observed after step 4 (PENDINGFORASSIGNMENT — see step 4's note on raw transitions; the workflow PI, the state of record, is separately asserted to still be the ASSIGN at PENDINGATLME with no ESCALATE). Finally captures auditDetails.lastModifiedTime as the pre-trigger SLA-clock baseline for step 8's strict-reset assertion.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(chainMissing, chainMissingMsg);
    test.setTimeout(SLA_ELAPSE_WAIT_MS + 60_000);

    // SLA-elapse wait: the seeded level-0 SLA is ~15 s; waiting the full 60 s
    // from the assign removes any clock-skew/persister ambiguity. Step 5
    // already consumed ~10 s of this.
    const remaining = assignedAtMs + SLA_ELAPSE_WAIT_MS - Date.now();
    if (remaining > 0) {
      console.log(`waiting ${Math.round(remaining / 1000)}s more so the 15 s SLA is unambiguously breached…`);
      await sleep(remaining);
    }

    const resp = await fetch(`${BASE_URL}/pgr-services/escalation/_trigger`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo, ts: Date.now() },
        tenantId: ROOT_TENANT,
        serviceRequestIds: [serviceRequestId],
        dryRun: true,
      }),
    });
    const body = await assertOk(resp, '/escalation/_trigger dryRun');
    console.log(`dryRun: scanned=${body.scanned}, wouldEscalate=${body.wouldEscalate}, escalated=${body.escalated}, skipBreakdown=${JSON.stringify(body.skipBreakdown ?? {})}`);

    if (body.scanned === 0) {
      // Most likely cause: the complaint left the scanned statuses — i.e.
      // something else escalated it. Surface the real state for diagnosis.
      const svc = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
      throw new Error(
        `dryRun scanned 0 complaints for ${serviceRequestId} — current PGR status=${svc?.applicationStatus}, ` +
        `escalationLevel=${svc?.additionalDetail?.escalationLevel}. If status is ${PENDINGATSUPERVISOR} the background ` +
        'cron stole the escalation: the calibration quiet-window was overrun (was the runner suspended mid-suite?).',
      );
    }

    expect(body.dryRun).toBe(true);
    expect(body.scanned, 'exactly our complaint in scope').toBe(1);
    expect(body.wouldEscalate, 'dryRun must report the would-be escalation').toBe(1);
    expect(body.escalated, 'dryRun must never mutate').toBe(0);

    const ours = (body.details ?? []).find((d: any) => d.serviceRequestId === serviceRequestId);
    expect(ours, `details must include ${serviceRequestId}; got ${JSON.stringify(body.details)}`).toBeTruthy();
    expect(ours.action).toBe('WOULD_ESCALATE');
    expect(ours.reason).toBe('SUCCESS');
    expect(ours.slaSource, 'the per-level CategorySLA cascade source must win').toBe(SLA_SOURCE_CATEGORY_LEVEL);

    // Zero-mutation proof — both state layers untouched.
    const svc = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
    expect(svc.applicationStatus, 'PGR row status unchanged by dryRun').toBe(postAssignPgrStatus);
    expect(svc.additionalDetail?.escalationLevel ?? 0, 'no escalationLevel written by dryRun').toBe(0);
    const latestPi = await fetchLatestProcessInstance(supToken, supUserInfo, serviceRequestId);
    expect(latestPi.action, 'workflow untouched by dryRun — latest PI is still the ASSIGN').toBe('ASSIGN');
    expect(latestPi.state?.applicationStatus).toBe(PENDINGATLME);

    // Pre-trigger SLA-clock baseline (step 8 asserts a strict reset).
    preTriggerLastModified = svc.auditDetails?.lastModifiedTime;
    expect(preTriggerLastModified, 'pre-trigger lastModifiedTime must be readable').toBeTruthy();
    console.log(`[${serviceRequestId}] dryRun verdict OK; state unchanged; pre-trigger lastModifiedTime=${preTriggerLastModified}`);
  });

  test('7 — real trigger: ESCALATED / SUCCESS / CRS.CategorySLA.level', {
    annotation: {
      type: 'description',
      description: `Same call as step 6 without dryRun — this one mutates. Asserts escalated 1 (wouldEscalate 0 — that counter is dry-run-only), details[0].action ESCALATED with reason SUCCESS, and slaSource still '${SLA_SOURCE_CATEGORY_LEVEL}'. The actual post-state (workflow transition, additionalDetail, SLA clock) is verified in step 8 after the persister catches up.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(chainMissing, chainMissingMsg);

    const resp = await fetch(`${BASE_URL}/pgr-services/escalation/_trigger`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo, ts: Date.now() },
        tenantId: ROOT_TENANT,
        serviceRequestIds: [serviceRequestId],
      }),
    });
    const body = await assertOk(resp, '/escalation/_trigger (real)');
    console.log(`trigger: scanned=${body.scanned}, escalated=${body.escalated}, skipBreakdown=${JSON.stringify(body.skipBreakdown ?? {})}`);

    if (body.scanned === 0) {
      const svc = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
      throw new Error(
        `real trigger scanned 0 complaints for ${serviceRequestId} — current PGR status=${svc?.applicationStatus}, ` +
        `escalationLevel=${svc?.additionalDetail?.escalationLevel}. If status is ${PENDINGATSUPERVISOR} the background ` +
        'cron stole the escalation between steps 6 and 7 (calibration quiet-window overrun).',
      );
    }

    expect(body.escalated, 'exactly our complaint must escalate').toBe(1);
    expect(body.wouldEscalate, 'wouldEscalate is a dry-run-only counter').toBe(0);

    const ours = (body.details ?? []).find((d: any) => d.serviceRequestId === serviceRequestId);
    expect(ours, `details must include ${serviceRequestId}; got ${JSON.stringify(body.details)}`).toBeTruthy();
    expect(ours.action).toBe('ESCALATED');
    expect(ours.reason).toBe('SUCCESS');
    expect(ours.slaSource).toBe(SLA_SOURCE_CATEGORY_LEVEL);
    console.log(`[${serviceRequestId}] ESCALATED (detail: ${ours.detail})`);
  });

  test('8 — post-conditions: status, escalationLevel, SLA-clock reset, ESCALATE PI', {
    annotation: {
      type: 'description',
      description: `Re-reads both state layers after ${PERSISTER_WAIT_MS / 1000}s (the escalation publishes the updated service to the PGR update topic — Kafka → egov-persister, async) and asserts everything the PRD requires of one escalation hop:
1. PGR applicationStatus flipped to ${PENDINGATSUPERVISOR} (the ESCALATE transition's target state — and proof that, unlike the raw ASSIGN, the scheduler's path DOES rewrite the PGR row, because it goes through pgr's workflow service + update topic).
2. additionalDetail.escalationLevel === 1.
3. auditDetails.lastModifiedTime STRICTLY greater than the pre-trigger baseline — the per-level SLA clock reset (PRD P6: each level gets a fresh window; without the reset, decreasing per-level SLAs cascade straight to maxDepth).
4. Latest workflow PI: action ESCALATE, assignee === the HRMS reportingTo supervisor resolved in step 0, and the audit-trail comment matches /Auto-escalated to .+ \\(.+\\): SLA breached at level 0/ (name + designation tier of buildEscalateComment).`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(chainMissing, chainMissingMsg);
    test.setTimeout(60_000);

    // Persister-async: the escalated service object reaches Postgres via the
    // PGR update topic; the ESCALATE ProcessInstance via the workflow topic.
    await sleep(PERSISTER_WAIT_MS);

    const svc = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
    expect(svc, 'complaint must be re-readable').toBeTruthy();
    console.log(`[${serviceRequestId}] post-escalation: status=${svc.applicationStatus}, additionalDetail=${JSON.stringify(svc.additionalDetail).slice(0, 300)}`);

    expect(svc.applicationStatus).toBe(PENDINGATSUPERVISOR);
    expect(svc.additionalDetail?.escalationLevel).toBe(1);

    const postLastModified = svc.auditDetails?.lastModifiedTime;
    expect(
      postLastModified,
      `SLA clock must reset: lastModifiedTime ${postLastModified} must be STRICTLY > pre-trigger ${preTriggerLastModified}`,
    ).toBeGreaterThan(preTriggerLastModified);

    const latestPi = await fetchLatestProcessInstance(supToken, supUserInfo, serviceRequestId);
    expect(latestPi, 'latest ProcessInstance must exist').toBeTruthy();
    expect(latestPi.action).toBe('ESCALATE');
    const piAssignees = (latestPi.assignes ?? []).map((a: any) => a?.uuid);
    expect(piAssignees, 'escalation must target the HRMS reportingTo supervisor').toContain(supervisorUuid);
    expect(String(latestPi.comment ?? '')).toMatch(/Auto-escalated to .+ \(.+\): SLA breached at level 0/);
    console.log(`[${serviceRequestId}] escalated to ${supervisorUuid} — comment: "${latestPi.comment}"`);
  });

  test('9 — OTEL: trigger trace has scan aggregates + escalation.complaint child span', {
    annotation: {
      type: 'description',
      description: `Closes the observability loop on the named-assignee path. The scheduler runs each complaint's escalation inside a CHILD span named 'escalation.complaint' (created under tracer 'pgr-services') so per-complaint attributes — complaint.serviceRequestId, escalation.slaSource, from/to levels — never last-writer-win on the scan span; the scan-level aggregates (escalation.scanned / escalation.escalated) stay on the parent.

Transport mirrors the sibling trigger spec's OTEL test: (1) SSH-grep the pgr-services container logs for "Escalated complaint <srid>" — that exact line is emitted ONCE, by the real (mutating) escalation in step 7; the step-6 dryRun preview never logs it, so the token uniquely identifies the mutating trigger's trace and the helper's default 10-minute --since window comfortably covers steps 7→9. (2) getTempoTrace with retries (ingest is async: javaagent batching → collector → Tempo flush). Then asserts: the parent scan span carries escalation.scanned >= 1 AND escalation.escalated >= 1; a CHILD span named 'escalation.complaint' exists with complaint.serviceRequestId === our srid and escalation.slaSource === '${SLA_SOURCE_CATEGORY_LEVEL}' (the same winning cascade layer the trigger response reported); and the child's parentSpanId === the scan span's spanId, proving the parent/child topology.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@area:otel', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(chainMissing, chainMissingMsg);
    test.setTimeout(120_000);

    // "Escalated complaint <srid> from level ..." is logged only by the real
    // escalation (EscalationService.escalateComplaintWithReason) — inside the
    // child span's scope, so its MDC trace_id is the trigger's trace.
    const grepToken = `Escalated complaint ${serviceRequestId}`;
    const traceId = await extractTraceIdFromBometLogs(grepToken);
    if (!traceId) {
      throw new Error(
        `No trace_id found in pgr-services logs for "${grepToken}". Either the OTEL javaagent is not ` +
        'attached, the MDC trace_id is missing from the log pattern, or step 7 never actually escalated.',
      );
    }
    console.log(`OTEL trace_id for ${serviceRequestId}: ${traceId}`);

    const trace = await getTempoTrace(traceId, 6, 2_500);

    // Parent scan span — the per-scan aggregates.
    const scanSpans = findSpansByAttribute(trace, 'escalation.scanned');
    expect(scanSpans.length, 'expected a span carrying escalation.scanned (the scan aggregates)').toBeGreaterThan(0);
    const scan = scanSpans[0];
    const scanned = getAttr(scan, 'escalation.scanned');
    const escalated = getAttr(scan, 'escalation.escalated');
    console.log(`scan span "${scan.name}": scanned=${scanned}, escalated=${escalated}`);
    expect(typeof scanned === 'number' && scanned >= 1, `escalation.scanned should be >= 1 (got ${scanned})`).toBe(true);
    expect(typeof escalated === 'number' && escalated >= 1, `escalation.escalated should be >= 1 (got ${escalated})`).toBe(true);

    // Per-complaint CHILD span — our srid, with the winning SLA source.
    const childSpans = findSpansByAttribute(trace, 'complaint.serviceRequestId')
      .filter((s) => s.name === 'escalation.complaint' && getAttr(s, 'complaint.serviceRequestId') === serviceRequestId);
    expect(
      childSpans.length,
      `expected an 'escalation.complaint' child span for ${serviceRequestId}; srid-bearing spans seen: ${JSON.stringify(
        findSpansByAttribute(trace, 'complaint.serviceRequestId').map((s) => `${s.name}=${getAttr(s, 'complaint.serviceRequestId')}`),
      )}`,
    ).toBeGreaterThan(0);
    const child = childSpans[0];
    expect(getAttr(child, 'escalation.slaSource'), 'child span must carry the winning SLA source').toBe(SLA_SOURCE_CATEGORY_LEVEL);
    expect(
      !!child.parentSpanId && child.parentSpanId === scan.spanId,
      `escalation.complaint must be a DIRECT CHILD of the scan span (child.parentSpanId=${child.parentSpanId}, scan.spanId=${scan.spanId})`,
    ).toBe(true);
    console.log(`[${serviceRequestId}] OTEL parent/child escalation span topology verified`);
  });
});
