#!/usr/bin/env node
/**
 * setup-role-fixture.mjs — multi-holder ROLE-escalation fixture (create-or-verify, idempotent)
 *
 * Stands up two NEW city tenants under root `ke` with test-only roles and a
 * deliberate employee layout that exercises every role-escalation resolution
 * path in EscalationService.doResolveRoleTarget (R2 ladder / R3 reportingTo
 * consensus) against a LIVE stack — isolated from production tenants
 * (ke.bomet) by E2E_* role codes that no production flow references.
 *
 * TENANT-ID PLATFORM CONSTRAINT (discovered empirically on Bomet)
 * ───────────────────────────────────────────────────────────────
 * egov-user rejects ANY tenantId containing a digit:
 *   `Pattern.createUserRequest.user.tenantId: must match "^[a-zA-Z. ]*$"`
 * so the originally-requested ids `ke.e2eroles` / `ke.e2ebeta` can never hold
 * users (and therefore no HRMS employees). The fixture uses the closest
 * digit-free ids instead — `2` spelled `toe`:
 *   ke.e2eroles → ke.etoeroles      ke.e2ebeta → ke.etoebeta
 * Role and employee CODES keep their exact E2E_* names (digits are fine
 * everywhere except tenant ids).
 *
 * FIXTURE LAYOUT
 * ──────────────
 *   Roles (MDMS ACCESSCONTROL-ROLES.roles at root `ke` — HRMS validates there):
 *     E2E_SUP1   E2E_SUP2   E2E_ROLE3   E2E_ROLE4      (all marked "fixture")
 *
 *   Tenant ke.etoeroles ("E2E Roles Alpha") — locality ETOEROLES_WARD_1:
 *     E2E_SUP1_HOLDER  [E2E_SUP1]                       R2 exactly-one target
 *     E2E_SUP2_A       [E2E_SUP2]  ┐
 *     E2E_SUP2_B       [E2E_SUP2]  ┘                    R2 ambiguous pair
 *     E2E_R3_A         [E2E_ROLE3] reportingTo=SUP1_HOLDER ┐ R3 consensus
 *     E2E_R3_B         [E2E_ROLE3] reportingTo=SUP1_HOLDER ┘ (same uuid)
 *     E2E_R4_A         [E2E_ROLE4] reportingTo=SUP2_A    ┐  R3 split
 *     E2E_R4_B         [E2E_ROLE4] reportingTo=SUP2_B    ┘  (different uuids)
 *
 *   Tenant ke.etoebeta ("E2E Roles Beta") — locality ETOEBETA_WARD_1:
 *     E2E_SUP1_BETA    [E2E_SUP1]      cross-tenant: the SAME role resolves
 *                                      to a DIFFERENT person here
 *
 * SCENARIOS THE LAYOUT ENABLES
 * ────────────────────────────
 *   R2 exactly-one : supervisorRoleByRole {X: E2E_SUP1} at ke.etoeroles
 *                    → resolves E2E_SUP1_HOLDER (single holder).
 *   R2 ambiguous   : supervisorRoleByRole {X: E2E_SUP2} at ke.etoeroles
 *                    → two holders → ROLE_SUPERVISOR_AMBIGUOUS skip.
 *   R3 consensus   : acting role E2E_ROLE3, no ladder → both holders'
 *                    current assignments report to E2E_SUP1_HOLDER
 *                    → consensus → escalate to E2E_SUP1_HOLDER.
 *   R3 split       : acting role E2E_ROLE4, no ladder → holders report to
 *                    different uuids → no consensus → skip.
 *   Cross-tenant   : E2E_SUP1 at ke.etoebeta resolves E2E_SUP1_BETA, proving
 *                    resolution is tenant-scoped (different person per tenant).
 *
 * WHAT EACH TENANT GETS (everything PGR `_create` validates, discovered
 * empirically against Bomet):
 *   1. MDMS `tenant.tenants` record at root `ke` (mdms-v2; uniqueIdentifier
 *      is derived from data.code by the service).
 *   2. PGR workflow BusinessService copied from root `ke` (egov-workflow-v2
 *      resolves BusinessService at the COMPLAINT tenant on this stack —
 *      uuid→state-name mapping for nextState, ids stripped).
 *   3. Boundary: ADMIN hierarchy (County>SubCounty>Ward, mirroring root ke),
 *      boundary ENTITIES + relationships. PGR validateBoundary calls
 *      `/boundary-service/boundary/_search?tenantId=<city>&codes=<locality>`
 *      so the Ward ENTITY is the hard requirement.
 *   4. HRMS employees as above. ServiceDefs resolve at root `ke`
 *      (multiStateInstanceUtil.getStateLevelTenant) so no per-tenant copy.
 *   5. Dual-scoped ADMIN (city_setup parity): city-tenant roles appended to
 *      the root ADMIN row, plus a SEPARATE `ADMIN` user row ON each city
 *      tenant — the oauth response filters roles to the LOGIN tenant and the
 *      workflow APPLY transition needs CITIZEN/CSR at the complaint tenant,
 *      so drive PGR with a token from `tenantId=<city>` (ADMIN/eGov@123
 *      works at both fixture tenants).
 *
 * PLATFORM GOTCHAS HONOURED
 *   - persister is async → every create is followed by a poll-until-visible
 *     (no blind sleeps; up to 60s per item).
 *   - MDMS phantom-200 on duplicate creates → search-first, never create-blind.
 *   - HRMS role.tenantId must be the CITY tenant (the escalation candidate
 *     search runs `employees/_search?tenantId=<city>&roles=<role>` and
 *     egov-user matches userroles by role tenant) — same shape as the proven
 *     PHASE0_* employees on ke.bomet.
 *   - user.tenantId must be the CITY tenant (login + (id,tenantid) PK).
 *   - Kenya mobile validation (MDMS UserValidation at ke): 9-digit `7…`
 *     numbers, deterministic per employee so re-runs never mint new users.
 *
 * USAGE
 *   node setup-role-fixture.mjs [--smoke]
 *
 *     BASE_URL       DIGIT API base (Kong). Default http://localhost:18000
 *                    (run on the Bomet box) — or https://bometfeedbackhub.digit.org
 *     ROOT_TENANT    default ke
 *     ADMIN_USER     default ADMIN     (must hold MDMS_ADMIN/SUPERUSER at root)
 *     ADMIN_PASS     default eGov@123
 *     EMP_PASSWORD   password for created employees, default eGov@123
 *     SERVICE_CODE   complaint type for --smoke, default ObsoleteOrDamagedPipeline
 *
 *   --smoke files ONE throwaway PGR complaint per tenant and prints the srid.
 *   Smoke complaints are creates (not idempotent) — leave the flag off for
 *   the no-op verify run.
 *
 * IDEMPOTENT: every item is search-first. A re-run against a complete fixture
 * performs ZERO writes and prints `VERIFIED` for every line. Exit 0 = fixture
 * complete and verified; exit 1 = drift or failure (printed per item).
 *
 * This fixture is meant to PERSIST on the Bomet test server. It never touches
 * ke.bomet data and does NOT enable any roleEscalation policy (spec phase's job).
 */

