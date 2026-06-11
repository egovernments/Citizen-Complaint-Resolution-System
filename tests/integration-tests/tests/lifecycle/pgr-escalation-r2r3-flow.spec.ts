/**
 * PGR ROLE-LEVEL escalation — R2 ladder / R3 reportingTo-consensus + the
 * CROSS-TENANT memoization proof — FULL-FLOW E2E on live Bomet.
 *
 * Sibling of pgr-escalation-role-flow.spec.ts (which proves R1_PIN). This
 * spec drives the two REMAINING strategies of
 * EscalationService.doResolveRoleTarget plus their ambiguity skips, and
 * closes with the tenant-keyed-cache proof: ONE scan resolving the SAME
 * acting role to DIFFERENT people on two city tenants.
 *
 * LIVE FIXTURE (persistent, created by scripts/setup-role-fixture.mjs —
 * see its header for the full inventory; re-run it for a no-op verify):
 *   Roles at root `ke`: E2E_SUP1, E2E_SUP2, E2E_ROLE3, E2E_ROLE4.
 *   ke.etoeroles (locality ETOEROLES_WARD_1):
 *     E2E_SUP1_HOLDER [E2E_SUP1]                      — R2 exactly-one target
 *     E2E_SUP2_A + E2E_SUP2_B [E2E_SUP2]              — R2 ambiguous pair
 *     E2E_R3_A + E2E_R3_B [E2E_ROLE3] → both reportingTo SUP1_HOLDER (R3 consensus)
 *     E2E_R4_A → SUP2_A, E2E_R4_B → SUP2_B [E2E_ROLE4] (R3 split)
 *   ke.etoebeta (locality ETOEBETA_WARD_1):
 *     E2E_SUP1_BETA [E2E_SUP1]                        — same role, different person
 *   All uuids are re-resolved from HRMS at runtime (test 0) and the layout
 *   is verified — drift skips the suite with a clear message instead of
 *   producing misleading scenario failures.
 *
 * SAFETY INVARIANTS (verified live in test 0):
 *   - The E2E_* role codes have ZERO holders at the production city tenant
 *     (ke.bomet), so while roleEscalation is enabled mid-suite, any
 *     unattended production complaint resolves to NO_ROLE_SUPERVISOR — a
 *     read-only skip. No production mutation is possible through the role
 *     path during the enabled windows.
 *   - The CRS.EscalationPolicy singleton at `ke` is PRODUCTION-SHARED: it is
 *     snapshotted ONCE before the first write and restored BYTE-IDENTICALLY
 *     in afterAll (verified via stable-stringify compare), exactly like the
 *     R1 sibling. Every mid-suite reconfiguration derives from the SNAPSHOT
 *     (never from the live row), so no scenario can leak fields into the next
 *     or into the restore.
 *
 * SCENARIOS (serial; policy.roleEscalation reconfigured between them —
 * update → 10 s persister settle → verify on the scheduler's v1 read path):
 *   A — R2 exactly-one (REAL):   ladder {E2E_ROLE3→E2E_SUP1} at alpha; the
 *       single holder wins; dryRun provenance R2_LADDER/candidateCount 1,
 *       then the real trigger assigns SUP1_HOLDER + role audit comment.
 *   B — R2 ambiguous (dryRun):   ladder {E2E_ROLE3→E2E_SUP2}; two holders →
 *       SKIPPED / ROLE_SUPERVISOR_AMBIGUOUS / candidateCount 2 (the number
 *       of ladder-role holders) / R2_LADDER; wouldEscalate 0. Skips are
 *       read-only so no real trigger is needed.
 *   C — R3 consensus (REAL):     NO ladder entry; both E2E_ROLE3 holders'
 *       current assignments report to SUP1_HOLDER → R3_REPORTING resolves
 *       the consensus uuid; candidateCount 1 (the number of DISTINCT
 *       reportingTo values, not holders); real trigger assigns SUP1_HOLDER.
 *   D — R3 split (dryRun):       acting role E2E_ROLE4, no ladder; holders
 *       report to different uuids → ROLE_SUPERVISOR_AMBIGUOUS with
 *       candidateCount 2 (distinct reportingTo set) / R3_REPORTING.
 *   E — cross-tenant memo (REAL): ladder {E2E_ROLE3→E2E_SUP1}; one
 *       unassigned tuple complaint in EACH tenant; ONE trigger with both
 *       srids and tenantId='ke' → escalated 2, alpha's PI assigned to
 *       SUP1_HOLDER and beta's to E2E_SUP1_BETA. Two different uuids out of
 *       a single scan prove resolveRoleTarget's per-scan memo is keyed on
 *       (tenantId, actingRole, department) — a tenant-less key would have
 *       reused alpha's answer for beta.
 *
 * FIELD SEMANTICS pinned against EscalationService/EscalationScheduler:
 *   - candidateCount: R2 = holders of the LADDER role; R3 = DISTINCT
 *     reportingTo uuids across holders of the ACTING role (so consensus over
 *     2 holders reports 1, split over 2 holders reports 2).
 *   - departmentFiltered: false here in every scenario — ObsoleteOrDamagedPipeline's
 *     ServiceDefs row at `ke` has no (path, category, subcategoryL1) tuple,
 *     so buildServiceCodeMapping never maps it and the scheduler resolves
 *     department=null → searchCandidates starts unfiltered (verified live).
 *   - Skip outcomes carry action SKIPPED + reason (the EscalationSkipReason
 *     name) + the same provenance fields, via recordRoleSkip.
 *
 * CRON STRATEGY (sentinel ONCE, then quiet-window discipline):
 *   roleEscalation stays enabled for most of the suite, and the background
 *   cron (every 300 s, SYSTEM identity) scans state-wide — including the
 *   fixture tenants, where resolution SUCCEEDS. Whether the cron can
 *   actually MUTATE is decided by the PGR workflow's treatment of the
 *   cron's SYSTEM transition, which has CHANGED across Bomet builds (the R1
 *   sibling documented a rejection; run 2 of THIS spec observed the cron
 *   role-escalate the sentinel on the current build even though the
 *   ESCALATE action's role list still reads GRO/AUTO_ESCALATE/PGR_VIEWER) —
 *   so the spec never assumes a branch: test 2 measures it live with ONE
 *   unassigned tuple sentinel at alpha observed over a full cron period:
 *     - QUIET branch: sentinel times out un-escalated → the cron cannot
 *       mutate, scenario complaints need no phase discipline at all (scoped
 *       triggers are the only mutators).
 *     - MUTATING branch (OBSERVED on current Bomet, 2026-06-11): the
 *       sentinel IS escalated; the observation timestamp anchors a
 *       quiet-window helper: every REAL scenario (A/C/E) files its
 *       complaints only when ≥150 s remain before the next predicted tick,
 *       so create→breach→trigger→verify (~110 s) completes inside the
 *       window. fixedDelay drifts by the scan duration (~5 s) each tick, so
 *       predictions are approximate — the helper waits an extra 45 s past a
 *       predicted tick and the 150 s budget leaves ~40 s slack on top of
 *       the scenario's real needs. Scenario timeouts budget a FULL extra
 *       cron period for the possible quiet-window wait. Scenarios B/D are
 *       immune either way: their resolutions are AMBIGUOUS, which skips
 *       (read-only) under any identity.
 *   Residue policy: scenario complaints stay on the fixture tenants after
 *   the suite (B/D unassigned with a then-deactivated tuple; A/C/E assigned
 *   to fixture employees). The fixture's smoke complaints are acceptable
 *   cron casualties if a future workflow ever grants SYSTEM.
 *
 * CONCURRENT-WRITER GUARD (learned the hard way — run 1, 2026-06-11): the
 * policy singleton is shared not just with production but with OTHER e2e
 * suites (the escalation-settings UI spec runs its own enable→restore cycles
 * against this very row; one such session clobbered scenario A's config
 * mid-run, turning the dryRun verdict into a baffling NO_ASSIGNEES). The
 * suite cannot lock MDMS, so instead every trigger is preceded by a re-read
 * of the scheduler's v1 policy: if roleEscalation no longer equals the
 * active scenario config, the spec fails IMMEDIATELY with an explicit
 * CONCURRENT WRITER diagnostic (including the row's audit trail) instead of
 * a misleading provenance assertion. Do not run this spec concurrently with
 * other escalation suites against the same deployment.
 *
 * SEEDS (all at the STATE tenant `ke`, the scheduler's read tenant):
 *   - ONE CRS.CategorySLA tuple row (E2E-R2R3 / EscalationTest / R2R3) with
 *     slaHoursByLevel [0.00417] (~15 s) — tuple-scoped: only this spec's
 *     complaints carry the tuple in additionalDetail, and the state-level
 *     read serves BOTH city tenants. Deactivated in afterAll.
 *   - CRS.EscalationPolicy.roleEscalation — reconfigured per scenario,
 *     restored from the single snapshot in afterAll.
 *   - NO CRS.RoleSupervisors rows: R1 must never win in this spec (verified
 *     in test 1 — any active pin for the acting roles fails fast).
 *
 * Required env (defaults in ../utils/env.ts):
 *   BASE_URL       e.g. https://bometfeedbackhub.digit.org
 *   DIGIT_TENANT   e.g. ke.bomet  (ROOT_TENANT derived: ke; fixture tenants
 *                  derived: ke.etoeroles / ke.etoebeta)
 *   SERVICE_CODE   complaint type live on BOTH fixture tenants
 *                  (ObsoleteOrDamagedPipeline — ServiceDefs resolve at root)
 *   DIGIT_USERNAME / DIGIT_PASSWORD  ADMIN at ROOT_TENANT and (via the
 *                  fixture's dual-scoped provisioning) at both city tenants
 *
 * Run:
 *   BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.bomet \
 *   LOCALITY_CODE=BOMET_BOMET_EAST_CHEMANER SERVICE_CODE=ObsoleteOrDamagedPipeline \
 *   npx playwright test tests/lifecycle/pgr-escalation-r2r3-flow.spec.ts --reporter=line
 *
 * PACING RULE (binding, inherited from the siblings): 15 s tuple SLA, a
 * full 60 s before every verdict, 10 s persister settles, one full cron
 * period for the sentinel. Determinism beats speed — the suite legitimately
 * takes 10+ minutes.
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import {
  BASE_URL, TENANT, ROOT_TENANT,
  ADMIN_USER, ADMIN_PASS,
  SERVICE_CODE,
} from '../utils/env';

// ---------------------------------------------------------------------------
// Fixture topology (codes are stable; uuids resolved live in test 0).
// ---------------------------------------------------------------------------
const TENANT_ALPHA = `${ROOT_TENANT}.etoeroles`;
const TENANT_BETA = `${ROOT_TENANT}.etoebeta`;
const FIXTURE = {
  [TENANT_ALPHA]: { name: 'E2E Roles Alpha', locality: 'ETOEROLES_WARD_1' },
  [TENANT_BETA]: { name: 'E2E Roles Beta', locality: 'ETOEBETA_WARD_1' },
} as const;

const ROLE_SUP1 = 'E2E_SUP1';
const ROLE_SUP2 = 'E2E_SUP2';
const ROLE_R3 = 'E2E_ROLE3';
const ROLE_R4 = 'E2E_ROLE4';
const ALL_FIXTURE_ROLES = [ROLE_SUP1, ROLE_SUP2, ROLE_R3, ROLE_R4];

// ---------------------------------------------------------------------------
// Test-scoped SLA tuple — only complaints created by this spec carry it, so
// the 15 s SLA can never leak onto production complaints. Read at the state
// tenant, so ONE row serves both fixture tenants.
// ---------------------------------------------------------------------------
const TUPLE = { path: 'E2E-R2R3', category: 'EscalationTest', subcategoryL1: 'R2R3' };
const TUPLE_UID = `${TUPLE.path}.${TUPLE.category}.${TUPLE.subcategoryL1}`;
const CATEGORY_SLA_SCHEMA = 'CRS.CategorySLA';
/** 0.00417 h ≈ 15 s. Per-level cells are HOURS and must be > 0 (levelCellToMillis). */
const SLA_HOURS_L0 = 0.00417;

