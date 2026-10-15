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
 * holds no role able to act on the NEXT state. An assignee is only ever a uuid
 * on the wire, so it is discovered from HRMS with no password. Only the ACTOR
 * needs credentials.
 *
 * Credentials come from the env profile alone: each persona is a Keycloak
 * login (<ROLE>_LOGIN) and password (<ROLE>_PASSWORD) linked to a DIGIT
 * employee at TENANT (scripts/seed-personas.ts makes them). Nothing is guessed:
 * Keycloak has brute-force protection, and an unset persona is simply not a
 * candidate. Each key below is checked against what the signed-in employee
 * really holds (roles, HRMS departments and jurisdictions), so a persona
 * pointed at the wrong person is reported, not trusted.
 */
import { getDigitToken } from './auth';
import { TENANT, PERSONA_ENV, personaLogin, type PersonaLogin, type PersonaRole } from './env';
import { KeycloakSignInError } from './identity-bff';
import { fetchEmployees, type DiscoveredEmployee } from './probes';
import { getProfile, type DeploymentProfile, type PersonaSummary } from './profile';

export type PersonaKey = 'employee' | 'gro' | 'gro-with-department' | 'lme' | 'ward-scoped-csr' | 'inbox-viewer';

export const PERSONA_KEYS: PersonaKey[] = ['employee', 'gro', 'gro-with-department', 'lme', 'ward-scoped-csr', 'inbox-viewer'];

export interface ResolvedPersona {
  /** Keycloak login: what loginEmployeeBrowser/getPrincipal sign in with. */
  username: string;
  password: string;
  /** The linked DIGIT user's userName (the HRMS code for HRMS-created staff). */
  digitUsername: string;
  tenant: string;
  uuid: string;
  roles: string[];
  departments: string[];
  jurisdictions: string[];
  token: string;
  userInfo: Record<string, unknown>;
  /** e.g. 'env:GRO_LOGIN'. */
  source: string;
}

export interface SeedPlan {
  actor: ResolvedPersona;
  assigneeUuid: string;
  assigneeCode: string;
  serviceCode: string;
  localityCode: string;
}

/** The configured persona each key tries first; every other configured persona follows. */
const PREFERRED: Record<PersonaKey, PersonaRole> = {
  employee: 'supervisor',
  gro: 'gro',
  'gro-with-department': 'gro',
  lme: 'lme',
  'ward-scoped-csr': 'wardCsr',
  'inbox-viewer': 'inboxViewer',
};

/** The configured persona logins, `key`'s own first. */
export function candidateCredentials(key?: PersonaKey): PersonaLogin[] {
  const roles = Object.keys(PERSONA_ENV) as PersonaRole[];
  const ordered = key ? [PREFERRED[key], ...roles.filter((r) => r !== PREFERRED[key])] : roles;
  return ordered.map(personaLogin).filter((p): p is PersonaLogin => p !== null);
}

// ── login + HRMS join ────────────────────────────────────────────────────────

interface Principal {
  token: string;
  userInfo: Record<string, any>;
  roles: string[];
}

/** Per worker. A refused login is remembered too: it is never retried. */
const loginCache = new Map<string, Principal | null>();
let employeeCache: DiscoveredEmployee[] | null = null;
/** Why the admin token is unavailable, when it is — kept so callers can tell a
 *  broken login apart from a deployment that genuinely has no employees. */
let adminTokenError: string | null = null;

async function adminToken(): Promise<string> {
  if (adminTokenError !== null) return '';
  const admin = personaLogin('admin');
  if (!admin) {
    adminTokenError = 'ADMIN_LOGIN/ADMIN_PASSWORD are not set';
    return '';
  }
  // Retried only for availability: a deployment that has just come up answers
  // the first call with a 5xx, or Keycloak times a sign-in out
  // (KeycloakSessionExpiredError). A refused password is never retried.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const token = (await getDigitToken({ tenant: TENANT, username: admin.login, password: admin.password })).access_token;
      adminTokenError = null; // an earlier attempt's 5xx no longer applies
      return token;
    } catch (err: any) {
      adminTokenError = `${admin.source}@${TENANT}: ${err?.message?.slice(0, 160) ?? err}`;
      if (err instanceof KeycloakSignInError) break;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2_000));
    }
  }
  console.log(`[personas] admin token unavailable — ${adminTokenError}`);
  return '';
}

/**
 * Employees at TENANT. Unfiltered because the codes=/names= filters are not
 * tenant-scoped at all — see probes.ts fetchEmployees.
 */
async function employeesAtTenant(): Promise<DiscoveredEmployee[]> {
  if (employeeCache) return employeeCache;
  const token = await adminToken();
  employeeCache = token ? await fetchEmployees(TENANT, token) : [];
  return employeeCache;
}

async function login(c: PersonaLogin): Promise<Principal | null> {
  if (loginCache.has(c.login)) return loginCache.get(c.login)!;
  let result: Principal | null = null;
  let why = '';
  try {
    const resp = await getDigitToken({ tenant: TENANT, username: c.login, password: c.password });
    const userInfo = (resp.UserRequest || {}) as Record<string, any>;
    result = { token: resp.access_token, userInfo, roles: ((userInfo.roles || []) as any[]).map((r) => String(r.code)) };
  } catch (err: any) {
    why = `: ${err?.message?.slice(0, 200) ?? err}`;
  }
  // Every attempt is logged, so a lockout can be traced to this suite.
  console.log(`[personas] login ${c.role} (${c.source}) -> ${result ? `ok @ ${TENANT}` : `no${why}`}`);
  loginCache.set(c.login, result);
  return result;
}

