/**
 * PGR escalation — the refusal paths, each asserted by its error code.
 *
 * prepareEscalation() runs eight ordered checks; this file follows that order:
 * MAX_DEPTH, then the three automatic-only gates (STATUS_NOT_ELIGIBLE,
 * LEVEL_DISABLED, NOT_DUE), then NO_ASSIGNEE, TOP_OF_HIERARCHY,
 * HIERARCHY_CYCLE, INVALID_ESCALATION_ASSIGNEE.
 *
 * The automatic path is selected by RequestInfo.userInfo.type == "SYSTEM", so
 * the scheduler's gates are reachable without waiting for a scan. Those three
 * tests pair the automatic refusal with a manual call on the same complaint
 * that succeeds — manual skips the eligible-state list, the per-level switch
 * and the SLA, so the pair is what shows the gate is automatic-only.
 *
 * Complements pgr-escalation.spec.ts (happy path); its one negative case only
 * checks resp.ok === false, which an expired token would also satisfy.
 *
 * Covers ESC/001 008 010 012 014 016 017 018 030 032 033 034 036 038 039 053.
 *
 * State names, action roles, the escalate destination, maxDepth,
 * eligibleStatuses and enabledByLevel are all read at runtime — the deployed
 * workflow differs from the seed template (GRO dropped from ESCALATE; two
 * legacy supervisor states left orphaned). A hardcoded 'PENDINGATLME' here
 * would be a bug.
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import { expectApiError } from '../utils/api-errors';
import { BASE_URL, TENANT, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { resolveSeedPlan } from '../utils/personas';
import { getProfile } from '../utils/profile';
import { seedComplaintAsCitizen } from '../utils/seed';

// ---------------------------------------------------------------------------
// Deployment facts — every one resolved in beforeAll, none assumed.
// ---------------------------------------------------------------------------

let adminToken: string;
let adminUserInfo: Record<string, unknown>;

/** Non-empty when the deployment cannot host this file at all. One line, with evidence. */
let skipReason = '';

/** ASSIGN's destination — the state that carries a concrete assignee. */
let assignedState = '';
/** REASSIGN's destination — the queue a complaint falls back into. '' when absent. */
let reassignQueue = '';
/** applicationStatus -> ESCALATE's destination, for every state with an active ESCALATE. */
const escalateStates = new Map<string, string>();
/** States whose workflow grants REJECT — used only by the afterAll drain. */
const rejectableStates = new Set<string>();

let maxDepth = 0;
let eligibleStatuses: string[] = [];
let enabledByLevel: boolean[] = [];
let department = '';

/** Same-department, patchable, assignee-eligible employees. chain[0] is the anchor. */
let chain: any[] = [];
/** How many of the same-department pool HRMS will actually let us patch. */
let patchableDepth = 0;
/** Total same-department employees, patchable or not — for the skip evidence. */
let inDepartmentCount = 0;

/** Every complaint this file files, drained in afterAll. */
const created = new Set<string>();
/** reportingTo as found, per assignment id, restored in afterAll. */
const originalReportingTo = new Map<string, { emp: any; byId: Map<string, string | null> }>();

const TERMINAL = new Set(['REJECTED', 'CLOSEDAFTERREJECTION', 'CLOSEDAFTERRESOLUTION', 'CANCELLED']);

const rq = (userType?: string) => ({
  apiId: 'Rainmaker',
  authToken: adminToken,
  userInfo: userType ? { ...adminUserInfo, type: userType } : adminUserInfo,
});
const authed = () => ({ Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' });

async function assertOk(resp: Response, context: string): Promise<any> {
  const body = await resp.json();
  if (!resp.ok) throw new Error(`${context}: HTTP ${resp.status} — ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

// ---------------------------------------------------------------------------
// Workflow + config discovery
// ---------------------------------------------------------------------------

/**
 * Read the deployed PGR state machine and derive the facts the tests need.
 *
 * `nextState` comes over the wire as a state uuid, so it is resolved back to an
 * applicationStatus here. Inactive actions are ignored — an `active: false` row
 * is configuration history, not an available transition.
 */
async function discoverWorkflow(): Promise<void> {
  const resp = await fetch(
    `${BASE_URL}/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=${encodeURIComponent(TENANT)}&businessServices=PGR`,
    { method: 'POST', headers: authed(), body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: adminToken } }) },
  );
  const biz = ((await resp.json()) as any)?.BusinessServices?.[0];
  if (!biz) throw new Error(`no PGR businessService on ${TENANT} (HTTP ${resp.status})`);

  const statusOf = new Map<string, string>();
  for (const s of biz.states ?? []) if (s.uuid) statusOf.set(s.uuid, s.applicationStatus ?? '');

  for (const s of biz.states ?? []) {
    const from = s.applicationStatus;
    if (!from) continue;
    for (const a of s.actions ?? []) {
      if (a.active === false) continue;
      const to = statusOf.get(a.nextState) ?? '';
      if (a.action === 'ASSIGN' && !assignedState) assignedState = to;
      if (a.action === 'REASSIGN' && !reassignQueue) reassignQueue = to;
      if (a.action === 'ESCALATE') escalateStates.set(from, to);
      if (a.action === 'REJECT') rejectableStates.add(from);
    }
  }
}

/** The tenant's own escalation policy. Read-only — a test may never rewrite shared master data. */
async function discoverEscalationConfig(): Promise<boolean> {
  const resp = await fetch(`${BASE_URL}/egov-mdms-service/v1/_search?tenantId=${encodeURIComponent(TENANT)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: adminToken },
      MdmsCriteria: {
        tenantId: TENANT,
        moduleDetails: [{ moduleName: 'RAINMAKER-PGR', masterDetails: [{ name: 'EscalationConfig' }] }],
      },
    }),
  });
  if (!resp.ok) return false;
  const rows: any[] = ((await resp.json()) as any)?.MdmsRes?.['RAINMAKER-PGR']?.EscalationConfig ?? [];
  const row = rows.find((r) => r?.code === 'DEFAULT') ?? rows[0];
  if (!row) return false;
  maxDepth = Number(row.maxDepth ?? 0);
  eligibleStatuses = (row.eligibleStatuses ?? []).map((s: string) => String(s).toUpperCase());
  enabledByLevel = Array.isArray(row.enabledByLevel) ? row.enabledByLevel.map(Boolean) : [];
  return maxDepth > 0;
}

