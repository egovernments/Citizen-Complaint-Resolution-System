/**
 * PGR escalation — reopening resets the ladder; an escalated complaint stays workable.
 *
 * prepareUpdate()'s REOPEN branch zeroes the level, re-anchors
 * escalationWindowStartedAt to now, and clears lastEscalatedAt / escalatedFrom /
 * escalatedTo / escalationTrigger. It uses `now` rather than the original
 * createdTime so an old complaint doesn't immediately consume every rung. The
 * reset holds on both halves: level reconciliation only counts ESCALATE entries
 * recorded since the anchor. No spec drove a real reopen before this one — the
 * two existing reopen specs stub the workflow read with page.route.
 *
 * Second theme: after an escalation the assigned state grants REASSIGN, RESOLVE,
 * ESCALATE and COMMENT but not REJECT, which only exists on the two assignment
 * queues. Since ESCALATE is a self-loop, an escalated complaint can never be
 * rejected — a workflow gap rather than a code one.
 *
 * Personas: RESOLVE goes through seed.ts's driveToResolved(), which finds a
 * credentialed PGR_LME instead of assuming ADMIN holds the role. REOPEN runs as
 * the filing citizen — an employee could also do it (the ownership check is
 * type-gated) but this is the suite's only citizen-reopen path. RATE is genuinely
 * filer-bound.
 *
 * Covers ESC/013 026 027 054 055 056 060 065 067 068 069.
 */
import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import { expectApiError } from '../utils/api-errors';
import { CITIZEN_FIXTURE_PATH, provisionFreshCitizen, readProvisionedCitizen, type ProvisionedCitizen } from '../utils/citizen-provision';
import { BASE_URL, TENANT, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { getPersona, resolveSeedPlan } from '../utils/personas';
import { getProfile } from '../utils/profile';
import { driveToResolved, seedComplaintAsCitizen } from '../utils/seed';

let adminToken: string;
let adminUserInfo: Record<string, unknown>;
let skipReason = '';

let assignedState = '';
let reassignQueue = '';
const escalateStates = new Map<string, string>();
const rejectableStates = new Set<string>();
/** applicationStatus -> REOPEN's destination, for every state granting it. */
const reopenableStates = new Map<string, string>();
/** applicationStatus -> RATE's destination. */
const rateableStates = new Map<string, string>();
let maxDepth = 0;
let department = '';
let chain: any[] = [];
let patchableDepth = 0;
let inDepartmentCount = 0;
let citizen: ProvisionedCitizen | null = null;

const created = new Set<string>();
const originalReportingTo = new Map<string, { emp: any; byId: Map<string, string | null> }>();
const TERMINAL = new Set(['REJECTED', 'CLOSEDAFTERREJECTION', 'CLOSEDAFTERRESOLUTION', 'CANCELLED']);

const rq = () => ({ apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo });
const authed = () => ({ Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' });

async function assertOk(resp: Response, context: string): Promise<any> {
  const body = await resp.json();
  if (!resp.ok) throw new Error(`${context}: HTTP ${resp.status} — ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

/** Live action list for a state — the positive control that makes an absence meaningful. */
let actionsByState = new Map<string, string[]>();

async function discoverWorkflow(): Promise<void> {
  const resp = await fetch(
    `${BASE_URL}/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=${encodeURIComponent(TENANT)}&businessServices=PGR`,
    { method: 'POST', headers: authed(), body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: adminToken } }) },
  );
  const biz = ((await resp.json()) as any)?.BusinessServices?.[0];
  if (!biz) throw new Error(`no PGR businessService on ${TENANT} (HTTP ${resp.status})`);
  const statusOf = new Map<string, string>();
  for (const s of biz.states ?? []) if (s.uuid) statusOf.set(s.uuid, s.applicationStatus ?? '');
  actionsByState = new Map();
  for (const s of biz.states ?? []) {
    const from = s.applicationStatus;
    if (!from) continue;
    const active = (s.actions ?? []).filter((a: any) => a.active !== false);
    actionsByState.set(from, active.map((a: any) => a.action));
    for (const a of active) {
      const to = statusOf.get(a.nextState) ?? '';
      if (a.action === 'ASSIGN' && !assignedState) assignedState = to;
      if (a.action === 'REASSIGN' && !reassignQueue) reassignQueue = to;
      if (a.action === 'ESCALATE') escalateStates.set(from, to);
      if (a.action === 'REJECT') rejectableStates.add(from);
      if (a.action === 'REOPEN') reopenableStates.set(from, to);
      if (a.action === 'RATE') rateableStates.set(from, to);
    }
  }
}

async function discoverMaxDepth(): Promise<number> {
  const resp = await fetch(`${BASE_URL}/egov-mdms-service/v1/_search?tenantId=${encodeURIComponent(TENANT)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: adminToken },
      MdmsCriteria: { tenantId: TENANT, moduleDetails: [{ moduleName: 'RAINMAKER-PGR', masterDetails: [{ name: 'EscalationConfig' }] }] },
    }),
  });
  if (!resp.ok) return 0;
  const rows: any[] = ((await resp.json()) as any)?.MdmsRes?.['RAINMAKER-PGR']?.EscalationConfig ?? [];
  return Number((rows.find((r) => r?.code === 'DEFAULT') ?? rows[0])?.maxDepth ?? 0);
}

