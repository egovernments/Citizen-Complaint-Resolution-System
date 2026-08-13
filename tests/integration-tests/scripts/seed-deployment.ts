/**
 * seed-deployment.ts — make a FROM-SCRATCH deployment testable, reproducibly.
 *
 * This is ENV-DATA-PLAN P0 option (B): seed from version-controlled JSON instead of
 * relying on a binary DB dump. A teardown-with-volumes + fresh deploy leaves the
 * stack unable to run the suite at all (`full-dump.sql` carries 108 localization
 * rows and no ComplaintHierarchy schema). Everything this script seeds was
 * restored by hand on 2026-07-27; this encodes that runbook so it never has to be
 * done by hand again.
 *
 * Deployment-agnostic by construction:
 *   - tenants come from env (ROOT_TENANT / DIGIT_TENANT), never hardcoded
 *   - the mobile rule is derived from the deployment's OWN globalConfigs, so a
 *     Kenya box gets +254 and a Mozambique box gets +258 (copying the shipped
 *     Kenya seed onto Maputo is exactly the bug this avoids)
 *   - every step is idempotent: re-running reports "exists" rather than failing
 *
 * Usage:
 *   cd tests/integration-tests
 *   set -a; source .env; set +a
 *   npx tsx scripts/seed-deployment.ts            # seed everything missing
 *   npx tsx scripts/seed-deployment.ts --check    # report only, change nothing
 *
 * NOTE the two traps this script exists to encode:
 *   1. Localization must be seeded at BOTH the root AND the city tenant — the city
 *      does not inherit, and the citizen/employee UIs read at the city.
 *   2. The localization service caches _search per (tenant, locale, module). After
 *      writing you MUST flush, or every verification reads the stale count.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { BASE_URL, ROOT_TENANT, TENANT, ADMIN_USER, ADMIN_PASS, DEFAULT_PASSWORD } from '../tests/utils/env';
import { fetchGlobalConfigs, fetchBoundaryTree, type BoundaryNode } from '../tests/utils/probes';
import { getMobileValidationRule, generateValidMobile } from '../tests/utils/mdms-mobile';

const CHECK_ONLY = process.argv.includes('--check');
/** Where the version-controlled seed lives (a git submodule in this repo). */
const SEED_ROOT = resolve(__dirname, '../../../local-setup/ansible/nairobi-mdms');
const LOC_DIR = join(SEED_ROOT, 'localization');
const MDMS_DIR = join(SEED_ROOT, 'mdms');
/** Root first: schemas/masters live at the root and the city inherits them. */
const TENANTS = Array.from(new Set([ROOT_TENANT, TENANT]));

let token = '';
/** The admin's own UserRequest, kept for the writes whose audit trail needs it. */
let adminUserInfo: Record<string, any> | null = null;
const log = (s: string) => console.log(s);

async function post<T = any>(path: string, body: unknown): Promise<{ ok: boolean; data?: T; err?: string }> {
  try {
    const r = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, err: `${r.status} ${text.slice(0, 160)}` };
    return { ok: true, data: text ? (JSON.parse(text) as T) : undefined };
  } catch (e) {
    return { ok: false, err: (e as Error).message.slice(0, 160) };
  }
}

const requestInfo = () => ({ apiId: 'Rainmaker', ver: '1.0', msgId: `seed|en_IN`, authToken: token });

