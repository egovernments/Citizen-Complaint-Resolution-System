/**
 * seed-personas.ts — give a workspace the suite's six staff personas, each a
 * DIGIT employee at the workspace's root tenant linked to a Keycloak login with
 * a known password. Idempotent: a re-run finds what exists, repairs what does
 * not, and re-verifies every sign-in.
 *
 *   admin         EMPLOYEE + the founder's admin roles, incl. ACCOUNT_ADMIN, plus
 *                 the PGR bundle (CSR, GRO, PGR_LME, SUPERVISOR) the admin-surface
 *                 specs file, assign and resolve complaints with
 *   gro           GRO in a department that owns a complaint type
 *   lme           PGR_LME in that department (the ASSIGN target)
 *   wardCsr       CSR scoped to the ward that holds the seed locality
 *   inboxViewer   GRO + PGR_LME in that department
 *   supervisor    GRO + PGR_LME + SUPERVISOR (the suite's EMPLOYEE_USER)
 *
 * The PGR personas' jurisdiction is the seed locality itself: PGR matches
 * jurisdictions EXACTLY against a complaint's locality (see personas.ts).
 *
 * Only public contracts: HRMS `_search`/`_create` as an ACCOUNT_ADMIN; the
 * Keycloak admin API, to create the login with a verified email and a known
 * password; the BFF's `workspace-members/_link`, which for an existing
 * verified login records a pending invitation and sends no mail; and the
 * persona's own `workspace-invitations/_accept`.
 *
 * Usage, where Keycloak's admin API is reachable:
 *   cd tests/integration-tests
 *   set -a; source deploy/<env>.env; [ -f "$SECRETS" ] && source "$SECRETS"; set +a
 *   SEED_ACTOR_LOGIN=… SEED_ACTOR_PASSWORD=… \
 *   IDENTITY_TEST_KEYCLOAK_ADMIN_URL=<keycloak base, …/auth> \
 *   IDENTITY_TEST_KEYCLOAK_ADMIN_USER=… IDENTITY_TEST_KEYCLOAK_ADMIN_PASSWORD=… \
 *     npx tsx scripts/seed-personas.ts --secrets-out "$SECRETS"
 *
 * Reads BASE_URL, DIGIT_TENANT, IDENTITY_TEST_TENANT_SLUG and the six
 * <ROLE>_LOGIN from the env profile. A <ROLE>_PASSWORD already set is kept;
 * a missing one is generated. With --secrets-out every persona password is
 * written to that file (mode 0600, other lines kept). Passwords never reach
 * stdout. The actor (SEED_ACTOR_*) is any ACCOUNT_ADMIN of the workspace: the
 * signup founder the first time (without SEED_ACTOR_PASSWORD, a founder with
 * no password credential — magic-link only — gets a one-off one through the
 * Keycloak admin API; one with a password is never reset), the seeded admin
 * (the default) after that.
 * stdout: the env-profile lines to add, then one verified line per persona.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { BASE_URL, IGNORE_HTTPS_ERRORS, KC_REALM, PERSONA_ENV, TENANT, type PersonaRole } from '../tests/utils/env';
import { identityJson, resolveTenant, selectContext, tenantSlug } from '../tests/utils/identity-bff';
import { keycloakAdminFresh } from '../tests/utils/keycloak-admin';
import { deriveMobileLengths, derivedStartingDigits, generateValidMobile, type MobileRule } from '../tests/utils/mdms-mobile';
import { fetchBoundaryTree, fetchGlobalConfigs, type BoundaryNode } from '../tests/utils/probes';
import { Digit, employeeSignIn, ok } from '../tests/utils/workspace-setup';

const ADMIN_ROLES = ['EMPLOYEE', 'SUPERUSER', 'ACCOUNT_ADMIN', 'MDMS_ADMIN', 'LOC_ADMIN', 'HRMS_ADMIN', 'WORKFLOW_ADMIN',
  'CSR', 'GRO', 'PGR_LME', 'SUPERVISOR'];
interface Spec { role: PersonaRole; roles: string[]; scope: 'root' | 'leaf' | 'ward' }
/** Admin last: when it is also the actor, re-setting its password ends the actor's session. */
const SPECS: Spec[] = [
  { role: 'gro', roles: ['EMPLOYEE', 'GRO'], scope: 'leaf' },
  { role: 'lme', roles: ['EMPLOYEE', 'PGR_LME'], scope: 'leaf' },
  { role: 'wardCsr', roles: ['EMPLOYEE', 'CSR'], scope: 'ward' },
  // PGR_LME too: inbox specs assign their seed complaint to the viewer, which needs a PGR_LME holder.
  { role: 'inboxViewer', roles: ['EMPLOYEE', 'GRO', 'PGR_LME'], scope: 'leaf' },
  { role: 'supervisor', roles: ['EMPLOYEE', 'GRO', 'PGR_LME', 'SUPERVISOR'], scope: 'leaf' },
  { role: 'admin', roles: ADMIN_ROLES, scope: 'root' },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (why: string): never => { throw new Error(why); };
const envName = (role: PersonaRole, suffix: 'LOGIN' | 'PASSWORD') => `${PERSONA_ENV[role]}_${suffix}`;
/** SEED_CODE_PREFIX seeds a fresh set (new codes) next to an old one, e.g. after a role change. */
const codeOf = (role: PersonaRole) => `${process.env.SEED_CODE_PREFIX || 'IT'}_${PERSONA_ENV[role]}`;
const newPassword = () => `It-${randomBytes(12).toString('base64url')}-9a`;
const active = (r: { isActive?: boolean; data?: { active?: boolean } }) => r.isActive !== false && r.data?.active !== false;

interface Plan {
  roleNames: Map<string, string>;
  department: string;
  designation: string;
  serviceCode: string;
  hierarchy: string;
  boundaries: Record<Spec['scope'], BoundaryNode>;
  mobile: MobileRule;
}

/** Everything HRMS validates an employee against, read from the workspace itself. */
async function planFor(digit: Digit): Promise<Plan> {
  const roleNames = new Map((await digit.mdms('ACCESSCONTROL-ROLES.roles')).map((r) => [String(r.data.code), String(r.data.name)]));
  const missingRoles = [...new Set(SPECS.flatMap((s) => s.roles))].filter((r) => !roleNames.has(r));
  if (missingRoles.length) fail(`Roles missing from ACCESSCONTROL-ROLES.roles at ${TENANT}: ${missingRoles.join(', ')}`);

  const departments = new Set((await digit.mdms('common-masters.Department')).filter(active).map((r) => String(r.data.code)));
  const designation = (await digit.mdms('common-masters.Designation')).find(active)?.data.code;
  // A complaint type whose department exists: the GRO/LME/viewer serve it.
  const types = [...(await digit.mdms('RAINMAKER-PGR.ComplaintHierarchy')), ...(await digit.mdms('RAINMAKER-PGR.ServiceDefs'))]
    .filter(active)
    .map((r) => ({ serviceCode: String(r.data.serviceCode ?? r.data.code ?? ''), department: String(r.data.department ?? r.data.departments?.[0] ?? '') }))
    .filter((t) => t.serviceCode && departments.has(t.department))
    .sort((a, b) => Number(b.serviceCode === process.env.SERVICE_CODE) - Number(a.serviceCode === process.env.SERVICE_CODE) || a.serviceCode.localeCompare(b.serviceCode));
  if (!types.length || !designation) fail(`${TENANT} needs a complaint type with a live department and a designation: finish the workspace's onboarding steps first`);

  // The hierarchy the SPA (and profile-setup) reads, so both agree on the seed locality.
  const hierarchy = (await fetchGlobalConfigs(BASE_URL)).hierarchyType ?? fail('globalConfigs names no boundary hierarchyType');
  const root = await fetchBoundaryTree(TENANT, hierarchy, { authToken: digit.context.access_token, baseUrl: BASE_URL })
    ?? fail(`No ${hierarchy} boundary tree at ${TENANT}`);
  // The seed locality: LOCALITY_CODE when it exists, else the first leaf — profile-setup's rule.
  const pathTo = (n: BoundaryNode, code: string): BoundaryNode[] | null => {
    if (n.code === code) return [n];
    for (const child of n.children ?? []) {
      const below = pathTo(child, code);
      if (below) return [n, ...below];
    }
    return null;
  };
  const firstBranch: BoundaryNode[] = [];
  for (let n: BoundaryNode | undefined = root; n; n = n.children?.[0]) firstBranch.push(n);
  const branch = (process.env.LOCALITY_CODE && pathTo(root, process.env.LOCALITY_CODE)) || firstBranch;
  if (branch.length < 2) fail(`The ${hierarchy} tree at ${TENANT} has one level: nothing to scope a ward CSR to`);
  // A ward is the level above the leaf, never the root (a root-scoped CSR sees everything).
  const ward = branch[Math.max(1, branch.length - 2)];

  const rule = (await digit.mdms('common-masters.MobileNumberValidation')).map((r) => r.data).find((d) => d?.default === true)
    ?? fail(`No default common-masters.MobileNumberValidation at ${TENANT}`);
  const lengths = deriveMobileLengths(rule.mobileNumberRegex);
  return {
    roleNames, department: types[0].department, designation, serviceCode: types[0].serviceCode, hierarchy,
    boundaries: { root, leaf: branch[branch.length - 1], ward },
    mobile: { prefix: rule.countryCode, pattern: rule.mobileNumberRegex, minLength: lengths.min, maxLength: lengths.max,
      errorMessage: '', allowedStartingDigits: derivedStartingDigits(rule.mobileNumberRegex) ?? undefined },
  };
}

/** The persona's HRMS employee: created when missing, given any role it lacks when it exists. */
async function ensureEmployee(digit: Digit, plan: Plan, spec: Spec, login: string): Promise<{ code: string; uuid: string }> {
  const code = codeOf(spec.role);
  const found = ((await digit.post(`/egov-hrms/employees/_search?tenantId=${TENANT}&codes=${code}`, {}, digit.ri({ action: '_search' }))).Employees ?? [])
    .find((e: { code?: string; tenantId?: string }) => e.code === code && e.tenantId === TENANT);
  if (found) {
    const held = new Set((found.user?.roles ?? []).map((r: { code: string }) => r.code));
    const lacking = spec.roles.filter((r) => !held.has(r));
    if (lacking.length) {
      // DIGIT keeps serving a live token with the old roles (see the WARN below); to use the
      // new roles at once, seed a fresh set with SEED_CODE_PREFIX and new <ROLE>_LOGINs.
      const roles = [...found.user.roles, ...lacking.map((r) => ({ code: r, name: plan.roleNames.get(r) ?? r, tenantId: TENANT }))];
      await digit.post('/egov-hrms/employees/_update', { Employees: [{ ...found, user: { ...found.user, roles } }] }, digit.ri({ action: '_update' }));
      console.error(`[seed-personas] ${code}: added ${lacking.join(', ')}`);
    }
    return { code, uuid: found.user?.uuid ?? found.uuid };
  }
  const boundary = plan.boundaries[spec.scope];
  const employee = {
    code, tenantId: TENANT, employeeStatus: 'EMPLOYED', employeeType: 'PERMANENT',
    user: { userName: code, name: `IT ${PERSONA_ENV[spec.role].replace(/_/g, ' ')}`, mobileNumber: generateValidMobile(plan.mobile),
      emailId: login, type: 'EMPLOYEE', active: true, tenantId: TENANT,
      roles: spec.roles.map((r) => ({ code: r, name: plan.roleNames.get(r) ?? r, tenantId: TENANT })) },
    jurisdictions: [{ boundary: boundary.code, boundaryType: boundary.boundaryType, hierarchy: plan.hierarchy,
      hierarchyType: plan.hierarchy, tenantId: TENANT, isActive: true }],
    assignments: [{ designation: plan.designation, department: plan.department, fromDate: Date.now(), isCurrentAssignment: true }],
  };
  const created = (await digit.post('/egov-hrms/employees/_create', { Employees: [employee] }, digit.ri({ action: '_create' }))).Employees[0];
  return { code, uuid: created.user?.uuid ?? created.uuid ?? fail(`HRMS created ${code} without a user uuid`) };
}

async function kc(path: string, init: RequestInit = {}, expect = [200, 201, 204]): Promise<Response> {
  const { base, token } = await keycloakAdminFresh();
  const r = await fetch(`${base}/admin/realms/${KC_REALM}${path}`, { ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (!expect.includes(r.status)) fail(`Keycloak admin ${init.method ?? 'GET'} ${path.split('?')[0]} -> HTTP ${r.status}`);
  return r;
}

async function findUser(login: string): Promise<Record<string, any> | undefined> {
  return ((await (await kc(`/users?${new URLSearchParams({ email: login, exact: 'true' })}`)).json()) as Array<Record<string, any>>)
    .find((u) => String(u.email).toLowerCase() === login);
}

/**
 * A password for an actor given without one. Only a login with NO password
 * credential (a magic-link founder) gets a one-off password, which is never
 * printed or kept; one that has a password is never touched — it may be a
 * real person's — and SEED_ACTOR_PASSWORD must be supplied instead.
 */
export async function ensureActorPassword(login: string): Promise<string> {
  const user = (await findUser(login)) ?? fail(`No Keycloak user ${login} for SEED_ACTOR_LOGIN`);
  const credentials = (await (await kc(`/users/${user.id}/credentials`)).json()) as Array<{ type?: string }>;
  if (credentials.some((c) => c.type === 'password')) {
    fail(`SEED_ACTOR_LOGIN ${login} already has a password: set SEED_ACTOR_PASSWORD; the script never resets an existing one`);
  }
  const password = newPassword();
  await kc(`/users/${user.id}/reset-password`, { method: 'PUT', body: JSON.stringify({ type: 'password', value: password, temporary: false }) });
  return password;
}

/**
 * The Keycloak login: verified email, no pending actions, not locked. A new
 * login gets `password`; an existing one only when `reset` (a password this run
 * generated): re-setting a known one would trip password-history policies and
 * end the sessions of an actor seeding itself. The final sign-in proves it.
 */
async function ensureLogin(login: string, password: string, reset: boolean): Promise<void> {
  let user = await findUser(login);
  if (!user) {
    await kc('/users', { method: 'POST', body: JSON.stringify({ username: login, email: login, enabled: true, emailVerified: true,
      firstName: 'IT', lastName: login.split('@')[0], requiredActions: [] }) }, [201]);
    user = (await findUser(login)) ?? fail(`Keycloak did not return the new user ${login}`);
    reset = true;
  } else if (user.emailVerified !== true || user.requiredActions?.length || user.enabled === false) {
    // The full representation goes back, so the BFF's own attributes survive.
    const full = await (await kc(`/users/${user.id}`)).json();
    await kc(`/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ ...full, enabled: true, emailVerified: true, requiredActions: [] }) });
  }
  if (reset) await kc(`/users/${user.id}/reset-password`, { method: 'PUT', body: JSON.stringify({ type: 'password', value: password, temporary: false }) });
  await kc(`/attack-detection/brute-force/users/${user.id}`, { method: 'DELETE' }, [200, 204, 404]);
}

interface Member { digitUuid: string; state: string; invitationVersion: number }

/** Linked = an ACTIVE binding at TENANT. Pending invitations are accepted as the persona. */
async function ensureLinked(actor: APIRequestContext, members: Member[], uuid: string, login: string, password: string): Promise<void> {
  const origin = { Origin: new URL(BASE_URL).origin };
  let member = members.find((m) => m.digitUuid === uuid);
  if (member?.state === 'active') return;
  if (!member) {
    const linked = await actor.post(`${BASE_URL}/identity/v1/workspace-members/_link`, { headers: origin, data: { tenantId: TENANT, digitUuid: uuid, email: login } });
    member = { digitUuid: uuid, ...(await ok<{ binding: Omit<Member, 'digitUuid'> }>(linked, [200, 201])).binding };
    if (member.state === 'active') return;
  }
  await sleep(2_000); // a same-second sign-in after a credential change is revoked (#2284)
  const persona = await playwrightRequest.newContext({ ignoreHTTPSErrors: IGNORE_HTTPS_ERRORS });
  try {
    await employeeSignIn(persona, BASE_URL, tenantSlug(), login, password, 'configurator');
    await ok(await persona.post(`${BASE_URL}/identity/v1/workspace-invitations/_accept?surface=configurator`,
      { headers: origin, data: { tenantId: TENANT, invitationVersion: member.invitationVersion } }));
  } finally {
    await persona.dispose();
  }
}

/** Keep every line but the persona passwords, then write them; 0600 either way. */
function writeSecrets(file: string, passwords: Map<PersonaRole, string>): void {
  const keys = new Set([...passwords.keys()].map((role) => envName(role, 'PASSWORD')));
  const kept = existsSync(file)
    ? readFileSync(file, 'utf8').split('\n').filter((l) => l && !keys.has(l.replace(/^export\s+/, '').split('=')[0]))
    : [];
  writeFileSync(file, [...kept, ...[...passwords].map(([role, value]) => `${envName(role, 'PASSWORD')}=${value}`), ''].join('\n'), { mode: 0o600 });
  chmodSync(file, 0o600);
}

async function main(): Promise<void> {
  const out = process.argv.indexOf('--secrets-out');
  const secretsOut = out >= 0 ? process.argv[out + 1] ?? fail('--secrets-out needs a file') : '';
  const actorLogin = process.env.SEED_ACTOR_LOGIN || process.env.ADMIN_LOGIN || '';
  let actorPassword = process.env.SEED_ACTOR_PASSWORD || (process.env.SEED_ACTOR_LOGIN ? '' : process.env.ADMIN_PASSWORD) || '';
  const missing = ['BASE_URL', 'DIGIT_TENANT', 'IDENTITY_TEST_TENANT_SLUG', ...SPECS.map((s) => envName(s.role, 'LOGIN'))]
    .filter((k) => !process.env[k]?.trim());
  if (!actorLogin) missing.push('SEED_ACTOR_LOGIN (an ACCOUNT_ADMIN of the workspace)');
  if (missing.length) fail(`Not set: ${missing.join(', ')}. Source deploy/<env>.env first.`);

  const passwords = new Map<PersonaRole, string>(SPECS.map((s) => [s.role, process.env[envName(s.role, 'PASSWORD')] || newPassword()]));
  const generated = SPECS.filter((s) => !process.env[envName(s.role, 'PASSWORD')]).map((s) => envName(s.role, 'PASSWORD'));
  if (generated.length && !secretsOut) fail(`${generated.join(', ')} not set: pass --secrets-out <file> to generate and keep them`);

  if (!actorPassword) {
    actorPassword = await ensureActorPassword(actorLogin.toLowerCase());
    await sleep(2_000); // a same-second sign-in after a credential change is revoked (#2284)
  }
  const actor = await playwrightRequest.newContext({ ignoreHTTPSErrors: IGNORE_HTTPS_ERRORS });
  try {
    const route = await resolveTenant(actor, BASE_URL);
    if (route.tenantId !== TENANT) fail(`Slug ${tenantSlug()} resolves to ${route.tenantId}, not DIGIT_TENANT=${TENANT}`);
    await employeeSignIn(actor, BASE_URL, tenantSlug(), actorLogin, actorPassword, 'configurator');
    const digit = new Digit(actor, BASE_URL, await selectContext(actor, BASE_URL, 'configurator', TENANT), TENANT);
    const plan = await planFor(digit);
    // Before Keycloak holds any new password, so a failure later cannot lose one.
    if (secretsOut) {
      writeSecrets(secretsOut, passwords);
      console.error(`[seed-personas] wrote ${passwords.size} persona passwords to ${secretsOut} (mode 0600)`);
    }
    console.log(`# env profile lines for ${tenantSlug()} (${TENANT})`);
    console.log(`SERVICE_CODE=${plan.serviceCode}\nLOCALITY_CODE=${plan.boundaries.leaf.code}\nWARD_CSR_BOUNDARY=${plan.boundaries.ward.code}`);

    // Read once, up front: the actor's own session may end when its login is re-set.
    const { members } = await identityJson<{ members: Member[] }>(
      await actor.get(`${BASE_URL}/identity/v1/workspace-members?tenantId=${TENANT}&first=0&max=500`));
    const seeded: Array<{ spec: Spec; login: string; code: string; uuid: string }> = [];
    for (const spec of SPECS) {
      const login = process.env[envName(spec.role, 'LOGIN')]!.trim().toLowerCase();
      const password = passwords.get(spec.role)!;
      const { code, uuid } = await ensureEmployee(digit, plan, spec, login);
      await ensureLogin(login, password, generated.includes(envName(spec.role, 'PASSWORD')));
      await ensureLinked(actor, members, uuid, login, password);
      seeded.push({ spec, login, code, uuid });
    }

    // Proof, not assumption: each persona signs in and selects its own employee.
    await sleep(2_000);
    for (const { spec, login, code, uuid } of seeded) {
      const persona = await playwrightRequest.newContext({ ignoreHTTPSErrors: IGNORE_HTTPS_ERRORS });
      try {
        await employeeSignIn(persona, BASE_URL, tenantSlug(), login, passwords.get(spec.role)!, 'configurator');
        const context = await selectContext(persona, BASE_URL, 'configurator', TENANT);
        if (context.UserRequest.uuid !== uuid) fail(`${envName(spec.role, 'LOGIN')} selects ${context.UserRequest.uuid}, not ${code} (${uuid})`);
        const held = new Set(((context.UserRequest.roles ?? []) as Array<{ code: string }>).map((r) => r.code));
        const stale = spec.roles.filter((r) => !held.has(r));
        if (stale.length) console.log(`# WARN ${envName(spec.role, 'LOGIN')}: the selected token still lacks ${stale.join(' ')} (DIGIT reuses a live token)`);
        console.log(`# ok ${envName(spec.role, 'LOGIN')} -> ${code} [${spec.roles.join(' ')}] @ ${plan.boundaries[spec.scope].code}`);
      } finally {
        await persona.dispose();
      }
    }
  } finally {
    await actor.dispose();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seed-personas] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
