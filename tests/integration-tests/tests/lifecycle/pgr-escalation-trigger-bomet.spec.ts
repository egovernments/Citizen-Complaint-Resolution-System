/**
 * PGR /escalation/_trigger — synchronous escalation E2E on Bomet.
 *
 * Drives the new SUPERUSER-only `POST /pgr-services/escalation/_trigger`
 * endpoint end-to-end against the live Bomet deployment:
 *
 *   1. Citizen files a complaint
 *   2. PHASE0_SUP assigns it to PHASE0_SUB2 (we use a city-tenant employee
 *      session because ADMIN/ke does not carry the city-level PGR roles)
 *   3. ADMIN/ke patches RAINMAKER-PGR.EscalationConfig so the SLA is short
 *      enough for the just-assigned complaint to be considered breached
 *   4. ADMIN/ke calls /escalation/_trigger scoped to this one srid
 *   5. Asserts the response counters (scanned/escalated) AND that the
 *      complaint's assignee and applicationStatus flipped to PHASE0_SUP /
 *      PENDINGATSUPERVISOR
 *   6. Pulls the OTEL trace_id from pgr-services logs by srid and verifies
 *      the EscalationScheduler + EscalationService spans carry the expected
 *      attributes (scanned/escalated/from-level/to-level/from-assignee/
 *      to-assignee/serviceRequestId)
 *   7. Restores the original SLA in afterAll
 *
 * Run (from the egov dev box — Tempo and the bomet SSH alias both live on
 * the VPC):
 *   BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.bomet \
 *   ROOT_TENANT=ke SERVICE_CODE=RepeatedFailureAcrossFacilities \
 *   LOCALITY_CODE=BOMET_BOMET_EAST_CHEMANER \
 *   TEMPO_URL=http://10.0.0.2:13200 \
 *   npx playwright test tests/lifecycle/pgr-escalation-trigger-bomet.spec.ts
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

// Pre-provisioned employees on ke.bomet (see Phase 0 task output).
const PHASE0_SUP_USERNAME = process.env.PHASE0_SUP_USERNAME || 'PHASE0_SUP_1780961197';
const PHASE0_SUP_UUID = process.env.PHASE0_SUP_UUID || 'bfb3d8e4-8a99-4a8f-a5cf-ffb267185329';
const PHASE0_SUB2_UUID = process.env.PHASE0_SUB2_UUID || '6956fc1a-6a48-47cb-a5f7-1777d12acb4a';

const CITIZEN_PHONE = generateCitizenPhone();
const CITIZEN_NAME = 'E2E Escalation Trigger Citizen';

// EscalationConfig knobs we mutate. Keep the test interval short and the
// SLA equal so the complaint is already-breached at trigger time.
const TEST_SLA_MS = [60_000, 60_000, 60_000];

// ---------------------------------------------------------------------------
// Local helpers (kept here, not factored into utils/, so this spec stays
// independently runnable and easy to diff against pgr-escalation-api.spec.ts)
// ---------------------------------------------------------------------------

async function assertOk(resp: Response, ctx: string): Promise<any> {
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`${ctx}: HTTP ${resp.status} — ${JSON.stringify(body).slice(0, 800)}`);
  }
  return body;
}

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
  const data = await resp.json();
  return { token: data.access_token, userInfo: data.UserRequest };
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
  const data = await resp.json();
  return data.ServiceWrappers?.[0]?.service;
}

async function searchEscalationConfig(token: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token, ts: Date.now() },
      MdmsCriteria: {
        tenantId: ROOT_TENANT,
        schemaCode: 'RAINMAKER-PGR.EscalationConfig',
        limit: 5,
      },
    }),
  });
  const body = await assertOk(resp, 'EscalationConfig _search');
  return body.mdms?.[0];
}

/** mdms-v2 _update: requires the full Mdms record (id + auditDetails) PLUS schemaCode in the URL. */
async function updateEscalationConfig(
  token: string,
  userInfo: Record<string, unknown>,
  record: any,
  newData: Record<string, unknown>,
): Promise<void> {
  const updated = {
    ...record,
    data: { ...record.data, ...newData },
  };
  const schemaCode = encodeURIComponent(record.schemaCode);
  const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_update/${schemaCode}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo, ts: Date.now() },
      Mdms: updated,
    }),
  });
  if (!resp.ok && resp.status !== 202) {
    const text = await resp.text();
    throw new Error(`MDMS _update: HTTP ${resp.status} — ${text.slice(0, 500)}`);
  }
  // 202 = accepted; persister writes asynchronously
}

