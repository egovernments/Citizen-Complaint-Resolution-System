/**
 * PGR ROLE-LEVEL escalation (PRD primary journey) — FULL-FLOW E2E on live Bomet.
 *
 * Drives the opt-in role-escalation path end-to-end against a live
 * deployment: an UNASSIGNED complaint whose SLA breaches is escalated to the
 * person resolved for the acting role of its workflow state — here via the
 * R1_PIN strategy (an explicit CRS.RoleSupervisors row), the highest-
 * precedence resolution in EscalationService.doResolveRoleTarget:
 *
 *   0. Pre-flight: resolve PHASE0_SUP (the pin target) from HRMS at runtime
 *   1. Snapshot the live CRS.EscalationPolicy row (deep copy — restored in
 *      afterAll no matter what), then seed three MDMS rows at the STATE tenant:
 *      (a) a test-scoped CRS.CategorySLA tuple row with slaHoursByLevel
 *          [0.00417] (~15 s) — same upsert machinery as the full-flow sibling;
 *      (b) the policy row UPDATED with roleEscalation { enabled,
 *          actingRoleByState: { PENDINGFORASSIGNMENT: GRO }, maxPerScan: 10 }
 *          while preserving every existing field;
 *      (c) a CRS.RoleSupervisors pin (GRO, ALL) → PHASE0_SUP.
 *   2. Cron-phase sentinel — same pattern as the full-flow sibling, but the
 *      sentinel stays UNASSIGNED: with role escalation enabled the background
 *      scan picks unattended complaints up via the role path. NOTE the
 *      expected branch on current Bomet: the PGR workflow's ESCALATE action
 *      at PENDINGFORASSIGNMENT carries roles GRO,AUTO_ESCALATE,PGR_VIEWER —
 *      no SYSTEM — so the cron's SYSTEM transition is rejected and the
 *      sentinel times out un-escalated. That branch is itself signal: a cron
 *      that cannot transition cannot race the main flow either.
 *   3. Citizen files the main complaint with the tuple; NOBODY assigns it
 *   4. After a full 60 s, dryRun /escalation/_trigger: WOULD_ESCALATE with
 *      slaSource CRS.CategorySLA.level + R1_PIN provenance, zero mutations
 *   5. Real /escalation/_trigger: escalated=1 / SUCCESS / same provenance
 *   6. Post-conditions: ESCALATE ProcessInstance assigned to PHASE0_SUP, the
 *      hedged role-path audit comment, escalationLevel 1, SLA clock reset,
 *      and the OBSERVED chain behavior for the status: ESCALATE at
 *      PENDINGFORASSIGNMENT is a SELF-LOOP on this deployment's workflow
 *      (nextState == PENDINGFORASSIGNMENT), so applicationStatus stays put
 *      while the assignee materializes
 *   7. OTEL: the real trigger's trace has the parent scan span with
 *      escalation.roleEscalated >= 1 AND an 'escalation.complaint' CHILD span
 *      carrying our srid + escalation.roleEscalation + resolutionStrategy
 *   8. afterAll: restore the policy row to the exact snapshot, deactivate the
 *      pin + tuple rows, then VERIFY the restore (re-read shows no enabled
 *      roleEscalation). Runs even when a mid-spec assertion failed.
 *
 * Required env (defaults in ../utils/env.ts):
 *   BASE_URL       e.g. https://bometfeedbackhub.digit.org
 *   DIGIT_TENANT   e.g. ke.bomet   (ROOT_TENANT derived: ke)
 *   SERVICE_CODE   a complaint type live on the tenant, e.g. ObsoleteOrDamagedPipeline
 *   LOCALITY_CODE  a leaf boundary on the tenant, e.g. BOMET_BOMET_EAST_CHEMANER
 *   DIGIT_USERNAME / DIGIT_PASSWORD   ADMIN at ROOT_TENANT (default ADMIN/eGov@123)
 *   PHASE0_SUP_PREFIX                 HRMS code prefix of the pin target (default PHASE0_SUP)
 *   PHASE0_SUP_PASSWORD               pin target's login password (default eGov@123)
 *   TEMPO_URL / BOMET_SSH_HOST        OTEL plumbing (defaults in ../utils/tempo.ts)
 *
 * Run (from the egov dev box — Tempo + the bomet SSH alias live on the VPC):
 *   BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.bomet \
 *   LOCALITY_CODE=BOMET_BOMET_EAST_CHEMANER SERVICE_CODE=ObsoleteOrDamagedPipeline \
 *   npx playwright test tests/lifecycle/pgr-escalation-role-flow.spec.ts --reporter=line
 *
 * PACING RULE (binding, inherited from the full-flow sibling): every wait is
 * generous on purpose (10 s for async persistence, 60 s for a 15 s SLA, a
 * full cron period for calibration). Determinism beats speed — the suite
 * legitimately takes several minutes.
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import {
  BASE_URL, TENANT, ROOT_TENANT,
  ADMIN_USER, ADMIN_PASS, FIXED_OTP, DEFAULT_PASSWORD,
  SERVICE_CODE, LOCALITY_CODE,
  CITIZEN_PHONE_PREFIX,
} from '../utils/env';
import {
  extractTraceIdFromBometLogs,
  getTempoTrace,
  findSpansByAttribute,
  getAttr,
} from '../utils/tempo';

// Offset the timestamp-derived phone so this spec never collides with the
// sibling specs' generateCitizenPhone() when several files load in the same
// millisecond of one runner invocation.
const CITIZEN_PHONE = CITIZEN_PHONE_PREFIX
  + (Date.now() + 424_242).toString().slice(-(9 - CITIZEN_PHONE_PREFIX.length));
const CITIZEN_NAME = 'E2E Escalation Role-Flow Citizen';

/** HRMS code prefix used to locate the pin target on the tenant. */
const PHASE0_SUP_PREFIX = process.env.PHASE0_SUP_PREFIX || 'PHASE0_SUP';
const PHASE0_SUP_PASSWORD = process.env.PHASE0_SUP_PASSWORD || DEFAULT_PASSWORD;

// ---------------------------------------------------------------------------
// Test-scoped SLA tuple (Strategy-A extraction off additionalDetail) — ONLY
// complaints created by this spec ever match the seeded CategorySLA row, so
// the 15 s SLA can never leak onto production complaints.
// ---------------------------------------------------------------------------
const TUPLE = { path: 'E2E-ROLEFLOW', category: 'EscalationTest', subcategoryL1: 'RoleFlow' };
const TUPLE_UID = `${TUPLE.path}.${TUPLE.category}.${TUPLE.subcategoryL1}`;
const CATEGORY_SLA_SCHEMA = 'CRS.CategorySLA';
/** 0.00417 h ≈ 15 s. Per-level cells are HOURS and must be > 0 (levelCellToMillis). */
const SLA_HOURS_L0 = 0.00417;