async function auth(): Promise<void> {
  const body = new URLSearchParams({
    grant_type: 'password', username: ADMIN_USER, password: ADMIN_PASS,
    tenantId: ROOT_TENANT, scope: 'read', userType: 'EMPLOYEE',
  });
  const r = await fetch(`${BASE_URL}/user/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=' },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`admin login failed (${r.status}) — is the stack up?`);
  const body2 = (await r.json()) as { access_token: string; UserRequest?: Record<string, any> };
  token = body2.access_token;
  adminUserInfo = body2.UserRequest ?? null;
}

// ── localization ────────────────────────────────────────────────────────────

async function locCount(tenant: string, module: string): Promise<number> {
  const r = await post<{ messages?: unknown[] }>(
    `/localization/messages/v1/_search?tenantId=${tenant}&locale=en_IN&module=${module}`,
    { RequestInfo: requestInfo() },
  );
  return r.data?.messages?.length ?? 0;
}

async function seedLocalization(): Promise<void> {
  const files = ['rainmaker-common.json', 'rainmaker-pgr.json', 'rainmaker-hr.json'];
  for (const tenant of TENANTS) {
    for (const f of files) {
      const p = join(LOC_DIR, f);
      if (!existsSync(p)) { log(`  ! missing seed file ${f} — is the nairobi-mdms submodule initialised?`); continue; }
      const msgs = JSON.parse(readFileSync(p, 'utf8')) as Array<{ code: string; message: string; module: string; locale: string }>;
      const module = msgs[0]?.module ?? f.replace('.json', '');
      const before = await locCount(tenant, module);
      if (before >= msgs.length) { log(`  = ${module} @ ${tenant}: ${before} (already seeded)`); continue; }
      if (CHECK_ONLY) { log(`  ~ ${module} @ ${tenant}: ${before} → would seed ${msgs.length}`); continue; }
      for (let i = 0; i < msgs.length; i += 300) {
        const chunk = msgs.slice(i, i + 300).map((m) => ({ code: m.code, message: m.message, module, locale: m.locale || 'en_IN' }));
        const r = await post(`/localization/messages/v1/_upsert?tenantId=${tenant}&locale=en_IN`,
          { RequestInfo: requestInfo(), tenantId: tenant, messages: chunk });
        if (!r.ok) log(`    ! chunk ${i} failed: ${r.err}`);
      }
      log(`  + ${module} @ ${tenant}: ${before} → ${msgs.length}`);
    }
  }
}

/**
 * The city must be at least as complete as the root — `admin/localization` asserts
 * exactly that, and the bootstrap writes a handful of root-only rows.
 */
async function mirrorRootToCity(): Promise<void> {
  if (ROOT_TENANT === TENANT) return;
  for (const module of ['rainmaker-common', 'rainmaker-pgr', 'rainmaker-hr']) {
    const [rootRes, cityRes] = await Promise.all([
      post<{ messages?: Array<{ code: string; message: string }> }>(`/localization/messages/v1/_search?tenantId=${ROOT_TENANT}&locale=en_IN&module=${module}`, { RequestInfo: requestInfo() }),
      post<{ messages?: Array<{ code: string; message: string }> }>(`/localization/messages/v1/_search?tenantId=${TENANT}&locale=en_IN&module=${module}`, { RequestInfo: requestInfo() }),
    ]);
    const cityCodes = new Set((cityRes.data?.messages ?? []).map((m) => m.code));
    const missing = (rootRes.data?.messages ?? []).filter((m) => !cityCodes.has(m.code));
    if (!missing.length) { log(`  = ${module}: root/city in parity`); continue; }
    if (CHECK_ONLY) { log(`  ~ ${module}: ${missing.length} root-only rows would be mirrored to city`); continue; }
    for (let i = 0; i < missing.length; i += 300) {
      const chunk = missing.slice(i, i + 300).map((m) => ({ code: m.code, message: m.message, module, locale: 'en_IN' }));
      await post(`/localization/messages/v1/_upsert?tenantId=${TENANT}&locale=en_IN`,
        { RequestInfo: requestInfo(), tenantId: TENANT, messages: chunk });
    }
    log(`  + ${module}: mirrored ${missing.length} rows to ${TENANT}`);
  }
}

// ── MDMS schemas + masters ──────────────────────────────────────────────────

async function ensureSchema(tenant: string, code: string, definition: unknown): Promise<void> {
  if (CHECK_ONLY) { log(`  ~ schema ${code} @ ${tenant}: would ensure`); return; }
  const r = await post('/mdms-v2/schema/v1/_create',
    { RequestInfo: requestInfo(), SchemaDefinition: { tenantId: tenant, code, description: code, definition, isActive: true } });
  log(r.ok ? `  + schema ${code} @ ${tenant}` : `  = schema ${code} @ ${tenant} (${/DUPLICATE/.test(r.err ?? '') ? 'exists' : r.err})`);
}

async function ensureData(tenant: string, schemaCode: string, uid: string, data: unknown): Promise<void> {
  if (CHECK_ONLY) { log(`  ~ ${schemaCode}/${uid} @ ${tenant}: would ensure`); return; }
  const r = await post(`/mdms-v2/v2/_create/${schemaCode}`,
    { RequestInfo: requestInfo(), Mdms: { tenantId: tenant, schemaCode, uniqueIdentifier: uid, data, isActive: true } });
  log(r.ok ? `  + ${schemaCode}/${uid} @ ${tenant}` : `  = ${schemaCode}/${uid} @ ${tenant} (exists/err)`);
}

/** ComplaintHierarchy: written by the onboarding wizard, absent from the dump. */
async function seedComplaintHierarchySchemas(): Promise<void> {
  const hier = {
    type: 'object', title: 'RAINMAKER-PGR.ComplaintHierarchy', $schema: 'http://json-schema.org/draft-07/schema#',
    required: ['code', 'name', 'hierarchyType', 'levelCode', 'active'], 'x-unique': ['code'],
    properties: {
      hierarchyType: { type: 'string' }, levelCode: { type: 'string' }, code: { type: 'string' },
      parentCode: { type: ['string', 'null'] }, name: { type: 'string' }, order: { type: 'number' },
      active: { type: 'boolean' }, path: { type: 'string' }, department: { type: 'string' },
      departments: { type: 'array', items: { type: 'string' } },
      slaHours: { type: 'number' }, keywords: { type: 'string' },
    },
    'x-ref-schema': [], additionalProperties: false,
  };
  const hdef = {
    type: 'object', title: 'RAINMAKER-PGR.ComplaintHierarchyDefinition', $schema: 'http://json-schema.org/draft-07/schema#',
    required: ['hierarchyType', 'levels', 'active'], 'x-unique': ['hierarchyType'],
    properties: {
      hierarchyType: { type: 'string' }, active: { type: 'boolean' },
      levels: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
    'x-ref-schema': [], additionalProperties: false,
  };
  await ensureSchema(ROOT_TENANT, 'RAINMAKER-PGR.ComplaintHierarchy', hier);
  await ensureSchema(ROOT_TENANT, 'RAINMAKER-PGR.ComplaintHierarchyDefinition', hdef);
}

async function seedRejectionReasons(): Promise<void> {
  const sp = join(MDMS_DIR, 'schemas/RAINMAKER-PGR/RejectionReasons.json');
  const dp = join(MDMS_DIR, 'data/ke/RAINMAKER-PGR/RejectionReasons.json');
  if (existsSync(sp)) {
    const sd = JSON.parse(readFileSync(sp, 'utf8'));
    await ensureSchema(ROOT_TENANT, 'RAINMAKER-PGR.RejectionReasons', sd.definition ?? sd);
  }
  if (!existsSync(dp)) return;
  for (const row of JSON.parse(readFileSync(dp, 'utf8')) as Array<Record<string, any>>) {
    const data = row.data ?? row;
    await ensureData(ROOT_TENANT, 'RAINMAKER-PGR.RejectionReasons', row.uniqueIdentifier ?? data.code, data);
  }
}

/**
 * The mobile rule MUST reflect this deployment, not the shipped Kenya seed.
 * Read it from the SPA's own globalConfigs (the rule the UI actually enforces) so
 * MDMS and the UI can never disagree — the exact mismatch that broke
 * verify-mobile-validation. Two masters exist; the app/tests read
 * `common-masters.MobileNumberValidation`.
 */
async function seedMobileValidation(): Promise<void> {
  let pattern = '', countryCode = '';
  try {
    const js = await (await fetch(`${BASE_URL}/digit-ui/globalConfigs.js`)).text();
    pattern = /mobileNumberPattern["']?\s*[:=]\s*["']([^"']+)/.exec(js)?.[1]
      ?? /mobileNumberRegex["']?\s*[:=]\s*["']([^"']+)/.exec(js)?.[1] ?? '';
    countryCode = /countryCode["']?\s*[:=]\s*["']([^"']+)/.exec(js)?.[1] ?? '';
  } catch { /* fall through to the profile below */ }
  if (!pattern) {
    const pf = resolve('deployment-profile.json');
    if (existsSync(pf)) {
      const p = JSON.parse(readFileSync(pf, 'utf8'));
      pattern = p?.mobile?.pattern ?? ''; countryCode = countryCode || (p?.mobile?.countryCode ?? '');
    }
  }
  if (!pattern) { log('  ! could not resolve this deployment\'s mobile pattern — skipping (set it by hand)'); return; }
  const digits = /\{(\d+)\}/.exec(pattern)?.[1];
  const len = digits ? Number(digits) + 1 : 10; // leading class + {n}
  const defn = {
    type: 'object', title: 'common-masters.MobileNumberValidation', $schema: 'http://json-schema.org/draft-07/schema#',
    required: ['countryCode', 'mobileNumberRegex'], 'x-unique': ['countryCode'],
    properties: { countryCode: { type: 'string' }, mobileNumberRegex: { type: 'string' }, default: { type: 'boolean' }, errorMessage: { type: 'string' } },
    'x-ref-schema': [], additionalProperties: false,
  };
  const data = { countryCode: countryCode || '+000', mobileNumberRegex: pattern, default: true,
    errorMessage: `Please enter a valid mobile number (${len} digits)` };
  await ensureSchema(ROOT_TENANT, 'common-masters.MobileNumberValidation', defn);
  for (const t of TENANTS) await ensureData(t, 'common-masters.MobileNumberValidation', data.countryCode, data);
  log(`  → mobile rule: ${data.countryCode} ${pattern} (derived from this deployment)`);
}

// ── personas ────────────────────────────────────────────────────────────────

/**
 * A CSR narrowed to ONE ward — the persona `personas.ward-scoped-csr` gates
 * tests/api/boundary-jurisdiction-496.spec.ts on.
 *
 * Without it that spec self-skips, because personas.ts's isWardScopedCsr wants
 * BOTH halves and no shipped employee has them together:
 *   - the CSR role, and
 *   - an HRMS jurisdiction in the PGR boundary hierarchy whose boundaryType is
 *     BELOW the hierarchy root (an employee scoped to the whole root sees the
 *     entire tree, which would make the jurisdiction-filter assertion vacuous).
 * On the local stack EMP001/2/3 are scoped to the MAPUTO_ADMIN root itself and
 * hold no CSR, while ADMIN holds CSR but its lone jurisdiction is `mz.maputo` —
 * a TENANT id in hierarchy `ADMIN`, not a PGR boundary at all.
 *
 * Everything here is derived from the deployment, never from Maputo literals:
 * the hierarchy comes from the SPA's own globalConfigs, the ward from that
 * hierarchy's live tree, and the department/designation from an employee who
 * already exists (the same trick tests/admin/employees.spec.ts uses, so HRMS's
 * FK validation passes on any tenant). Idempotent: if any active employee
 * already satisfies the predicate, nothing is written.
 */
const WARD_CSR_CODE = process.env.SEED_WARD_CSR_CODE || 'SEED_WARD_CSR';

interface HrmsEmployeeRow {
  code?: string;
  user?: { roles?: Array<{ code?: string }> };
  jurisdictions?: Array<{ hierarchy?: string; boundary?: string; boundaryType?: string; isActive?: boolean }>;
  assignments?: Array<{ department?: string; designation?: string; isCurrentAssignment?: boolean }>;
}

/** Active employees at the EXACT complaint tenant — HRMS has no parent fallback. */
async function employeesAt(tenant: string): Promise<HrmsEmployeeRow[]> {
  const r = await post<{ Employees?: HrmsEmployeeRow[] }>(
    `/egov-hrms/employees/_search?tenantId=${encodeURIComponent(tenant)}&isActive=true&limit=500&offset=0`,
    { RequestInfo: requestInfo() },
  );
  return r.data?.Employees ?? [];
}

/** The boundaryTypes of one root-to-leaf path, root first. */
function levelsOf(root: BoundaryNode): string[] {
  const out: string[] = [];
  for (let n: BoundaryNode | undefined = root; n; n = n.children?.[0]) out.push(n.boundaryType);
  return [...new Set(out)];
}

async function seedWardScopedCsr(): Promise<void> {
  const gc = await fetchGlobalConfigs().catch(() => ({} as Awaited<ReturnType<typeof fetchGlobalConfigs>>));
  let hierarchyType = gc.hierarchyType ?? '';
  if (!hierarchyType && existsSync(resolve('deployment-profile.json'))) {
    hierarchyType = JSON.parse(readFileSync(resolve('deployment-profile.json'), 'utf8'))?.boundary?.hierarchyType ?? '';
  }
  if (!hierarchyType) { log('  ! no boundary hierarchy on this deployment — cannot scope a CSR to a ward'); return; }

  const tree = await fetchBoundaryTree(TENANT, hierarchyType, { authToken: token }).catch(() => null);
  if (!tree) { log(`  ! hierarchy ${hierarchyType} has no boundary tree at ${TENANT} — seed boundaries first`); return; }
  const levels = levelsOf(tree);
  if (levels.length < 2) { log(`  ! hierarchy ${hierarchyType} is one level deep — nothing sits BELOW its root`); return; }

  // Already satisfied? Same predicate personas.ts applies, so a deployment that
  // onboarded its own ward CSR (bomet) is left completely alone.
  const employees = await employeesAt(TENANT);
  const existing = employees.find((e) =>
    (e.user?.roles ?? []).some((r) => r.code === 'CSR') &&
    (e.jurisdictions ?? []).some(
      (j) => j.isActive !== false && j.hierarchy === hierarchyType && j.boundaryType !== levels[0],
    ),
  );
  if (existing) { log(`  = ward-scoped CSR @ ${TENANT}: ${existing.code} (already onboarded)`); return; }

  // A "ward" is the level just above the leaf — the smallest area that still
  // contains several localities — but never the root, which would defeat the
  // scoping this persona exists to exercise.
  const wardLevel = levels[Math.max(1, levels.length - 2)];
  const wards: string[] = [];
  const collect = (n: BoundaryNode): void => {
    if (n.boundaryType === wardLevel) wards.push(n.code);
    for (const c of n.children ?? []) collect(c);
  };
  collect(tree);
  wards.sort();
  if (wards.length < 2) {
    log(`  ! only ${wards.length} '${wardLevel}' boundary(ies) exist — #496 needs a sibling ward to be non-vacuous`);
    return;
  }
  const ward = wards[0];

  // HRMS validates department/designation against the tenant's own masters, so
  // borrow a live pair rather than guessing. `PW_`-prefixed rows are suite
  // litter and are skipped; a donor scoped to the PGR hierarchy is preferred
  // because its department is the one the complaint catalogue actually uses.
  const isLitter = (code = ''): boolean => /(^|_)PW[A-Z_]/i.test(code);
  const donors = employees
    .filter((e) => !isLitter(e.code) && (e.assignments ?? []).some((a) => a.department && a.designation))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const donor =
    donors.find((e) => (e.jurisdictions ?? []).some((j) => j.hierarchy === hierarchyType)) ?? donors[0];
  const assignment = (donor?.assignments ?? []).find((a) => a.department && a.designation);
  if (!assignment) {
    log(`  ! no employee at ${TENANT} carries a department+designation to copy — onboard one employee first`);
    return;
  }

  if (CHECK_ONLY) {
    log(`  ~ ward-scoped CSR ${WARD_CSR_CODE} @ ${TENANT}: would create — ${wardLevel} '${ward}' ` +
      `in ${hierarchyType}, ${assignment.department}/${assignment.designation} (from ${donor?.code})`);
    return;
  }

  // Mobile must satisfy THIS tenant's MDMS rule (Kenya starts 7/1, Maputo 8) —
  // HRMS rejects the create otherwise.
  const mobile = generateValidMobile(await getMobileValidationRule(TENANT));
  const now = Date.now();
  const r = await post(`/egov-hrms/employees/_create?tenantId=${encodeURIComponent(TENANT)}`, {
    RequestInfo: { ...requestInfo(), ver: '1.0', ts: now, action: '_create', userInfo: adminUserInfo ?? undefined },
    Employees: [{
      tenantId: TENANT,
      code: WARD_CSR_CODE,
      employeeStatus: 'EMPLOYED',
      employeeType: 'PERMANENT',
      dateOfAppointment: now - 24 * 3600_000,
      user: {
        // HRMS overwrites userName with the employee code regardless of what we
        // send (see EmployeeShow.tsx:39-41), and persona discovery logs in with
        // the CODE it read back from HRMS — so they must be the same string.
        userName: WARD_CSR_CODE,
        name: 'Seeded Ward CSR',
        mobileNumber: mobile,
        type: 'EMPLOYEE',
        active: true,
        gender: 'MALE',
        dob: 631152000000,
        // The password persona discovery guesses (personas.ts passwordGuesses
        // defaults to this); without it the persona is created but unusable.
        password: process.env.PERSONA_PASSWORD_GUESSES?.split(',')[0]?.trim() || DEFAULT_PASSWORD,
        tenantId: TENANT,
        roles: [
          { code: 'CSR', name: 'CSR', tenantId: TENANT },
          { code: 'EMPLOYEE', name: 'Employee', tenantId: TENANT },
        ],
      },
      jurisdictions: [{
        boundary: ward, boundaryType: wardLevel,
        hierarchy: hierarchyType, hierarchyType,
        tenantId: TENANT, isActive: true,
      }],
      assignments: [{
        department: assignment.department, designation: assignment.designation,
        fromDate: now - 24 * 3600_000, isCurrentAssignment: true,
      }],
    }],
  });
  log(r.ok
    ? `  + ward-scoped CSR ${WARD_CSR_CODE} @ ${TENANT}: ${wardLevel} '${ward}' in ${hierarchyType}, ` +
      `${assignment.department}/${assignment.designation}`
    : `  ! ward-scoped CSR ${WARD_CSR_CODE} @ ${TENANT} failed: ${r.err}`);
}