async function searchEmployees(): Promise<any[]> {
  const PAGE = 100;
  const CEILING = 2000;
  const out: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const resp = await fetch(
      `${BASE_URL}/egov-hrms/employees/_search?tenantId=${encodeURIComponent(TENANT)}&offset=${offset}&limit=${PAGE}`,
      { method: 'POST', headers: authed(), body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: adminToken } }) },
    );
    const batch: any[] = ((await resp.json()) as any).Employees || [];
    out.push(...batch);
    if (batch.length < PAGE) break;
    if (out.length >= CEILING) throw new Error(`searchEmployees: hit the ${CEILING}-record ceiling on ${TENANT} with a full page still coming`);
  }
  return out;
}

const currentAssignments = (emp: any) => (emp?.assignments || []).filter((a: any) => a.isCurrentAssignment);

/** Keyed on the assignment id ALONE — see the note in escalation-guards.spec.ts. */
function remember(emp: any): void {
  if (originalReportingTo.has(emp.uuid)) return;
  const byId = new Map<string, string | null>();
  for (const a of currentAssignments(emp)) {
    if (a.id === undefined || a.id === null) {
      throw new Error(`${emp.code}: a current HRMS assignment has no id, so its reportingTo cannot be restored — refusing to mutate it`);
    }
    byId.set(String(a.id), a.reportingTo ?? null);
  }
  originalReportingTo.set(emp.uuid, { emp, byId });
}

async function setReportingTo(emp: any, uuid: string | null, why: string): Promise<void> {
  const fresh = (await searchEmployees()).find((e) => e.uuid === emp.uuid) ?? emp;
  const rows = currentAssignments(fresh);
  if (rows.length === 0) throw new Error(`${fresh.code} has no current HRMS assignment (${why})`);
  for (const a of rows) a.reportingTo = uuid;
  await assertOk(
    await fetch(`${BASE_URL}/egov-hrms/employees/_update?tenantId=${encodeURIComponent(TENANT)}`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ RequestInfo: rq(), Employees: [fresh] }),
    }),
    `HRMS _update (${why}: ${fresh.code}, ${rows.length} current)`,
  );
  const after = currentAssignments((await searchEmployees()).find((e) => e.uuid === emp.uuid) ?? {});
  const values = [...new Set(after.map((a: any) => a.reportingTo ?? null))];
  expect(values, `${why}: ${fresh.code} read back as ${JSON.stringify(values)} — the service reads element [0], so a partial write is unusable`).toEqual([uuid]);
}

async function restoreReportingTo(): Promise<void> {
  for (const { emp, byId } of originalReportingTo.values()) {
    try {
      const fresh = (await searchEmployees()).find((e) => e.uuid === emp.uuid) ?? emp;
      const rows = currentAssignments(fresh);
      if (!rows.length) continue;
      for (const a of rows) if (byId.has(String(a.id))) a.reportingTo = byId.get(String(a.id)) ?? null;
      await assertOk(
        await fetch(`${BASE_URL}/egov-hrms/employees/_update?tenantId=${encodeURIComponent(TENANT)}`, {
          method: 'POST', headers: authed(), body: JSON.stringify({ RequestInfo: rq(), Employees: [fresh] }),
        }),
        `HRMS restore (${fresh.code})`,
      );
    } catch (err) {
      console.warn(`could not restore reportingTo for ${emp.code}: ${String(err).slice(0, 200)}`);
    }
  }
}

async function fetchComplaint(srid: string, token = adminToken, userInfo: any = adminUserInfo): Promise<any> {
  const resp = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${encodeURIComponent(TENANT)}&serviceRequestId=${encodeURIComponent(srid)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo } }),
    },
  );
  return ((await resp.json()) as any)?.ServiceWrappers?.[0]?.service ?? null;
}