// Role-escalation seed rows.
const POLICY_SCHEMA = 'CRS.EscalationPolicy';
/** The policy singleton's x-unique field is singletonKey, enum-locked to 'default'. */
const POLICY_UID = 'default';
const PIN_SCHEMA = 'CRS.RoleSupervisors';
const ACTING_ROLE = 'GRO';
const PIN_DEPARTMENT = 'ALL';
// mdms-v2 derives uniqueIdentifier from the schema's x-unique fields
// (role, department) joined with '.', so the pin is addressable as GRO.ALL.
const PIN_UID = `${ACTING_ROLE}.${PIN_DEPARTMENT}`;

// Pacing (see PACING RULE in the header — identical to the full-flow sibling).
/** MDMS + PGR + workflow writes are all Kafka → egov-persister async. */
const PERSISTER_WAIT_MS = 10_000;
/** Generous margin over the ~15 s seeded SLA before asking for a verdict. */
const SLA_ELAPSE_WAIT_MS = 60_000;
/**
 * pgr.escalation.interval.ms is 300 s on Bomet (fixedDelay). One full period
 * + scan time + persister/poll lag with margin.
 */
const CRON_OBSERVE_TIMEOUT_MS = 390_000;
const CRON_POLL_INTERVAL_MS = 10_000;

const PENDINGFORASSIGNMENT = 'PENDINGFORASSIGNMENT';

const SLA_SOURCE_CATEGORY_LEVEL = 'CRS.CategorySLA.level';
const STRATEGY_R1_PIN = 'R1_PIN';

/**
 * Role-path audit comment template (EscalationService.buildRoleEscalateComment):
 *   "Auto-escalated (no recorded assignee): assigned to %s — acting role %s (elapsed %dh > SLA %dh)"
 * where %s is the 3-tier name (designation) → name → uuid fallback. A
 * ", department fallback" suffix is appended only when the resolution was
 * department-filtered=false WITH a non-null department — our serviceCode has
 * no ServiceDefs category tuple, so the scheduler resolves department=null
 * and no suffix is expected; the regex stays un-anchored at the end anyway.
 */
const ROLE_COMMENT_RE =
  /Auto-escalated \(no recorded assignee\): assigned to .+ — acting role GRO \(elapsed \d+h > SLA \d+h\)/;

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
        // Strategy-A tuple: extractCategoryTuple reads these three keys from
        // additionalDetail and matches them against the seeded CategorySLA row.
        additionalDetail: { ...TUPLE },
      },
      workflow: { action: 'APPLY', verificationDocuments: [] },
    }),
  });
  const data = await assertOk(resp, 'PGR _create');
  return data.ServiceWrappers[0].service;
}

// --- MDMS v2 helpers (generic over schema — this spec touches three) --------

async function mdmsSearchRow(token: string, schemaCode: string, uniqueIdentifier: string): Promise<any | undefined> {
  const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token, ts: Date.now() },
      MdmsCriteria: {
        // The scheduler reads CRS masters at the STATE tenant (see
        // EscalationScheduler.fetchMdmsModule → getStateLevelTenant), so all
        // rows must live at ROOT_TENANT, not the city tenant.
        tenantId: ROOT_TENANT,
        schemaCode,
        uniqueIdentifiers: [uniqueIdentifier],
        limit: 10,
      },
    }),
  });
  const body = await assertOk(resp, `${schemaCode} _search`);
  return (body.mdms ?? [])[0];
}

/** mdms-v2 _update: requires the full Mdms record (id + auditDetails) PLUS schemaCode in the URL. */
async function mdmsUpdateRow(
  token: string,
  userInfo: Record<string, unknown>,
  schemaCode: string,
  record: any,
  data: Record<string, unknown>,
  recordActive: boolean,
): Promise<void> {
  const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_update/${encodeURIComponent(schemaCode)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo, ts: Date.now() },
      Mdms: { ...record, data, isActive: recordActive },
    }),
  });
  if (!resp.ok && resp.status !== 202) {
    const text = await resp.text();
    throw new Error(`${schemaCode} _update: HTTP ${resp.status} — ${text.slice(0, 500)}`);
  }
  // 200/202 = accepted; persister writes asynchronously — callers re-search.
}

/**
 * Create-or-update an MDMS row to ACTIVE with the given data. Search-first
 * (a previous run's cleanup leaves rows deactivated); a phantom-200 create
 * (duplicate create returns HTTP 200 with an empty mdms array) flips to the
 * update path. Same machinery as the full-flow sibling's CategorySLA seed.
 */
async function mdmsUpsertActiveRow(
  token: string,
  userInfo: Record<string, unknown>,
  schemaCode: string,
  uniqueIdentifier: string,
  data: Record<string, unknown>,
): Promise<void> {
  const existing = await mdmsSearchRow(token, schemaCode, uniqueIdentifier);
  if (existing) {
    await mdmsUpdateRow(token, userInfo, schemaCode, existing, data, true);
    console.log(`${schemaCode} ${uniqueIdentifier} existed (recordActive=${existing.isActive}) — updated to active`);
    return;
  }
  const createResp = await fetch(`${BASE_URL}/mdms-v2/v2/_create/${encodeURIComponent(schemaCode)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo, ts: Date.now() },
      Mdms: {
        tenantId: ROOT_TENANT,
        schemaCode,
        uniqueIdentifier,
        data,
        isActive: true,
      },
    }),
  });
  const createBody = await assertOk(createResp, `${schemaCode} _create`);
  if (!createBody.mdms || createBody.mdms.length === 0) {
    // MDMS phantom-200: duplicate create acks with an empty mdms array.
    console.log(`${schemaCode} _create returned phantom-200 (empty mdms) — switching to update`);
    const record = await mdmsSearchRow(token, schemaCode, uniqueIdentifier);
    expect(record, `phantom-200 implies ${schemaCode}/${uniqueIdentifier} exists, but re-search found nothing`).toBeTruthy();
    await mdmsUpdateRow(token, userInfo, schemaCode, record, data, true);
  } else {
    console.log(`${schemaCode} ${uniqueIdentifier} created (id=${createBody.mdms[0].id})`);
  }
}

/**
 * The scheduler's read path: MDMS v1 module search (fetchMdmsModule with
 * module CRS at the state tenant). v1 only returns record-level-active rows'
 * data objects — which is also why cleanup deactivates at the record level.
 */
async function v1CrsMaster(token: string, masterName: string): Promise<any[]> {
  const resp = await fetch(`${BASE_URL}/egov-mdms-service/v1/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token },
      MdmsCriteria: {
        tenantId: ROOT_TENANT,
        moduleDetails: [{ moduleName: 'CRS', masterDetails: [{ name: masterName }] }],
      },
    }),
  });
  const body = await assertOk(resp, `CRS.${masterName} v1 _search (scheduler read path)`);
  return body?.MdmsRes?.CRS?.[masterName] ?? [];
}