// ── cache ───────────────────────────────────────────────────────────────────

/**
 * Without this every verification reads stale counts and you conclude the seeding
 * failed when it didn't. Best-effort: falls back to the localization cache-bust
 * endpoint when the redis container isn't reachable from here.
 */
async function bustCaches(): Promise<void> {
  if (CHECK_ONLY) return;
  const { execSync } = await import('node:child_process');
  try {
    execSync('docker exec digit-redis redis-cli FLUSHALL', { stdio: 'ignore' });
    log('  + flushed redis (localization + validationRules)');
    return;
  } catch { /* not a local docker stack */ }
  await post('/localization/messages/v1/_cache-bust', { RequestInfo: requestInfo() });
  log('  + requested localization cache-bust');
}

async function main(): Promise<void> {
  log(`seed-deployment: ${BASE_URL}  root=${ROOT_TENANT} city=${TENANT}${CHECK_ONLY ? '  [CHECK ONLY]' : ''}`);
  await auth();
  log('\n── MDMS schemas ──');
  await seedComplaintHierarchySchemas();
  log('\n── RejectionReasons ──');
  await seedRejectionReasons();
  log('\n── mobile validation ──');
  await seedMobileValidation();
  log('\n── localization ──');
  await seedLocalization();
  await mirrorRootToCity();
  log('\n── personas ──');
  await seedWardScopedCsr();
  log('\n── caches ──');
  await bustCaches();
  log('\nDone. Re-run any time — every step is idempotent.');
  log('Onboarding data (boundaries / complaint types / employees) is NOT handled here:');
  log('  seed it with the XLSX onboarding (see docs/TEST-PREREQUISITES.md §1b row A).');
}

main().catch((e) => { console.error(e); process.exit(1); });
