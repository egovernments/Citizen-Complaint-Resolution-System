/**
 * Persona resolution — who on this deployment can actually drive a PGR action.
 *
 * The hard part is not logging someone in, it is that a testable ASSIGN needs a
 * consistent TRIPLE, not a lucky employee:
 *
 *     (serviceCode, actor holding GRO, assignee holding serviceCode's department
 *      AND a role able to act on the state ASSIGN lands in)
 *
 * pgr-services validates the ASSIGNEE's HRMS departments against the complaint
 * type's department, and egov-workflow-v2 separately rejects an assignee who
 * holds no role able to act on the NEXT state. Both shipped deployments punish
 * the obvious "first employee with GRO and some department" shortcut:
 *
 *   local  ADMIN satisfies GRO+department, but its departments (CENTER, DEPT_5,
 *          DEPT_36, DEPT_37) match no maputo complaint type, so the ASSIGN it
 *          wins fails INVALID_ASSIGNMENT. Only EMP001 (ambiental,
 *          obras_publicas) lines up with the catalogue.
 *   bomet  RudeBehavior needs WATER_ENV, held only by DEMO_WATER — which has
 *          PGR_LME but no GRO. HS_GRO has the GRO but sits in DEPT_1. The actor
 *          and the assignee are necessarily DIFFERENT PEOPLE there.
 *
 * The asymmetry that makes this tractable: an assignee is only ever a uuid on
 * the wire, so it can be discovered freely from HRMS with no password. Only the
 * ACTOR needs credentials, and those come from env.
 */
import { getDigitToken } from './auth';
import { ROOT_TENANT, TENANT, DEFAULT_PASSWORD } from './env';
import { fetchEmployees, type DiscoveredEmployee } from './probes';
import { getProfile, type DeploymentProfile, type PersonaSummary } from './profile';

export type PersonaKey = 'employee' | 'gro' | 'gro-with-department' | 'lme' | 'ward-scoped-csr' | 'inbox-viewer';

export const PERSONA_KEYS: PersonaKey[] = ['employee', 'gro', 'gro-with-department', 'lme', 'ward-scoped-csr', 'inbox-viewer'];

export interface Candidate {
  username: string;
  password: string;
  /** Provenance, e.g. 'env:GRO_USER' — persisted so a reader can re-derive it. */
  source: string;
  /**
   * Tenants this credential may be authenticated against, in order.
   *
   * Part of the lockout budget, not a convenience: every entry here is one more
   * failed login the account absorbs when the password is wrong, so the list is
   * only ever longer than one element when we have a positive reason to believe
   * the user might live at the root (see candidateCredentials).
   */
  authTenants: string[];
}

export interface ResolvedPersona {
  username: string;
  password: string;
  tenant: string;
  uuid: string;
  roles: string[];
  departments: string[];
  jurisdictions: string[];
  token: string;
  userInfo: Record<string, unknown>;
  source: string;
}

export interface SeedPlan {
  actor: ResolvedPersona;
  assigneeUuid: string;
  assigneeCode: string;
  serviceCode: string;
  localityCode: string;
}

/**
 * Password guesses for HRMS-discovered codes that no env var names.
 *
 * Capped and disable-able because a wrong guess is not free: user-service locks
 * an account after repeated failures, and a locked persona breaks the very
 * deployment the suite is meant to test. Set PERSONA_PASSWORD_GUESSES='' to turn
 * discovery-by-guessing off entirely and rely on env pairs alone.
 *
 * The cap is only real if a guess costs exactly ONE failed login. It used not
 * to: login() probed [TENANT, ROOT_TENANT], so on a deployment with a city
 * sub-tenant (mz.maputo under mz) three guesses spent SIX failures against the
 * account — double the budget this constant claims to enforce, and enough to
 * trip a lockout threshold the cap was chosen to stay under. Hence
 * `authTenants` on Candidate: a code we discovered by reading HRMS at TENANT is
 * known to live at TENANT, so probing the root for it buys nothing and costs a
 * failure. See candidateCredentials().
 */
const MAX_PASSWORD_GUESSES = 3;

function passwordGuesses(): string[] {
  const raw = process.env.PERSONA_PASSWORD_GUESSES;
  if (raw !== undefined && !raw.trim()) return [];
  return (raw ?? DEFAULT_PASSWORD)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_PASSWORD_GUESSES);
}