const BASE_URL = (process.env.BASE_URL || 'http://localhost:18000').replace(/\/+$/, '');
const ROOT = process.env.ROOT_TENANT || 'ke';
const ADMIN_USER = process.env.ADMIN_USER || 'ADMIN';
const ADMIN_PASS = process.env.ADMIN_PASS || 'eGov@123';
const EMP_PASSWORD = process.env.EMP_PASSWORD || 'eGov@123';
const SERVICE_CODE = process.env.SERVICE_CODE || 'ObsoleteOrDamagedPipeline';
const SMOKE = process.argv.includes('--smoke');

// Department/designation are NOT part of the fixture semantics (department
// filtering is out of scope) — any single valid pair at root `ke` works.
const DEPARTMENT = process.env.FIXTURE_DEPARTMENT || 'WATER_ENV';
const DESIGNATION = process.env.FIXTURE_DESIGNATION || 'officer';

// Fixed epoch dates so payloads are deterministic across runs.
const DATE_OF_APPOINTMENT = 1700000000000; // 2023-11-14
const DOB = 631152000000; // 1990-01-01

// NOTE: tenant ids MUST be digit-free (egov-user @Pattern "^[a-zA-Z. ]*$").
const TENANT_ALPHA = `${ROOT}.etoeroles`;
const TENANT_BETA = `${ROOT}.etoebeta`;

const TENANTS = {
  [TENANT_ALPHA]: {
    name: 'E2E Roles Alpha',
    cityCode: 'ETOEROLES',
    county: 'ETOEROLES_COUNTY',
    subcounty: 'ETOEROLES_SUBCOUNTY_1',
    locality: 'ETOEROLES_WARD_1',
    smokeCitizenMobile: '753999001',
    adminMobile: '753000111',
  },
  [TENANT_BETA]: {
    name: 'E2E Roles Beta',
    cityCode: 'ETOEBETA',
    county: 'ETOEBETA_COUNTY',
    subcounty: 'ETOEBETA_SUBCOUNTY_1',
    locality: 'ETOEBETA_WARD_1',
    smokeCitizenMobile: '753999002',
    adminMobile: '753000112',
  },
};

