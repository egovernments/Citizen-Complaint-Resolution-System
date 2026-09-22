/**
 * PGR escalation — the escalation record is server-owned.
 *
 * Eight fields in additionalDetail may only be written by pgr-services:
 * assignmentChangedAt, assignmentChangeSource, escalationLevel,
 * escalationWindowStartedAt, lastEscalatedAt, escalatedFrom, escalatedTo,
 * escalationTrigger. prepareCreate() strips them from a create;
 * preserveServerMetadata() restores them from the persisted record on every
 * update, or drops the key when nothing is persisted.
 *
 * The clock is the reason this matters. escalationWindowStartedAt anchors every
 * cumulative threshold and falls back to createdTime when absent; only a reopen
 * writes it. Moving it forward would postpone escalation indefinitely, moving it
 * back would force one over a colleague.
 *
 * Note on the clock assertions: since prepareCreate strips the field, an
 * ordinary complaint has no anchor at all, so the checks are "field still
 * absent" plus "createdTime unmoved". Asserting a stored value would pass
 * silently on every complaint that never had one.
 *
 * Covers ESC/026 027 033 058 059 060 070 071 072 074.
 */
import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import { CITIZEN_FIXTURE_PATH, provisionFreshCitizen, readProvisionedCitizen, type ProvisionedCitizen } from '../utils/citizen-provision';
import { BASE_URL, TENANT, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { resolveFilingTarget, resolveSeedPlan } from '../utils/personas';
import { getProfile } from '../utils/profile';
import { seedComplaintAsCitizen } from '../utils/seed';

/** The eight fields only pgr-services may originate. */
const SERVER_OWNED = [
  'assignmentChangedAt',
  'assignmentChangeSource',
  'escalationLevel',
  'escalationWindowStartedAt',
  'lastEscalatedAt',
  'escalatedFrom',
  'escalatedTo',
  'escalationTrigger',
] as const;

let adminToken: string;
let adminUserInfo: Record<string, unknown>;
let skipReason = '';

let assignedState = '';
let reassignQueue = '';
const escalateStates = new Map<string, string>();
const rejectableStates = new Set<string>();
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

async function fetchComplaint(srid: string): Promise<any> {
  const resp = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${encodeURIComponent(TENANT)}&serviceRequestId=${encodeURIComponent(srid)}`,
    { method: 'POST', headers: authed(), body: JSON.stringify({ RequestInfo: rq() }) },
  );
  const svc = ((await resp.json()) as any)?.ServiceWrappers?.[0]?.service;
  if (!svc) throw new Error(`${srid} not readable on ${TENANT} (HTTP ${resp.status})`);
  return svc;
}

/** `mutate` edits the real persisted object — which is what makes a forgery realistic. */
async function act(srid: string, workflow: Record<string, unknown>, mutate?: (s: any) => void): Promise<Response> {
  const service = await fetchComplaint(srid);
  mutate?.(service);
  return fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${encodeURIComponent(TENANT)}`, {
    method: 'POST',
    headers: authed(),
    body: JSON.stringify({ RequestInfo: rq(), service, workflow }),
  });
}

async function levelOf(srid: string): Promise<number> {
  return Number((await fetchComplaint(srid))?.additionalDetail?.escalationLevel ?? 0);
}

/** How many ESCALATE transitions the workflow itself has recorded. */
async function escalateCount(srid: string): Promise<number> {
  const resp = await fetch(
    `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?tenantId=${encodeURIComponent(TENANT)}&businessIds=${encodeURIComponent(srid)}&history=true`,
    { method: 'POST', headers: authed(), body: JSON.stringify({ RequestInfo: rq() }) },
  );
  return (((await resp.json()) as any).ProcessInstances || []).filter((p: any) => p.action === 'ESCALATE').length;
}

async function newComplaint(note: string): Promise<string> {
  const c = await seedComplaintAsCitizen({ description: `escalation-metadata ${note} — ${new Date().toISOString()}` });
  created.add(c.srid);
  return c.srid;
}