/** The data payload of the seeded CategorySLA row while the test is live. */
function activeTupleData(): Record<string, unknown> {
  return {
    ...TUPLE,
    // No per-state cells: the per-level cell must be the layer that answers,
    // proving slaSource === 'CRS.CategorySLA.level' (the cascade's top).
    slaHoursByState: {},
    slaHoursByLevel: [SLA_HOURS_L0],
    isActive: true,
  };
}

/** The data payload of the (GRO, ALL) pin row while the test is live. */
function activePinData(assigneeUuid: string): Record<string, unknown> {
  // Schema CRS.RoleSupervisors: required [role, department, assigneeUuid,
  // isActive], additionalProperties false.
  return {
    role: ACTING_ROLE,
    department: PIN_DEPARTMENT,
    assigneeUuid,
    isActive: true,
  };
}

/**
 * POST /escalation/_trigger with retry on 409 SCAN_IN_PROGRESS: a mutating
 * scan can collide with a background cron tick mid-flight (the scheduler's
 * single-replica overlap guard returns 409). Scan ticks finish in seconds,
 * so a short backoff resolves the race deterministically. Dry runs bypass
 * the guard server-side, so the retry never fires for them.
 */
async function escalationTrigger(
  token: string,
  userInfo: Record<string, unknown>,
  serviceRequestIds: string[],
  dryRun: boolean,
): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const resp = await fetch(`${BASE_URL}/pgr-services/escalation/_trigger`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo, ts: Date.now() },
        tenantId: ROOT_TENANT,
        serviceRequestIds,
        ...(dryRun ? { dryRun: true } : {}),
      }),
    });
    if (resp.status === 409 && attempt <= 4) {
      console.log(`/escalation/_trigger 409 SCAN_IN_PROGRESS (cron tick mid-flight) — retry ${attempt}/4 in 15s`);
      await sleep(15_000);
      continue;
    }
    return assertOk(resp, `/escalation/_trigger${dryRun ? ' dryRun' : ''}`);
  }
}