const POLICY_SCHEMA = 'CRS.EscalationPolicy';
const POLICY_UID = 'default';
const PIN_SCHEMA = 'CRS.RoleSupervisors';

// Pacing (see PACING RULE in the header).
const PERSISTER_WAIT_MS = 10_000;
const SLA_ELAPSE_WAIT_MS = 60_000;
/** pgr.escalation.interval.ms is 300 s (fixedDelay) on Bomet. */
const CRON_PERIOD_MS = 300_000;
const CRON_OBSERVE_TIMEOUT_MS = 390_000;
const CRON_POLL_INTERVAL_MS = 10_000;
/** Budget a REAL scenario needs inside a cron quiet window (defensive branch only). */
const QUIET_WINDOW_NEEDED_MS = 150_000;

const PENDINGFORASSIGNMENT = 'PENDINGFORASSIGNMENT';
const SLA_SOURCE_CATEGORY_LEVEL = 'CRS.CategorySLA.level';
const STRATEGY_R2_LADDER = 'R2_LADDER';
const STRATEGY_R3_REPORTING = 'R3_REPORTING';
const REASON_AMBIGUOUS = 'ROLE_SUPERVISOR_AMBIGUOUS';

/**
 * Role-path audit comment template (EscalationService.buildRoleEscalateComment).
 * No ", department fallback" suffix: the suffix needs departmentFiltered=false
 * WITH a non-null department, and this serviceCode resolves department=null
 * (no complete ServiceDefs tuple at `ke` — verified live).
 */
const roleCommentRe = (actingRole: string) => new RegExp(
  `Auto-escalated \\(no recorded assignee\\): assigned to .+ — acting role ${actingRole} \\(elapsed \\d+h > SLA \\d+h\\)`,
);

// ---------------------------------------------------------------------------
// Local helpers (kept here, not factored into utils/, so this spec stays
// independently runnable and easy to diff against its R1 sibling).
// ---------------------------------------------------------------------------

async function assertOk(resp: Response, ctx: string): Promise<any> {
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`${ctx}: HTTP ${resp.status} — ${JSON.stringify(body).slice(0, 800)}`);
  }
  return body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deterministic JSON with recursively sorted keys — the byte-identical-restore comparator. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as object).sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Unique Kenya-valid 9-digit 7-prefix citizen mobile per complaint. */
let phoneSeq = 0;
function nextCitizenPhone(): string {
  phoneSeq += 1;
  return '7' + (Date.now() + phoneSeq * 17).toString().slice(-8);
}

async function searchEmployeesByRole(token: string, tenantId: string, role: string): Promise<any[]> {
  const resp = await fetch(
    `${BASE_URL}/egov-hrms/employees/_search?tenantId=${tenantId}&roles=${role}&isActive=true&offset=0&limit=100`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token } }),
    },
  );
  const data = await assertOk(resp, `HRMS employees/_search ${role}@${tenantId}`);
  return data.Employees || [];
}

const currentAssignment = (emp: any) =>
  (emp.assignments || []).find((a: any) => a.isCurrentAssignment === true) || null;

async function fetchComplaint(token: string, userInfo: Record<string, unknown>, tenantId: string, srid: string): Promise<any> {
  const resp = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${tenantId}&serviceRequestId=${encodeURIComponent(srid)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo } }),
    },
  );
  const data = await assertOk(resp, `PGR _search ${srid}@${tenantId}`);
  return data.ServiceWrappers?.[0]?.service;
}