// ---------------------------------------------------------------------------
// HRMS
// ---------------------------------------------------------------------------

/**
 * Paged employee read. Throws at the ceiling rather than returning a short list:
 * a silently truncated pool picks a different anchor and the failure surfaces
 * somewhere unrelated.
 */
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
    if (out.length >= CEILING) {
      throw new Error(`searchEmployees: hit the ${CEILING}-record ceiling on ${TENANT} with a full page still coming — raise it rather than truncating`);
    }
  }
  return out;
}

const currentAssignments = (emp: any) => (emp?.assignments || []).filter((a: any) => a.isCurrentAssignment);

/**
 * Snapshot reportingTo per assignment, keyed on the assignment's own id.
 *
 * Keyed on id ALONE and deliberately: an earlier version also keyed by array
 * index, and since HRMS assignment ids are small integers, an assignment with
 * id 2 collided with index key 2 and the restore put one assignment's value onto
 * another — silently corrupting the pool pgr-escalation.spec.ts also draws from.
 * An assignment with no id is unrestorable, and says so loudly.
 */
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

/**
 * Point every current assignment at `uuid` (null clears), then verify by re-read.
 *
 * Writing every row is a correctness requirement, not tidiness: the service reads
 * `assignments[?(@.isCurrentAssignment==true)].reportingTo` and takes element [0],
 * so with several current assignments the answer would otherwise depend on HRMS's
 * ordering. One attempt, then verify — a repair LOOP is how a flaky write becomes
 * a green test.
 */
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
  expect(
    values,
    `${why}: HRMS accepted the write but ${fresh.code}'s current assignments read back as ${JSON.stringify(values)} — the service reads element [0] of these, so a partial write is not usable`,
  ).toEqual([uuid]);
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

// ---------------------------------------------------------------------------
// Complaints
// ---------------------------------------------------------------------------

async function fetchComplaint(srid: string): Promise<any> {
  const resp = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${encodeURIComponent(TENANT)}&serviceRequestId=${encodeURIComponent(srid)}`,
    { method: 'POST', headers: authed(), body: JSON.stringify({ RequestInfo: rq() }) },
  );
  const svc = ((await resp.json()) as any)?.ServiceWrappers?.[0]?.service;
  if (!svc) throw new Error(`${srid} not readable on ${TENANT} (HTTP ${resp.status})`);
  return svc;
}

/** Drive an action. Returns the raw Response so either outcome can be asserted. */
async function act(srid: string, workflow: Record<string, unknown>, userType?: string): Promise<Response> {
  const service = await fetchComplaint(srid);
  return fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${encodeURIComponent(TENANT)}`, {
    method: 'POST',
    headers: authed(),
    body: JSON.stringify({ RequestInfo: rq(userType), service, workflow }),
  });
}

const escalate = (srid: string, extra: Record<string, unknown> = {}) =>
  act(srid, { action: 'ESCALATE', comments: 'escalation-guards', ...extra });

/** The same call the scheduler makes: userInfo.type = SYSTEM selects the automatic path. */
const escalateAsSystem = (srid: string, extra: Record<string, unknown> = {}) =>
  act(srid, { action: 'ESCALATE', comments: 'escalation-guards (automatic)', ...extra }, 'SYSTEM');

async function levelOf(srid: string): Promise<number> {
  return Number((await fetchComplaint(srid))?.additionalDetail?.escalationLevel ?? 0);
}

async function newComplaint(note: string): Promise<string> {
  const created_ = await seedComplaintAsCitizen({ description: `escalation-guards ${note} — ${new Date().toISOString()}` });
  created.add(created_.srid);
  return created_.srid;
}