async function act(srid: string, workflow: Record<string, unknown>): Promise<Response> {
  const service = await fetchComplaint(srid);
  if (!service) throw new Error(`${srid} not readable on ${TENANT}`);
  return fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${encodeURIComponent(TENANT)}`, {
    method: 'POST', headers: authed(), body: JSON.stringify({ RequestInfo: rq(), service, workflow }),
  });
}

const citizenUserInfo = (c: ProvisionedCitizen) => ({
  uuid: c.uuid, type: 'CITIZEN', tenantId: c.tenantId, userName: c.mobile, name: c.name, mobileNumber: c.mobile,
});

/** Drive an action as the filing citizen — REOPEN's coverage choice and RATE's requirement. */
async function actAsCitizen(srid: string, workflow: Record<string, unknown>, mutate?: (s: any) => void): Promise<Response> {
  if (!citizen) throw new Error('no citizen identity — beforeAll did not resolve one');
  const userInfo = citizenUserInfo(citizen);
  const service = await fetchComplaint(srid, citizen.token, userInfo);
  if (!service) throw new Error(`${srid} not readable by the filing citizen — a citizen's search is scoped to its own accountId`);
  mutate?.(service);
  return fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${encodeURIComponent(TENANT)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${citizen.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: citizen.token, userInfo }, service, workflow }),
  });
}

async function levelOf(srid: string): Promise<number> {
  return Number((await fetchComplaint(srid))?.additionalDetail?.escalationLevel ?? 0);
}

async function newComplaint(note: string): Promise<string> {
  const c = await seedComplaintAsCitizen({ description: `escalation-lifecycle ${note} — ${new Date().toISOString()}` });
  created.add(c.srid);
  return c.srid;
}

async function assignTo(srid: string, assigneeUuid: string, note: string): Promise<any> {
  const body = await assertOk(
    await act(srid, { action: 'ASSIGN', assignes: [assigneeUuid], comments: `escalation-lifecycle ${note}` }),
    `ASSIGN ${srid}`,
  );
  const svc = body.ServiceWrappers[0].service;
  expect(svc.applicationStatus).toBe(assignedState);
  return svc;
}

async function ensureHeldByAnchor(srid: string): Promise<void> {
  const svc = await fetchComplaint(srid);
  if (svc.applicationStatus === assignedState) {
    const holders = (svc.workflow?.assignes ?? []).map((a: any) => (typeof a === 'string' ? a : a?.uuid));
    if (holders.length === 1 && holders[0] === chain[0].uuid) return;
    await assertOk(await act(srid, { action: 'REASSIGN', comments: 'reset' }), `REASSIGN ${srid}`);
  }
  await assignTo(srid, chain[0].uuid, 'reset');
}

async function ensureEscalatedTo(srid: string, level: number): Promise<void> {
  for (let guard = 0; guard <= maxDepth + 1; guard++) {
    if ((await levelOf(srid)) >= level) return;
    await assertOk(await act(srid, { action: 'ESCALATE', comments: `toward level ${level}` }), `ESCALATE ${srid}`);
  }
  throw new Error(`${srid} did not reach level ${level} within ${maxDepth + 1} hops`);
}

async function ensureCitizen(): Promise<ProvisionedCitizen> {
  const existing = readProvisionedCitizen();
  if (existing && (await citizenTokenWorks(existing))) return existing;
  if (existing) console.warn('citizen-fixture.json holds a token that no longer works — re-provisioning');
  const fresh = await provisionFreshCitizen();
  writeFileSync(CITIZEN_FIXTURE_PATH, JSON.stringify(fresh, null, 2));
  return fresh;
}

async function citizenTokenWorks(c: ProvisionedCitizen): Promise<boolean> {
  try {
    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_search?tenantId=${encodeURIComponent(TENANT)}&limit=1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: c.token, userInfo: citizenUserInfo(c) } }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function drain(srid: string): Promise<'drained' | 'already' | 'stuck'> {
  const svc = await fetchComplaint(srid);
  if (!svc) return 'already';
  const status = svc.applicationStatus;
  if (TERMINAL.has(status)) return 'already';
  if (!rejectableStates.has(status)) {
    if (status !== assignedState || !reassignQueue || !rejectableStates.has(reassignQueue)) return 'stuck';
    await assertOk(await act(srid, { action: 'REASSIGN', comments: 'cleanup' }), `cleanup REASSIGN ${srid}`);
  }
  await assertOk(await act(srid, { action: 'REJECT', comments: 'Cleaned up by escalation-lifecycle' }), `cleanup REJECT ${srid}`);
  return 'drained';
}

// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  const auth = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
  adminToken = auth.access_token;
  adminUserInfo = auth.UserRequest as Record<string, unknown>;
  if (!adminToken) {
    skipReason = `cannot log in to ${ROOT_TENANT}`;
    return;
  }

  await discoverWorkflow();
  if (!assignedState) {
    skipReason = `the PGR workflow on ${TENANT} defines no active ASSIGN action`;
    return;
  }
  maxDepth = await discoverMaxDepth();

  const plan = await resolveSeedPlan();
  if ('error' in plan) {
    skipReason = `${TENANT} cannot supply a complaint to escalate`;
    return;
  }
  department = getProfile().complaintTypes.services.find((s) => s.serviceCode === plan.serviceCode)?.department ?? '';
  if (!department) {
    skipReason = `${TENANT} has no department for the seed complaint type`;
    return;
  }

  const assigneeRoles = new Set(getProfile().workflow.pgr.assign?.assigneeRoles ?? []);
  const SCRATCH = /(^|[._])PW[A-Z_]/i;
  const inDepartment = (await searchEmployees()).filter(
    (e) =>
      (e.assignments || []).some((a: any) => a.department === department) &&
      currentAssignments(e).length > 0 &&
      e.user?.userName !== ADMIN_USER &&
      !(SCRATCH.test(String(e.code ?? '')) || SCRATCH.test(String(e.user?.userName ?? ''))),
  );
  inDepartmentCount = inDepartment.length;
  chain = inDepartment.filter(
    (e) => currentAssignments(e).length === 1 && (assigneeRoles.size === 0 || (e.user?.roles ?? []).some((r: any) => assigneeRoles.has(r.code))),
  );
  patchableDepth = chain.length;
  if (patchableDepth < 2) {
    skipReason =
      `department '${department}' on ${TENANT} has ${inDepartmentCount} employee(s) but only ${patchableDepth} ` +
      `patchable (exactly one current assignment + an ASSIGN-eligible role) — an escalation needs at least 2`;
    return;
  }

  citizen = await ensureCitizen();
  console.log(
    `[lifecycle] ${TENANT}/${department} assigned=${assignedState} reopenFrom=${JSON.stringify([...reopenableStates.keys()])} ` +
      `maxDepth=${maxDepth} patchable=${patchableDepth}/${inDepartmentCount} chain=${chain.map((e) => e.code).join(' -> ')} ` +
      `citizen=${citizen.mobile}`,
  );
});

test.afterAll(async () => {
  await restoreReportingTo();
  if (process.env.KEEP_TEST_COMPLAINTS === '1') {
    console.log(`[lifecycle] KEEP_TEST_COMPLAINTS=1 — leaving ${created.size} complaint(s): ${[...created].join(', ')}`);
    return;
  }
  const tally = { drained: 0, already: 0, stuck: 0, failed: 0 };
  for (const srid of created) {
    try {
      tally[await drain(srid)] += 1;
    } catch (err) {
      tally.failed += 1;
      console.warn(`could not drain ${srid}: ${String(err).slice(0, 200)}`);
    }
  }
  console.log(`[lifecycle] cleanup: ${JSON.stringify(tally)}`);
});

// ---------------------------------------------------------------------------
// Chain A — the reopen reset
// ---------------------------------------------------------------------------