/**
 * Credentials to try, most-trustworthy first.
 *
 * Sync by contract, so HRMS codes arrive from the caller rather than being
 * fetched here — resolvePersona() does that read once and shares it.
 *
 * Two classes of candidate, and they get different tenant budgets:
 *
 *   explicit (env vars, PERSONA_CANDIDATES)
 *     An operator handed us this pair and did not say where the user lives. It
 *     may be a city employee or a root admin, so both are probed. The cost is
 *     bounded at 2 failures for ONE password, and a wrong env password is an
 *     operator mistake that ought to be loud.
 *
 *   discovered (`hrms:<code>+guess`)
 *     We only know this code because HRMS at TENANT returned it, so TENANT is
 *     where it authenticates; the root probe could only ever fail. Probing it
 *     anyway would multiply MAX_PASSWORD_GUESSES by the tenant count and walk
 *     the account toward a lockout in exchange for no information at all.
 */
export function candidateCredentials(discoveredCodes: string[] = []): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  // First push wins, so an explicit pair that repeats a discovered code keeps
  // its wider tenant list instead of being narrowed by the guess loop below.
  const push = (username: string | undefined, password: string | undefined, source: string, authTenants: string[]): void => {
    if (!username || !password) return;
    const key = `${username}\u0000${password}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ username, password, source, authTenants });
  };

  const explicitTenants = TENANT === ROOT_TENANT ? [TENANT] : [TENANT, ROOT_TENANT];

  const envPairs: [string, string, string][] = [
    ['EMPLOYEE_USER', 'EMPLOYEE_PASSWORD', 'env:EMPLOYEE_USER'],
    ['GRO_USER', 'GRO_PASSWORD', 'env:GRO_USER'],
    ['CITY_ADMIN_USER', 'CITY_ADMIN_PASS', 'env:CITY_ADMIN_USER'],
    ['WARD_CSR_USER', 'WARD_CSR_PASSWORD', 'env:WARD_CSR_USER'],
    ['FLOW5_EMPLOYEE_USER', 'FLOW5_EMPLOYEE_PASSWORD', 'env:FLOW5_EMPLOYEE_USER'],
  ];
  for (const [userVar, passVar, source] of envPairs) {
    push(process.env[userVar], process.env[passVar] || DEFAULT_PASSWORD, source, explicitTenants);
  }
  push(process.env.DIGIT_USERNAME || process.env.ADMIN_USER || 'ADMIN',
    process.env.DIGIT_PASSWORD || process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD, 'env:ADMIN', explicitTenants);

  for (const pair of (process.env.PERSONA_CANDIDATES || '').split(',')) {
    const [username, password] = pair.split(':');
    push(username?.trim(), password?.trim(), 'env:PERSONA_CANDIDATES', explicitTenants);
  }

  for (const code of discoveredCodes) {
    for (const guess of passwordGuesses()) push(code, guess, `hrms:${code}+guess`, [TENANT]);
  }
  return out;
}

// ── login + HRMS join ────────────────────────────────────────────────────────

interface Principal {
  token: string;
  userInfo: Record<string, any>;
  roles: string[];
  authTenant: string;
}

const loginCache = new Map<string, Principal | null>();
let employeeCache: DiscoveredEmployee[] | null = null;
let adminTokenCache: string | null = null;

/** Why the admin token is unavailable, when it is — kept so callers can tell a
 *  broken login apart from a deployment that genuinely has no employees. */
let adminTokenError: string | null = null;

async function adminToken(): Promise<string> {
  if (adminTokenCache !== null) return adminTokenCache;
  const user = process.env.DIGIT_USERNAME || process.env.ADMIN_USER || 'ADMIN';
  // The admin login is retried: it is the single point every HRMS read goes
  // through, and a deployment that has just come up answers the first call
  // with a 5xx while egov-user is still warming. A one-shot failure here used
  // to surface as "Employees present: none", which reads as a seed gap and
  // sends the reader to onboard data that is already there.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await getDigitToken({
        tenant: ROOT_TENANT,
        username: user,
        password: process.env.DIGIT_PASSWORD || process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD,
      });
      adminTokenCache = r.access_token;
      adminTokenError = null;
      return adminTokenCache;
    } catch (err: any) {
      adminTokenError = `${user}@${ROOT_TENANT}: ${err?.message?.slice(0, 160) ?? err}`;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2_000));
    }
  }
  console.log(`[personas] admin token unavailable after 3 attempts — ${adminTokenError}`);
  adminTokenCache = '';
  return adminTokenCache;
}

/**
 * Employees at the EXACT complaint tenant.
 *
 * Exact because HRMS has no parent-tenant fallback: bomet's BOMET_ADMIN exists
 * only at ke.bomet and therefore cannot serve a complaint filed at ke, no matter
 * what an env var claims. Unfiltered because the codes=/names= filters are not
 * tenant-scoped at all (asking ke for codes=EMP001 hands back an mz.maputo
 * employee) — see probes.ts fetchEmployees.
 */
async function employeesAtTenant(): Promise<DiscoveredEmployee[]> {
  if (employeeCache) return employeeCache;
  const token = await adminToken();
  employeeCache = token ? await fetchEmployees(TENANT, token) : [];
  return employeeCache;
}

/**
 * Log in at each tenant the candidate carries, in order.
 *
 * The tenant list belongs to the CANDIDATE, not to this function, because it is
 * a spend decision and only the credential's provenance can make it: an
 * explicit env pair probes CITY then ROOT (an onboarded employee lives at the
 * city tenant and 400s against the root, while ADMIN is the reverse), whereas
 * an HRMS-discovered code is probed only where HRMS said it lives. Hard-coding
 * [TENANT, ROOT_TENANT] here is what silently doubled the guess budget.
 */
async function login(c: Candidate): Promise<Principal | null> {
  const key = `${c.username}\u0000${c.password}`;
  const hit = loginCache.get(key);
  if (hit !== undefined) return hit;

  let result: Principal | null = null;
  for (const authTenant of c.authTenants) {
    try {
      const resp = await getDigitToken({ tenant: authTenant, authTenant, username: c.username, password: c.password });
      if (resp.access_token) {
        const userInfo = (resp.UserRequest || {}) as Record<string, any>;
        result = {
          token: resp.access_token,
          userInfo,
          roles: ((userInfo.roles || []) as any[]).map((r) => String(r.code)),
          authTenant,
        };
        break;
      }
    } catch {
      // Try the next tenant; a guessed password failing everywhere is normal.
    }
  }
  // R6: every attempt is logged, so a lockout can be traced to this suite —
  // which means logging how many failures it cost, not just the verdict.
  console.log(
    `[personas] login ${c.username} (${c.source}) -> ${result ? `ok @ ${result.authTenant}` : `no (tried ${c.authTenants.join(', ')})`}`,
  );
  loginCache.set(key, result);
  return result;
}

async function toResolved(c: Candidate, p: Principal): Promise<ResolvedPersona> {
  const employees = await employeesAtTenant();
  const uuid = String(p.userInfo.uuid ?? '');
  // Joined on uuid, not code: the same ADMIN username exists at both mz and
  // mz.maputo with DIFFERENT uuids and different departments, and only the
  // record at the complaint's tenant is the one pgr-services will read.
  const hrms = employees.find((e) => e.uuid === uuid);
  return {
    username: c.username,
    password: c.password,
    tenant: p.authTenant,
    uuid,
    roles: [...new Set([...p.roles, ...(hrms?.roles ?? [])])].sort(),
    departments: hrms?.departments ?? [],
    jurisdictions: (hrms?.jurisdictions ?? []).map((j) => j.boundary),
    token: p.token,
    userInfo: p.userInfo,
    source: c.source,
  };
}

// ── predicates ───────────────────────────────────────────────────────────────

/**
 * A CSR narrowed to something below the top of the PGR boundary hierarchy.
 *
 * Both halves are load-bearing. The hierarchy must match the one complaints use
 * (the local ADMIN carries a jurisdiction in hierarchy 'ADMIN' while complaints
 * run on MAPUTO_ADMIN, so it is not scoped for PGR at all), and the boundary
 * type must be deeper than the root level (an employee scoped to the whole
 * Município sees everything and would make the jurisdiction-filter spec vacuous).
 */
function isWardScopedCsr(p: ResolvedPersona, hrms: DiscoveredEmployee | undefined, profile: DeploymentProfile): boolean {
  if (!p.roles.includes('CSR')) return false;
  const rootLevel = profile.boundary.levels[0];
  return (hrms?.jurisdictions ?? []).some(
    (j) => j.hierarchy === profile.boundary.hierarchyType && j.boundaryType !== rootLevel,
  );
}

async function matches(key: PersonaKey, p: ResolvedPersona, profile: DeploymentProfile): Promise<boolean> {
  const hrms = (await employeesAtTenant()).find((e) => e.uuid === p.uuid);
  switch (key) {
    case 'employee':
      return p.roles.includes('EMPLOYEE') || p.roles.includes('SUPERUSER');
    case 'gro':
      return p.roles.includes('GRO');
    case 'gro-with-department':
      return p.roles.includes('GRO') && p.departments.length > 0;
    case 'lme':
      return p.roles.includes('PGR_LME');
    case 'ward-scoped-csr':
      return isWardScopedCsr(p, hrms, profile);
    case 'inbox-viewer': {
      // The PGR "assign" inbox lists PENDINGFORASSIGNMENT complaints inside the
      // employee's HRMS jurisdiction, so seeing a freshly-seeded complaint needs
      // GRO plus a jurisdiction that covers the seed locality. A jurisdiction at
      // the hierarchy ROOT covers the whole tree — the deployment-independent
      // way to guarantee the seeded complaint is visible regardless of which
      // leaf it lands on. getPersona('employee') only checks the role, which is
      // why it picked BOMET_LME on bomet: no HRMS record at all, so an empty
      // inbox (the [role=row] timeout).
      const rootCode = profile.boundary?.root?.code;
      const jurBoundaries = (hrms?.jurisdictions ?? []).map((j) => j.boundary);
      // Three things, because the inbox scopes on all three:
      //  - GRO: the assign-inbox is GRO's surface. A PGR_LME-only employee can
      //    log in but may not drive it.
      //  - a jurisdiction at the hierarchy ROOT: covers the whole boundary tree,
      //    so the seeded complaint is visible wherever it lands.
      //  - a department that actually OWNS a complaint type: the inbox filters
      //    by the viewer's department too, so a viewer whose department owns no
      //    service can never see a seeded complaint. This is the same
      //    co-selection the ASSIGN triple does — callers must then seed a
      //    serviceCode from serviceDepartmentsOf(persona).
      const serviceDepts = new Set((profile.complaintTypes?.services ?? []).map((s) => s.department));
      return (
        p.roles.includes('GRO') &&
        !!rootCode &&
        jurBoundaries.includes(rootCode) &&
        p.departments.some((d) => serviceDepts.has(d))
      );
    }
  }
}

function whyUnresolved(key: PersonaKey, tried: ResolvedPersona[]): string {
  const seen = tried.length
    // Jurisdictions are printed because two of the keys below are gated on them
    // — a reader told "needs a jurisdiction at the hierarchy root" cannot act on
    // that without seeing which jurisdictions the rejected candidates did hold.
    ? tried
        .map(
          (p) =>
            `${p.username}[roles=${p.roles.join('|') || 'none'} depts=${p.departments.join('|') || 'none'} ` +
            `jurisdictions=${p.jurisdictions.join('|') || 'none'}]`,
        )
        .join(', ')
    : 'nobody — no candidate credential logged in at all';
  const need: Record<PersonaKey, string> = {
    employee: 'the EMPLOYEE or SUPERUSER role',
    gro: 'the GRO role',
    'gro-with-department': 'the GRO role AND an HRMS department assignment',
    lme: 'the PGR_LME role',
    'ward-scoped-csr': 'the CSR role AND an HRMS jurisdiction below the hierarchy root',
    // Must state exactly what matches() checks, or the reader onboards the
    // wrong thing: it said "GRO (or PGR_LME)" when PGR_LME alone never
    // satisfies it, and omitted the department clause entirely.
    'inbox-viewer':
      'the GRO role AND an HRMS jurisdiction at the boundary-hierarchy root (so the seeded complaint is in scope wherever ' +
      "it lands) AND an HRMS department that owns at least one complaint type (the inbox filters on the viewer's " +
      'department too, so a department owning no service can never show a seeded complaint)',
  };
  return (
    `No persona '${key}' on ${TENANT}: needs ${need[key]}. Logged in and inspected: ${seen}. ` +
    'Point the matching env var (EMPLOYEE_USER / GRO_USER / WARD_CSR_USER / PERSONA_CANDIDATES) at a real ' +
    'persona, or seed one — this is a deployment/seed gap, not an app bug.'
  );
}

// ── public API ───────────────────────────────────────────────────────────────

const resolvedCache = new Map<PersonaKey, ResolvedPersona | null>();
const diagnostics = new Map<PersonaKey, string>();

export async function resolvePersona(key: PersonaKey, opts?: { profile?: DeploymentProfile }): Promise<ResolvedPersona | null> {
  if (resolvedCache.has(key)) return resolvedCache.get(key)!;
  const profile = opts?.profile ?? getProfile();

  const codes = (await employeesAtTenant()).map((e) => e.code).sort();
  const inspected: ResolvedPersona[] = [];
  let found: ResolvedPersona | null = null;

  // profile-setup already swept every candidate and recorded who satisfied this
  // key, so re-deriving it here means ONE login instead of the whole sweep.
  //
  // This matters far more than it looks. resolvedCache is per-process, and
  // Playwright starts a FRESH worker after every failing test — so without this
  // each failure throws the cache away and the next test re-tries every
  // candidate credential again. On a deployment with ~50 HRMS employees that is
  // ~50 auth calls per persona per test; the auth service starts refusing them,
  // which makes more tests fail, which spawns more workers. One real failure
  // snowballs into "no candidate credential logged in at all" everywhere. Seen
  // live on bomet: 23 failures became 46 that way.
  //
  // Passwords are deliberately absent from the profile, so match the recorded
  // username back to a candidate (which carries the credential) rather than
  // trusting the summary alone. If that one login fails — rotated password,
  // deactivated user — fall through to the full sweep below.
  const recorded = profile.personas?.resolved?.[key]?.username;
  if (recorded) {
    const candidate = candidateCredentials(codes).find((c) => c.username === recorded);
    if (candidate) {
      const principal = await login(candidate);
      if (principal) {
        const persona = await toResolved(candidate, principal);
        if (await matches(key, persona, profile)) {
          resolvedCache.set(key, persona);
          return persona;
        }
      }
    }
  }

  for (const candidate of candidateCredentials(codes)) {
    const principal = await login(candidate);
    if (!principal) continue;
    const persona = await toResolved(candidate, principal);
    inspected.push(persona);
    if (await matches(key, persona, profile)) {
      found = persona;
      break;
    }
  }

  if (!found) diagnostics.set(key, whyUnresolved(key, inspected));
  resolvedCache.set(key, found);
  return found;
}

export async function getPersona(key: PersonaKey, opts?: { profile?: DeploymentProfile }): Promise<ResolvedPersona> {
  const p = await resolvePersona(key, opts);
  if (!p) throw new Error(diagnostics.get(key) ?? whyUnresolved(key, []));
  return p;
}

/** Why `key` could not be resolved. Empty until resolvePersona has tried. */
export function personaDiagnostic(key: PersonaKey): string {
  return diagnostics.get(key) ?? '';
}

/**
 * The serviceCodes this persona's department(s) own, i.e. the complaints they can
 * actually SEE in their inbox.
 *
 * The PGR inbox scopes by the viewer's department as well as their jurisdiction,
 * so seeding an arbitrary serviceCode (e.g. the seed plan's, which is chosen for
 * ASSIGN-ability) can produce a complaint the viewer is structurally blind to.
 * That is exactly what happened on bomet: the inbox viewer's department is ENV
 * while the seed plan's RudeBehavior belongs to WATER_ENV, so the inbox showed
 * other rows but never the seeded ones. It passed on mz.maputo only because
 * EMP001 happens to hold the department that owns the seed's service.
 */
export function serviceCodesFor(p: ResolvedPersona, profile?: DeploymentProfile): string[] {
  const prof = profile ?? getProfile();
  return (prof.complaintTypes?.services ?? [])
    .filter((s) => p.departments.includes(s.department))
    .map((s) => s.serviceCode);
}

function redact(p: ResolvedPersona): PersonaSummary {
  // Passwords and tokens never reach disk — the profile is an artefact a run
  // uploads. `source` is enough to re-derive the credential at use time.
  return {
    username: p.username,
    tenant: p.tenant,
    uuid: p.uuid,
    roles: p.roles,
    departments: p.departments,
    jurisdictions: p.jurisdictions,
    source: p.source,
  };
}

/** Resolve every persona for the profile writer. Used by discoverProfile(). */
export async function resolvePersonasForProfile(profile: DeploymentProfile): Promise<{
  resolved: Record<string, PersonaSummary | null>;
  unresolvedDiagnostics: Record<string, string>;
}> {
  const resolved: Record<string, PersonaSummary | null> = {};
  const unresolvedDiagnostics: Record<string, string> = {};
  for (const key of PERSONA_KEYS) {
    const p = await resolvePersona(key, { profile });
    resolved[key] = p ? redact(p) : null;
    if (!p) unresolvedDiagnostics[key] = personaDiagnostic(key);
  }
  return { resolved, unresolvedDiagnostics };
}

// ── filing ───────────────────────────────────────────────────────────────────

/** The whole of what pgr-services needs to accept a CREATE. */
export interface FilingTarget {
  serviceCode: string;
  localityCode: string;
}

/** Services in a stable order, SERVICE_CODE first when it exists. */
function orderedServices(profile: DeploymentProfile): DeploymentProfile['complaintTypes']['services'] {
  const preferred = process.env.SERVICE_CODE?.trim();
  return [...profile.complaintTypes.services].sort((a, b) => {
    if (a.serviceCode === preferred) return -1;
    if (b.serviceCode === preferred) return 1;
    return a.serviceCode.localeCompare(b.serviceCode);
  });
}

function localityFor(profile: DeploymentProfile): string | { error: string } {
  const localityCode = profile.pgr.seedLocalityCode ?? profile.boundary.leafCode;
  if (!localityCode) {
    return { error: `No locality on ${TENANT}: boundary hierarchy ${profile.boundary.hierarchyType ?? '(none)'} yielded no leaf, so a complaint has nowhere to be filed.` };
  }
  return localityCode;
}

/**
 * What a CITIZEN needs in order to file — and nothing more.
 *
 * Deliberately weaker than resolveSeedPlan(). Filing is APPLY, which pgr-services
 * gates on a serviceCode and a locality; it neither knows nor cares whether an
 * employee exists who could later be ASSIGNed the result. Routing filing through
 * the full triple made every create- and REJECT-shaped test inherit ASSIGN's
 * prerequisites, so a deployment missing only an eligible assignee could not run
 * the tests that had nothing to do with assignment — the seed threw "Cannot seed
 * a complaint: No employee ... can be an assignee" and took a create test down
 * with a diagnosis about a feature it never touches.
 *
 * The seed plan is still CONSULTED, because when it does resolve its serviceCode
 * is strictly better: it is the one whose department an assignee actually holds,
 * so a complaint filed here can still be driven through ASSIGN by
 * driveToPendingAtLme(). We just no longer make it a preRequisite. When there is
 * no plan, any service in the catalogue can be filed against, and the first in
 * deterministic order is taken.
 */
export async function resolveFilingTarget(opts?: { profile?: DeploymentProfile }): Promise<FilingTarget | { error: string }> {
  const profile = opts?.profile ?? getProfile();
  const services = orderedServices(profile);
  if (!services.length) {
    return { error: `No complaint types on ${TENANT}: nothing can be filed at all. Seed RAINMAKER-PGR.ComplaintHierarchy or ServiceDefs.` };
  }

  const locality = localityFor(profile);
  if (typeof locality !== 'string') return locality;

  const plan = await resolveSeedPlan({ profile });
  if (!('error' in plan)) return { serviceCode: plan.serviceCode, localityCode: plan.localityCode };

  console.log(
    `[seed] no ASSIGN-viable seed plan on ${TENANT} (${plan.error.slice(0, 120)}) — filing against ` +
      `${services[0].serviceCode} anyway; a complaint can be created and rejected without an assignee.`,
  );
  return { serviceCode: services[0].serviceCode, localityCode: locality };
}

// ── the triple ───────────────────────────────────────────────────────────────

/**
 * Pick a (serviceCode, actor, assignee) triple that ASSIGN will actually accept.
 *
 * Deterministic by construction — a run that picked a different service each
 * time would turn a real seed regression into flake. SERVICE_CODE wins when it
 * is compatible; otherwise services are walked in sorted order and the first one
 * with a viable assignee is taken.
 */
export async function resolveSeedPlan(opts?: { profile?: DeploymentProfile }): Promise<SeedPlan | { error: string }> {
  const profile = opts?.profile ?? getProfile();
  const services = orderedServices(profile);
  if (!services.length) {
    return { error: `No complaint types on ${TENANT}: nothing can be filed, so no ASSIGN is testable. Seed RAINMAKER-PGR.ComplaintHierarchy or ServiceDefs.` };
  }

  const assign = profile.workflow.pgr.assign;
  if (!assign) {
    return {
      error:
        `PGR workflow on ${TENANT} defines no ASSIGN transition (actions: ${profile.workflow.pgr.actions.join(', ') || 'none'}), ` +
        'so an assignee cannot be validated. Check the businessService seed.',
    };
  }

  // The assignee must hold a role able to act on the state ASSIGN lands in —
  // egov-workflow-v2 answers INVALID_ASSIGNEE otherwise. Union of the next
  // state's action roles minus CITIZEN, which no employee carries meaningfully.
  const assigneeRoles = assign.assigneeRoles.filter((r) => r !== 'CITIZEN');
  const employees = (await employeesAtTenant()).slice().sort((a, b) => a.code.localeCompare(b.code));
  const eligible = employees.filter(
    (e) => e.departments.length > 0 && e.roles.some((r) => assigneeRoles.includes(r)),
  );
  if (!eligible.length) {
    // An empty employee list has two very different causes, and saying "no
    // employee can be an assignee" for the second one sends the reader off to
    // onboard data that already exists.
    if (!employees.length && adminTokenError) {
      return {
        error:
          `Could not read HRMS at ${TENANT}: the admin login failed (${adminTokenError}), so the employee list came back ` +
          'empty. This is an auth/availability failure, NOT a seed gap — the deployment may well have a valid assignee. ' +
          'Check that the service is up and DIGIT_USERNAME/DIGIT_PASSWORD are right, then re-run.',
      };
    }
    return {
      error:
        `No employee at ${TENANT} can be an assignee: ASSIGN lands in ${assign.nextState}, which needs one of ` +
        `[${assigneeRoles.join(', ')}] plus an HRMS department. Employees present: ` +
        `${employees.map((e) => `${e.code}[roles=${e.roles.join('|')} depts=${e.departments.join('|') || 'none'}]`).join(', ') || 'none'}. ` +
        'Note HRMS has no parent-tenant fallback — an employee at a sub-tenant cannot serve this one.',
    };
  }

  let picked: { service: (typeof services)[number]; assignee: DiscoveredEmployee } | null = null;
  for (const service of services) {
    const assignee = eligible.find((e) => e.departments.includes(service.department));
    if (assignee) {
      picked = { service, assignee };
      break;
    }
  }
  if (!picked) {
    return {
      error:
        `No (serviceCode, assignee) pair lines up on ${TENANT}. pgr-services validates the ASSIGNEE's HRMS ` +
        'departments against the complaint type\'s department, and none of the eligible assignees holds one of ' +
        `the catalogue's departments. Complaint types: ${services.map((s) => `${s.serviceCode}->${s.department || 'no-dept'}`).join(', ')}. ` +
        `Eligible assignees: ${eligible.map((e) => `${e.code}->${e.departments.join('|')}`).join(', ')}. ` +
        'Give an employee with an assignee-capable role one of the catalogue departments in HRMS.',
    };
  }
  const preferred = process.env.SERVICE_CODE?.trim();
  if (preferred && picked.service.serviceCode !== preferred) {
    console.log(`[seed] SERVICE_CODE=${preferred} has no employee holding its department — using ${picked.service.serviceCode} instead`);
  }

  // Prefer an actor that also carries a department. The plan only requires GRO
  // of the actor, but lifecycle.setup has hit DEPARTMENT_NOT_FOUND on
  // department-less actors, and preferring one costs nothing.
  const actor = (await resolvePersona('gro-with-department', { profile })) ?? (await resolvePersona('gro', { profile }));
  if (!actor) {
    return { error: personaDiagnostic('gro-with-department') || whyUnresolved('gro', []) };
  }

  const localityCode = localityFor(profile);
  if (typeof localityCode !== 'string') return localityCode;

  return {
    actor,
    assigneeUuid: picked.assignee.uuid,
    assigneeCode: picked.assignee.code,
    serviceCode: picked.service.serviceCode,
    localityCode,
  };
}