async function assignTo(srid: string, assigneeUuid: string, note: string): Promise<any> {
  const body = await assertOk(
    await act(srid, { action: 'ASSIGN', assignes: [assigneeUuid], comments: `escalation-guards ${note}` }),
    `ASSIGN ${srid}`,
  );
  const svc = body.ServiceWrappers[0].service;
  expect(svc.applicationStatus).toBe(assignedState);
  return svc;
}

/**
 * Bring a shared complaint to "held by the anchor", whatever state it is in.
 *
 * Idempotent, because a chain's beforeAll re-runs after any failure: the second
 * test of a chain therefore faces exactly two arrival states — inherited from the
 * first test, or hook-fresh — and this reconciles them so the assertions can stay
 * absolute. Repairs are limited to ASSIGN and REASSIGN→ASSIGN; it never resolves
 * or reopens, because reopening resets the ladder and that is a behaviour under
 * test elsewhere, not infrastructure.
 */
async function ensureHeldByAnchor(srid: string): Promise<void> {
  const svc = await fetchComplaint(srid);
  const status = svc.applicationStatus;
  if (status === assignedState) {
    const holders = (svc.workflow?.assignes ?? []).map((a: any) => (typeof a === 'string' ? a : a?.uuid));
    if (holders.length === 1 && holders[0] === chain[0].uuid) return;
    await assertOk(await act(srid, { action: 'REASSIGN', comments: 'escalation-guards reset' }), `REASSIGN ${srid}`);
  }
  await assignTo(srid, chain[0].uuid, 'reset');
}

/** Escalate until the level reaches `level`. Bounded, so a non-advancing hop throws. */
async function ensureEscalatedTo(srid: string, level: number): Promise<void> {
  for (let guard = 0; guard <= maxDepth + 1; guard++) {
    if ((await levelOf(srid)) >= level) return;
    await assertOk(await escalate(srid), `ESCALATE ${srid} toward level ${level}`);
  }
  throw new Error(`${srid} did not reach level ${level} within ${maxDepth + 1} hops`);
}

/**
 * Drain a complaint out of every active queue: REASSIGN to the queue, then REJECT.
 *
 * REJECT is not granted on the assigned state on this workflow, so the two-hop
 * route is the only one ADMIN can drive. Per-record errors are warnings — one
 * stale complaint must not tank the cleanup of a dozen.
 */
async function drain(srid: string): Promise<'drained' | 'already' | 'stuck'> {
  const svc = await fetchComplaint(srid);
  const status = svc.applicationStatus;
  if (TERMINAL.has(status)) return 'already';
  if (!rejectableStates.has(status)) {
    if (status !== assignedState || !reassignQueue || !rejectableStates.has(reassignQueue)) return 'stuck';
    await assertOk(await act(srid, { action: 'REASSIGN', comments: 'cleanup' }), `cleanup REASSIGN ${srid}`);
  }
  await assertOk(await act(srid, { action: 'REJECT', comments: 'Cleaned up by escalation-guards' }), `cleanup REJECT ${srid}`);
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
  if (escalateStates.size === 0) {
    skipReason = `no state on ${TENANT} grants an active ESCALATE action`;
    return;
  }
  if (!(await discoverEscalationConfig())) {
    skipReason = `escalation is not configured on ${TENANT}`;
    return;
  }

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

  // Two independent role questions, because this workflow separates them: the
  // ACTOR needs a role on ESCALATE (GRO was removed from it on this tenant), and
  // the ASSIGNEE needs one of ASSIGN's assignee roles.
  const escalateRoles = new Set<string>();
  const wf = getProfile().workflow.pgr;
  for (const r of wf.actionRoles?.ESCALATE ?? []) escalateRoles.add(r);
  const adminRoles = new Set((adminUserInfo as any)?.roles?.map((r: any) => r.code) ?? []);
  if (escalateRoles.size > 0 && ![...escalateRoles].some((r) => adminRoles.has(r))) {
    skipReason = `${ADMIN_USER} holds no role among ESCALATE's ${JSON.stringify([...escalateRoles])} on ${TENANT}`;
    return;
  }
  const assigneeRoles = new Set(wf.assign?.assigneeRoles ?? []);

  const SCRATCH = /(^|[._])PW[A-Z_]/i;
  const all = await searchEmployees();
  const inDepartment = all.filter(
    (e) =>
      (e.assignments || []).some((a: any) => a.department === department) &&
      currentAssignments(e).length > 0 &&
      e.user?.userName !== ADMIN_USER &&
      !(SCRATCH.test(String(e.code ?? '')) || SCRATCH.test(String(e.user?.userName ?? ''))),
  );
  inDepartmentCount = inDepartment.length;

  // Patchable = HRMS will accept an _update. It rejects any employee carrying
  // several current assignments with ERR_HRMS_INVALID_CURRENT_ASSGN ("There
  // should be exactly one current assignment"), so such employees cannot be
  // wired into a reporting chain at all, however many of them there are.
  const pool = inDepartment.filter(
    (e) =>
      currentAssignments(e).length === 1 &&
      (assigneeRoles.size === 0 || (e.user?.roles ?? []).some((r: any) => assigneeRoles.has(r.code))),
  );
  patchableDepth = pool.length;
  if (patchableDepth < 2) {
    skipReason =
      `department '${department}' on ${TENANT} has ${inDepartmentCount} employee(s) but only ${patchableDepth} ` +
      `patchable (exactly one current assignment + an ASSIGN-eligible role) — an escalation needs at least 2`;
    return;
  }
  chain = pool;

  console.log(
    `[guards] ${TENANT}/${department} assigned=${assignedState} reassignQueue=${reassignQueue || 'none'} ` +
      `escalateOn=${JSON.stringify([...escalateStates.entries()])} maxDepth=${maxDepth} ` +
      `eligible=${JSON.stringify(eligibleStatuses)} enabledByLevel=${JSON.stringify(enabledByLevel)} ` +
      `patchable=${patchableDepth}/${inDepartmentCount} chain=${chain.map((e) => e.code).join(' -> ')}`,
  );
});