test.describe('PGR escalation lifecycle — the reopen reset', () => {
  let srid = '';

  test.beforeAll(async () => {
    if (skipReason || !citizen) return;
    srid = await newComplaint('reopen');
    remember(chain[0]);
    await setReportingTo(chain[0], chain[1].uuid, 'reopen setup');
    await assignTo(srid, chain[0].uuid, 'reopen');
  });

  test('reopening clears the escalation record and re-anchors the clock', {
    annotation: {
      type: 'description',
      description: `Covers ESC/054. The first spec in this suite to drive a REAL reopen — the two existing reopen specs stub the workflow read and never take the transition, so this branch has never been executed by a test.

Steps:
1. Escalate once. Note the level, the target, and that no clock anchor is stored yet.
2. RESOLVE via driveToResolved(), which discovers a credentialed PGR_LME.
3. REOPEN as the citizen that filed it.
4. Assert escalationLevel is back to 0.
5. Assert escalationWindowStartedAt is now PRESENT, at the reopen rather than the original creation.
6. Assert lastEscalatedAt, escalatedFrom, escalatedTo and escalationTrigger are all cleared.

Step 5 is the substance.`,
    },
    tag: ['@persona:citizen', '@area:pgr', '@layer:api', '@kind:lifecycle'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    test.skip(!citizen, `no citizen identity could be provisioned on ${TENANT}`);
    test.skip(
      reopenableStates.size === 0,
      `no state on ${TENANT} grants an active REOPEN action — states are ${JSON.stringify([...actionsByState.keys()])}`,
    );

    await ensureHeldByAnchor(srid);
    await ensureEscalatedTo(srid, 1);
    const before = await fetchComplaint(srid);
    expect(before.additionalDetail.escalatedTo, 'the escalation landed on the wired manager').toBe(chain[1].uuid);
    expect(before.additionalDetail.escalationWindowStartedAt, 'no anchor is stored before a reopen').toBeUndefined();

    await driveToResolved(srid);
    const resolved = await fetchComplaint(srid);
    test.skip(
      !reopenableStates.has(resolved.applicationStatus),
      `${TENANT} does not grant REOPEN on '${resolved.applicationStatus}' — REOPEN is on ${JSON.stringify([...reopenableStates.keys()])}`,
    );

    const reopenAt = Date.now();
    const reopened = await assertOk(await actAsCitizen(srid, { action: 'REOPEN', comments: 'citizen reopen' }), 'REOPEN as the filing citizen');
    const detail = reopened.ServiceWrappers[0].service.additionalDetail ?? {};

    expect(Number(detail.escalationLevel ?? 0), 'a reopened complaint starts a fresh ladder at rung zero').toBe(0);

    const anchorAt = Number(detail.escalationWindowStartedAt ?? 0);
    expect(anchorAt, 'a reopen must store a fresh escalation window anchor').toBeGreaterThan(0);
    expect(
      anchorAt,
      'the window starts at the reopen, not at the original creation — otherwise an old complaint would immediately consume every rung',
    ).toBeGreaterThanOrEqual(reopenAt - 120_000);
    expect(anchorAt).toBeGreaterThan(Number(before.auditDetails?.createdTime ?? 0));

    for (const field of ['lastEscalatedAt', 'escalatedFrom', 'escalatedTo', 'escalationTrigger']) {
      expect(detail[field], `${field} belongs to the previous cycle and must be cleared on reopen`).toBeUndefined();
    }
  });

  test('a reopened complaint cannot escalate until somebody holds it', {
    annotation: {
      type: 'description',
      description: `Covers ESC/056. A reopen lands the complaint in an assignment queue — a state with no assignee and, on this workflow, no ESCALATE action either. So a reopened complaint is doubly ineligible: nobody to escalate from, and no escalate action on the state.

Reuses this chain's complaint in exactly the state the previous test leaves it. The precondition is re-established idempotently, because a worker restart would have re-filed the complaint at level 0 and assigned.

Steps:
1. Ensure the complaint is reopened and unheld at level 0.
2. ESCALATE. Assert it is refused and the level stays 0.
3. ASSIGN to the anchor, then ESCALATE. Assert it succeeds at level 1.

Step 3 is the control.`,
    },
    tag: ['@persona:citizen', '@area:pgr', '@layer:api', '@kind:edge-case'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    test.skip(!citizen, `no citizen identity could be provisioned on ${TENANT}`);
    test.skip(reopenableStates.size === 0, `no state on ${TENANT} grants an active REOPEN action`);

    // Idempotent: reach "reopened and unheld" whatever the previous test left.
    let svc = await fetchComplaint(srid);
    if (!reopenableStates.has(svc.applicationStatus) && svc.applicationStatus !== [...reopenableStates.values()][0]) {
      await ensureHeldByAnchor(srid);
      await driveToResolved(srid);
      svc = await fetchComplaint(srid);
    }
    if (reopenableStates.has(svc.applicationStatus)) {
      await assertOk(await actAsCitizen(srid, { action: 'REOPEN', comments: 'reopen for the unheld case' }), 'REOPEN');
      svc = await fetchComplaint(srid);
    }

    const queue = svc.applicationStatus;
    expect(Number(svc.additionalDetail?.escalationLevel ?? 0), 'a reopened complaint is at rung zero').toBe(0);

    const refused = await act(srid, { action: 'ESCALATE', comments: 'escalate while unheld' });
    expect(refused.ok, `a reopened complaint sitting unheld in '${queue}' cannot be escalated`).toBe(false);
    expect(Number((await fetchComplaint(srid)).additionalDetail?.escalationLevel ?? 0)).toBe(0);

    await assignTo(srid, chain[0].uuid, 'reopen-unheld control');
    const ok = await assertOk(await act(srid, { action: 'ESCALATE', comments: 'escalate once held' }), 'ESCALATE once held');
    expect(
      Number(ok.ServiceWrappers[0].service.additionalDetail.escalationLevel),
      'control: the identical call succeeds once the complaint has a holder',
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Chain B — the spent ladder
// ---------------------------------------------------------------------------

test.describe('PGR escalation lifecycle — the spent ladder', () => {
  let srid = '';
  let line: any[] = [];

  test.beforeAll(async () => {
    if (skipReason || !citizen) return;
    if (patchableDepth < maxDepth + 1 || maxDepth <= 0) return;
    line = chain.slice(0, maxDepth + 1);
    for (let i = 0; i < line.length - 1; i++) {
      remember(line[i]);
      await setReportingTo(line[i], line[i + 1].uuid, `spent-ladder link ${i}`);
    }
    srid = await newComplaint('spent-ladder');
    await assignTo(srid, line[0].uuid, 'spent-ladder');
  });

  test('a ladder spent before a reopen is available again after it', {
    annotation: {
      type: 'description',
      description: `Covers ESC/055: escalations from before a reopening do not count against the new cycle.

The reset is genuine on both halves. The level is zeroed, and — the part worth asserting — the level reconciliation counts only ESCALATE entries recorded since the clock anchor, so pre-reopen hops drop out of the new cycle's count rather than being re-counted from workflow history. A reopen that zeroed the level but failed to re-anchor the window would look correct here until the next escalation jumped straight back to the maximum.

Steps:
1. Exhaust the ladder to maxDepth, then confirm it is provably spent: one more hop must be refused with ESCALATION_MAX_DEPTH.
2. RESOLVE, then REOPEN as the citizen.
3. Assert the level is 0 AND that the workflow-history count since the new anchor is 0 — the two-part check that distinguishes a real reset from a zeroed counter over a stale anchor.
4. ASSIGN and ESCALATE. Assert it succeeds at level 1.

Step 1's refusal is the control: without it, step 4 succeeding would not distinguish "the reopen reset the counter" from "the ladder was never full".`,
    },
    tag: ['@persona:citizen', '@area:pgr', '@layer:api', '@kind:lifecycle'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    test.skip(!citizen, `no citizen identity could be provisioned on ${TENANT}`);
    test.skip(maxDepth <= 0, `escalation is not configured on ${TENANT}`);
    test.skip(
      patchableDepth < maxDepth + 1,
      `department '${department}' on ${TENANT} has ${patchableDepth} patchable employee(s) of ${inDepartmentCount}, ` +
        `but spending every rung with maxDepth=${maxDepth} needs ${maxDepth + 1}`,
    );
    test.skip(reopenableStates.size === 0, `no state on ${TENANT} grants an active REOPEN action`);

    await ensureHeldByAnchor(srid);
    await ensureEscalatedTo(srid, maxDepth);
    await expectApiError(
      await act(srid, { action: 'ESCALATE', comments: 'one hop too many' }),
      'ESCALATION_MAX_DEPTH',
      `control: the ladder must be provably spent before the reopen (maxDepth=${maxDepth})`,
    );

    await driveToResolved(srid);
    const resolved = await fetchComplaint(srid);
    test.skip(
      !reopenableStates.has(resolved.applicationStatus),
      `${TENANT} does not grant REOPEN on '${resolved.applicationStatus}'`,
    );

    const reopened = await assertOk(await actAsCitizen(srid, { action: 'REOPEN', comments: 'reopen after exhausting' }), 'REOPEN');
    const detail = reopened.ServiceWrappers[0].service.additionalDetail ?? {};
    expect(Number(detail.escalationLevel ?? 0), 'the stored level resets').toBe(0);

    const anchorAt = Number(detail.escalationWindowStartedAt ?? 0);
    expect(anchorAt, 'and the window is re-anchored, which is what excludes the old hops from the new count').toBeGreaterThan(0);
    const sinceAnchor = await escalatesSince(srid, anchorAt);
    expect(
      sinceAnchor,
      'no ESCALATE entry should count toward the new cycle — a zeroed level over a stale anchor would still be at the maximum',
    ).toBe(0);

    await assignTo(srid, chain[0].uuid, 'after reopen');
    const ok = await assertOk(await act(srid, { action: 'ESCALATE', comments: 'first hop of the new cycle' }), 'ESCALATE after reopen');
    expect(
      Number(ok.ServiceWrappers[0].service.additionalDetail.escalationLevel),
      'the new cycle gets a full ladder; pre-reopen hops do not count against it',
    ).toBe(1);
  });
});

/** ESCALATE transitions recorded at or after `anchor` — the window the service itself counts. */
async function escalatesSince(srid: string, anchor: number): Promise<number> {
  const resp = await fetch(
    `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?tenantId=${encodeURIComponent(TENANT)}&businessIds=${encodeURIComponent(srid)}&history=true`,
    { method: 'POST', headers: authed(), body: JSON.stringify({ RequestInfo: rq() }) },
  );
  const instances = ((await resp.json()) as any).ProcessInstances || [];
  return instances.filter((p: any) => p.action === 'ESCALATE' && Number(p.auditDetails?.createdTime ?? 0) >= anchor).length;
}

// ---------------------------------------------------------------------------
// Chain C — holder precedence, then post-escalation access
// ---------------------------------------------------------------------------

test.describe('PGR escalation lifecycle — post-escalation', () => {
  let srid = '';

  test.beforeAll(async () => {
    if (skipReason) return;
    srid = await newComplaint('post-escalation');
    remember(chain[0]);
    await setReportingTo(chain[0], chain[1].uuid, 'post-escalation setup');
  });

  test('escalation follows the workflow holder, not the complaint record', {
    annotation: {
      type: 'description',
      description: `Covers ESC/013. The service reads its current assignees from the workflow process instance, deliberately, rather than from the copy PGR keeps on the complaint. Proving that needs the two sources made to disagree.

The lever is already used elsewhere in the suite: tests/lifecycle/pgr-sla-auto-escalate.spec.ts assigns through the raw egov-wf _transition endpoint precisely because PGR's own _update wraps self-loops and drops assignes. Doing the ASSIGN that way populates the workflow's assignee list while leaving PGR's assignment metadata unwritten.

Steps:
1. Assign through the raw workflow _transition, asserting on the TRANSITION RESPONSE — not on a re-read of PGR's index, which lags behind a write and would report the old state.
2. Poll the workflow process-instance search until it shows the anchor as a current assignee.
3. Assert PGR's own assignment stamp (assignmentChangeSource) is still absent — the observable disagreement between the two sources.
4. ESCALATE, and assert escalatedFrom names the anchor while escalatedTo names its manager.

Step 4 is only reachable if the escalation resolved its holder from the workflow engine: PGR's record never learned who held it, so an implementation reading the complaint's own copy would have found no assignee and answered ESCALATION_NO_ASSIGNEE.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:regression'],
  }, async () => {
    test.skip(!!skipReason, skipReason);

    const transition = await fetch(`${BASE_URL}/egov-workflow-v2/egov-wf/process/_transition`, {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({
        RequestInfo: rq(),
        ProcessInstances: [{
          tenantId: TENANT,
          businessService: 'PGR',
          businessId: srid,
          moduleName: 'PGR',
          action: 'ASSIGN',
          comment: 'escalation-lifecycle raw workflow assign',
          assignes: [{ uuid: chain[0].uuid }],
        }],
      }),
    });
    const body = await assertOk(transition, 'raw egov-wf ASSIGN');
    const instance = body.ProcessInstances?.[0];
    expect(instance?.state?.applicationStatus, 'the transition response itself reports the new workflow state').toBe(assignedState);

    // The workflow is the source of truth here; PGR's index lags a write, so poll
    // the process search rather than re-reading the complaint.
    await expect
      .poll(async () => {
        const resp = await fetch(
          `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?tenantId=${encodeURIComponent(TENANT)}&businessIds=${encodeURIComponent(srid)}`,
          { method: 'POST', headers: authed(), body: JSON.stringify({ RequestInfo: rq() }) },
        );
        const latest = ((await resp.json()) as any).ProcessInstances?.[0];
        return (latest?.assignes ?? []).map((a: any) => a?.uuid);
      }, { timeout: 20_000, intervals: [500, 1000, 2000], message: 'the workflow should record the raw-transition assignee' })
      .toContain(chain[0].uuid);

    const afterRaw = await fetchComplaint(srid);
    expect(
      afterRaw.additionalDetail?.assignmentChangeSource,
      'PGR never processed this assignment, so its own assignment stamp is absent — the two sources now disagree',
    ).toBeUndefined();

    const ok = await assertOk(await act(srid, { action: 'ESCALATE', comments: 'escalate from the workflow holder' }), 'ESCALATE');
    const detail = ok.ServiceWrappers[0].service.additionalDetail;
    expect(
      detail.escalatedFrom,
      'the holder was read from the workflow engine, which is the only place it was ever recorded',
    ).toContain(chain[0].uuid);
    expect(detail.escalatedTo).toBe(chain[1].uuid);
    expect(Number(detail.escalationLevel)).toBe(1);
  });

  test('an escalated complaint can be resolved and rated, but never rejected', {
    annotation: {
      type: 'description',
      description: `Covers ESC/065, ESC/067, ESC/068 and ESC/069 — and records a finding the manual sheet leaves open.

ESC/068 asks whether a complaint can be rejected once escalated. On the deployed workflow it cannot: the assigned state grants REASSIGN, RESOLVE, ESCALATE and COMMENT, while REJECT exists only on the two assignment queues. Because ESCALATE is a self-loop there, an escalated complaint never leaves that state, so rejection is permanently out of reach. That is a workflow change to make, not a code one.

Steps:
1. Ensure the complaint is escalated and note its state.
2. Read the live action list for that state. Assert REJECT is absent while RESOLVE, REASSIGN and ESCALATE are present — the positive control that makes the absence meaningful rather than an empty read.
3. Attempt REJECT anyway. Assert it is refused.
4. Assert a credentialed PGR_LME can still read the complaint — access is role-gated, not assignee-gated, so an escalation does not lock out the people who could act before it (ESC/067).
5. RESOLVE, then RATE as the filing citizen. Assert the terminal state and that the escalation record survived (ESC/069).

On ESC/067's exact wording: the previous holder's own credentials are generally unknown to the suite — personas are discovered by role and most employee records have no known password — so this asserts the operative rule, that anyone holding the role which could act before the escalation still can, rather than impersonating that specific employee.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:lifecycle'],
  }, async () => {
    test.skip(!!skipReason, skipReason);

    await ensureHeldByAnchor(srid);
    await ensureEscalatedTo(srid, 1);
    const state = (await fetchComplaint(srid)).applicationStatus;

    const available = actionsByState.get(state) ?? [];
    expect(available.length, `control: the workflow must actually describe '${state}', or the absence below proves nothing`).toBeGreaterThan(0);
    for (const expected of ['RESOLVE', 'REASSIGN', 'ESCALATE']) {
      expect(available, `control: '${state}' should grant ${expected}`).toContain(expected);
    }
    expect(
      available,
      `'${state}' must not grant REJECT — an escalated complaint stays in this state, so rejection is unreachable. ` +
        `Actions found: ${JSON.stringify(available)}`,
    ).not.toContain('REJECT');

    const rejected = await act(srid, { action: 'REJECT', comments: 'reject an escalated complaint' });
    expect(rejected.ok, `REJECT is not configured on '${state}', so the attempt must be refused`).toBe(false);

    // ESC/067 — the escalation does not remove access from the role that held it.
    const lme = await getPersona('lme');
    const asLme = await fetchComplaint(srid, lme.token, lme.userInfo);
    expect(
      asLme,
      `a credentialed PGR_LME (${lme.username}) must still be able to read the complaint after it was escalated`,
    ).not.toBeNull();
    expect(Number(asLme.additionalDetail?.escalationLevel ?? 0)).toBeGreaterThan(0);

    // ESC/069 — resolve, then rate, with the escalation record intact.
    const levelBefore = await levelOf(srid);
    await driveToResolved(srid);
    const resolved = await fetchComplaint(srid);
    expect(Number(resolved.additionalDetail?.escalationLevel ?? 0), 'resolving must not erase the escalation record').toBe(levelBefore);

    const rateTarget = rateableStates.get(resolved.applicationStatus);
    test.skip(
      !rateTarget || !citizen,
      `${TENANT} does not grant RATE on '${resolved.applicationStatus}', or no citizen identity is available`,
    );
    const rated = await assertOk(
      await actAsCitizen(srid, { action: 'RATE', comments: 'rating' }, (s) => { s.rating = 5; }),
      'RATE as the filing citizen',
    );
    const finalSvc = rated.ServiceWrappers[0].service;
    expect(finalSvc.applicationStatus).toBe(rateTarget);
    expect(
      Number(finalSvc.additionalDetail?.escalationLevel ?? 0),
      'the escalation record survives all the way to the terminal state',
    ).toBe(levelBefore);
  });
});