async function toResolved(c: PersonaLogin, p: Principal): Promise<ResolvedPersona> {
  const uuid = String(p.userInfo.uuid ?? '');
  const hrms = (await employeesAtTenant()).find((e) => e.uuid === uuid);
  return {
    username: c.login,
    password: c.password,
    digitUsername: String(p.userInfo.userName ?? ''),
    tenant: TENANT,
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
      // GRO plus a jurisdiction that covers the seed locality — see the
      // exact-match note below. getPersona('employee') only checks the role,
      // which is why it picked BOMET_LME on bomet: no HRMS record at all, so an
      // empty inbox (the [role=row] timeout).
      const seedWard = profile.pgr?.seedLocalityCode;
      const jurBoundaries = (hrms?.jurisdictions ?? []).map((j) => j.boundary);
      // Three things, because the inbox scopes on all three:
      //  - GRO: the assign-inbox is GRO's surface. A PGR_LME-only employee can
      //    log in but may not drive it.
      //  - jurisdiction that COVERS THE SEED LOCALITY. PGR's jurisdiction axis
      //    is EXACT-match on the complaint's locality code (PGRQueryBuilder:
      //    ads.locality IN (jurisdictionCodes)) — there is NO subtree
      //    expansion, so the old "a jurisdiction at the hierarchy root covers
      //    the whole tree" assumption silently selects a viewer who can see
      //    nothing. Visibility needs the seed ward itself in the viewer's
      //    jurisdiction list, or SUPERVISOR (the one role the authored ABAC
      //    policy maps to jurisdiction=ALL).
      //  - a department that actually OWNS a complaint type: the inbox filters
      //    by the viewer's department too, so a viewer whose department owns no
      //    service can never see a seeded complaint. This is the same
      //    co-selection the ASSIGN triple does — callers must then seed a
      //    serviceCode from serviceDepartmentsOf(persona).
      const serviceDepts = new Set((profile.complaintTypes?.services ?? []).map((s) => s.department));
      const seesSeedLocality =
        p.roles.includes('SUPERVISOR') || (!!seedWard && jurBoundaries.includes(seedWard));
      return (
        p.roles.includes('GRO') &&
        seesSeedLocality &&
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
            `${p.source}=${p.digitUsername}[roles=${p.roles.join('|') || 'none'} depts=${p.departments.join('|') || 'none'} ` +
            `jurisdictions=${p.jurisdictions.join('|') || 'none'}]`,
        )
        .join(', ')
    : 'nobody — no configured persona signed in at all';
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
      'the GRO role AND jurisdiction covering the seed locality — the seed WARD itself in the HRMS jurisdiction list, or ' +
      'the SUPERVISOR role (jurisdiction=ALL); PGR matches jurisdiction EXACTLY against the complaint locality, a root-level ' +
      "jurisdiction covers nothing — AND an HRMS department that owns at least one complaint type (the inbox filters on the " +
      "viewer's department too, so a department owning no service can never show a seeded complaint)",
  };
  const prefix = PERSONA_ENV[PREFERRED[key]];
  return (
    `No persona '${key}' on ${TENANT}: needs ${need[key]}. Signed in and inspected: ${seen}. ` +
    `Set ${prefix}_LOGIN (env profile) and ${prefix}_PASSWORD (secrets file) to a linked employee who has it — ` +
    'scripts/seed-personas.ts creates one. This is a deployment/seed gap, not an app bug.'
  );
}

// ── public API ───────────────────────────────────────────────────────────────

const resolvedCache = new Map<PersonaKey, ResolvedPersona | null>();
const diagnostics = new Map<PersonaKey, string>();

export async function resolvePersona(key: PersonaKey, opts?: { profile?: DeploymentProfile }): Promise<ResolvedPersona | null> {
  if (resolvedCache.has(key)) return resolvedCache.get(key)!;
  const profile = opts?.profile ?? getProfile();

  // profile-setup recorded which persona satisfied this key: try it first.
  // Logins are cached per worker, but Playwright starts a fresh worker after
  // every failing test, so the order still saves sign-ins.
  const recorded = profile.personas?.resolved?.[key]?.source;
  const candidates = candidateCredentials(key).sort((a, b) => Number(b.source === recorded) - Number(a.source === recorded));
  const inspected: ResolvedPersona[] = [];
  let found: ResolvedPersona | null = null;
  for (const candidate of candidates) {
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
  // Passwords, tokens and logins never reach disk. `source` is enough to
  // re-derive the credential at use time.
  return {
    username: p.digitUsername,
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
    const tokenErr = adminTokenError;
    if (!employees.length && tokenErr) {
      return {
        error:
          `Could not read HRMS at ${TENANT}: the admin login failed (${tokenErr}), so the employee list came back ` +
          'empty. This is an auth/availability failure, NOT a seed gap — the deployment may well have a valid assignee. ' +
          'Check that the service is up and ADMIN_LOGIN/ADMIN_PASSWORD are right, then re-run.',
      };
    }
    return {
      error:
        `No employee at ${TENANT} can be an assignee: ASSIGN lands in ${assign.nextState}, which needs one of ` +
        `[${assigneeRoles.join(', ')}] plus an HRMS department. Employees present: ` +
        `${employees.map((e) => `${e.code}[roles=${e.roles.join('|')} depts=${e.departments.join('|') || 'none'}]`).join(', ') || 'none'}.`,
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