/** Latest (non-history) ProcessInstance — the exact read EscalationService.getCurrentAssignees does first. */
async function fetchLatestProcessInstance(token: string, userInfo: Record<string, unknown>, tenantId: string, srid: string): Promise<any> {
  const resp = await fetch(
    `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?tenantId=${tenantId}&businessIds=${encodeURIComponent(srid)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo } }),
    },
  );
  const data = await assertOk(resp, `workflow process/_search ${srid}@${tenantId}`);
  return (data.ProcessInstances ?? [])[0];
}

/**
 * File an UNASSIGNED tuple complaint at a fixture tenant. PGR _create on
 * these tenants is driven by the CITY-tenant ADMIN token (the login-tenant-
 * scoped CITIZEN/CSR roles are what the workflow APPLY transition
 * authorizes against — a root-ke token gets INVALID ROLE on APPLY), with
 * the citizen embedded in the service payload, same proven shape as the
 * fixture script's pgrSmoke.
 */
async function createComplaint(
  city: { token: string; userInfo: Record<string, unknown> },
  tenantId: string,
  description: string,
): Promise<any> {
  const fx = FIXTURE[tenantId as keyof typeof FIXTURE];
  const phone = nextCitizenPhone();
  const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${city.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: city.token, userInfo: city.userInfo, ts: Date.now() },
      service: {
        tenantId,
        serviceCode: SERVICE_CODE,
        description,
        source: 'web',
        address: {
          tenantId,
          city: fx.name,
          locality: { code: fx.locality, name: fx.locality },
          // geoLocation MUST be an object — the persister crashes on null (PathNotFoundException)
          geoLocation: { latitude: 0, longitude: 0 },
        },
        citizen: {
          name: 'E2E R2R3 Citizen',
          mobileNumber: phone,
          userName: phone,
          type: 'CITIZEN',
          tenantId: ROOT_TENANT,
          roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: ROOT_TENANT }],
        },
        active: true,
        // Strategy-A tuple: extractCategoryTuple reads these three keys from
        // additionalDetail and matches them against the seeded CategorySLA row.
        additionalDetail: { ...TUPLE },
      },
      workflow: { action: 'APPLY' },
    }),
  });
  const data = await assertOk(resp, `PGR _create @ ${tenantId}`);
  const svc = data.ServiceWrappers?.[0]?.service;
  if (!svc?.serviceRequestId) {
    throw new Error(`PGR _create @ ${tenantId} returned no serviceRequestId: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return svc;
}

// --- MDMS v2 helpers (same machinery as the R1 sibling) ---------------------

async function mdmsSearchRow(token: string, schemaCode: string, uniqueIdentifier: string): Promise<any | undefined> {
  const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token, ts: Date.now() },
      MdmsCriteria: {
        // The scheduler reads CRS masters at the STATE tenant, so all rows
        // live at ROOT_TENANT — which also lets ONE tuple row serve both
        // fixture city tenants.
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
 * update path.
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
      Mdms: { tenantId: ROOT_TENANT, schemaCode, uniqueIdentifier, data, isActive: true },
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
 * module CRS at the state tenant). fetchCrsEscalationPolicy consumes
 * rows[0] of this result.
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
    // proving slaSource === 'CRS.CategorySLA.level' across both tenants.
    slaHoursByState: {},
    slaHoursByLevel: [SLA_HOURS_L0],
    isActive: true,
  };
}

/** Shape of a roleEscalation block this spec writes between scenarios. */
interface RoleEscalationConfig {
  enabled: boolean;
  actingRoleByState: Record<string, string>;
  supervisorRoleByRole?: Record<string, string>;
  maxPerScan: number;
}