const ROLES = [
  { code: 'E2E_SUP1', name: 'E2E Supervisor One (fixture)', description: 'E2E role-escalation fixture — R2 exactly-one supervisor target. Test-only; ignore in production.' },
  { code: 'E2E_SUP2', name: 'E2E Supervisor Two (fixture)', description: 'E2E role-escalation fixture — R2 ambiguous supervisor pair (two holders). Test-only; ignore in production.' },
  { code: 'E2E_ROLE3', name: 'E2E Acting Role Three (fixture)', description: 'E2E role-escalation fixture — R3 consensus: both holders report to E2E_SUP1_HOLDER. Test-only.' },
  { code: 'E2E_ROLE4', name: 'E2E Acting Role Four (fixture)', description: 'E2E role-escalation fixture — R3 split: holders report to different supervisors. Test-only.' },
];
const ROLE_NAME = Object.fromEntries(ROLES.map((r) => [r.code, r.name]));

// Wave 1 has no reportingTo; wave 2 reports to wave-1 uuids (resolved live).
const EMPLOYEES = [
  { code: 'E2E_SUP1_HOLDER', name: 'E2E Sup1 Holder', tenant: TENANT_ALPHA, role: 'E2E_SUP1', mobile: '753100001', reportingToCode: null, wave: 1 },
  { code: 'E2E_SUP2_A', name: 'E2E Sup2 A', tenant: TENANT_ALPHA, role: 'E2E_SUP2', mobile: '753100002', reportingToCode: null, wave: 1 },
  { code: 'E2E_SUP2_B', name: 'E2E Sup2 B', tenant: TENANT_ALPHA, role: 'E2E_SUP2', mobile: '753100003', reportingToCode: null, wave: 1 },
  { code: 'E2E_SUP1_BETA', name: 'E2E Sup1 Beta', tenant: TENANT_BETA, role: 'E2E_SUP1', mobile: '753200001', reportingToCode: null, wave: 1 },
  { code: 'E2E_R3_A', name: 'E2E R3 A', tenant: TENANT_ALPHA, role: 'E2E_ROLE3', mobile: '753100004', reportingToCode: 'E2E_SUP1_HOLDER', wave: 2 },
  { code: 'E2E_R3_B', name: 'E2E R3 B', tenant: TENANT_ALPHA, role: 'E2E_ROLE3', mobile: '753100005', reportingToCode: 'E2E_SUP1_HOLDER', wave: 2 },
  { code: 'E2E_R4_A', name: 'E2E R4 A', tenant: TENANT_ALPHA, role: 'E2E_ROLE4', mobile: '753100006', reportingToCode: 'E2E_SUP2_A', wave: 2 },
  { code: 'E2E_R4_B', name: 'E2E R4 B', tenant: TENANT_ALPHA, role: 'E2E_ROLE4', mobile: '753100007', reportingToCode: 'E2E_SUP2_B', wave: 2 },
];

// Expected EXACT holder sets per (tenant, role) — this is the contract the
// escalation candidate search (HRMS ?roles=) must see.
const EXPECTED_HOLDERS = [
  { tenant: TENANT_ALPHA, role: 'E2E_SUP1', codes: ['E2E_SUP1_HOLDER'] },
  { tenant: TENANT_ALPHA, role: 'E2E_SUP2', codes: ['E2E_SUP2_A', 'E2E_SUP2_B'] },
  { tenant: TENANT_ALPHA, role: 'E2E_ROLE3', codes: ['E2E_R3_A', 'E2E_R3_B'] },
  { tenant: TENANT_ALPHA, role: 'E2E_ROLE4', codes: ['E2E_R4_A', 'E2E_R4_B'] },
  { tenant: TENANT_BETA, role: 'E2E_SUP1', codes: ['E2E_SUP1_BETA'] },
];

// ── plumbing ────────────────────────────────────────────────────────────────

let authToken = null;
let userInfo = null;
const failures = [];