test.afterAll(async () => {
  await restoreReportingTo();

  if (process.env.KEEP_TEST_COMPLAINTS === '1') {
    console.log(`[guards] KEEP_TEST_COMPLAINTS=1 — leaving ${created.size} complaint(s): ${[...created].join(', ')}`);
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
  console.log(`[guards] cleanup: ${JSON.stringify(tally)}`);
});

// ---------------------------------------------------------------------------
// Chain A — the holder
// ---------------------------------------------------------------------------

test.describe('PGR escalation guards — the holder', () => {
  let srid = '';

  test.beforeAll(async () => {
    if (skipReason) return;
    srid = await newComplaint('holder');
  });

  test('refuses an unheld complaint with ESCALATION_NO_ASSIGNEE, and escalates once it has a holder', {
    annotation: {
      type: 'description',
      description: `Covers ESC/012, the holder half of ESC/010, and the holder rule of ESC/039: an unassigned complaint cannot be escalated, and the caller is pointed at assignment instead.

Steps:
1. Assert the freshly filed complaint is unheld.
2. ESCALATE. Assert the refusal carries ESCALATION_NO_ASSIGNEE by name.
3. Assert nothing moved: same state, escalationLevel still 0.
4. Wire the anchor to a manager, ASSIGN, and ESCALATE again — the identical call must now succeed at level 1, landing on that manager.

Step 4 is the positive control and it is what makes step 2 mean anything: without it the assertion passes on an expired token, a malformed payload or a path typo just as readily as on the guard firing.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:edge-case'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    const unheldState = (await fetchComplaint(srid)).applicationStatus;
    test.skip(
      !escalateStates.has(unheldState),
      `${TENANT} does not grant ESCALATE on '${unheldState}', where an unassigned complaint sits — ` +
        `the workflow refuses the action before the domain guard is reached (ESCALATE is on ${JSON.stringify([...escalateStates.keys()])})`,
    );

    await expectApiError(await escalate(srid), 'ESCALATION_NO_ASSIGNEE', `ESCALATE on unheld ${srid}`);

    const after = await fetchComplaint(srid);
    expect(after.applicationStatus, 'a refused escalation must not move the complaint').toBe(unheldState);
    expect(Number(after.additionalDetail?.escalationLevel ?? 0), 'a refused escalation must not consume a rung').toBe(0);

    // ---- control: the identical call, with the one missing precondition ----
    const [anchor, manager] = chain;
    remember(anchor);
    await setReportingTo(anchor, manager.uuid, 'holder control');
    await assignTo(srid, anchor.uuid, 'holder control');

    const ok = await assertOk(await escalate(srid), 'ESCALATE after ASSIGN');
    const detail = ok.ServiceWrappers[0].service.additionalDetail;
    expect(Number(detail.escalationLevel), 'the identical request must succeed once a holder exists').toBe(1);
    expect(detail.escalatedTo, "and must land on the holder's manager").toBe(manager.uuid);
  });

  test('refuses at the top of the reporting line with ESCALATION_TOP_OF_HIERARCHY', {
    annotation: {
      type: 'description',
      description: `Covers ESC/017 and ESC/036: a complaint held by somebody with nobody above them cannot be escalated, and it says so specifically rather than failing generically. ESC/036's point is that how far a complaint can climb is bounded by the org chart as well as by configuration.

Steps:
1. Bring the complaint back to the anchor (idempotent — it may have been left with the manager by the previous test, or re-filed by this chain's beforeAll after a failure) and note the level it carries.
2. Clear the anchor's reportingTo on every current assignment, verified by read-back.
3. ESCALATE. Assert ESCALATION_TOP_OF_HIERARCHY and that the level did not move.
4. Restore the manager and ESCALATE again — one rung higher than step 1.

Step 4 is the control: the only difference between the two calls is that one HRMS field, so the refusal can have come from nothing else.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:edge-case'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    const [anchor, manager] = chain;

    await ensureHeldByAnchor(srid);
    const before = await levelOf(srid);
    test.skip(
      before >= maxDepth,
      `${srid} is already at maxDepth=${maxDepth} on ${TENANT}, so MAX_DEPTH would answer before the manager check`,
    );

    remember(anchor);
    await setReportingTo(anchor, null, 'top-of-hierarchy');

    await expectApiError(await escalate(srid), 'ESCALATION_TOP_OF_HIERARCHY', `ESCALATE with no reportingTo on ${anchor.code}`);
    expect(await levelOf(srid), 'a refused escalation must not consume a rung').toBe(before);

    // ---- control: restore the single field and the same call goes through ----
    await setReportingTo(anchor, manager.uuid, 'top-of-hierarchy restore');
    const ok = await assertOk(await escalate(srid), 'ESCALATE after restoring reportingTo');
    expect(Number(ok.ServiceWrappers[0].service.additionalDetail.escalationLevel)).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// Chain B — the target
// ---------------------------------------------------------------------------

test.describe('PGR escalation guards — the target', () => {
  let srid = '';

  test.beforeAll(async () => {
    if (skipReason) return;
    srid = await newComplaint('target');
    remember(chain[0]);
    await setReportingTo(chain[0], chain[1].uuid, 'target setup');
    await assignTo(srid, chain[0].uuid, 'target');
  });

  test('refuses a reporting line that points back at the current holder with ESCALATION_HIERARCHY_CYCLE', {
    annotation: {
      type: 'description',
      description: `Covers ESC/018 — and records a finding, because the guard is NARROWER than that row assumes.

The check is \`currentAssignees.contains(expectedAssignee)\`: it fires when the resolved manager IS one of the complaint's CURRENT assignees. The sheet's setup — two employees recorded as each other's manager — does NOT trigger it on a singly-assigned complaint. Assign to A, escalate to B, and A is no longer a current assignee, so B -> A resolves cleanly and the complaint simply walks back down, consuming a rung each time. A self-reference is the only single-assignee shape that can trip it, and is what this test uses.

Worth raising with the product owner: a reciprocal A<->B pair produces an escalation that ping-pongs between two people until the ladder is spent, rather than being refused as ESC/018 expects.

Steps:
1. Point the anchor's reportingTo at itself, verified by read-back.
2. ESCALATE. Assert ESCALATION_HIERARCHY_CYCLE and escalationLevel still 0.
3. Restore the real manager; the same call succeeds at level 1.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:edge-case'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    const [anchor, manager] = chain;

    await ensureHeldByAnchor(srid);
    remember(anchor);
    await setReportingTo(anchor, anchor.uuid, 'cycle');

    await expectApiError(await escalate(srid), 'ESCALATION_HIERARCHY_CYCLE', `ESCALATE with ${anchor.code} reporting to itself`);
    expect(await levelOf(srid), 'a refused escalation must not consume a rung').toBe(0);

    await setReportingTo(anchor, manager.uuid, 'cycle restore');
    const ok = await assertOk(await escalate(srid), 'ESCALATE after breaking the cycle');
    expect(Number(ok.ServiceWrappers[0].service.additionalDetail.escalationLevel)).toBe(1);
  });

  test('rejects a caller-chosen target with INVALID_ESCALATION_ASSIGNEE but accepts the exact manager, or none', {
    annotation: {
      type: 'description',
      description: `Covers ESC/016. The API is the only way to reach this — the employee UI offers no person picker, which tests/employee/escalate-action-521.spec.ts already asserts.

Steps:
1. Bring the complaint back to the anchor and wire a two-deep line: anchor -> manager -> second.
2. ESCALATE naming the third party. Assert INVALID_ESCALATION_ASSIGNEE, that the message points the caller at reassignment, and that no rung was consumed.
3. ESCALATE naming exactly the resolved manager. Assert accepted, and that it landed there.
4. ESCALATE naming nobody. Assert accepted, and that the server resolved the next hop itself.

Steps 3 and 4 are what stop this from being a test that merely proves escalation is broken: the guard must reject a WRONG target without rejecting a right one or an absent one. Levels are relative because this chain's complaint carries whatever the cycle test's control left on it.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:edge-case'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    test.skip(
      patchableDepth < 3,
      `department '${department}' on ${TENANT} has ${patchableDepth} patchable employee(s) of ${inDepartmentCount} — ` +
        `naming a wrong target needs 3 (anchor, its manager, and a third party)`,
    );
    const [anchor, manager, second] = chain;

    await ensureHeldByAnchor(srid);
    const before = await levelOf(srid);
    test.skip(before + 2 > maxDepth, `${srid} is at level ${before} with maxDepth=${maxDepth}; this case needs two spare rungs`);

    remember(anchor);
    remember(manager);
    await setReportingTo(anchor, manager.uuid, 'invalid-assignee');
    await setReportingTo(manager, second.uuid, 'invalid-assignee');

    const refused = await expectApiError(
      await escalate(srid, { assignes: [second.uuid] }),
      'INVALID_ESCALATION_ASSIGNEE',
      `ESCALATE naming ${second.code}, who is not ${anchor.code}'s manager`,
    );
    expect(
      refused.messages.join(' '),
      'the refusal should send the caller to reassignment, since a sideways move is a different operation',
    ).toMatch(/reassign/i);
    expect(await levelOf(srid), 'a refused escalation must not consume a rung').toBe(before);

    const exact = await assertOk(await escalate(srid, { assignes: [manager.uuid] }), 'ESCALATE naming the exact manager');
    const exactDetail = exact.ServiceWrappers[0].service.additionalDetail;
    expect(Number(exactDetail.escalationLevel), 'naming the correct manager must be accepted').toBe(before + 1);
    expect(exactDetail.escalatedTo).toBe(manager.uuid);

    const resolved = await assertOk(await escalate(srid), 'ESCALATE naming nobody');
    const resolvedDetail = resolved.ServiceWrappers[0].service.additionalDetail;
    expect(Number(resolvedDetail.escalationLevel), 'omitting the target must be accepted too').toBe(before + 2);
    expect(resolvedDetail.escalatedTo, 'the server resolves the target with no help from the caller').toBe(second.uuid);
  });
});

// ---------------------------------------------------------------------------
// Chain C — the depth
// ---------------------------------------------------------------------------

test.describe('PGR escalation guards — the depth', () => {
  let srid = '';
  let line: any[] = [];

  test.beforeAll(async () => {
    if (skipReason) return;
    if (patchableDepth < maxDepth + 2) return;   // the tests skip with the evidence
    line = chain.slice(0, maxDepth + 2);
    for (let i = 0; i < line.length - 1; i++) {
      remember(line[i]);
      await setReportingTo(line[i], line[i + 1].uuid, `depth link ${i}`);
    }
    srid = await newComplaint('depth');
    await assignTo(srid, line[0].uuid, 'depth');
  });

  const depthSkip = () =>
    `department '${department}' on ${TENANT} has ${patchableDepth} patchable employee(s) of ${inDepartmentCount}, ` +
    `but maxDepth=${maxDepth} needs ${maxDepth + 2}: the anchor, ${maxDepth} managers to spend every rung, and ` +
    `somebody still above the top so the final refusal is the maximum and not a missing manager`;

  test('stops at the configured maximum with ESCALATION_MAX_DEPTH, and keeps one count per complaint', {
    annotation: {
      type: 'description',
      description: `Covers ESC/034, the max-depth half of ESC/030, ESC/033, and the maximum rule of ESC/039.

maxDepth is read from the tenant's own EscalationConfig rather than assumed, so this asserts whatever the deployment is configured for. The reporting line must be maxDepth+1 deep: maxDepth hops have to succeed AND the holder at the top must still have a manager, otherwise the final refusal would be TOP_OF_HIERARCHY and the maximum would go untested. That is also ESC/034's fourth bullet — a deeper line does not raise the limit.

Steps:
1. ESCALATE maxDepth times, asserting the level reads 1, 2, ... maxDepth and each hop lands on the next employee up.
2. ESCALATE once more. Assert ESCALATION_MAX_DEPTH and that the level did not move past maxDepth.
3. Assert additionalDetail carries exactly one escalation counter and nothing per-state.
4. Assert the complaint is still in the state ESCALATE is configured to land in.

Step 1's running assertion is the control: a test that only checked the final refusal could not tell an exhausted ladder from an escalation that never worked at all.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:regression'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    test.skip(patchableDepth < maxDepth + 2, depthSkip());

    for (let hop = 1; hop <= maxDepth; hop++) {
      const ok = await assertOk(await escalate(srid), `ESCALATE hop ${hop} of ${maxDepth}`);
      const detail = ok.ServiceWrappers[0].service.additionalDetail;
      expect(Number(detail.escalationLevel), `hop ${hop} should read level ${hop}`).toBe(hop);
      expect(detail.escalatedTo, `hop ${hop} should land on ${line[hop].code}`).toBe(line[hop].uuid);
    }

    await expectApiError(await escalate(srid), 'ESCALATION_MAX_DEPTH', `ESCALATE hop ${maxDepth + 1} with maxDepth=${maxDepth}`);

    const final = await fetchComplaint(srid);
    expect(Number(final.additionalDetail.escalationLevel), 'the refused hop must not advance the level').toBe(maxDepth);

    const keys = Object.keys(final.additionalDetail ?? {});
    expect(
      keys.filter((k) => /escalationlevel/i.test(k)),
      `the ladder belongs to the complaint, so exactly one counter — found ${JSON.stringify(keys)}`,
    ).toEqual(['escalationLevel']);
    expect(final.applicationStatus, 'the escalation lands where the workflow says').toBe(escalateStates.get(assignedState));
  });

  test('a ladder spent before handover leaves the next holder with no escalation left', {
    annotation: {
      type: 'description',
      description: `Covers ESC/053 and the holder half of ESC/014. This is the fairness consequence the sheet flags for manager discussion, asserted as behaviour rather than argued: the ladder is anchored to the complaint, so an employee can receive one that has already used every rung and face no escalation pressure at all.

Reuses this chain's complaint, which the previous test leaves at maxDepth — exactly the state this case needs, so there is no second exhaustion cycle. The precondition is re-established idempotently, because a worker restart would have re-filed it at level 0.

Steps:
1. Ensure the complaint is at maxDepth.
2. REASSIGN. It lands in the queue, which carries no assignee. ESCALATE there — refused, no rung consumed. That is ESC/014's "a complaint that loses its holder stops escalating".
3. ASSIGN to a DIFFERENT employee who has a manager of their own.
4. Assert the level arrived unreset, then ESCALATE. Assert ESCALATION_MAX_DEPTH.

Step 3 is the control.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:edge-case'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    test.skip(patchableDepth < maxDepth + 2, depthSkip());
    test.skip(!reassignQueue, `${TENANT} defines no REASSIGN action, so a complaint cannot be handed on`);

    await ensureHeldByAnchor(srid);
    await ensureEscalatedTo(srid, maxDepth);
    expect(await levelOf(srid), 'this case starts from an exhausted ladder').toBe(maxDepth);

    const reassigned = await assertOk(await act(srid, { action: 'REASSIGN', comments: 'handover' }), 'REASSIGN');
    expect(reassigned.ServiceWrappers[0].service.applicationStatus).toBe(reassignQueue);

    const whileUnheld = await escalate(srid);
    expect(whileUnheld.ok, 'a complaint with no holder cannot be escalated').toBe(false);
    expect(await levelOf(srid), 'a refused escalation must not consume a rung').toBe(maxDepth);

    // ---- control: the new holder DOES have a manager available ----
    const fresh = line[maxDepth + 1];
    const freshManager = line[0];
    expect(fresh.uuid, 'the fresh holder must differ from its own manager').not.toBe(freshManager.uuid);
    remember(fresh);
    await setReportingTo(fresh, freshManager.uuid, 'fresh holder');

    const handed = await assignTo(srid, fresh.uuid, 'handover');
    expect(
      Number(handed.additionalDetail.escalationLevel),
      'a reassignment preserves consumed rungs rather than starting the new holder at zero',
    ).toBe(maxDepth);

    await expectApiError(
      await escalate(srid),
      'ESCALATION_MAX_DEPTH',
      `ESCALATE after handover to ${fresh.code}, who has manager ${freshManager.code} available`,
    );
  });
});

// ---------------------------------------------------------------------------
// Chain D — the automatic-only gates
// ---------------------------------------------------------------------------

test.describe('PGR escalation guards — the automatic-only gates', () => {
  let srid = '';

  test.beforeAll(async () => {
    if (skipReason) return;
    srid = await newComplaint('automatic');
    remember(chain[0]);
    await setReportingTo(chain[0], chain[1].uuid, 'automatic setup');
    await assignTo(srid, chain[0].uuid, 'automatic');
  });

  test('refuses an automatic escalation before the cumulative threshold, while manual succeeds', {
    annotation: {
      type: 'description',
      description: `Covers ESC/001, ESC/032 and gate (a) of ESC/038 — and it is the sharpest available statement of the single most common source of "the SLA didn't work" confusion.

Thresholds are cumulative from when the complaint was raised. A complaint filed seconds ago is therefore nowhere near its first threshold, so the automatic path must refuse it with ESCALATION_NOT_DUE — while the manual path, which deliberately ignores the SLA entirely, must succeed on the very same complaint.

The automatic path is selected by sending RequestInfo.userInfo.type = "SYSTEM", which is exactly how the scheduler presents itself. A public caller doing the same is treated as automatic, and the direction is fail-safe: it only ADDS checks.

Steps:
1. ESCALATE as SYSTEM. Assert ESCALATION_NOT_DUE and that no rung was consumed.
2. ESCALATE as an ordinary employee, same complaint, same instant. Assert it SUCCEEDS at level 1.
3. Assert the record says MANUAL — the hop that went through was the manual one.

Step 2 is the control, and it is the whole test: a refusal alone would be indistinguishable from escalation being broken.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:edge-case'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    await ensureHeldByAnchor(srid);
    const before = await levelOf(srid);
    test.skip(before >= maxDepth, `${srid} is at maxDepth=${maxDepth}, so MAX_DEPTH answers before the threshold check`);
    test.skip(
      !eligibleStatuses.includes(assignedState.toUpperCase()),
      `'${assignedState}' is not in ${TENANT}'s eligibleStatuses ${JSON.stringify(eligibleStatuses)}, so the automatic ` +
        `path answers STATUS_NOT_ELIGIBLE before it reaches the threshold check`,
    );

    await expectApiError(
      await escalateAsSystem(srid),
      'ESCALATION_NOT_DUE',
      `automatic ESCALATE on ${srid}, filed moments ago`,
    );
    expect(await levelOf(srid), 'a refused escalation must not consume a rung').toBe(before);

    // ---- control: the manual path ignores the SLA on the same complaint ----
    const ok = await assertOk(await escalate(srid), 'manual ESCALATE at the same instant');
    const detail = ok.ServiceWrappers[0].service.additionalDetail;
    expect(Number(detail.escalationLevel), 'manual escalation deliberately ignores the deadline').toBe(before + 1);
    expect(detail.escalationTrigger, 'and records itself as manual').toBe('MANUAL');
  });

  test('refuses an automatic escalation in a state the administrator has not listed', {
    annotation: {
      type: 'description',
      description: `Covers ESC/008, ESC/009, ESC/044 and gate (b) of ESC/038.

eligibleStatuses is authored configuration and is never derived from the workflow. Nothing inspects the business service to find states with an ESCALATE action, so a state can grant ESCALATE and still never be escalated automatically. The automatic path checks the list first; the manual path does not consult it at all.

This needs a state that BOTH grants an active ESCALATE and is absent from eligibleStatuses. Where the two sets coincide the case is unreachable and the test skips naming both, which is itself the useful finding: it says the deployment cannot distinguish "listed" from "has the action".

Steps, when such a state exists:
1. Bring the complaint into that state and confirm it holds an assignee.
2. ESCALATE as SYSTEM. Assert ESCALATION_STATUS_NOT_ELIGIBLE, no rung consumed.
3. ESCALATE as an ordinary employee. Assert it succeeds — the manual path ignores the list.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:edge-case'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    const unlisted = [...escalateStates.keys()].find((s) => !eligibleStatuses.includes(s.toUpperCase()));
    test.skip(
      !unlisted,
      `no state on ${TENANT} both grants ESCALATE and is absent from eligibleStatuses — ESCALATE is on ` +
        `${JSON.stringify([...escalateStates.keys()])} and eligibleStatuses is ${JSON.stringify(eligibleStatuses)}, ` +
        `so the automatic path can never answer STATUS_NOT_ELIGIBLE here`,
    );

    const svc = await fetchComplaint(srid);
    test.skip(
      svc.applicationStatus !== unlisted,
      `${srid} sits in '${svc.applicationStatus}' and no transition in this test can move it to '${unlisted}' ` +
        `while keeping an assignee — the unlisted state would need to be reachable with a holder`,
    );

    await expectApiError(await escalateAsSystem(srid), 'ESCALATION_STATUS_NOT_ELIGIBLE', `automatic ESCALATE in unlisted '${unlisted}'`);
    const ok = await assertOk(await escalate(srid), 'manual ESCALATE in the same unlisted state');
    expect(
      Number(ok.ServiceWrappers[0].service.additionalDetail.escalationLevel),
      'the manual path does not consult eligibleStatuses',
    ).toBeGreaterThan(0);
  });

  test('refuses an automatic escalation at a level whose switch is off, while manual succeeds', {
    annotation: {
      type: 'description',
      description: `Covers gate (c) of ESC/038. enabledByLevel turns individual rungs off for the automatic path only; manual escalation ignores it.

Needs a tenant whose enabledByLevel contains a false at a rung the complaint can actually reach. Where every level is enabled the case is unreachable and the test skips naming the configured array.

Steps, when such a rung exists:
1. Walk the complaint to the rung below the disabled one.
2. ESCALATE as SYSTEM. Assert ESCALATION_LEVEL_DISABLED, no rung consumed.
3. ESCALATE as an ordinary employee. Assert it succeeds through the disabled rung.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:edge-case'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    const disabled = enabledByLevel.findIndex((on) => on === false);
    test.skip(
      disabled < 0,
      `${TENANT} enables every escalation level (enabledByLevel=${JSON.stringify(enabledByLevel)}), so the automatic ` +
        `path can never answer LEVEL_DISABLED here`,
    );
    test.skip(
      disabled >= maxDepth || patchableDepth < disabled + 2,
      `${TENANT} disables level ${disabled} but reaching it needs ${disabled + 2} patchable employees (have ` +
        `${patchableDepth}) and maxDepth=${maxDepth}`,
    );

    await ensureHeldByAnchor(srid);
    for (let i = 0; i < disabled; i++) {
      remember(chain[i]);
      await setReportingTo(chain[i], chain[i + 1].uuid, `level-disabled link ${i}`);
    }
    await ensureEscalatedTo(srid, disabled);
    const before = await levelOf(srid);

    await expectApiError(await escalateAsSystem(srid), 'ESCALATION_LEVEL_DISABLED', `automatic ESCALATE at disabled level ${disabled}`);
    expect(await levelOf(srid), 'a refused escalation must not consume a rung').toBe(before);

    const ok = await assertOk(await escalate(srid), 'manual ESCALATE at the same level');
    expect(
      Number(ok.ServiceWrappers[0].service.additionalDetail.escalationLevel),
      'the manual path does not consult enabledByLevel',
    ).toBe(before + 1);
  });
});