test.describe.serial('PGR /escalation/_trigger on Bomet (SUPERUSER, sync)', () => {
  let adminToken: string;
  let adminUserInfo: Record<string, unknown>;
  let supToken: string;
  let supUserInfo: Record<string, unknown>;
  let citizenToken: string;
  let citizenUserInfo: Record<string, unknown>;
  let serviceRequestId: string;
  let originalEscalationRecord: any;
  let triggerStartedAt: string;

  test.beforeAll(async () => {
    test.setTimeout(60_000);

    // 1. ADMIN/ke — needed for /escalation/_trigger (carries SUPERUSER) and
    //    for the MDMS _update.
    const adminResp = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    adminToken = adminResp.access_token;
    adminUserInfo = adminResp.UserRequest as Record<string, unknown>;
    expect(adminToken, 'ADMIN/ke token must mint').toBeTruthy();

    // 2. PHASE0_SUP/ke.bomet — needed to ASSIGN the complaint because ADMIN/ke
    //    is not in the GRO/PGR_LME roles at the city tenant.
    const supResp = await getDigitToken({
      tenant: 'ke.bomet',
      username: PHASE0_SUP_USERNAME,
      password: 'eGov@123',
    });
    supToken = supResp.access_token;
    supUserInfo = supResp.UserRequest as Record<string, unknown>;
    expect(supToken, 'PHASE0_SUP token must mint').toBeTruthy();

    // 3. Citizen via OTP (mock OTP path on Bomet — fixed 123456)
    const cit = await registerCitizen(CITIZEN_PHONE);
    citizenToken = cit.token;
    citizenUserInfo = cit.userInfo;
    expect(citizenToken, 'citizen OTP login must mint').toBeTruthy();

    // 4. Snapshot the current EscalationConfig record so we can restore it
    //    in afterAll even if mid-spec assertions fail.
    originalEscalationRecord = await searchEscalationConfig(adminToken);
    expect(originalEscalationRecord, 'EscalationConfig MDMS record must exist').toBeTruthy();
  });

  test.afterAll(async () => {
    if (!originalEscalationRecord || !adminToken) return;
    // Best-effort: write the original SLA back. We don't fail the suite if
    // this errors — surfacing the prior assertion failure is more valuable.
    try {
      await updateEscalationConfig(
        adminToken,
        adminUserInfo,
        originalEscalationRecord,
        {
          maxDepth: originalEscalationRecord.data.maxDepth,
          defaultSlaByLevel: originalEscalationRecord.data.defaultSlaByLevel,
          overrides: originalEscalationRecord.data.overrides,
        },
      );
      console.log('Restored EscalationConfig to original SLAs');
    } catch (err) {
      console.log(`[afterAll] Failed to restore EscalationConfig: ${(err as Error).message}`);
    }
  });

  test('1 — citizen files complaint; PHASE0_SUP assigns to PHASE0_SUB2', {
    annotation: {
      type: 'description',
      description: `Builds the candidate complaint for the synchronous escalation scan. ADMIN/ke is not carrying city-level PGR roles on Bomet — so ASSIGN goes through the PHASE0_SUP supervisor token instead. The complaint must end at PENDINGATLME so the scheduler considers it for ESCALATION (PENDINGFORASSIGNMENT is a different self-loop).

Steps:
1. POST /pgr-services/v2/request/_create with the citizen token; assert status PENDINGFORASSIGNMENT.
2. fetchComplaint with supToken to load full service object.
3. POST /pgr-services/v2/request/_update with workflow.action=ASSIGN and assignees=[PHASE0_SUB2]; assert status PENDINGATLME.

Stashes serviceRequestId for the trigger + trace assertions.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    // Create
    const createResp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: citizenToken, userInfo: citizenUserInfo },
        service: {
          tenantId: TENANT,
          serviceCode: SERVICE_CODE,
          description: `E2E /escalation/_trigger — ${new Date().toISOString()}`,
          source: 'web',
          address: {
            city: TENANT,
            locality: { code: LOCALITY_CODE },
            geoLocation: { latitude: 0, longitude: 0 },
          },
          citizen: { name: CITIZEN_NAME, mobileNumber: CITIZEN_PHONE },
        },
        workflow: { action: 'APPLY', verificationDocuments: [] },
      }),
    });
    const createData = await assertOk(createResp, 'PGR _create (trigger)');
    serviceRequestId = createData.ServiceWrappers[0].service.serviceRequestId;
    expect(createData.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGFORASSIGNMENT');
    console.log(`[${serviceRequestId}] created → PENDINGFORASSIGNMENT`);

    // Assign as PHASE0_SUP (city-tenant supervisor — has GRO/PGR_LME)
    const fullService = await fetchComplaint(supToken, supUserInfo, serviceRequestId);
    expect(fullService, 'complaint must be readable post-create').toBeTruthy();

    const assignResp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: supToken, userInfo: supUserInfo },
        service: fullService,
        workflow: {
          action: 'ASSIGN',
          // NB: the workflow API key is the misspelled 'assignes' (@JsonProperty). Sending
          // 'assignees' is silently dropped on stacks without the JsonAlias fix (issue #1674).
          assignes: [PHASE0_SUB2_UUID],
          comments: 'E2E trigger test — assigning to PHASE0_SUB2 so SLA can breach',
        },
      }),
    });
    const assignData = await assertOk(assignResp, 'PGR ASSIGN as PHASE0_SUP');
    expect(assignData.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');
    console.log(`[${serviceRequestId}] ASSIGNED to ${PHASE0_SUB2_UUID} → PENDINGATLME`);
  });

  test('2 — patch EscalationConfig SLA to make the just-assigned complaint already-breached', {
    annotation: {
      type: 'description',
      description: `Without this patch the scheduler will SKIP the complaint with SLA_NOT_BREACHED. We pin defaultSlaByLevel to [60s, 60s, 60s] so that the moment the trigger fires (after the persister catches up + a sub-second sleep) every level's SLA is short enough that the freshly-assigned complaint qualifies for escalation.

Steps:
1. updateEscalationConfig with defaultSlaByLevel = [60000, 60000, 60000].
2. Sleep 5s — MDMS persister is async (HTTP 202; Kafka → egov-persister).
3. Re-search EscalationConfig and assert defaultSlaByLevel[0] === 60000 (defends against silent persister failures).

A failure here usually means egov-persister is stalled / not consuming the egov-mdms-create-v2 topic.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@layer:api', '@persona:admin'] }, async () => {
    await updateEscalationConfig(adminToken, adminUserInfo, originalEscalationRecord, {
      defaultSlaByLevel: TEST_SLA_MS,
    });
    await new Promise((r) => setTimeout(r, 5_000));

    const after = await searchEscalationConfig(adminToken);
    expect(after?.data?.defaultSlaByLevel?.[0], 'persister should have applied SLA[0] = 60000').toBe(60_000);
    console.log(`EscalationConfig SLA pinned to ${JSON.stringify(after.data.defaultSlaByLevel)} (persister caught up)`);
  });

  test('3 — POST /escalation/_trigger scoped to our srid; assert response counters', {
    annotation: {
      type: 'description',
      description: `Hits the new synchronous endpoint. ADMIN/ke carries SUPERUSER so the auth guard passes. The endpoint auto-injects AUTO_ESCALATE on the caller's roles so the manual-ESCALATE comment validator stays out of the way.

Steps:
1. Capture triggerStartedAt (ISO) so the log scrape can scope --since.
2. POST /pgr-services/escalation/_trigger with { tenantId: ROOT_TENANT, serviceRequestIds: [our srid] } as ADMIN.
3. Assert response status 200, body.scanned >= 1, body.escalated >= 1.
4. Find the outcome for our srid in body.details; assert action === 'ESCALATED'.

This is the canonical "did the scheduler actually fire?" assertion — synchronous, no polling.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@layer:api', '@persona:admin'] }, async () => {
    triggerStartedAt = new Date(Date.now() - 30_000).toISOString();

    const resp = await fetch(`${BASE_URL}/pgr-services/escalation/_trigger`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo, ts: Date.now() },
        tenantId: ROOT_TENANT,
        serviceRequestIds: [serviceRequestId],
      }),
    });

    // If the endpoint isn't deployed yet (Phase 5 Task A blocked) this comes
    // back as a 400 "No static resource" — surface that clearly rather than
    // letting the test fail later with a confusing JSON-shape error.
    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 400 && text.includes('No static resource')) {
        throw new Error(
          `/escalation/_trigger not deployed on Bomet — pgr-services image is the pre-escalation build. ` +
          `Phase 5 Task A noted the amd64 rebuild was in progress. Raw response: ${text.slice(0, 200)}`,
        );
      }
      throw new Error(`/escalation/_trigger HTTP ${resp.status}: ${text.slice(0, 500)}`);
    }

    const body = (await resp.json()) as {
      scanned: number;
      escalated: number;
      skipped: number;
      skipBreakdown?: Record<string, number>;
      details?: Array<{ serviceRequestId: string; action: string; reason: string; detail?: string }>;
    };

    console.log(`Trigger response: scanned=${body.scanned}, escalated=${body.escalated}, skipped=${body.skipped}`);
    console.log(`  skipBreakdown=${JSON.stringify(body.skipBreakdown ?? {})}`);

    expect(body.scanned, 'should have scanned >= 1 complaint').toBeGreaterThanOrEqual(1);
    expect(body.escalated, 'should have escalated >= 1 complaint').toBeGreaterThanOrEqual(1);

    const ours = (body.details ?? []).find((d) => d.serviceRequestId === serviceRequestId);
    expect(ours, `details should include outcome for ${serviceRequestId}; got ${JSON.stringify(body.details)}`)
      .toBeTruthy();
    expect(ours!.action).toBe('ESCALATED');
  });

  test('4 — re-fetch complaint; assert assignee + status flipped to PHASE0_SUP / PENDINGATSUPERVISOR', {
    annotation: {
      type: 'description',
      description: `Confirms the trigger actually walked the HRMS reportingTo chain and rewrote the PGR row. PHASE0_SUB2.reportingTo = PHASE0_SUP, so escalation level 1 must target PHASE0_SUP. The workflow self-loop also flips the application status into PENDINGATSUPERVISOR because the supervisor is now the assignee.

Steps:
1. fetchComplaint with admin token; assert truthy.
2. Assert applicationStatus === 'PENDINGATSUPERVISOR'.
3. Pull the current assignee uuid from workflow.assignes (fallback to additionalDetail.lastAssignedTo); assert it equals PHASE0_SUP_UUID.

If status is still PENDINGATLME the scheduler didn't actually transition the workflow — likely a SYSTEM-role grant gap on PGR's ESCALATE action.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@layer:api', '@persona:admin'] }, async () => {
    // Small wait for the workflow update to flush through Kafka → persister
    await new Promise((r) => setTimeout(r, 2_000));

    const svc = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
    expect(svc, 'complaint must be re-readable').toBeTruthy();
    console.log(`Post-trigger state: status=${svc.applicationStatus}, additionalDetail=${JSON.stringify(svc.additionalDetail)}`);

    expect(svc.applicationStatus).toBe('PENDINGATSUPERVISOR');

    // Look at workflow.assignes if PGR populated it; otherwise fall back to
    // the workflow process-instance search.
    const wfAssignees: string[] = (svc.workflow?.assignes ?? []).map((a: any) => a.uuid);
    if (wfAssignees.length > 0) {
      expect(wfAssignees).toContain(PHASE0_SUP_UUID);
    } else {
      // Fallback: ask workflow-v2 directly
      const histResp = await fetch(
        `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?tenantId=${TENANT}&businessIds=${serviceRequestId}&history=true`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo } }),
        },
      );
      const hist = await histResp.json();
      const latest = (hist.ProcessInstances ?? [])[0];
      const piAssignees = (latest?.assignes ?? []).map((a: any) => a.uuid);
      expect(piAssignees, `workflow processInstance assignes for ${serviceRequestId}`).toContain(PHASE0_SUP_UUID);
    }
  });

  test('5 — OTEL: pull trace_id from logs, fetch trace, assert escalation spans', {
    annotation: {
      type: 'description',
      description: `Closes the loop on observability: every successful escalation should emit two annotated spans — EscalationScheduler.scanAndEscalate (resource-level counters) and EscalationService.escalateComplaint (per-complaint metadata). Both must be retrievable from Tempo by the trace_id pgr-services logged for our srid.

Steps:
1. setTimeout 60s — Tempo ingest can take a few seconds; we retry inside getTempoTrace too.
2. extractTraceIdFromBometLogs(serviceRequestId, triggerStartedAt) — SSH greps the container logs.
3. If no trace_id found, log the surrounding log window and fail with a clear message.
4. getTempoTrace(traceId) with retries.
5. findSpansByAttribute on escalation.scanned and escalation.escalated; assert at least one such span exists with values >= 1 (the scheduler span).
6. findSpansByAttribute on complaint.serviceRequestId; assert at least one span has it == our srid (the service span); then assert escalation.fromAssignee, escalation.toAssignee == PHASE0_SUP_UUID, escalation.fromLevel === 0, escalation.toLevel === 1.

This is the canary that the OTEL javaagent + scheduler/service @WithSpan wiring is intact end-to-end.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@area:otel', '@kind:lifecycle', '@layer:api', '@persona:admin'] }, async () => {
    test.setTimeout(60_000);

    // 1. Pull trace_id out of pgr-services logs. We filter on srid +
    //    EscalationService so we don't accidentally pick up an unrelated
    //    scheduler tick.
    const grepToken = `${serviceRequestId}`;
    const traceId = await extractTraceIdFromBometLogs(grepToken, triggerStartedAt);
    if (!traceId) {
      throw new Error(
        `No trace_id found in pgr-services logs for ${grepToken} since ${triggerStartedAt}. ` +
        `Either the OTEL javaagent is not attached, the MDC trace_id is missing from log4j format, ` +
        `or the escalation never produced a per-complaint log line.`,
      );
    }
    console.log(`OTEL trace_id for ${serviceRequestId}: ${traceId}`);

    // 2. Fetch the trace from Tempo (with retries, ingest is async)
    const trace = await getTempoTrace(traceId, 6, 2_500);

    // 3. Scheduler-level counters
    const schedSpans = findSpansByAttribute(trace, 'escalation.scanned');
    expect(schedSpans.length, 'expected at least one span carrying escalation.scanned').toBeGreaterThan(0);
    const sched = schedSpans[0];
    const scanned = getAttr(sched, 'escalation.scanned');
    const escalated = getAttr(sched, 'escalation.escalated');
    console.log(`Scheduler span: scanned=${scanned}, escalated=${escalated}`);
    expect(typeof scanned === 'number' && scanned >= 1, `escalation.scanned should be >= 1 (got ${scanned})`).toBe(true);
    expect(typeof escalated === 'number' && escalated >= 1, `escalation.escalated should be >= 1 (got ${escalated})`).toBe(true);

    // 4. Per-complaint span — find by serviceRequestId attribute matching our srid
    const sridSpans = findSpansByAttribute(trace, 'complaint.serviceRequestId')
      .filter((s) => getAttr(s, 'complaint.serviceRequestId') === serviceRequestId);
    expect(
      sridSpans.length,
      `expected an escalateComplaint span for ${serviceRequestId}; got spans=${JSON.stringify(
        findSpansByAttribute(trace, 'complaint.serviceRequestId').map((s) => getAttr(s, 'complaint.serviceRequestId')),
      )}`,
    ).toBeGreaterThan(0);
    const svcSpan = sridSpans[0];

    expect(getAttr(svcSpan, 'escalation.fromAssignee'), 'fromAssignee should be PHASE0_SUB2').toBe(PHASE0_SUB2_UUID);
    expect(getAttr(svcSpan, 'escalation.toAssignee'), 'toAssignee should be PHASE0_SUP').toBe(PHASE0_SUP_UUID);
    expect(getAttr(svcSpan, 'escalation.fromLevel'), 'fromLevel should be 0').toBe(0);
    expect(getAttr(svcSpan, 'escalation.toLevel'), 'toLevel should be 1').toBe(1);
    console.log(`Per-complaint span OTEL attrs verified for ${serviceRequestId}`);
  });
});