/** Raw oauth — returns {token, user} or throws. */
async function oauth(username, password, tenantId) {
  const res = await fetch(`${BASE_URL}/user/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'password', scope: 'read',
      username, password, tenantId, userType: 'EMPLOYEE',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`auth ${username}@${tenantId} failed: ${JSON.stringify(data).slice(0, 200)}`);
  return { token: data.access_token, user: data.UserRequest };
}

function log(status, item, extra = '') {
  console.log(`${status.padEnd(9)} ${item}${extra ? `  ${extra}` : ''}`);
}
function fail(item, why) {
  failures.push(`${item}: ${why}`);
  log('FAIL', item, why);
}

function requestInfo() {
  return { apiId: 'role-fixture', ver: '1.0', ts: Date.now(), msgId: 'setup-role-fixture', authToken, userInfo };
}

async function api(path, body, { allowErrors = false } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  const errors = data?.Errors || data?.errors;
  if (!allowErrors && (!res.ok || (Array.isArray(errors) && errors.length))) {
    const msg = Array.isArray(errors)
      ? errors.map((e) => `${e.code}: ${e.message}`).join('; ')
      : `HTTP ${res.status} ${text.slice(0, 300)}`;
    throw new Error(`${path} → ${msg}`);
  }
  return data;
}

async function pollUntil(desc, fn, { timeoutMs = 60000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = await fn();
    if (out) return out;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${desc} (${timeoutMs / 1000}s)`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function auth() {
  const { token, user } = await oauth(ADMIN_USER, ADMIN_PASS, ROOT);
  authToken = token;
  userInfo = user;
  log('OK', `auth ${ADMIN_USER}@${ROOT}`, `(${BASE_URL})`);
}

// ── MDMS v2 ─────────────────────────────────────────────────────────────────

async function mdmsSearch(tenantId, schemaCode, uniqueIdentifiers) {
  const data = await api('/mdms-v2/v2/_search', {
    RequestInfo: requestInfo(),
    MdmsCriteria: { tenantId, schemaCode, uniqueIdentifiers, limit: 50, offset: 0 },
  });
  return data.mdms || [];
}

async function mdmsCreate(tenantId, schemaCode, recordData) {
  await api(`/mdms-v2/v2/_create/${schemaCode}`, {
    RequestInfo: requestInfo(),
    Mdms: { tenantId, schemaCode, data: recordData, isActive: true },
  });
}

async function mdmsReactivate(record) {
  await api(`/mdms-v2/v2/_update/${record.schemaCode}`, {
    RequestInfo: requestInfo(),
    Mdms: { ...record, isActive: true },
  });
}

async function ensureMdmsRecord(label, tenantId, schemaCode, uniqueIdentifier, recordData) {
  const found = await mdmsSearch(tenantId, schemaCode, [uniqueIdentifier]);
  if (found.length && found[0].isActive) {
    log('VERIFIED', label);
    return found[0];
  }
  if (found.length && !found[0].isActive) {
    await mdmsReactivate(found[0]);
    log('CREATED', label, '(reactivated)');
  } else {
    await mdmsCreate(tenantId, schemaCode, recordData);
    log('CREATED', label);
  }
  // persister is async — poll until the record is searchable and active
  return pollUntil(`${label} visible`, async () => {
    const rows = await mdmsSearch(tenantId, schemaCode, [uniqueIdentifier]);
    return rows.length && rows[0].isActive ? rows[0] : null;
  });
}

// ── tenant + roles ──────────────────────────────────────────────────────────

async function ensureTenant(tid) {
  const t = TENANTS[tid];
  await ensureMdmsRecord(`tenant ${tid}`, ROOT, 'tenant.tenants', tid, {
    code: tid,
    name: t.name,
    tenantId: tid,
    parent: ROOT,
    type: 'City',
    description: `E2E role-escalation fixture tenant: ${t.name}. Test-only.`,
    city: { code: t.cityCode, name: t.name, districtName: ROOT },
  });
}

async function ensureRoles() {
  for (const role of ROLES) {
    await ensureMdmsRecord(`role ${role.code} @ ${ROOT}`, ROOT, 'ACCESSCONTROL-ROLES.roles', role.code, role);
  }
}

// ── admin city roles ────────────────────────────────────────────────────────
//
// The PGR workflow's APPLY action requires CITIZEN/CSR scoped to the
// COMPLAINT tenant — a root-only ADMIN gets `INVALID ROLE` from
// egov-workflow-v2 on _create. Mirror MCP city_setup's "dual-scoped ADMIN":
// additively grant the standard role set at each fixture tenant (same list
// city_setup uses for every wizard-created city on this box).

const ADMIN_CITY_ROLES = ['EMPLOYEE', 'CITIZEN', 'CSR', 'GRO', 'PGR_LME', 'DGRO', 'SUPERUSER', 'INTERNAL_MICROSERVICE_ROLE'];

async function ensureAdminCityRoles() {
  const data = await api('/user/_search', {
    RequestInfo: requestInfo(),
    tenantId: ROOT,
    userName: ADMIN_USER,
    userType: 'EMPLOYEE',
    active: true,
  });
  const admin = (data.user || [])[0];
  if (!admin) throw new Error(`user _search found no ${ADMIN_USER}@${ROOT}`);

  const have = new Set((admin.roles || []).map((r) => `${r.code}@${r.tenantId}`));
  const missing = [];
  for (const tid of Object.keys(TENANTS)) {
    for (const code of ADMIN_CITY_ROLES) {
      if (!have.has(`${code}@${tid}`)) missing.push({ code, name: code, tenantId: tid });
    }
  }
  if (!missing.length) {
    log('VERIFIED', `admin city roles (${ADMIN_USER})`, `@ ${Object.keys(TENANTS).join(', ')}`);
    return;
  }
  // omit mobileNumber: ADMIN's legacy 10-digit mobile fails the Kenya
  // UserValidation rules that _updatenovalidate re-runs; absent field = keep.
  const { mobileNumber: _omit, ...adminSansMobile } = admin;
  await api('/user/users/_updatenovalidate', {
    RequestInfo: requestInfo(),
    user: { ...adminSansMobile, roles: [...(admin.roles || []), ...missing] },
  });
  log('CREATED', `admin city roles (${ADMIN_USER})`, `(+${missing.length} role grants)`);
  // re-authenticate — workflow reads roles from the token's userInfo
  await auth();
}

// The login response filters roles to the LOGIN tenant and egov-user scopes
// users by (id, tenantid) — so to act AT a city tenant (PGR create → workflow
// APPLY needs CITIZEN/CSR there), a separate ADMIN user row must exist on
// that tenant. Same as city_setup's "dual-scoped ADMIN" provisioning.
async function ensureCityAdminUser(tid) {
  const item = `city admin user ${ADMIN_USER} @ ${tid}`;
  const found = await api('/user/_search', {
    RequestInfo: requestInfo(),
    tenantId: tid,
    userName: ADMIN_USER,
    userType: 'EMPLOYEE',
    active: true,
  }, { allowErrors: true });
  const existing = (found.user || [])[0];
  const wanted = ADMIN_CITY_ROLES.map((code) => ({ code, name: code, tenantId: tid }));
  if (existing) {
    const have = new Set((existing.roles || []).map((r) => `${r.code}@${r.tenantId}`));
    const missing = wanted.filter((r) => !have.has(`${r.code}@${r.tenantId}`));
    if (!missing.length) {
      log('VERIFIED', item);
      return;
    }
    const { mobileNumber: _m, ...sansMobile } = existing;
    await api('/user/users/_updatenovalidate', {
      RequestInfo: requestInfo(),
      user: { ...sansMobile, roles: [...(existing.roles || []), ...missing] },
    });
    log('CREATED', item, `(+${missing.length} role grants)`);
    return;
  }
  await api('/user/users/_createnovalidate', {
    RequestInfo: requestInfo(),
    user: {
      name: 'Super Admin',
      userName: ADMIN_USER,
      password: ADMIN_PASS,
      // a Kenya-valid mobile is REQUIRED: egov-user runs the MDMS
      // UserValidation rules (state level = ke) even on _createnovalidate.
      mobileNumber: TENANTS[tid].adminMobile,
      type: 'EMPLOYEE',
      active: true,
      tenantId: tid,
      roles: wanted,
    },
  });
  log('CREATED', item);
  await pollUntil(`${item} searchable`, async () => {
    const res = await api('/user/_search', {
      RequestInfo: requestInfo(),
      tenantId: tid, userName: ADMIN_USER, userType: 'EMPLOYEE', active: true,
    }, { allowErrors: true });
    return (res.user || []).length > 0;
  });
}

// ── workflow ────────────────────────────────────────────────────────────────

async function wfSearch(tenantId) {
  const data = await api(
    `/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=${tenantId}&businessServices=PGR`,
    { RequestInfo: requestInfo() },
  );
  return data.BusinessServices || [];
}

async function ensureWorkflow(tid) {
  const existing = await wfSearch(tid);
  if (existing.length) {
    log('VERIFIED', `workflow PGR @ ${tid}`);
    return;
  }
  const [src] = await wfSearch(ROOT);
  if (!src) throw new Error(`no PGR BusinessService at root ${ROOT} to copy from`);

  // uuid → state-name map: action.nextState in the search result is a state
  // uuid; create expects the state NAME (same transform as MCP city_setup).
  const stateByUuid = new Map((src.states || []).map((s) => [s.uuid, s.state]));
  const states = (src.states || []).map((s) => ({
    state: s.state,
    applicationStatus: s.applicationStatus,
    docUploadRequired: s.docUploadRequired,
    isStartState: s.isStartState,
    isTerminateState: s.isTerminateState,
    isStateUpdatable: s.isStateUpdatable,
    actions: (s.actions || []).map((a) => ({
      action: a.action,
      nextState: stateByUuid.get(a.nextState) || a.nextState,
      roles: a.roles,
      active: a.active,
    })),
  }));
  await api('/egov-workflow-v2/egov-wf/businessservice/_create', {
    RequestInfo: requestInfo(),
    BusinessServices: [{
      tenantId: tid,
      businessService: src.businessService,
      business: src.business,
      businessServiceSla: src.businessServiceSla,
      states,
    }],
  });
  log('CREATED', `workflow PGR @ ${tid}`);
  await pollUntil(`workflow PGR @ ${tid} visible`, async () => (await wfSearch(tid)).length > 0);
}

// ── boundary ────────────────────────────────────────────────────────────────

async function boundaryEntitySearch(tenantId, codes) {
  const data = await api(
    `/boundary-service/boundary/_search?tenantId=${tenantId}&codes=${codes.join(',')}&limit=50&offset=0`,
    { RequestInfo: requestInfo() },
  );
  return data.Boundary || [];
}

async function ensureBoundary(tid) {
  const t = TENANTS[tid];
  // Mirrors root `ke` ADMIN shape (County > SubCounty > Ward); leaf Ward is
  // the PGR locality. Hierarchy + relationships live per-tenant; root ke is
  // never written.
  const levels = [
    { boundaryType: 'County', parentBoundaryType: null, active: true },
    { boundaryType: 'SubCounty', parentBoundaryType: 'County', active: true },
    { boundaryType: 'Ward', parentBoundaryType: 'SubCounty', active: true },
  ];
  const chain = [
    { code: t.county, type: 'County', parent: null },
    { code: t.subcounty, type: 'SubCounty', parent: t.county },
    { code: t.locality, type: 'Ward', parent: t.subcounty },
  ];

  // 1. hierarchy definition
  const hier = await api('/boundary-service/boundary-hierarchy-definition/_search', {
    RequestInfo: requestInfo(),
    BoundaryTypeHierarchySearchCriteria: { tenantId: tid, hierarchyType: 'ADMIN', limit: 10, offset: 0 },
  });
  if ((hier.BoundaryHierarchy || []).length) {
    log('VERIFIED', `boundary hierarchy ADMIN @ ${tid}`);
  } else {
    await api('/boundary-service/boundary-hierarchy-definition/_create', {
      RequestInfo: requestInfo(),
      BoundaryHierarchy: { tenantId: tid, hierarchyType: 'ADMIN', boundaryHierarchy: levels },
    });
    log('CREATED', `boundary hierarchy ADMIN @ ${tid}`);
  }

  // 2. boundary entities (what PGR validateBoundary actually checks)
  const existing = await boundaryEntitySearch(tid, chain.map((b) => b.code));
  const existingCodes = new Set(existing.map((b) => b.code));
  const missing = chain.filter((b) => !existingCodes.has(b.code));
  if (!missing.length) {
    log('VERIFIED', `boundary entities @ ${tid}`, `(${chain.map((b) => b.code).join(', ')})`);
  } else {
    await api('/boundary-service/boundary/_create', {
      RequestInfo: requestInfo(),
      Boundary: missing.map((b) => ({
        tenantId: tid,
        code: b.code,
        geometry: { type: 'Point', coordinates: [0, 0] },
      })),
    });
    log('CREATED', `boundary entities @ ${tid}`, `(${missing.map((b) => b.code).join(', ')})`);
    await pollUntil(`boundary entities @ ${tid} visible`, async () => {
      const rows = await boundaryEntitySearch(tid, chain.map((b) => b.code));
      return rows.length >= chain.length;
    });
  }

  // 3. relationships (top-down) — needed for relationship-based consumers (UI)
  const rel = await api(
    `/boundary-service/boundary-relationships/_search?tenantId=${tid}&hierarchyType=ADMIN&includeChildren=true`,
    { RequestInfo: requestInfo() },
    { allowErrors: true },
  );
  const flat = [];
  const walk = (nodes) => (nodes || []).forEach((n) => { flat.push(n.code); walk(n.children); });
  (rel.TenantBoundary || []).forEach((tb) => walk(tb.boundary));
  const relSet = new Set(flat);
  let createdRel = 0;
  for (const b of chain) {
    if (relSet.has(b.code)) continue;
    await api('/boundary-service/boundary-relationships/_create', {
      RequestInfo: requestInfo(),
      BoundaryRelationship: {
        tenantId: tid,
        code: b.code,
        hierarchyType: 'ADMIN',
        boundaryType: b.type,
        parent: b.parent || undefined,
      },
    });
    createdRel++;
  }
  log(createdRel ? 'CREATED' : 'VERIFIED', `boundary relationships @ ${tid}`, createdRel ? `(${createdRel} links)` : '');
}

// ── HRMS employees ──────────────────────────────────────────────────────────

async function hrmsSearchByCode(tenantId, code) {
  const data = await api(
    `/egov-hrms/employees/_search?tenantId=${tenantId}&codes=${code}&limit=10&offset=0`,
    { RequestInfo: requestInfo() },
  );
  return (data.Employees || []).find((e) => e.code === code) || null;
}

async function hrmsSearchByRole(tenantId, role) {
  const data = await api(
    `/egov-hrms/employees/_search?tenantId=${tenantId}&roles=${role}&isActive=true&offset=0&limit=100`,
    { RequestInfo: requestInfo() },
  );
  return data.Employees || [];
}

function currentAssignment(emp) {
  return (emp.assignments || []).find((a) => a.isCurrentAssignment === true) || null;
}

/** uuid by employee code, from already-verified employees. */
const uuidByCode = {};

async function ensureEmployee(spec) {
  const item = `employee ${spec.code} @ ${spec.tenant}`;
  const expectedReportingTo = spec.reportingToCode ? uuidByCode[spec.reportingToCode] : null;
  if (spec.reportingToCode && !expectedReportingTo) {
    throw new Error(`${item}: supervisor ${spec.reportingToCode} uuid not resolved (wave ordering bug)`);
  }

  const verify = (emp) => {
    const problems = [];
    const roleCodes = new Set((emp.user?.roles || []).map((r) => r.code));
    if (!roleCodes.has(spec.role)) problems.push(`missing role ${spec.role} (has: ${[...roleCodes].join(',')})`);
    const asg = currentAssignment(emp);
    if (!asg) problems.push('no isCurrentAssignment=true assignment');
    else if ((asg.reportingTo || null) !== (expectedReportingTo || null)) {
      problems.push(`reportingTo=${asg.reportingTo || 'null'} expected=${expectedReportingTo || 'null'}`);
    }
    if (emp.user?.active === false) problems.push('user inactive');
    return problems;
  };

  let emp = await hrmsSearchByCode(spec.tenant, spec.code);
  if (emp) {
    const problems = verify(emp);
    if (problems.length) {
      fail(item, `DRIFT — ${problems.join('; ')}`);
    } else {
      uuidByCode[spec.code] = emp.uuid;
      log('VERIFIED', item, `uuid=${emp.uuid}`);
    }
    return;
  }

  // city-scoped roles (matches PHASE0_* shape; HRMS role search at the city
  // tenant — the escalation candidate query — matches on role tenantId).
  const roles = [
    { code: spec.role, name: ROLE_NAME[spec.role], tenantId: spec.tenant },
    { code: 'EMPLOYEE', name: 'Employee', tenantId: spec.tenant },
  ];
  const t = TENANTS[spec.tenant];
  const payload = {
    tenantId: spec.tenant,
    code: spec.code,
    employeeStatus: 'EMPLOYED',
    employeeType: 'PERMANENT',
    dateOfAppointment: DATE_OF_APPOINTMENT,
    user: {
      name: spec.name,
      userName: spec.code,
      password: EMP_PASSWORD,
      mobileNumber: spec.mobile,
      gender: 'MALE',
      dob: DOB,
      type: 'EMPLOYEE',
      active: true,
      tenantId: spec.tenant, // CITY tenant — login + (id,tenantid) scoping
      roles,
    },
    assignments: [{
      fromDate: DATE_OF_APPOINTMENT,
      isCurrentAssignment: true,
      department: DEPARTMENT,
      designation: DESIGNATION,
      isHOD: false,
      ...(expectedReportingTo ? { reportingTo: expectedReportingTo } : {}),
    }],
    jurisdictions: [{
      hierarchy: 'ADMIN',
      boundaryType: 'County',
      boundary: t.county,
      tenantId: spec.tenant,
    }],
  };
  await api('/egov-hrms/employees/_create', { RequestInfo: requestInfo(), Employees: [payload] });
  emp = await pollUntil(`${item} searchable`, () => hrmsSearchByCode(spec.tenant, spec.code));
  const problems = verify(emp);
  if (problems.length) {
    fail(item, `created but verification failed — ${problems.join('; ')}`);
    return;
  }
  uuidByCode[spec.code] = emp.uuid;
  log('CREATED', item, `uuid=${emp.uuid}`);
}

async function verifyRoleHolderSets() {
  for (const exp of EXPECTED_HOLDERS) {
    const item = `role-holders ${exp.role} @ ${exp.tenant}`;
    const holders = (await hrmsSearchByRole(exp.tenant, exp.role)).map((e) => e.code).sort();
    const want = [...exp.codes].sort();
    if (JSON.stringify(holders) === JSON.stringify(want)) {
      log('VERIFIED', item, `= [${holders.join(', ')}]`);
    } else {
      fail(item, `holders [${holders.join(', ')}] expected [${want.join(', ')}]`);
    }
  }
}

// ── PGR smoke ───────────────────────────────────────────────────────────────

async function pgrSmoke(tid) {
  const t = TENANTS[tid];
  // act as the CITY-tenant ADMIN: login-tenant-scoped roles (CITIZEN/CSR @
  // tid) are what the workflow APPLY transition authorizes against.
  const city = await oauth(ADMIN_USER, ADMIN_PASS, tid);
  const cityRequestInfo = { ...requestInfo(), authToken: city.token, userInfo: city.user };
  const data = await api('/pgr-services/v2/request/_create', {
    RequestInfo: cityRequestInfo,
    service: {
      tenantId: tid,
      serviceCode: SERVICE_CODE,
      description: `E2E role-fixture smoke complaint (throwaway) @ ${tid}`,
      address: {
        tenantId: tid,
        locality: { code: t.locality, name: t.locality },
        city: t.name,
        geoLocation: { latitude: 0, longitude: 0 },
      },
      citizen: {
        name: 'E2E Fixture Citizen',
        mobileNumber: t.smokeCitizenMobile,
        userName: t.smokeCitizenMobile,
        type: 'CITIZEN',
        tenantId: ROOT,
        roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: ROOT }],
      },
      source: 'web',
      active: true,
    },
    workflow: { action: 'APPLY' },
  });
  const srid = data.ServiceWrappers?.[0]?.service?.serviceRequestId;
  if (!srid) throw new Error(`PGR create @ ${tid} returned no serviceRequestId: ${JSON.stringify(data).slice(0, 300)}`);
  // poll search — persister is async
  await pollUntil(`complaint ${srid} searchable`, async () => {
    const res = await api(
      `/pgr-services/v2/request/_search?tenantId=${tid}&serviceRequestId=${encodeURIComponent(srid)}`,
      { RequestInfo: requestInfo() },
    );
    return (res.ServiceWrappers || []).length > 0;
  });
  log('SMOKE-OK', `PGR @ ${tid}`, `srid=${srid} locality=${t.locality} serviceCode=${SERVICE_CODE}`);
  return srid;
}