async function assignTo(srid: string, assigneeUuid: string, note: string): Promise<any> {
  const body = await assertOk(
    await act(srid, { action: 'ASSIGN', assignes: [assigneeUuid], comments: `escalation-metadata ${note}` }),
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

/**
 * Reuse the shared citizen fixture, or create and persist one.
 *
 * Only tests/fixtures/citizen.setup.ts writes citizen-fixture.json, and the `api`
 * project does not depend on that setup project — so on an api-only run the file
 * is absent. provisionFreshCitizen() alone does not help: it returns an identity
 * WITHOUT persisting, while seed.ts keeps its own copy in a module cache we cannot
 * reach, so this file and seed.ts would end up filing as two different citizens.
 * Writing the fixture, exactly as citizen.setup.ts does, keeps them agreed.
 *
 * The token is probed because nothing ever cleans this file up: a fixture left by
 * a run days ago carries a dead token, and readProvisionedCitizen() checks only
 * that the field is non-empty.
 */
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
      body: JSON.stringify({
        RequestInfo: {
          apiId: 'Rainmaker', authToken: c.token,
          userInfo: { uuid: c.uuid, type: 'CITIZEN', tenantId: c.tenantId, userName: c.mobile, name: c.name, mobileNumber: c.mobile },
        },
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

const citizenUserInfo = (c: ProvisionedCitizen) => ({
  uuid: c.uuid, type: 'CITIZEN', tenantId: c.tenantId, userName: c.mobile, name: c.name, mobileNumber: c.mobile,
});

async function drain(srid: string): Promise<'drained' | 'already' | 'stuck'> {
  const svc = await fetchComplaint(srid);
  const status = svc.applicationStatus;
  if (TERMINAL.has(status)) return 'already';
  if (!rejectableStates.has(status)) {
    if (status !== assignedState || !reassignQueue || !rejectableStates.has(reassignQueue)) return 'stuck';
    await assertOk(await act(srid, { action: 'REASSIGN', comments: 'cleanup' }), `cleanup REASSIGN ${srid}`);
  }
  await assertOk(await act(srid, { action: 'REJECT', comments: 'Cleaned up by escalation-metadata' }), `cleanup REJECT ${srid}`);
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

  citizen = await ensureCitizen();
  console.log(
    `[metadata] ${TENANT}/${department} assigned=${assignedState} maxDepth=${maxDepth} ` +
      `patchable=${patchableDepth}/${inDepartmentCount} chain=${chain.map((e) => e.code).join(' -> ')} citizen=${citizen.mobile}`,
  );
});

test.afterAll(async () => {
  await restoreReportingTo();
  if (process.env.KEEP_TEST_COMPLAINTS === '1') {
    console.log(`[metadata] KEEP_TEST_COMPLAINTS=1 — leaving ${created.size} complaint(s): ${[...created].join(', ')}`);
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
  console.log(`[metadata] cleanup: ${JSON.stringify(tally)}`);
});

// ---------------------------------------------------------------------------
// Chain A — creation
// ---------------------------------------------------------------------------

test.describe('PGR escalation metadata — at creation', () => {
  test('discards escalation metadata supplied when a complaint is raised', {
    annotation: {
      type: 'description',
      description: `Covers ESC/059. prepareCreate strips every server-owned field from an incoming create, so nobody can file a complaint that claims to have already been escalated, nor one whose escalation clock started in the past.

This test needs no employee chain at all — the subject is _create — so it is gated on the citizen alone. It files its own complaint because the forgery under test happens AT creation; there is nothing to reuse.

Steps:
1. File directly through _create as the provisioned citizen (pgrCreate() has no additionalDetail parameter, so the body is built here) with all eight server-owned fields populated: escalationLevel 5, a clock anchor back-dated 30 days, a named escalatedTo, escalationTrigger AUTOMATIC.
2. Alongside them, include one harmless custom key.
3. Assert the create succeeded and every server-owned field is absent or at its zero value.
4. Assert the harmless key SURVIVED.

Step 4 is the control and it is the whole reason this means anything.`,
    },
    tag: ['@persona:citizen', '@area:pgr', '@layer:api', '@kind:edge-case'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    test.skip(!citizen, `no citizen identity could be provisioned on ${TENANT}`);

    const target = await resolveFilingTarget();
    test.skip('error' in target, `${TENANT} cannot supply a complaint type to file against`);
    const filing = target as { serviceCode: string; localityCode: string };

    const backDated = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const forged: Record<string, unknown> = {
      assignmentChangedAt: backDated,
      assignmentChangeSource: 'FORGED',
      escalationLevel: 5,
      escalationWindowStartedAt: backDated,
      lastEscalatedAt: backDated,
      escalatedFrom: [citizen!.uuid],
      escalatedTo: citizen!.uuid,
      escalationTrigger: 'AUTOMATIC',
      metadataProbe: 'client-supplied-and-harmless',
    };

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizen!.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: citizen!.token, userInfo: citizenUserInfo(citizen!) },
        service: {
          tenantId: TENANT,
          serviceCode: filing.serviceCode,
          description: `escalation-metadata forged create — ${new Date().toISOString()}`,
          source: 'web',
          address: { city: TENANT, locality: { code: filing.localityCode }, geoLocation: { latitude: 0, longitude: 0 } },
          citizen: { name: citizen!.name, mobileNumber: citizen!.mobile },
          additionalDetail: forged,
        },
        workflow: { action: 'APPLY' },
      }),
    });
    const body = await assertOk(resp, 'citizen _create carrying forged escalation metadata');
    const service = body.ServiceWrappers[0].service;
    created.add(service.serviceRequestId);
    const detail = service.additionalDetail ?? {};

    expect(
      detail.metadataProbe,
      'control: a field the server does not own must survive, proving additionalDetail was read and persisted rather than ignored',
    ).toBe('client-supplied-and-harmless');

    expect(Number(detail.escalationLevel ?? 0), 'a freshly filed complaint starts at rung zero whatever the caller claimed').toBe(0);
    for (const field of SERVER_OWNED) {
      if (field === 'escalationLevel') continue;
      expect(detail[field], `${field} was supplied by the caller and must have been discarded`).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Chain B — on update
// ---------------------------------------------------------------------------

test.describe('PGR escalation metadata — on update', () => {
  let srid = '';

  test.beforeAll(async () => {
    if (skipReason || chain.length < 2) return;
    srid = await newComplaint('update');
    remember(chain[0]);
    await setReportingTo(chain[0], chain[1].uuid, 'update setup');
    if (chain[2]) {
      remember(chain[1]);
      await setReportingTo(chain[1], chain[2].uuid, 'update setup');
    }
    await assignTo(srid, chain[0].uuid, 'update');
  });

  const chainSkip = () =>
    `department '${department}' on ${TENANT} has ${patchableDepth} patchable employee(s) of ${inDepartmentCount} — ` +
    `this case needs 3 to escalate twice along a wired line`;

  test('cannot be talked into forging the level, the target or the clock', {
    annotation: {
      type: 'description',
      description: `Covers ESC/058 and ESC/027. preserveServerMetadata overwrites each incoming server-owned field with the persisted value, and removes the key outright when nothing is persisted — so an update can neither invent an escalation, nor redirect one, nor move the clock it is measured against.

Steps:
1. Escalate once legitimately. Note the real level and real target, and that no clock anchor is stored.
2. Escalate AGAIN, echoing the persisted body back with escalationLevel 99, escalatedTo pointed at somebody the server could never choose at this point in the chain, and escalationWindowStartedAt back-dated 30 days.
3. Assert the level advanced by exactly one, to 2 — not to 99, and not to 100.
4. Assert escalatedTo is the manager the server resolved, not the name supplied.
5. Assert escalationWindowStartedAt is still absent, so the anchor is still createdTime, and that createdTime itself did not move.

Escalating is the right vehicle rather than a benign action: it is the one operation that legitimately writes these fields, so it is where a preservation bug would actually surface.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:edge-case'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    test.skip(patchableDepth < 3, chainSkip());
    const [anchor, manager, second] = chain;

    await ensureHeldByAnchor(srid);
    const start = await levelOf(srid);
    test.skip(start + 2 > maxDepth, `${srid} is at level ${start} with maxDepth=${maxDepth}; this case needs two spare rungs`);

    const first = await assertOk(await act(srid, { action: 'ESCALATE', comments: 'legitimate hop' }), 'ESCALATE (legitimate)');
    const firstDetail = first.ServiceWrappers[0].service.additionalDetail;
    expect(Number(firstDetail.escalationLevel)).toBe(start + 1);
    expect(firstDetail.escalatedTo).toBe(manager.uuid);
    expect(firstDetail.escalationWindowStartedAt, 'no anchor is stored on an ordinary complaint — createdTime is the effective anchor').toBeUndefined();

    const createdTime = (await fetchComplaint(srid)).auditDetails?.createdTime;
    const backDated = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // The forged target must not be the one the server would legitimately pick.
    // After hop 1 the manager holds it, so hop 2 resolves to `second`; naming
    // `second` would make the assertion below vacuously true. Point the forgery
    // backwards at the anchor — a target the server cannot choose from here.
    const forgedTarget = anchor.uuid;
    expect(forgedTarget, 'the forged target must differ from the legitimate one').not.toBe(second.uuid);

    const forged = await assertOk(
      await act(srid, { action: 'ESCALATE', comments: 'forged hop' }, (service) => {
        service.additionalDetail = {
          ...(service.additionalDetail ?? {}),
          escalationLevel: 99,
          escalatedTo: forgedTarget,
          escalatedFrom: [forgedTarget],
          escalationWindowStartedAt: backDated,
          lastEscalatedAt: backDated,
          escalationTrigger: 'AUTOMATIC',
        };
      }),
      'ESCALATE carrying forged metadata',
    );
    const detail = forged.ServiceWrappers[0].service.additionalDetail;

    expect(Number(detail.escalationLevel), 'the level advances by exactly one from the PERSISTED value, ignoring the forgery').toBe(start + 2);
    expect(detail.escalatedTo, 'the server resolves the target from HRMS; the caller cannot redirect it').toBe(second.uuid);
    expect(detail.escalationTrigger, 'a manual call cannot label itself automatic').toBe('MANUAL');
    expect(detail.escalationWindowStartedAt, 'a forged clock anchor must be removed, not stored').toBeUndefined();
    expect((await fetchComplaint(srid)).auditDetails?.createdTime, 'the effective anchor is unchanged').toBe(createdTime);
  });

  test('holds one escalation count per complaint, reconciled against the workflow history', {
    annotation: {
      type: 'description',
      description: `Covers ESC/060 and ESC/033. The level the service acts on is max(stored level, count of ESCALATE entries in workflow history since the clock anchor), so metadata that lags a successful transition cannot let a rung fire forever.

Steps:
1. Ensure the complaint carries at least one real escalation.
2. Assert the stored escalationLevel equals the number of ESCALATE process instances in its workflow history — whatever that number is.
3. Assert additionalDetail carries exactly one escalation counter and nothing per-state.

This asserts the reconciliation's invariant rather than simulating a lagging write, because forcing the metadata out of step with the history would mean writing a server-owned field — and the test above proves that cannot be done through the API.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:regression'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    test.skip(patchableDepth < 2, chainSkip());

    await ensureHeldByAnchor(srid);
    await ensureEscalatedTo(srid, 1);

    const svc = await fetchComplaint(srid);
    const stored = Number(svc.additionalDetail?.escalationLevel ?? 0);
    expect(stored, 'this case needs at least one real escalation to reconcile').toBeGreaterThan(0);
    expect(
      await escalateCount(srid),
      'the stored level and the workflow history must agree — divergence is what the reconciliation exists to absorb',
    ).toBe(stored);

    const keys = Object.keys(svc.additionalDetail ?? {});
    expect(keys.filter((k) => /escalationlevel/i.test(k)), `exactly one escalation counter — found ${JSON.stringify(keys)}`).toEqual(['escalationLevel']);
  });

  test('can be handed back down, and no assignment action reads the escalation level', {
    annotation: {
      type: 'description',
      description: `Covers ESC/070, ESC/071 and ESC/072.

The workflow does give a senior a route back down — REASSIGN from the assigned state into the queue, then ASSIGN out of it — and the employee the complaint was escalated away from can be named as the new assignee. What no assignment action does is consider the escalation level: the assignment branch uses putIfAbsent, so a first assignment initialises the level to 0 while later reassignments preserve consumed rungs, and there is no affordance to lower it on the way down.

Steps:
1. Ensure the complaint carries at least one escalation, and note the level.
2. REASSIGN. Assert it lands in the queue with the level intact — ESC/070.
3. ASSIGN back to the anchor, the very employee it was escalated away from. Assert it succeeds — ESC/071.
4. Assert the level is unchanged through both — ESC/072.
5. REASSIGN again while naming escalationLevel 0 in the body. Assert it is still unchanged.

Step 5 separates "no action resets the level" from "no action can be TOLD to reset it", which is the part of ESC/072 that matters for security rather than bookkeeping.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:edge-case'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    test.skip(patchableDepth < 2, chainSkip());
    test.skip(!reassignQueue, `${TENANT} defines no REASSIGN action, so there is no route back down`);

    await ensureHeldByAnchor(srid);
    await ensureEscalatedTo(srid, 1);
    const before = await levelOf(srid);
    expect(before, 'this case starts from an escalated complaint').toBeGreaterThan(0);

    const reassigned = await assertOk(await act(srid, { action: 'REASSIGN', comments: 'senior hands it back' }), 'REASSIGN');
    const reassignedSvc = reassigned.ServiceWrappers[0].service;
    expect(reassignedSvc.applicationStatus, 'a senior can send an escalated complaint back down').toBe(reassignQueue);
    expect(Number(reassignedSvc.additionalDetail.escalationLevel), 'handing it back must not refund a rung').toBe(before);

    const back = await assignTo(srid, chain[0].uuid, 'back to the original holder');
    expect(
      Number(back.additionalDetail.escalationLevel),
      'the complaint can go back to the employee it was escalated away from, still at the level it reached',
    ).toBe(before);

    const forged = await assertOk(
      await act(srid, { action: 'REASSIGN', comments: 'reassign naming level 0' }, (service) => {
        service.additionalDetail = { ...(service.additionalDetail ?? {}), escalationLevel: 0 };
      }),
      'REASSIGN naming escalationLevel 0',
    );
    expect(
      Number(forged.ServiceWrappers[0].service.additionalDetail.escalationLevel),
      'an assignment action cannot be told to lower the escalation level',
    ).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Chain C — the clock
// ---------------------------------------------------------------------------

test.describe('PGR escalation metadata — the clock', () => {
  let srid = '';

  test.beforeAll(async () => {
    if (skipReason) return;
    srid = await newComplaint('clock');
  });

  test('the escalation clock survives comments, assignment, reassignment and edits', {
    annotation: {
      type: 'description',
      description: `Covers ESC/026: ordinary activity on a complaint never delays or restarts its escalation timing. Thresholds are cumulative from when the complaint was raised, so none of the day-to-day traffic on a complaint should move them. Using lastModifiedTime as the clock would let unrelated activity postpone escalation indefinitely, and the service's comments call out that this is deliberately not the clock.

Uses its own complaint, never escalated — the assertion is that no escalation anchor EVER appears, and escalating would have written one.

Steps, each followed by a re-read:
1. A citizen COMMENT (the workflow grants COMMENT to CITIZEN only).
2. ASSIGN to the anchor.
3. An edit to the description, sent alongside a transition.
4. REASSIGN, into the queue.
5. ASSIGN again.

After every step: createdTime is unchanged and escalationWindowStartedAt is still absent.`,
    },
    tag: ['@persona:cross', '@area:pgr', '@layer:api', '@kind:regression'],
  }, async () => {
    test.skip(!!skipReason, skipReason);
    test.skip(patchableDepth < 1, `department '${department}' on ${TENANT} has no patchable employee to assign to`);

    const baseline = await fetchComplaint(srid);
    const createdTime = baseline.auditDetails?.createdTime;
    expect(createdTime, 'a complaint must carry a createdTime to anchor its escalation clock').toBeTruthy();

    const anchorUnmoved = async (afterWhat: string) => {
      const svc = await fetchComplaint(srid);
      expect(svc.auditDetails?.createdTime, `createdTime must not move after ${afterWhat}`).toBe(createdTime);
      expect(
        svc.additionalDetail?.escalationWindowStartedAt,
        `no escalation anchor should appear after ${afterWhat} — only a reopen re-anchors the clock`,
      ).toBeUndefined();
      return svc;
    };

    if (citizen) {
      const svc = await fetchComplaint(srid);
      await assertOk(
        await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${encodeURIComponent(TENANT)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${citizen.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker', authToken: citizen.token, userInfo: citizenUserInfo(citizen) },
            service: svc,
            workflow: { action: 'COMMENT', comments: 'escalation-metadata citizen comment' },
          }),
        }),
        'citizen COMMENT',
      );
      await anchorUnmoved('a citizen comment');
    }

    await assignTo(srid, chain[0].uuid, 'clock');
    const afterAssign = await anchorUnmoved('an assignment');
    const firstChangedAt = Number(afterAssign.additionalDetail?.assignmentChangedAt ?? 0);
    expect(
      firstChangedAt,
      'control: ASSIGN must stamp assignmentChangedAt — without this moving, "the clock did not move" is vacuously true',
    ).toBeGreaterThan(0);

    await assertOk(
      await act(srid, { action: 'COMMENT', comments: 'escalation-metadata edit' }, (service) => {
        service.description = `edited by escalation-metadata — ${new Date().toISOString()}`;
      }),
      'description edit',
    );
    await anchorUnmoved('an edit to the description');

    if (reassignQueue) {
      await assertOk(await act(srid, { action: 'REASSIGN', comments: 'escalation-metadata reassign' }), 'REASSIGN');
      await anchorUnmoved('a reassignment');
      await assignTo(srid, chain[0].uuid, 'clock re-assign');
      const afterReassign = await anchorUnmoved('being assigned again');
      expect(
        Number(afterReassign.additionalDetail?.assignmentChangedAt ?? 0),
        'control: the assignment audit stamp moves even though the escalation clock does not',
      ).toBeGreaterThanOrEqual(firstChangedAt);
    }
  });
});