test.describe.serial('PGR role-level escalation full flow on Bomet (policy + pin → unassigned complaint → R1_PIN escalate)', () => {
  let adminToken: string;
  let adminUserInfo: Record<string, unknown>;
  let supToken: string;
  let supUserInfo: Record<string, unknown>;
  let citizenToken: string;
  let citizenUserInfo: Record<string, unknown>;

  // Resolved at runtime from HRMS — no hardcoded uuids anywhere.
  let supUuid: string;
  let supUsername: string;
  let supMissing = false;
  let supMissingMsg = '';

  // Cleanup bookkeeping — flags are set BEFORE each write fires so a
  // failed-but-maybe-applied write still gets restored/deactivated.
  let policySnapshotData: Record<string, unknown> | undefined;
  let policySnapshotActive = true;
  let policyMutated = false;
  let pinTouched = false;
  let tupleTouched = false;

  let seedLive = false;
  let sentinelSrid: string;
  let serviceRequestId: string;
  let createdAtMs: number;
  let preTriggerLastModified: number;
  let triggerStartedAt: string;

  test.beforeAll(async () => {
    test.setTimeout(90_000);

    // ADMIN at the root tenant — carries SUPERUSER for /escalation/_trigger
    // and MDMS write access for the three seeds.
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
    // CLEANUP — must run even when a mid-spec assertion failed, and the
    // policy restore is non-negotiable (it is the only write that touches a
    // LIVE production row rather than a test-scoped one). Failures are
    // collected (never thrown mid-way) so every cleanup step always runs,
    // then surfaced as one error at the end.
    test.setTimeout(120_000);
    const failures: string[] = [];

    // The suite runs long enough that the beforeAll token could in theory
    // age out — re-mint a fresh ADMIN token for cleanup, best-effort.
    try {
      const fresh = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
      if (fresh.access_token) {
        adminToken = fresh.access_token;
        adminUserInfo = fresh.UserRequest as Record<string, unknown>;
      }
    } catch (err) {
      console.log(`[cleanup] token re-mint failed (continuing with original): ${(err as Error).message}`);
    }

    // 1. Restore CRS.EscalationPolicy to the exact pre-spec snapshot
    //    (roleEscalation key gone entirely — it was absent before).
    if (policyMutated && policySnapshotData && adminToken) {
      try {
        const record = await mdmsSearchRow(adminToken, POLICY_SCHEMA, POLICY_UID);
        if (!record) throw new Error('policy row not found on re-search');
        await mdmsUpdateRow(adminToken, adminUserInfo, POLICY_SCHEMA, record, policySnapshotData, policySnapshotActive);
        console.log(`[cleanup] ${POLICY_SCHEMA} restored to snapshot: ${JSON.stringify(policySnapshotData)}`);
      } catch (err) {
        failures.push(`policy restore FAILED: ${(err as Error).message}`);
      }
    }

    // 2. Deactivate the (GRO, ALL) pin row at both levels (record-level for
    //    the v1 read, data-level for the resolver's own pre-filter).
    if (pinTouched && supUuid && adminToken) {
      try {
        const record = await mdmsSearchRow(adminToken, PIN_SCHEMA, PIN_UID);
        if (record) {
          await mdmsUpdateRow(adminToken, adminUserInfo, PIN_SCHEMA, record,
            { ...activePinData(supUuid), isActive: false }, false);
          console.log(`[cleanup] ${PIN_SCHEMA} ${PIN_UID} deactivated`);
        }
      } catch (err) {
        failures.push(`pin deactivate FAILED: ${(err as Error).message}`);
      }
    }

    // 3. Deactivate the seeded CategorySLA tuple row (both levels).
    if (tupleTouched && adminToken) {
      try {
        const record = await mdmsSearchRow(adminToken, CATEGORY_SLA_SCHEMA, TUPLE_UID);
        if (record) {
          await mdmsUpdateRow(adminToken, adminUserInfo, CATEGORY_SLA_SCHEMA, record,
            { ...activeTupleData(), isActive: false }, false);
          console.log(`[cleanup] ${CATEGORY_SLA_SCHEMA} ${TUPLE_UID} deactivated`);
        }
      } catch (err) {
        failures.push(`tuple deactivate FAILED: ${(err as Error).message}`);
      }
    }

    // 4. VERIFY the policy restore landed: after the persister settles, the
    //    re-read row must show no enabled roleEscalation.
    if (policyMutated && adminToken) {
      await sleep(PERSISTER_WAIT_MS);
      try {
        const live = await mdmsSearchRow(adminToken, POLICY_SCHEMA, POLICY_UID);
        const re: any = live?.data?.roleEscalation;
        if (re && re.enabled === true) {
          failures.push(`policy restore NOT VERIFIED — re-read still shows enabled roleEscalation: ${JSON.stringify(re)}`);
        } else {
          console.log('[cleanup] verified: policy re-read shows no enabled roleEscalation');
        }
      } catch (err) {
        failures.push(`policy restore verification read FAILED: ${(err as Error).message}`);
      }
    }

    console.log(`[traceability] sentinel complaint: ${sentinelSrid ?? '(not created)'}`);
    console.log(`[traceability] main complaint:     ${serviceRequestId ?? '(not created)'}`);

    if (failures.length > 0) {
      throw new Error(
        `CLEANUP FAILURES — production MDMS state may need manual repair: ${failures.join('; ')}. ` +
        `Policy snapshot for manual restore (tenant ${ROOT_TENANT}, schema ${POLICY_SCHEMA}, uid ${POLICY_UID}): ` +
        JSON.stringify(policySnapshotData),
      );
    }
  });

  test('0 — pre-flight: resolve PHASE0_SUP (the pin target) from HRMS', {
    annotation: {
      type: 'description',
      description: `Resolves the role-escalation target entirely at runtime — no hardcoded uuids. Searches HRMS on the city tenant for the active employee whose code starts with ${PHASE0_SUP_PREFIX} (the Phase-0 supervisor): its uuid becomes the CRS.RoleSupervisors pin's assigneeUuid, which the resolver validates against HRMS at escalation time (a non-active pin target falls through, so the employee must be live). Skips the whole suite with a clear message when it is missing. Also mints the supervisor's own employee token — used for the workflow process reads, mirroring the full-flow sibling — which doubles as proof the pin target is a real, login-able employee.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:cross'] }, async () => {
    const employees = await searchEmployees(adminToken, TENANT);

    const sup = employees.find((e: any) => String(e.code || '').startsWith(PHASE0_SUP_PREFIX));
    if (!sup || sup.isActive === false) {
      supMissing = true;
      supMissingMsg = !sup
        ? `No HRMS employee with code prefix '${PHASE0_SUP_PREFIX}' on ${TENANT} — Phase-0 chain not seeded`
        : `HRMS employee ${sup.code} is inactive — cannot be a CRS.RoleSupervisors pin target (R1 validates against HRMS)`;
      test.skip(true, supMissingMsg);
      return;
    }
    supUuid = sup.uuid;
    supUsername = sup.code;
    console.log(`HRMS pin target: ${supUsername} (${supUuid}), active=${sup.isActive}`);

    const supResp = await getDigitToken({ tenant: TENANT, username: supUsername, password: PHASE0_SUP_PASSWORD });
    supToken = supResp.access_token;
    supUserInfo = supResp.UserRequest as Record<string, unknown>;
    expect(supToken, `pin target ${supUsername} token must mint on ${TENANT}`).toBeTruthy();
  });

  test('1 — snapshot policy; seed CategorySLA tuple + roleEscalation policy + (GRO, ALL) pin', {
    annotation: {
      type: 'description',
      description: `Three MDMS writes at the STATE tenant, then one ${PERSISTER_WAIT_MS / 1000}s persister settle and per-row verification on BOTH read paths (mdms-v2 /v2/_search = what this spec wrote, and the v1 module read = the EXACT path EscalationScheduler.fetchCrsCategorySla / fetchCrsEscalationPolicy / fetchCrsRoleSupervisors consume):

(a) CRS.CategorySLA tuple row (${TUPLE_UID}) with slaHoursByLevel [${SLA_HOURS_L0}] (~15 s) — the full-flow sibling's upsert machinery verbatim, incl. phantom-200 create handling. Tuple-scoped, so the 15 s SLA can only ever apply to this spec's complaints.

(b) CRS.EscalationPolicy — the riskiest write of the suite, because this row is LIVE production policy. The existing row is snapshotted (deep copy, logged for manual repair) BEFORE the update, then UPDATED to data = { ...snapshot, roleEscalation: { enabled: true, actingRoleByState: { ${PENDINGFORASSIGNMENT}: '${ACTING_ROLE}' }, maxPerScan: 10 } } — every pre-existing field preserved byte-for-byte. afterAll restores the exact snapshot even on failure.

(c) CRS.RoleSupervisors pin (${PIN_UID}): role ${ACTING_ROLE} / department ${PIN_DEPARTMENT} / assigneeUuid = the HRMS-resolved PHASE0_SUP / isActive true — the R1_PIN strategy's input, matched via findPinRow's (role, 'ALL') fallback since the complaint's serviceCode has no ServiceDefs department tuple.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(supMissing, supMissingMsg);
    test.setTimeout(120_000);

    // (a) CategorySLA tuple row — upsert to active.
    tupleTouched = true;
    await mdmsUpsertActiveRow(adminToken, adminUserInfo, CATEGORY_SLA_SCHEMA, TUPLE_UID, activeTupleData());

    // (b) EscalationPolicy — snapshot FIRST (deep copy), then update.
    const policyRecord = await mdmsSearchRow(adminToken, POLICY_SCHEMA, POLICY_UID);
    expect(
      policyRecord,
      `${POLICY_SCHEMA}/${POLICY_UID} must already exist at ${ROOT_TENANT} — this spec only UPDATEs the singleton, never creates it`,
    ).toBeTruthy();
    policySnapshotData = JSON.parse(JSON.stringify(policyRecord.data));
    policySnapshotActive = policyRecord.isActive !== false;
    console.log(`[policy] snapshot taken (afterAll restore payload): ${JSON.stringify(policySnapshotData)}`);
    expect(
      (policySnapshotData as any)?.roleEscalation?.enabled !== true,
      'pre-existing policy must not already have roleEscalation enabled — refusing to clobber a live rollout',
    ).toBe(true);
    policyMutated = true; // set BEFORE the write: a failed-but-applied update must still be restored
    await mdmsUpdateRow(adminToken, adminUserInfo, POLICY_SCHEMA, policyRecord, {
      ...policySnapshotData,
      roleEscalation: {
        enabled: true,
        actingRoleByState: { [PENDINGFORASSIGNMENT]: ACTING_ROLE },
        maxPerScan: 10,
      },
    }, policySnapshotActive);
    console.log('[policy] roleEscalation enabled (all prior fields preserved)');

    // (c) RoleSupervisors pin — create-or-update to active.
    pinTouched = true;
    await mdmsUpsertActiveRow(adminToken, adminUserInfo, PIN_SCHEMA, PIN_UID, activePinData(supUuid));

    // Persister is async (write acked → Kafka → egov-persister → Postgres):
    // wait once, then prove all three rows are actually live.
    await sleep(PERSISTER_WAIT_MS);

    // --- verify (v2 read path: what we wrote) ---
    const tupleLive = await mdmsSearchRow(adminToken, CATEGORY_SLA_SCHEMA, TUPLE_UID);
    expect(tupleLive, 'seeded CategorySLA row must be searchable after persister wait').toBeTruthy();
    expect(tupleLive.isActive, 'tuple record-level isActive (v1 read filters on it)').toBe(true);
    expect(tupleLive.data?.isActive, 'tuple data-level isActive (scheduler-side guard)').toBe(true);
    expect(tupleLive.data?.slaHoursByLevel?.[0], 'level-0 SLA cell must be the seeded value').toBe(SLA_HOURS_L0);

    const policyLive = await mdmsSearchRow(adminToken, POLICY_SCHEMA, POLICY_UID);
    expect(policyLive?.data?.roleEscalation?.enabled, 'policy roleEscalation.enabled must be live').toBe(true);
    expect(policyLive?.data?.roleEscalation?.actingRoleByState?.[PENDINGFORASSIGNMENT]).toBe(ACTING_ROLE);
    expect(policyLive?.data?.roleEscalation?.maxPerScan).toBe(10);
    for (const key of Object.keys(policySnapshotData as object)) {
      expect(
        JSON.stringify(policyLive?.data?.[key]),
        `pre-existing policy field '${key}' must be preserved by the roleEscalation update`,
      ).toBe(JSON.stringify((policySnapshotData as any)[key]));
    }

    const pinLive = await mdmsSearchRow(adminToken, PIN_SCHEMA, PIN_UID);
    expect(pinLive, 'pin row must be searchable after persister wait').toBeTruthy();
    expect(pinLive.isActive, 'pin record-level isActive').toBe(true);
    expect(pinLive.data?.isActive, 'pin data-level isActive (fetchCrsRoleSupervisors filters on it)').toBe(true);
    expect(pinLive.data?.assigneeUuid).toBe(supUuid);

    // --- verify (v1 module read: the scheduler's exact consumption path) ---
    const v1Tuples = await v1CrsMaster(adminToken, 'CategorySLA');
    const v1Tuple = v1Tuples.find((r) =>
      r.path === TUPLE.path && r.category === TUPLE.category && r.subcategoryL1 === TUPLE.subcategoryL1);
    expect(v1Tuple, `tuple row must be visible on the scheduler's v1 read path; v1 returned ${v1Tuples.length} rows`).toBeTruthy();
    expect(v1Tuple.slaHoursByLevel?.[0]).toBe(SLA_HOURS_L0);

    // fetchCrsEscalationPolicy consumes rows[0] of the v1 result — verify
    // EXACTLY that read, not just "some row somewhere".
    const v1Policies = await v1CrsMaster(adminToken, 'EscalationPolicy');
    expect(v1Policies.length, 'policy singleton must be visible on the v1 read path').toBeGreaterThan(0);
    expect(
      v1Policies[0]?.roleEscalation?.enabled,
      `scheduler reads v1 rows[0] — it must carry the enabled roleEscalation (v1 rows: ${JSON.stringify(v1Policies).slice(0, 400)})`,
    ).toBe(true);

    const v1Pins = await v1CrsMaster(adminToken, 'RoleSupervisors');
    const v1Pin = v1Pins.find((r) => r.role === ACTING_ROLE && r.department === PIN_DEPARTMENT);
    expect(v1Pin, `(${ACTING_ROLE}, ${PIN_DEPARTMENT}) pin must be visible on the scheduler's v1 read path`).toBeTruthy();
    expect(v1Pin.assigneeUuid).toBe(supUuid);
    expect(v1Pin.isActive).toBe(true);

    seedLive = true;
    console.log('All three seed rows live on both read paths (v2 + scheduler v1)');
  });

  test('2 — cron-phase calibration: UNASSIGNED sentinel observes the background scheduler', {
    annotation: {
      type: 'description',
      description: `Same calibration pattern as the full-flow sibling, with one deliberate difference: the sentinel stays UNASSIGNED, because with roleEscalation enabled the background scan now picks unattended complaints up via the role path — observing the cron escalate the sentinel both pins the tick phase AND proves the role path end-to-end under the cron's SYSTEM identity.

Expected branch on current Bomet, however, is the TIMEOUT: the PGR workflow's ESCALATE action at ${PENDINGFORASSIGNMENT} carries roles GRO,AUTO_ESCALATE,PGR_VIEWER — no SYSTEM — so the cron's role-path transition is rejected (WORKFLOW_TRANSITION_FAILED) and the sentinel never escalates. That outcome is itself signal: a cron that cannot perform this transition cannot race the main flow either, so the spec proceeds directly (the /escalation/_trigger path is unaffected — the controller injects AUTO_ESCALATE, which the action DOES grant). Either branch is deterministic; this test never fails on the timeout itself.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(supMissing, supMissingMsg);
    test.setTimeout(CRON_OBSERVE_TIMEOUT_MS + 60_000);
    expect(seedLive, 'seed step must have completed').toBe(true);

    const sentinel = await createComplaint(
      citizenToken, citizenUserInfo,
      `E2E role-flow CRON SENTINEL — safe to ignore — ${new Date().toISOString()}`,
    );
    sentinelSrid = sentinel.serviceRequestId;
    expect(sentinel.applicationStatus).toBe(PENDINGFORASSIGNMENT);
    // Deliberately NOT assigned — the role path only fires on complaints
    // with no recorded assignee.
    console.log(`[${sentinelSrid}] sentinel created (UNASSIGNED); observing background scheduler (≤${CRON_OBSERVE_TIMEOUT_MS / 1000}s)…`);

    const deadline = Date.now() + CRON_OBSERVE_TIMEOUT_MS;
    let cronObserved = false;
    while (Date.now() < deadline) {
      // Modest poll interval — keeps us well inside Kong rate limits.
      await sleep(CRON_POLL_INTERVAL_MS);
      const latest = await fetchLatestProcessInstance(supToken, supUserInfo, sentinelSrid);
      if (latest?.action === 'ESCALATE') {
        cronObserved = true;
        console.log(`[${sentinelSrid}] cron ROLE-escalated the sentinel (comment: "${latest.comment}") — quiet window starts NOW`);
        break;
      }
      const remaining = Math.round((deadline - Date.now()) / 1000);
      if (remaining % 60 < CRON_POLL_INTERVAL_MS / 1000) console.log(`  …waiting for cron tick, ~${remaining}s budget left`);
    }

    if (!cronObserved) {
      console.log(
        `[${sentinelSrid}] cron did NOT role-escalate the sentinel within ${CRON_OBSERVE_TIMEOUT_MS / 1000}s — ` +
        `expected on this deployment (ESCALATE@${PENDINGFORASSIGNMENT} grants AUTO_ESCALATE but not SYSTEM), ` +
        'so the background scheduler cannot mutate unassigned complaints and cannot race the main flow. Proceeding.',
      );
    }
  });

  test('3 — citizen files the main complaint with the SLA tuple; NOBODY assigns it', {
    annotation: {
      type: 'description',
      description: `Files the complaint whose role-escalation this spec asserts. Same auth + body shape as the siblings, with service.additionalDetail = the (path, category, subcategoryL1) tuple so the scheduler's Strategy-A extraction resolves the seeded 15 s CategorySLA row. Crucially it is NEVER assigned: the latest ProcessInstance stays the citizen's APPLY with zero assignees, so EscalationService.getCurrentAssignees (current PI, then history fallback) returns empty and the scheduler routes the complaint down the ROLE path instead of the named-assignee path. Asserts creation, ${PENDINGFORASSIGNMENT}, and tuple survival through PGR's enrichment.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:citizen'] }, async () => {
    test.skip(supMissing, supMissingMsg);

    const svc = await createComplaint(
      citizenToken, citizenUserInfo,
      `E2E escalation role-flow — ${new Date().toISOString()}`,
    );
    serviceRequestId = svc.serviceRequestId;
    createdAtMs = Date.now();
    expect(serviceRequestId).toBeTruthy();
    expect(svc.applicationStatus).toBe(PENDINGFORASSIGNMENT);
    // PGR enriches additionalDetail (department, serviceName) — our tuple
    // keys must survive that merge or the SLA lookup will miss.
    expect(svc.additionalDetail?.path).toBe(TUPLE.path);
    expect(svc.additionalDetail?.category).toBe(TUPLE.category);
    expect(svc.additionalDetail?.subcategoryL1).toBe(TUPLE.subcategoryL1);
    console.log(`[${serviceRequestId}] created → ${PENDINGFORASSIGNMENT}, tuple intact, deliberately unassigned`);
  });

  test('4 — dryRun preview: WOULD_ESCALATE via R1_PIN with full provenance, zero mutations', {
    annotation: {
      type: 'description',
      description: `Waits out the remainder of a FULL ${SLA_ELAPSE_WAIT_MS / 1000}s since creation (generous margin over the ~15 s seeded SLA — the unassigned complaint's SLA clock runs from createdTime, surfaced as auditDetails.lastModifiedTime), then POSTs /escalation/_trigger with dryRun:true scoped to the main srid as ADMIN.

Asserts the verdict AND the role-resolution provenance the PRD requires for "why did X get this?": scanned 1, wouldEscalate 1, escalated 0; details[0] action WOULD_ESCALATE / reason SUCCESS / slaSource '${SLA_SOURCE_CATEGORY_LEVEL}' (per-level CategorySLA cell beat the cascade) / resolutionStrategy '${STRATEGY_R1_PIN}' (the explicit pin won before R2/R3 ran) / actingRole '${ACTING_ROLE}' / departmentFiltered present (false here — the complaint's serviceCode has no ServiceDefs category tuple, so the scheduler resolves department=null and findPinRow matches the ('${ACTING_ROLE}', '${PIN_DEPARTMENT}') fallback row).

Then proves zero mutations by re-fetching BOTH state layers: the PGR row (status still ${PENDINGFORASSIGNMENT}, no escalationLevel) and the latest workflow PI (still the citizen's APPLY with no assignees). Finally captures auditDetails.lastModifiedTime as the SLA-clock baseline for step 6's strict-reset assertion.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(supMissing, supMissingMsg);
    test.setTimeout(SLA_ELAPSE_WAIT_MS + 60_000);

    const remaining = createdAtMs + SLA_ELAPSE_WAIT_MS - Date.now();
    if (remaining > 0) {
      console.log(`waiting ${Math.round(remaining / 1000)}s more so the 15 s SLA is unambiguously breached…`);
      await sleep(remaining);
    }

    const body = await escalationTrigger(adminToken, adminUserInfo, [serviceRequestId], true);
    console.log(`dryRun: scanned=${body.scanned}, wouldEscalate=${body.wouldEscalate}, escalated=${body.escalated}, skipBreakdown=${JSON.stringify(body.skipBreakdown ?? {})}`);

    if (body.scanned === 0) {
      const svc = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
      throw new Error(
        `dryRun scanned 0 complaints for ${serviceRequestId} — current PGR status=${svc?.applicationStatus}, ` +
        `escalationLevel=${svc?.additionalDetail?.escalationLevel}. Either the complaint left the scanned statuses ` +
        'or the scan batch paged it out (escalation batch size exceeded by the PENDINGFORASSIGNMENT pool).',
      );
    }

    expect(body.dryRun).toBe(true);
    expect(body.scanned, 'exactly our complaint in scope').toBe(1);
    expect(body.wouldEscalate, 'dryRun must report the would-be role escalation').toBe(1);
    expect(body.escalated, 'dryRun must never mutate').toBe(0);

    const ours = (body.details ?? []).find((d: any) => d.serviceRequestId === serviceRequestId);
    expect(ours, `details must include ${serviceRequestId}; got ${JSON.stringify(body.details)}`).toBeTruthy();
    expect(ours.action).toBe('WOULD_ESCALATE');
    expect(ours.reason).toBe('SUCCESS');
    expect(ours.slaSource, 'the per-level CategorySLA cascade source must win').toBe(SLA_SOURCE_CATEGORY_LEVEL);
    expect(ours.resolutionStrategy, 'the explicit pin must resolve the target (R1 wins before R2/R3)').toBe(STRATEGY_R1_PIN);
    expect(ours.actingRole).toBe(ACTING_ROLE);
    expect(ours.candidateCount, 'R1_PIN always resolves to exactly one candidate').toBe(1);
    expect(
      typeof ours.departmentFiltered,
      `role-path outcomes must carry departmentFiltered provenance (got ${JSON.stringify(ours)})`,
    ).toBe('boolean');

    // Zero-mutation proof — both state layers untouched.
    const svc = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
    expect(svc.applicationStatus, 'PGR row status unchanged by dryRun').toBe(PENDINGFORASSIGNMENT);
    expect(svc.additionalDetail?.escalationLevel ?? 0, 'no escalationLevel written by dryRun').toBe(0);
    const latestPi = await fetchLatestProcessInstance(supToken, supUserInfo, serviceRequestId);
    expect(latestPi.action, 'workflow untouched by dryRun — latest PI is still the citizen APPLY').toBe('APPLY');
    expect((latestPi.assignes ?? []).length, 'still no recorded assignee after dryRun').toBe(0);

    preTriggerLastModified = svc.auditDetails?.lastModifiedTime;
    expect(preTriggerLastModified, 'pre-trigger lastModifiedTime must be readable').toBeTruthy();
    console.log(`[${serviceRequestId}] dryRun R1_PIN verdict OK; state unchanged; pre-trigger lastModifiedTime=${preTriggerLastModified}`);
  });

  test('5 — real trigger: escalated=1 / SUCCESS / R1_PIN provenance intact', {
    annotation: {
      type: 'description',
      description: `Same call as step 4 without dryRun — this one mutates: the scheduler resolves the acting role's pin, validates the target against HRMS, and EscalationService.escalateToRoleTarget performs the ESCALATE self-loop assigning PHASE0_SUP directly (no reportingTo hop — the resolved person IS the target). Asserts escalated 1 (wouldEscalate 0 — that counter is dry-run-only) and that details[0] carries action ESCALATED / reason SUCCESS with the SAME provenance as the preview (slaSource '${SLA_SOURCE_CATEGORY_LEVEL}', resolutionStrategy '${STRATEGY_R1_PIN}', actingRole '${ACTING_ROLE}', departmentFiltered present). Retries on 409 SCAN_IN_PROGRESS in case a background cron tick is mid-flight (the calibration in step 2 cannot pin the tick phase when the cron's transition is rejected). Post-state is verified in step 6 after the persister catches up; the trace timestamp captured here scopes step 7's log grep.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(supMissing, supMissingMsg);
    test.setTimeout(120_000);

    triggerStartedAt = new Date(Date.now() - 30_000).toISOString();
    const body = await escalationTrigger(adminToken, adminUserInfo, [serviceRequestId], false);
    console.log(`trigger: scanned=${body.scanned}, escalated=${body.escalated}, skipBreakdown=${JSON.stringify(body.skipBreakdown ?? {})}`);

    if (body.scanned === 0) {
      const svc = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
      throw new Error(
        `real trigger scanned 0 complaints for ${serviceRequestId} — current PGR status=${svc?.applicationStatus}, ` +
        `escalationLevel=${svc?.additionalDetail?.escalationLevel}.`,
      );
    }

    expect(body.escalated, 'exactly our complaint must escalate').toBe(1);
    expect(body.wouldEscalate, 'wouldEscalate is a dry-run-only counter').toBe(0);

    const ours = (body.details ?? []).find((d: any) => d.serviceRequestId === serviceRequestId);
    expect(ours, `details must include ${serviceRequestId}; got ${JSON.stringify(body.details)}`).toBeTruthy();
    expect(ours.action).toBe('ESCALATED');
    expect(ours.reason).toBe('SUCCESS');
    expect(ours.slaSource).toBe(SLA_SOURCE_CATEGORY_LEVEL);
    expect(ours.resolutionStrategy).toBe(STRATEGY_R1_PIN);
    expect(ours.actingRole).toBe(ACTING_ROLE);
    expect(typeof ours.departmentFiltered).toBe('boolean');
    console.log(`[${serviceRequestId}] ROLE-ESCALATED (detail: ${ours.detail})`);
  });

  test('6 — post-conditions: ESCALATE PI to PHASE0_SUP, hedged comment, level 1, clock reset', {
    annotation: {
      type: 'description',
      description: `Re-reads both state layers after ${PERSISTER_WAIT_MS / 1000}s (escalation publishes the updated service to the PGR update topic and the ESCALATE PI to the workflow topic — both Kafka → egov-persister, async):
1. Latest workflow PI: action ESCALATE, assignee === the HRMS-resolved PHASE0_SUP (the PIN target directly — no reportingTo hop on the role path), and the audit-trail comment matches the buildRoleEscalateComment template exactly: ${String(ROLE_COMMENT_RE)} — hedged to "no recorded assignee" because the system cannot distinguish never-assigned from assignee-lost (the upstream #1674 family of bugs).
2. PGR row: additionalDetail.escalationLevel === 1, and auditDetails.lastModifiedTime STRICTLY greater than the step-4 baseline (PRD P6: each level gets a fresh SLA window).
3. Status per the OBSERVED chain behavior on this deployment: the PGR workflow defines ESCALATE at ${PENDINGFORASSIGNMENT} as a SELF-LOOP (nextState = ${PENDINGFORASSIGNMENT} — verified against /egov-wf/businessservice/_search, unlike PENDINGATLME's ESCALATE which targets PENDINGATSUPERVISOR), so BOTH layers stay at ${PENDINGFORASSIGNMENT} while the assignee materializes on the PI. The role escalation's observable state change is the assignee + level + clock, not the status.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(supMissing, supMissingMsg);
    test.setTimeout(60_000);

    await sleep(PERSISTER_WAIT_MS);

    const latestPi = await fetchLatestProcessInstance(supToken, supUserInfo, serviceRequestId);
    expect(latestPi, 'latest ProcessInstance must exist').toBeTruthy();
    expect(latestPi.action).toBe('ESCALATE');
    const piAssignees = (latestPi.assignes ?? []).map((a: any) => a?.uuid);
    expect(piAssignees, 'role escalation must target the pinned PHASE0_SUP directly').toContain(supUuid);
    expect(String(latestPi.comment ?? '')).toMatch(ROLE_COMMENT_RE);
    // Observed chain behavior: ESCALATE@PENDINGFORASSIGNMENT self-loops.
    expect(latestPi.state?.applicationStatus, 'ESCALATE at PENDINGFORASSIGNMENT is a self-loop on this workflow').toBe(PENDINGFORASSIGNMENT);
    console.log(`[${serviceRequestId}] ESCALATE PI → ${supUuid}, comment: "${latestPi.comment}"`);

    const svc = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
    expect(svc, 'complaint must be re-readable').toBeTruthy();
    console.log(`[${serviceRequestId}] post-escalation: status=${svc.applicationStatus}, additionalDetail=${JSON.stringify(svc.additionalDetail).slice(0, 300)}`);
    expect(svc.additionalDetail?.escalationLevel).toBe(1);
    expect(svc.applicationStatus, 'PGR row mirrors the self-loop target state').toBe(PENDINGFORASSIGNMENT);

    const postLastModified = svc.auditDetails?.lastModifiedTime;
    expect(
      postLastModified,
      `SLA clock must reset: lastModifiedTime ${postLastModified} must be STRICTLY > pre-trigger ${preTriggerLastModified}`,
    ).toBeGreaterThan(preTriggerLastModified);
    console.log(`[${serviceRequestId}] escalationLevel=1, SLA clock reset (${preTriggerLastModified} → ${postLastModified})`);
  });

  test('7 — OTEL: trigger trace has roleEscalated aggregate + escalation.complaint child span', {
    annotation: {
      type: 'description',
      description: `Closes the observability loop on the role path. The real trigger's per-complaint work runs inside a CHILD span named 'escalation.complaint' (created by EscalationScheduler under tracer 'pgr-services') so per-complaint attributes never last-writer-win on the scan span; scan-level aggregates stay on the parent.

Steps (transport identical to the sibling trigger spec's OTEL test):
1. SSH-grep the pgr-services container logs for the real escalation's unique log line ("Role-escalated complaint <srid>" — emitted exactly once, by EscalationService.escalateToRoleTarget, inside the child span's scope) and extract the OTEL trace_id MDC field.
2. getTempoTrace with retries (ingest is async: javaagent batching → collector → Tempo flush).
3. Parent scan span (found via its escalation.roleEscalated attribute): assert roleEscalated >= 1.
4. Child span: name 'escalation.complaint', complaint.serviceRequestId === our srid, escalation.roleEscalation === true, escalation.resolutionStrategy === '${STRATEGY_R1_PIN}', escalation.actingRole === '${ACTING_ROLE}', escalation.slaSource === '${SLA_SOURCE_CATEGORY_LEVEL}', escalation.toAssignee === the pinned PHASE0_SUP, escalation.toLevel === 1 — and parentSpanId === the scan span's spanId, proving the parent/child topology.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@area:otel', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(supMissing, supMissingMsg);
    test.setTimeout(120_000);

    // "Role-escalated complaint <srid>" is logged ONLY by the real (mutating)
    // role escalation — the dryRun preview never emits it — so this token
    // cannot pick up the step-4 dry-run trace.
    const grepToken = `Role-escalated complaint ${serviceRequestId}`;
    const traceId = await extractTraceIdFromBometLogs(grepToken, triggerStartedAt);
    if (!traceId) {
      throw new Error(
        `No trace_id found in pgr-services logs for "${grepToken}" since ${triggerStartedAt}. ` +
        'Either the OTEL javaagent is not attached, the MDC trace_id is missing from the log pattern, ' +
        'or step 5 never actually role-escalated.',
      );
    }
    console.log(`OTEL trace_id for ${serviceRequestId}: ${traceId}`);

    const trace = await getTempoTrace(traceId, 6, 2_500);

    // Parent scan span — the per-scan aggregates.
    const scanSpans = findSpansByAttribute(trace, 'escalation.roleEscalated');
    expect(scanSpans.length, 'expected a span carrying escalation.roleEscalated (the scan aggregates)').toBeGreaterThan(0);
    const scan = scanSpans[0];
    const roleEscalated = getAttr(scan, 'escalation.roleEscalated');
    console.log(`scan span "${scan.name}": roleEscalated=${roleEscalated}, scanned=${getAttr(scan, 'escalation.scanned')}, escalated=${getAttr(scan, 'escalation.escalated')}`);
    expect(
      typeof roleEscalated === 'number' && roleEscalated >= 1,
      `escalation.roleEscalated should be >= 1 (got ${roleEscalated})`,
    ).toBe(true);

    // Per-complaint CHILD span.
    const childSpans = findSpansByAttribute(trace, 'complaint.serviceRequestId')
      .filter((s) => s.name === 'escalation.complaint' && getAttr(s, 'complaint.serviceRequestId') === serviceRequestId);
    expect(
      childSpans.length,
      `expected an 'escalation.complaint' child span for ${serviceRequestId}; srid-bearing spans seen: ${JSON.stringify(
        findSpansByAttribute(trace, 'complaint.serviceRequestId').map((s) => `${s.name}=${getAttr(s, 'complaint.serviceRequestId')}`),
      )}`,
    ).toBeGreaterThan(0);
    const child = childSpans[0];

    expect(getAttr(child, 'escalation.roleEscalation'), 'child must be flagged as a role escalation').toBe(true);
    expect(getAttr(child, 'escalation.resolutionStrategy'), 'child must carry the winning strategy').toBe(STRATEGY_R1_PIN);
    expect(getAttr(child, 'escalation.actingRole')).toBe(ACTING_ROLE);
    expect(getAttr(child, 'escalation.slaSource'), 'child must carry the winning SLA source').toBe(SLA_SOURCE_CATEGORY_LEVEL);
    expect(getAttr(child, 'escalation.toAssignee'), 'child must record the pin target').toBe(supUuid);
    expect(getAttr(child, 'escalation.toLevel')).toBe(1);
    expect(
      !!child.parentSpanId && child.parentSpanId === scan.spanId,
      `escalation.complaint must be a DIRECT CHILD of the scan span (child.parentSpanId=${child.parentSpanId}, scan.spanId=${scan.spanId})`,
    ).toBe(true);
    console.log(`[${serviceRequestId}] OTEL parent/child role-escalation span topology verified`);
  });
});