// ── main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`setup-role-fixture: BASE_URL=${BASE_URL} root=${ROOT} smoke=${SMOKE}\n`);
  await auth();

  await ensureRoles();
  for (const tid of Object.keys(TENANTS)) {
    await ensureTenant(tid);
    await ensureWorkflow(tid);
    await ensureBoundary(tid);
  }
  await ensureAdminCityRoles();
  for (const tid of Object.keys(TENANTS)) await ensureCityAdminUser(tid);
  for (const spec of EMPLOYEES.filter((e) => e.wave === 1)) await ensureEmployee(spec);
  for (const spec of EMPLOYEES.filter((e) => e.wave === 2)) await ensureEmployee(spec);
  if (!failures.length) await verifyRoleHolderSets();

  const smokeSrids = {};
  if (SMOKE && !failures.length) {
    for (const tid of Object.keys(TENANTS)) smokeSrids[tid] = await pgrSmoke(tid);
  }

  console.log('\n── fixture inventory ──');
  console.log(JSON.stringify({
    rootTenant: ROOT,
    tenants: Object.fromEntries(Object.entries(TENANTS).map(([tid, t]) => [tid, {
      name: t.name, locality: t.locality, serviceCode: SERVICE_CODE,
    }])),
    roles: ROLES.map((r) => r.code),
    employees: EMPLOYEES.map((e) => ({
      code: e.code, tenant: e.tenant, role: e.role, uuid: uuidByCode[e.code] || null,
      reportingTo: e.reportingToCode ? `${e.reportingToCode} (${uuidByCode[e.reportingToCode] || '?'})` : null,
    })),
    ...(SMOKE ? { smokeSrids } : {}),
  }, null, 2));

  if (failures.length) {
    console.error(`\n${failures.length} FAILURE(S):`);
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log('\nFIXTURE COMPLETE — all items verified.');
})().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