/**
 * POST /escalation/_trigger with retry on 409 SCAN_IN_PROGRESS (a background
 * cron tick can hold the single-replica overlap guard mid-flight; scan ticks
 * finish in seconds). Dry runs bypass the guard server-side.
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

test.describe.serial('PGR role escalation R2/R3 + cross-tenant on Bomet (ladder, consensus, ambiguity skips, tenant-keyed memo)', () => {
  let adminToken: string;
  let adminUserInfo: Record<string, unknown>;
  const cityAdmin: Record<string, { token: string; userInfo: Record<string, unknown> }> = {};

  // Resolved at runtime from HRMS — no hardcoded uuids load-bear.
  let sup1AlphaUuid: string;   // E2E_SUP1_HOLDER @ alpha (R2-A + R3-C + E target)
  let sup1BetaUuid: string;    // E2E_SUP1_BETA @ beta (E target)
  let fixtureMissing = false;
  let fixtureMissingMsg = '';

  // Cleanup bookkeeping — flags set BEFORE each write fires so a
  // failed-but-maybe-applied write still gets restored/deactivated.
  let policySnapshotData: Record<string, unknown> | undefined;
  let policySnapshotActive = true;
  let policyMutated = false;
  let tupleTouched = false;
  let seedLive = false;

  // Cron calibration (test 2). undefined anchor = cron cannot mutate (expected).
  let cronTickAnchorMs: number | undefined;
  let sentinelSrid: string | undefined;

  // The roleEscalation block this suite believes is live (set by every
  // reconfigure) — the reference for the concurrent-writer guard.
  let activeRoleEscalation: RoleEscalationConfig | undefined;

  // Traceability of every complaint this spec files.
  const filedSrids: string[] = [];

  /**
   * Reconfigure CRS.EscalationPolicy.roleEscalation, settle, then verify the
   * config landed on BOTH read paths (v2 = what we wrote; v1 rows[0] = the
   * EXACT object fetchCrsEscalationPolicy hands the scheduler). Always
   * derives from the SNAPSHOT so scenario configs can't leak into each other
   * (e.g. scenario B's ladder lingering into scenario C's no-ladder run) and
   * pre-existing production fields are preserved byte-for-byte.
   */
  async function reconfigureRoleEscalation(label: string, cfg: RoleEscalationConfig): Promise<void> {
    expect(policySnapshotData, 'policy snapshot must exist before any reconfiguration').toBeTruthy();
    const record = await mdmsSearchRow(adminToken, POLICY_SCHEMA, POLICY_UID);
    expect(record, `${POLICY_SCHEMA}/${POLICY_UID} must be re-searchable for the ${label} reconfig`).toBeTruthy();
    policyMutated = true; // idempotent; set before the write
    await mdmsUpdateRow(adminToken, adminUserInfo, POLICY_SCHEMA, record, {
      ...(policySnapshotData as Record<string, unknown>),
      roleEscalation: cfg,
    }, policySnapshotActive);
    console.log(`[policy:${label}] roleEscalation → ${JSON.stringify(cfg)}; settling ${PERSISTER_WAIT_MS / 1000}s`);
    await sleep(PERSISTER_WAIT_MS);

    const live = await mdmsSearchRow(adminToken, POLICY_SCHEMA, POLICY_UID);
    expect(stableStringify(live?.data?.roleEscalation),
      `[${label}] v2 re-read must show the new roleEscalation`).toBe(stableStringify(cfg));
    for (const key of Object.keys(policySnapshotData as object)) {
      expect(stableStringify(live?.data?.[key]),
        `[${label}] pre-existing policy field '${key}' must be preserved`)
        .toBe(stableStringify((policySnapshotData as any)[key]));
    }

    const v1Rows = await v1CrsMaster(adminToken, 'EscalationPolicy');
    expect(v1Rows.length, `[${label}] policy singleton must be visible on the v1 read path`).toBeGreaterThan(0);
    expect(stableStringify(v1Rows[0]?.roleEscalation),
      `[${label}] scheduler reads v1 rows[0] — it must carry the new roleEscalation (got ${JSON.stringify(v1Rows[0]?.roleEscalation)})`)
      .toBe(stableStringify(cfg));
    activeRoleEscalation = cfg;
    console.log(`[policy:${label}] verified on v2 + scheduler v1 read paths (row lastModified ${live?.auditDetails?.lastModifiedTime})`);
  }

  /**
   * Concurrent-writer guard (see header): re-read the scheduler's v1 policy
   * IMMEDIATELY before a trigger and fail with an explicit diagnostic if the
   * active scenario config was clobbered by another session. Run 1 of this
   * spec lost scenario A exactly this way (a concurrent escalation-settings
   * UI suite restored ITS policy snapshot over ours mid-run).
   */
  async function assertPolicyStillOurs(label: string): Promise<void> {
    const v1Rows = await v1CrsMaster(adminToken, 'EscalationPolicy');
    const live = v1Rows[0]?.roleEscalation;
    if (stableStringify(live) === stableStringify(activeRoleEscalation)) return;
    let audit = '(audit unavailable)';
    try {
      const v2 = await mdmsSearchRow(adminToken, POLICY_SCHEMA, POLICY_UID);
      audit = `lastModifiedTime=${v2?.auditDetails?.lastModifiedTime} (${new Date(v2?.auditDetails?.lastModifiedTime ?? 0).toISOString()}) lastModifiedBy=${v2?.auditDetails?.lastModifiedBy}`;
    } catch { /* diagnostic best-effort */ }
    throw new Error(
      `[${label}] CONCURRENT WRITER on ${POLICY_SCHEMA}/${POLICY_UID}: the scheduler's v1 read no longer shows ` +
      `this suite's roleEscalation config.\n  expected: ${stableStringify(activeRoleEscalation)}\n  live:     ${stableStringify(live)}\n  row audit: ${audit}\n` +
      'Another session (e.g. the escalation-settings UI suite) is mutating the shared policy singleton — ' +
      're-run this spec when no other escalation suite is active against this deployment. ' +
      'afterAll will still restore THIS suite\'s snapshot.',
    );
  }

  /**
   * Quiet-window discipline (defensive branch only — see CRON STRATEGY in
   * the header). No-op when test 2 proved the cron cannot mutate.
   */
  async function awaitQuietWindow(label: string): Promise<void> {
    if (cronTickAnchorMs === undefined) return;
    for (;;) {
      const sinceAnchor = (Date.now() - cronTickAnchorMs) % CRON_PERIOD_MS;
      const untilNextTick = CRON_PERIOD_MS - sinceAnchor;
      if (untilNextTick > QUIET_WINDOW_NEEDED_MS) {
        console.log(`[quiet-window:${label}] ~${Math.round(untilNextTick / 1000)}s until predicted tick — proceeding`);
        return;
      }
      // +45s margin: fixedDelay drifts ~5s per tick past the 300s model, so
      // by the later scenarios the REAL tick lands after the predicted one.
      console.log(`[quiet-window:${label}] predicted cron tick in ~${Math.round(untilNextTick / 1000)}s — waiting it out (+45s margin)`);
      await sleep(untilNextTick + 45_000);
    }
  }

  /** File an unassigned tuple complaint and assert creation invariants. */
  async function fileScenarioComplaint(tenantId: string, label: string): Promise<{ srid: string; createdAtMs: number }> {
    const svc = await createComplaint(cityAdmin[tenantId], tenantId,
      `E2E escalation R2R3 ${label} — ${new Date().toISOString()}`);
    const srid = svc.serviceRequestId;
    filedSrids.push(`${srid} (${label} @ ${tenantId})`);
    expect(svc.applicationStatus, `[${label}] fresh complaint state`).toBe(PENDINGFORASSIGNMENT);
    // PGR enriches additionalDetail (department, serviceName) — the tuple
    // keys must survive that merge or the 15 s SLA lookup will miss.
    expect(svc.additionalDetail?.path).toBe(TUPLE.path);
    expect(svc.additionalDetail?.category).toBe(TUPLE.category);
    expect(svc.additionalDetail?.subcategoryL1).toBe(TUPLE.subcategoryL1);
    console.log(`[${srid}] created @ ${tenantId} → ${PENDINGFORASSIGNMENT}, tuple intact, deliberately unassigned`);
    return { srid, createdAtMs: Date.now() };
  }

  /** Wait out the remainder of a FULL 60 s breach window since creation. */
  async function waitForBreach(createdAtMs: number): Promise<void> {
    const remaining = createdAtMs + SLA_ELAPSE_WAIT_MS - Date.now();
    if (remaining > 0) {
      console.log(`waiting ${Math.round(remaining / 1000)}s more so the 15 s SLA is unambiguously breached…`);
      await sleep(remaining);
    }
  }

  /** Common provenance assertions on a details[] entry from the trigger response. */
  function expectProvenance(ours: any, exp: {
    action: string; reason: string; strategy: string; actingRole: string; candidateCount: number;
  }): void {
    expect(ours.action).toBe(exp.action);
    expect(ours.reason).toBe(exp.reason);
    expect(ours.resolutionStrategy, 'winning strategy must be reported').toBe(exp.strategy);
    expect(ours.actingRole).toBe(exp.actingRole);
    expect(ours.candidateCount, 'candidateCount semantics (R2: ladder holders; R3: distinct reportingTo)').toBe(exp.candidateCount);
    // department=null on this serviceCode ⇒ search starts unfiltered (verified
    // live: ServiceDefs row has no path/category/subcategoryL1 tuple at ke).
    expect(ours.departmentFiltered, 'department resolves null ⇒ unfiltered candidate search').toBe(false);
    if (exp.reason === 'SUCCESS') {
      expect(ours.slaSource, 'per-level CategorySLA cell must win the SLA cascade').toBe(SLA_SOURCE_CATEGORY_LEVEL);
    }
  }

  /** Zero-mutation proof: PGR row + latest PI untouched for an unassigned complaint. */
  async function expectUntouched(tenantId: string, srid: string, ctx: string): Promise<any> {
    const svc = await fetchComplaint(adminToken, adminUserInfo, tenantId, srid);
    expect(svc.applicationStatus, `[${ctx}] PGR row status unchanged`).toBe(PENDINGFORASSIGNMENT);
    expect(svc.additionalDetail?.escalationLevel ?? 0, `[${ctx}] no escalationLevel written`).toBe(0);
    const pi = await fetchLatestProcessInstance(cityAdmin[tenantId].token, cityAdmin[tenantId].userInfo, tenantId, srid);
    expect(pi.action, `[${ctx}] workflow untouched — latest PI is still the APPLY`).toBe('APPLY');
    expect((pi.assignes ?? []).length, `[${ctx}] still no recorded assignee`).toBe(0);
    return svc;
  }

  /** Post-real-escalation assertions: ESCALATE PI to the target + level/clock/comment. */
  async function expectEscalatedTo(
    tenantId: string, srid: string, targetUuid: string, actingRole: string,
    preTriggerLastModified: number, ctx: string,
  ): Promise<void> {
    const pi = await fetchLatestProcessInstance(cityAdmin[tenantId].token, cityAdmin[tenantId].userInfo, tenantId, srid);
    expect(pi, `[${ctx}] latest ProcessInstance must exist`).toBeTruthy();
    expect(pi.action, `[${ctx}] latest PI must be the ESCALATE`).toBe('ESCALATE');
    const assignees = (pi.assignes ?? []).map((a: any) => a?.uuid);
    expect(assignees, `[${ctx}] escalation must target ${targetUuid}`).toContain(targetUuid);
    expect(String(pi.comment ?? ''), `[${ctx}] role audit comment template`).toMatch(roleCommentRe(actingRole));
    // ESCALATE@PENDINGFORASSIGNMENT is a SELF-LOOP on this workflow (verified
    // against businessservice/_search on the fixture tenants — copies of root
    // ke): status stays put while the assignee materializes.
    expect(pi.state?.applicationStatus, `[${ctx}] ESCALATE self-loop keeps the state`).toBe(PENDINGFORASSIGNMENT);
    console.log(`[${srid}] ESCALATE PI → ${assignees.join(',')}, comment: "${pi.comment}"`);

    const svc = await fetchComplaint(adminToken, adminUserInfo, tenantId, srid);
    expect(svc.additionalDetail?.escalationLevel, `[${ctx}] escalationLevel must increment`).toBe(1);
    expect(svc.applicationStatus, `[${ctx}] PGR row mirrors the self-loop state`).toBe(PENDINGFORASSIGNMENT);
    const post = svc.auditDetails?.lastModifiedTime;
    expect(post, `[${ctx}] SLA clock must reset: ${post} must be STRICTLY > ${preTriggerLastModified}`)
      .toBeGreaterThan(preTriggerLastModified);
    console.log(`[${srid}] escalationLevel=1, SLA clock reset (${preTriggerLastModified} → ${post})`);
  }

  test.beforeAll(async () => {
    test.setTimeout(90_000);

    // ADMIN at the root tenant — SUPERUSER for /escalation/_trigger + MDMS writes.
    const adminResp = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    adminToken = adminResp.access_token;
    adminUserInfo = adminResp.UserRequest as Record<string, unknown>;
    expect(adminToken, `ADMIN/${ROOT_TENANT} token must mint`).toBeTruthy();

    // CITY-tenant ADMIN tokens (fixture's dual-scoped provisioning): the
    // login-tenant-scoped CITIZEN/CSR roles drive PGR _create at each tenant.
    for (const tid of [TENANT_ALPHA, TENANT_BETA]) {
      const resp = await getDigitToken({ tenant: tid, username: ADMIN_USER, password: ADMIN_PASS });
      expect(resp.access_token, `ADMIN/${tid} token must mint (fixture dual-scoped ADMIN)`).toBeTruthy();
      cityAdmin[tid] = { token: resp.access_token, userInfo: resp.UserRequest as Record<string, unknown> };
    }
  });

  test.afterAll(async () => {
    // CLEANUP — must run even when a mid-spec assertion failed. The policy
    // restore is non-negotiable (the singleton is LIVE production policy).
    // Failures are collected, never thrown mid-way, then surfaced as one error.
    test.setTimeout(120_000);
    const failures: string[] = [];

    // The suite runs >10 min — re-mint a fresh ADMIN token for cleanup.
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

    // 2. Deactivate the seeded CategorySLA tuple row (record + data levels).
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

    // 3. VERIFY the policy restore is BYTE-IDENTICAL: after the persister
    //    settles, the re-read data must stable-stringify to the snapshot.
    if (policyMutated && adminToken) {
      await sleep(PERSISTER_WAIT_MS);
      try {
        const live = await mdmsSearchRow(adminToken, POLICY_SCHEMA, POLICY_UID);
        const got = stableStringify(live?.data);
        const want = stableStringify(policySnapshotData);
        if (got !== want) {
          failures.push(`policy restore NOT VERIFIED — re-read data != snapshot. got=${got} want=${want}`);
        } else {
          console.log('[cleanup] verified: policy re-read is byte-identical to the snapshot');
        }
      } catch (err) {
        failures.push(`policy restore verification read FAILED: ${(err as Error).message}`);
      }
    }

    console.log(`[traceability] complaints filed by this run:\n  ${filedSrids.join('\n  ') || '(none)'}`);
    console.log(`[traceability] cron sentinel: ${sentinelSrid ?? '(not created)'}; cron branch: ${
      cronTickAnchorMs === undefined ? 'CANNOT MUTATE (expected)' : `MUTATING (anchor ${cronTickAnchorMs})`}`);

    if (failures.length > 0) {
      throw new Error(
        `CLEANUP FAILURES — production MDMS state may need manual repair: ${failures.join('; ')}. ` +
        `Policy snapshot for manual restore (tenant ${ROOT_TENANT}, schema ${POLICY_SCHEMA}, uid ${POLICY_UID}): ` +
        JSON.stringify(policySnapshotData),
      );
    }
  });

  test('0 — pre-flight: verify the live fixture topology + production-safety invariant', {
    annotation: {
      type: 'description',
      description: `Re-resolves every fixture uuid from HRMS at runtime and verifies the EXACT layout each scenario depends on: ${TENANT_ALPHA} must hold exactly one ${ROLE_SUP1} (the R2 target), exactly two ${ROLE_SUP2} (the R2 ambiguous pair), exactly two ${ROLE_R3} whose current assignments BOTH report to the ${ROLE_SUP1} holder (R3 consensus), exactly two ${ROLE_R4} reporting to two DIFFERENT uuids (R3 split); ${TENANT_BETA} must hold exactly one ${ROLE_SUP1} who is a DIFFERENT person than alpha's (the cross-tenant proof needs distinct uuids). Drift skips the suite with a pointer at scripts/setup-role-fixture.mjs. Separately HARD-FAILS (not skips) if any E2E_* role has holders at the production tenant ${TENANT} — that would void the safety property that production complaints can only ever skip (NO_ROLE_SUPERVISOR, read-only) while this suite has roleEscalation enabled.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:cross'] }, async () => {
    test.setTimeout(90_000);

    const problems: string[] = [];

    const sup1Alpha = await searchEmployeesByRole(adminToken, TENANT_ALPHA, ROLE_SUP1);
    if (sup1Alpha.length !== 1) problems.push(`${ROLE_SUP1}@${TENANT_ALPHA}: ${sup1Alpha.length} holders (want 1)`);
    else sup1AlphaUuid = sup1Alpha[0].uuid;

    const sup2Alpha = await searchEmployeesByRole(adminToken, TENANT_ALPHA, ROLE_SUP2);
    if (sup2Alpha.length !== 2) problems.push(`${ROLE_SUP2}@${TENANT_ALPHA}: ${sup2Alpha.length} holders (want 2)`);

    const r3Alpha = await searchEmployeesByRole(adminToken, TENANT_ALPHA, ROLE_R3);
    const r3Sup = new Set(r3Alpha.map((e) => currentAssignment(e)?.reportingTo).filter(Boolean));
    if (r3Alpha.length !== 2) problems.push(`${ROLE_R3}@${TENANT_ALPHA}: ${r3Alpha.length} holders (want 2)`);
    if (sup1AlphaUuid && (r3Sup.size !== 1 || !r3Sup.has(sup1AlphaUuid))) {
      problems.push(`${ROLE_R3} reportingTo set ${JSON.stringify([...r3Sup])} (want exactly [${sup1AlphaUuid}])`);
    }

    const r4Alpha = await searchEmployeesByRole(adminToken, TENANT_ALPHA, ROLE_R4);
    const r4Sup = new Set(r4Alpha.map((e) => currentAssignment(e)?.reportingTo).filter(Boolean));
    if (r4Alpha.length !== 2) problems.push(`${ROLE_R4}@${TENANT_ALPHA}: ${r4Alpha.length} holders (want 2)`);
    if (r4Sup.size !== 2) problems.push(`${ROLE_R4} distinct reportingTo set size ${r4Sup.size} (want 2 — the R3 split)`);

    const sup1Beta = await searchEmployeesByRole(adminToken, TENANT_BETA, ROLE_SUP1);
    if (sup1Beta.length !== 1) problems.push(`${ROLE_SUP1}@${TENANT_BETA}: ${sup1Beta.length} holders (want 1)`);
    else sup1BetaUuid = sup1Beta[0].uuid;
    if (sup1AlphaUuid && sup1BetaUuid && sup1AlphaUuid === sup1BetaUuid) {
      problems.push(`${ROLE_SUP1} resolves to the SAME uuid on both tenants — cross-tenant proof impossible`);
    }

    if (problems.length) {
      fixtureMissing = true;
      fixtureMissingMsg =
        `role fixture drifted — re-run scripts/setup-role-fixture.mjs and fix: ${problems.join('; ')}`;
      test.skip(true, fixtureMissingMsg);
      return;
    }
    console.log(`fixture verified: SUP1@alpha=${sup1AlphaUuid} (consensus target), SUP1@beta=${sup1BetaUuid}, `
      + `SUP2 pair=[${sup2Alpha.map((e: any) => e.code).join(',')}], R4 split=${JSON.stringify([...r4Sup])}`);

    // SAFETY invariant — HARD failure, not a skip: zero E2E_* holders at the
    // production tenant means production complaints can never resolve a role
    // target while this suite has the policy enabled.
    for (const role of ALL_FIXTURE_ROLES) {
      const holders = await searchEmployeesByRole(adminToken, TENANT, role);
      expect(holders.length,
        `SAFETY: ${role} must have ZERO holders at production ${TENANT} — found ${holders.map((e: any) => e.code).join(',')}. ` +
        'Enabling roleEscalation would resolve real targets for unattended production complaints. ABORTING.',
      ).toBe(0);
    }
    console.log(`safety verified: no E2E_* role holders at production ${TENANT}`);
  });

  test('1 — snapshot policy; seed the cross-tenant CategorySLA tuple; enable scenario-A config', {
    annotation: {
      type: 'description',
      description: `ONE policy snapshot for the whole suite (deep copy, logged for manual repair; refuses to run if roleEscalation is already enabled — never clobber a live rollout), then two seeds at the STATE tenant with a ${PERSISTER_WAIT_MS / 1000}s settle and verification on BOTH read paths (mdms-v2 _search + the v1 module read the scheduler consumes): (a) the CRS.CategorySLA tuple row ${TUPLE_UID} with slaHoursByLevel [${SLA_HOURS_L0}] (~15 s) — seeded ONCE; because the scheduler reads CategorySLA at the state tenant, the same row prices complaints on BOTH fixture city tenants; (b) the scenario-A policy via the shared reconfigure helper: roleEscalation { enabled, actingRoleByState { ${PENDINGFORASSIGNMENT}: ${ROLE_R3} }, supervisorRoleByRole { ${ROLE_R3}: ${ROLE_SUP1} }, maxPerScan 10 }, every pre-existing policy field preserved byte-for-byte. Also asserts NO active CRS.RoleSupervisors pin exists for either acting role — a pin would let R1 shadow the R2/R3 strategies this spec exists to prove.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(fixtureMissing, fixtureMissingMsg);
    test.setTimeout(120_000);

    // R1 must not be reachable: no active pin may exist for our acting roles.
    const pins = await v1CrsMaster(adminToken, 'RoleSupervisors');
    const conflicting = pins.filter((p: any) =>
      [ROLE_R3, ROLE_R4].includes(p.role) && p.isActive !== false);
    expect(conflicting.length,
      `active CRS.RoleSupervisors pins exist for the acting roles — R1 would win before R2/R3: ${JSON.stringify(conflicting)}`,
    ).toBe(0);

    // (a) CategorySLA tuple row — upsert to active, once for the whole suite.
    tupleTouched = true;
    await mdmsUpsertActiveRow(adminToken, adminUserInfo, CATEGORY_SLA_SCHEMA, TUPLE_UID, activeTupleData());

    // (b) Policy snapshot FIRST (deep copy), then the scenario-A config.
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

    await reconfigureRoleEscalation('A:R2-exactly-one', {
      enabled: true,
      actingRoleByState: { [PENDINGFORASSIGNMENT]: ROLE_R3 },
      supervisorRoleByRole: { [ROLE_R3]: ROLE_SUP1 },
      maxPerScan: 10,
    });

    // Tuple verification on both read paths (the policy was verified by the
    // reconfigure helper).
    const tupleLive = await mdmsSearchRow(adminToken, CATEGORY_SLA_SCHEMA, TUPLE_UID);
    expect(tupleLive, 'seeded CategorySLA row must be searchable after the settle').toBeTruthy();
    expect(tupleLive.isActive, 'tuple record-level isActive (v1 read filters on it)').toBe(true);
    expect(tupleLive.data?.isActive, 'tuple data-level isActive (scheduler-side guard)').toBe(true);
    expect(tupleLive.data?.slaHoursByLevel?.[0], 'level-0 SLA cell must be the seeded value').toBe(SLA_HOURS_L0);

    const v1Tuples = await v1CrsMaster(adminToken, 'CategorySLA');
    const v1Tuple = v1Tuples.find((r) =>
      r.path === TUPLE.path && r.category === TUPLE.category && r.subcategoryL1 === TUPLE.subcategoryL1);
    expect(v1Tuple, `tuple row must be visible on the scheduler's v1 read path; v1 returned ${v1Tuples.length} rows`).toBeTruthy();
    expect(v1Tuple.slaHoursByLevel?.[0]).toBe(SLA_HOURS_L0);

    seedLive = true;
    console.log('seed complete: tuple + scenario-A policy live on both read paths');
  });

  test('2 — cron sentinel (ONCE): can the background scheduler mutate fixture-tenant complaints?', {
    annotation: {
      type: 'description',
      description: `Decides the suite's concurrency posture ONCE, up front, under the scenario-A policy (where resolution at ${TENANT_ALPHA} SUCCEEDS — a sentinel at the production tenant would only ever skip on NO_ROLE_SUPERVISOR and prove nothing about transition viability). Files one UNASSIGNED tuple complaint at ${TENANT_ALPHA} and watches a full cron period (≤${CRON_OBSERVE_TIMEOUT_MS / 1000}s) for an ESCALATE ProcessInstance. The branch is MEASURED, never assumed — it has flipped across Bomet builds (the R1 sibling observed the cron's SYSTEM transition rejected; run 2 of this spec observed the cron escalate the sentinel on the current build): QUIET branch — sentinel times out un-escalated, the cron cannot mutate, no phase discipline needed (the timeout is a valid outcome, not a failure). MUTATING branch (current Bomet) — the sentinel IS escalated by the background scheduler under its SYSTEM identity, which both proves the role path end-to-end under cron AND anchors the quiet-window helper used before every REAL scenario (A/C/E) so create→breach→trigger (~110 s) always completes ≥${QUIET_WINDOW_NEEDED_MS / 1000}s clear of the next predicted tick. Scenarios B/D are immune in both branches: AMBIGUOUS resolutions skip read-only under any identity.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(fixtureMissing, fixtureMissingMsg);
    test.setTimeout(CRON_OBSERVE_TIMEOUT_MS + 90_000);
    expect(seedLive, 'seed step must have completed').toBe(true);

    const sentinel = await createComplaint(cityAdmin[TENANT_ALPHA], TENANT_ALPHA,
      `E2E R2R3 CRON SENTINEL — safe to ignore — ${new Date().toISOString()}`);
    sentinelSrid = sentinel.serviceRequestId;
    filedSrids.push(`${sentinelSrid} (cron sentinel @ ${TENANT_ALPHA})`);
    expect(sentinel.applicationStatus).toBe(PENDINGFORASSIGNMENT);
    console.log(`[${sentinelSrid}] sentinel created (UNASSIGNED, tuple SLA 15s, scenario-A policy live); observing ≤${CRON_OBSERVE_TIMEOUT_MS / 1000}s…`);

    const deadline = Date.now() + CRON_OBSERVE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(CRON_POLL_INTERVAL_MS);
      const latest = await fetchLatestProcessInstance(
        cityAdmin[TENANT_ALPHA].token, cityAdmin[TENANT_ALPHA].userInfo, TENANT_ALPHA, sentinelSrid!);
      if (latest?.action === 'ESCALATE') {
        cronTickAnchorMs = Date.now();
        console.log(`[${sentinelSrid}] cron ROLE-escalated the sentinel (comment: "${latest.comment}") — ` +
          `MUTATING branch: quiet-window discipline ACTIVE for scenarios A/C/E (anchor ${cronTickAnchorMs})`);
        break;
      }
      const remaining = Math.round((deadline - Date.now()) / 1000);
      if (remaining % 60 < CRON_POLL_INTERVAL_MS / 1000) console.log(`  …waiting for cron tick, ~${remaining}s budget left`);
    }

    if (cronTickAnchorMs === undefined) {
      console.log(
        `[${sentinelSrid}] cron did NOT escalate the sentinel within ${CRON_OBSERVE_TIMEOUT_MS / 1000}s — ` +
        `expected on this deployment (ESCALATE@${PENDINGFORASSIGNMENT} grants AUTO_ESCALATE but not SYSTEM), ` +
        'so the background scheduler cannot mutate unassigned complaints and cannot race the scoped triggers. ' +
        'No quiet-window discipline needed; proceeding.',
      );
    }
  });

  test('A — R2 exactly-one: dryRun provenance, then REAL escalation to the single ladder-role holder', {
    annotation: {
      type: 'description',
      description: `The R2_LADDER happy path under the scenario-A policy (acting role ${ROLE_R3}, ladder → ${ROLE_SUP1}, exactly ONE holder at ${TENANT_ALPHA}). Files an unassigned tuple complaint, waits a full ${SLA_ELAPSE_WAIT_MS / 1000}s, then: (1) scoped dryRun → scanned 1 / wouldEscalate 1 / escalated 0; details[0] WOULD_ESCALATE / SUCCESS / slaSource ${SLA_SOURCE_CATEGORY_LEVEL} / resolutionStrategy ${STRATEGY_R2_LADDER} / actingRole ${ROLE_R3} / candidateCount 1 (one holder of the LADDER role) / departmentFiltered false, plus the zero-mutation proof on both state layers and the SLA-clock baseline capture; (2) real trigger → escalated 1 (wouldEscalate 0 — that counter is dry-run-only) with identical provenance; (3) after the persister settles, the ESCALATE PI is assigned to the HRMS-resolved ${ROLE_SUP1} holder with the hedged role-comment (acting role ${ROLE_R3}), escalationLevel 1, status self-looped at ${PENDINGFORASSIGNMENT}, lastModifiedTime strictly advanced (PRD P6 fresh window).`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(fixtureMissing, fixtureMissingMsg);
    // Budget: quiet-window wait (≤ one cron period, mutating branch) + 60s
    // breach + dryRun/real/settle/reads.
    test.setTimeout(CRON_PERIOD_MS + SLA_ELAPSE_WAIT_MS + 240_000);

    await awaitQuietWindow('A');
    const { srid, createdAtMs } = await fileScenarioComplaint(TENANT_ALPHA, 'scenario-A');
    await waitForBreach(createdAtMs);
    await assertPolicyStillOurs('A pre-dryRun');

    // (1) dryRun preview — zero mutations.
    const dry = await escalationTrigger(adminToken, adminUserInfo, [srid], true);
    console.log(`[A] dryRun: scanned=${dry.scanned}, wouldEscalate=${dry.wouldEscalate}, escalated=${dry.escalated}, skipBreakdown=${JSON.stringify(dry.skipBreakdown ?? {})}`);
    expect(dry.dryRun).toBe(true);
    expect(dry.scanned, 'exactly our complaint in scope').toBe(1);
    expect(dry.wouldEscalate, 'dryRun must report the would-be role escalation').toBe(1);
    expect(dry.escalated, 'dryRun must never mutate').toBe(0);
    const dryOurs = (dry.details ?? []).find((d: any) => d.serviceRequestId === srid);
    expect(dryOurs, `details must include ${srid}; got ${JSON.stringify(dry.details)}`).toBeTruthy();
    expectProvenance(dryOurs, {
      action: 'WOULD_ESCALATE', reason: 'SUCCESS',
      strategy: STRATEGY_R2_LADDER, actingRole: ROLE_R3, candidateCount: 1,
    });
    expect(dryOurs.detail, 'preview detail must name the resolved target').toContain(sup1AlphaUuid);

    const svc = await expectUntouched(TENANT_ALPHA, srid, 'A dryRun');
    const preTriggerLastModified = svc.auditDetails?.lastModifiedTime;
    expect(preTriggerLastModified, 'pre-trigger lastModifiedTime must be readable').toBeTruthy();

    // (2) real trigger — mutates.
    await assertPolicyStillOurs('A pre-real');
    const real = await escalationTrigger(adminToken, adminUserInfo, [srid], false);
    console.log(`[A] trigger: scanned=${real.scanned}, escalated=${real.escalated}, skipBreakdown=${JSON.stringify(real.skipBreakdown ?? {})}`);
    expect(real.scanned, 'exactly our complaint in scope').toBe(1);
    expect(real.escalated, 'exactly our complaint must escalate').toBe(1);
    expect(real.wouldEscalate, 'wouldEscalate is a dry-run-only counter').toBe(0);
    const realOurs = (real.details ?? []).find((d: any) => d.serviceRequestId === srid);
    expect(realOurs, `details must include ${srid}; got ${JSON.stringify(real.details)}`).toBeTruthy();
    expectProvenance(realOurs, {
      action: 'ESCALATED', reason: 'SUCCESS',
      strategy: STRATEGY_R2_LADDER, actingRole: ROLE_R3, candidateCount: 1,
    });

    // (3) post-conditions after the persister settles.
    await sleep(PERSISTER_WAIT_MS);
    await expectEscalatedTo(TENANT_ALPHA, srid, sup1AlphaUuid, ROLE_R3, preTriggerLastModified, 'A');
  });

  test('B — R2 ambiguous: two ladder-role holders ⇒ ROLE_SUPERVISOR_AMBIGUOUS skip (dryRun only)', {
    annotation: {
      type: 'description',
      description: `Reconfigures the ladder to { ${ROLE_R3}: ${ROLE_SUP2} } — a role with TWO holders at ${TENANT_ALPHA} — update → ${PERSISTER_WAIT_MS / 1000}s settle → verified on the scheduler's v1 read. Files a fresh unassigned tuple complaint, waits the full ${SLA_ELAPSE_WAIT_MS / 1000}s, then asserts the skip-don't-guess contract on a scoped dryRun ONLY (skips are read-only on real scans too, so a dry run proves the identical code path with zero risk): scanned 1 / wouldEscalate 0 / escalated 0 / skipped 1, skipBreakdown.${REASON_AMBIGUOUS} 1; details[0] action SKIPPED / reason ${REASON_AMBIGUOUS} / resolutionStrategy ${STRATEGY_R2_LADDER} / actingRole ${ROLE_R3} / candidateCount 2 — per doResolveRoleTarget's R2 branch the count is the number of LADDER-ROLE HOLDERS (candidates.size()), not distinct supervisors — / departmentFiltered false, with the detail string naming the ladder role. Closes with the zero-mutation re-read of both state layers.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(fixtureMissing, fixtureMissingMsg);
    test.setTimeout(SLA_ELAPSE_WAIT_MS + 150_000);

    await reconfigureRoleEscalation('B:R2-ambiguous', {
      enabled: true,
      actingRoleByState: { [PENDINGFORASSIGNMENT]: ROLE_R3 },
      supervisorRoleByRole: { [ROLE_R3]: ROLE_SUP2 },
      maxPerScan: 10,
    });

    const { srid, createdAtMs } = await fileScenarioComplaint(TENANT_ALPHA, 'scenario-B');
    await waitForBreach(createdAtMs);
    await assertPolicyStillOurs('B pre-dryRun');

    const dry = await escalationTrigger(adminToken, adminUserInfo, [srid], true);
    console.log(`[B] dryRun: scanned=${dry.scanned}, wouldEscalate=${dry.wouldEscalate}, skipped=${dry.skipped}, skipBreakdown=${JSON.stringify(dry.skipBreakdown ?? {})}`);
    expect(dry.scanned, 'exactly our complaint in scope').toBe(1);
    expect(dry.wouldEscalate, 'ambiguity must NOT preview as an escalation').toBe(0);
    expect(dry.escalated).toBe(0);
    expect(dry.skipped).toBe(1);
    expect(dry.skipBreakdown?.[REASON_AMBIGUOUS], `skipBreakdown must count the ${REASON_AMBIGUOUS}`).toBe(1);

    const ours = (dry.details ?? []).find((d: any) => d.serviceRequestId === srid);
    expect(ours, `details must include ${srid}; got ${JSON.stringify(dry.details)}`).toBeTruthy();
    expectProvenance(ours, {
      action: 'SKIPPED', reason: REASON_AMBIGUOUS,
      strategy: STRATEGY_R2_LADDER, actingRole: ROLE_R3, candidateCount: 2,
    });
    expect(ours.detail, 'skip detail must name the ambiguous ladder role').toContain(`holders of ladder role ${ROLE_SUP2}`);

    await expectUntouched(TENANT_ALPHA, srid, 'B');
    console.log(`[${srid}] R2 ambiguity skip verified — complaint untouched`);
  });

  test('C — R3 consensus: no ladder, both acting-role holders report to one person — REAL escalation', {
    annotation: {
      type: 'description',
      description: `Reconfigures with NO supervisorRoleByRole key at all (ladderRoleFor returns null ⇒ R2 never runs; R2 exhaustion never falls through to R3 — only ABSENCE of a ladder entry reaches it), acting role still ${ROLE_R3}. Both ${ROLE_R3} holders at ${TENANT_ALPHA} have current assignments reporting to the SAME uuid (the ${ROLE_SUP1} holder), so R3_REPORTING resolves the consensus: dryRun → WOULD_ESCALATE / ${STRATEGY_R3_REPORTING} / candidateCount 1 — per the R3 branch the count is DISTINCT reportingTo uuids (supervisors.size()), not the 2 holders — then the REAL trigger escalates and the ESCALATE PI lands on the consensus reportingTo (same person as scenario A reached via the ladder, but through a DIFFERENT strategy — the provenance fields are what distinguish the journeys). Standard post-conditions: hedged comment, level 1, self-loop status, strict clock advance.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(fixtureMissing, fixtureMissingMsg);
    // Budget: reconfigure+settle + quiet-window wait (≤ one cron period) +
    // 60s breach + dryRun/real/settle/reads. Run 2 timed out at 240s total
    // exactly because the quiet-window wait wasn't budgeted.
    test.setTimeout(CRON_PERIOD_MS + SLA_ELAPSE_WAIT_MS + 240_000);

    await reconfigureRoleEscalation('C:R3-consensus', {
      enabled: true,
      actingRoleByState: { [PENDINGFORASSIGNMENT]: ROLE_R3 },
      // supervisorRoleByRole deliberately ABSENT — R3 only runs with no ladder entry.
      maxPerScan: 10,
    });

    await awaitQuietWindow('C');
    const { srid, createdAtMs } = await fileScenarioComplaint(TENANT_ALPHA, 'scenario-C');
    await waitForBreach(createdAtMs);
    await assertPolicyStillOurs('C pre-dryRun');

    const dry = await escalationTrigger(adminToken, adminUserInfo, [srid], true);
    console.log(`[C] dryRun: scanned=${dry.scanned}, wouldEscalate=${dry.wouldEscalate}, skipBreakdown=${JSON.stringify(dry.skipBreakdown ?? {})}`);
    expect(dry.scanned).toBe(1);
    expect(dry.wouldEscalate).toBe(1);
    expect(dry.escalated).toBe(0);
    const dryOurs = (dry.details ?? []).find((d: any) => d.serviceRequestId === srid);
    expect(dryOurs, `details must include ${srid}; got ${JSON.stringify(dry.details)}`).toBeTruthy();
    expectProvenance(dryOurs, {
      action: 'WOULD_ESCALATE', reason: 'SUCCESS',
      strategy: STRATEGY_R3_REPORTING, actingRole: ROLE_R3, candidateCount: 1,
    });
    expect(dryOurs.detail, 'preview detail must name the consensus target').toContain(sup1AlphaUuid);

    const svc = await expectUntouched(TENANT_ALPHA, srid, 'C dryRun');
    const preTriggerLastModified = svc.auditDetails?.lastModifiedTime;
    expect(preTriggerLastModified, 'pre-trigger lastModifiedTime must be readable').toBeTruthy();

    await assertPolicyStillOurs('C pre-real');
    const real = await escalationTrigger(adminToken, adminUserInfo, [srid], false);
    console.log(`[C] trigger: scanned=${real.scanned}, escalated=${real.escalated}, skipBreakdown=${JSON.stringify(real.skipBreakdown ?? {})}`);
    expect(real.scanned).toBe(1);
    expect(real.escalated).toBe(1);
    const realOurs = (real.details ?? []).find((d: any) => d.serviceRequestId === srid);
    expect(realOurs).toBeTruthy();
    expectProvenance(realOurs, {
      action: 'ESCALATED', reason: 'SUCCESS',
      strategy: STRATEGY_R3_REPORTING, actingRole: ROLE_R3, candidateCount: 1,
    });

    await sleep(PERSISTER_WAIT_MS);
    await expectEscalatedTo(TENANT_ALPHA, srid, sup1AlphaUuid, ROLE_R3, preTriggerLastModified, 'C');
  });

  test('D — R3 split: holders report to different people ⇒ ROLE_SUPERVISOR_AMBIGUOUS skip (dryRun only)', {
    annotation: {
      type: 'description',
      description: `Reconfigures the acting role to ${ROLE_R4} (actingRoleByState { ${PENDINGFORASSIGNMENT}: ${ROLE_R4} }), still no ladder. The two ${ROLE_R4} holders at ${TENANT_ALPHA} report to two DIFFERENT uuids, so the R3 consensus fails and the resolver skips rather than guesses: scoped dryRun → scanned 1 / wouldEscalate 0 / skipped 1 / skipBreakdown.${REASON_AMBIGUOUS} 1; details[0] SKIPPED / ${REASON_AMBIGUOUS} / ${STRATEGY_R3_REPORTING} / actingRole ${ROLE_R4} / candidateCount 2 (the size of the DISTINCT reportingTo set) / departmentFiltered false, detail naming the distinct-reportingTo condition. dryRun-only for the same reason as scenario B. Zero-mutation re-read closes the scenario.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(fixtureMissing, fixtureMissingMsg);
    test.setTimeout(SLA_ELAPSE_WAIT_MS + 150_000);

    await reconfigureRoleEscalation('D:R3-split', {
      enabled: true,
      actingRoleByState: { [PENDINGFORASSIGNMENT]: ROLE_R4 },
      maxPerScan: 10,
    });

    const { srid, createdAtMs } = await fileScenarioComplaint(TENANT_ALPHA, 'scenario-D');
    await waitForBreach(createdAtMs);
    await assertPolicyStillOurs('D pre-dryRun');

    const dry = await escalationTrigger(adminToken, adminUserInfo, [srid], true);
    console.log(`[D] dryRun: scanned=${dry.scanned}, wouldEscalate=${dry.wouldEscalate}, skipped=${dry.skipped}, skipBreakdown=${JSON.stringify(dry.skipBreakdown ?? {})}`);
    expect(dry.scanned).toBe(1);
    expect(dry.wouldEscalate, 'a split reportingTo set must NOT preview as an escalation').toBe(0);
    expect(dry.escalated).toBe(0);
    expect(dry.skipped).toBe(1);
    expect(dry.skipBreakdown?.[REASON_AMBIGUOUS]).toBe(1);

    const ours = (dry.details ?? []).find((d: any) => d.serviceRequestId === srid);
    expect(ours, `details must include ${srid}; got ${JSON.stringify(dry.details)}`).toBeTruthy();
    expectProvenance(ours, {
      action: 'SKIPPED', reason: REASON_AMBIGUOUS,
      strategy: STRATEGY_R3_REPORTING, actingRole: ROLE_R4, candidateCount: 2,
    });
    expect(ours.detail, 'skip detail must name the split condition').toContain(`distinct reportingTo across holders of ${ROLE_R4}`);

    await expectUntouched(TENANT_ALPHA, srid, 'D');
    console.log(`[${srid}] R3 split skip verified — complaint untouched`);
  });

  test('E — cross-tenant memo: ONE scan resolves the same role to DIFFERENT people per tenant (REAL)', {
    annotation: {
      type: 'description',
      description: `The tenant-keyed-cache proof. Restores the scenario-A ladder config ({ ${ROLE_R3}: ${ROLE_SUP1} }), files one unassigned tuple complaint in EACH fixture tenant, waits the full ${SLA_ELAPSE_WAIT_MS / 1000}s, then fires a SINGLE real trigger with serviceRequestIds=[both] and tenantId=${ROOT_TENANT} (the state-level pool spans every ke.* city tenant — verified live: fixture-tenant complaints appear in the 'ke' scan). Asserts scanned 2 / escalated 2 with BOTH details ESCALATED via ${STRATEGY_R2_LADDER}, then — after the persister settles — alpha's ESCALATE PI assigned to the alpha ${ROLE_SUP1} holder and beta's to the beta ${ROLE_SUP1} holder, two DIFFERENT uuids out of ONE scan. resolveRoleTarget memoizes per scan keyed on (tenantId, actingRole, department); a tenant-less key would have replayed alpha's answer (the first resolution) for beta's complaint and assigned the wrong person cross-tenant — exactly the regression this scenario pins.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@kind:e2e', '@layer:api', '@persona:admin'] }, async () => {
    test.skip(fixtureMissing, fixtureMissingMsg);
    // Budget: reconfigure+settle + quiet-window wait (≤ one cron period) +
    // 60s breach + trigger/settle + two tenants' worth of reads.
    test.setTimeout(CRON_PERIOD_MS + SLA_ELAPSE_WAIT_MS + 300_000);

    await reconfigureRoleEscalation('E:cross-tenant', {
      enabled: true,
      actingRoleByState: { [PENDINGFORASSIGNMENT]: ROLE_R3 },
      supervisorRoleByRole: { [ROLE_R3]: ROLE_SUP1 },
      maxPerScan: 10,
    });

    await awaitQuietWindow('E');
    const alpha = await fileScenarioComplaint(TENANT_ALPHA, 'scenario-E-alpha');
    const beta = await fileScenarioComplaint(TENANT_BETA, 'scenario-E-beta');
    await waitForBreach(Math.max(alpha.createdAtMs, beta.createdAtMs));

    const preAlpha = (await fetchComplaint(adminToken, adminUserInfo, TENANT_ALPHA, alpha.srid))?.auditDetails?.lastModifiedTime;
    const preBeta = (await fetchComplaint(adminToken, adminUserInfo, TENANT_BETA, beta.srid))?.auditDetails?.lastModifiedTime;
    expect(preAlpha, 'alpha pre-trigger lastModifiedTime must be readable').toBeTruthy();
    expect(preBeta, 'beta pre-trigger lastModifiedTime must be readable').toBeTruthy();

    // ONE trigger, BOTH srids, state-level tenant — the single scan must
    // resolve each complaint against its OWN tenant's HRMS.
    await assertPolicyStillOurs('E pre-real');
    const real = await escalationTrigger(adminToken, adminUserInfo, [alpha.srid, beta.srid], false);
    console.log(`[E] trigger: scanned=${real.scanned}, escalated=${real.escalated}, skipBreakdown=${JSON.stringify(real.skipBreakdown ?? {})}`);
    expect(real.scanned, 'both complaints must be in the single scan').toBe(2);
    expect(real.escalated, 'both complaints must escalate in the single scan').toBe(2);
    expect(real.wouldEscalate).toBe(0);

    for (const [srid, label] of [[alpha.srid, 'alpha'], [beta.srid, 'beta']] as const) {
      const ours = (real.details ?? []).find((d: any) => d.serviceRequestId === srid);
      expect(ours, `[E:${label}] details must include ${srid}; got ${JSON.stringify(real.details)}`).toBeTruthy();
      expectProvenance(ours, {
        action: 'ESCALATED', reason: 'SUCCESS',
        strategy: STRATEGY_R2_LADDER, actingRole: ROLE_R3, candidateCount: 1,
      });
    }

    await sleep(PERSISTER_WAIT_MS);
    await expectEscalatedTo(TENANT_ALPHA, alpha.srid, sup1AlphaUuid, ROLE_R3, preAlpha, 'E:alpha');
    await expectEscalatedTo(TENANT_BETA, beta.srid, sup1BetaUuid, ROLE_R3, preBeta, 'E:beta');

    // The headline assertion: ONE scan, same acting role, two different
    // targets — per-tenant resolution proven.
    expect(sup1AlphaUuid, 'cross-tenant targets must be DIFFERENT people').not.toBe(sup1BetaUuid);
    console.log(`[E] cross-tenant memo verified: alpha→${sup1AlphaUuid}, beta→${sup1BetaUuid} from a single scan`);
  });
});
