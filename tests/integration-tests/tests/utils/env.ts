/**
 * Environment configuration. Every spec reads deployment values from here, not
 * from process.env directly.
 *
 * Nothing in this file names a tenant, a persona or a box. Everything a run
 * targets comes from two env files (deploy/README.md):
 *
 *   deploy/<env>.env     tracked, no secrets: BASE_URL, DIGIT_TENANT, the
 *                        workspace slug, persona Keycloak logins, codes
 *   box secrets file     untracked, runner-only (RUNNER_SECRETS_ENV): persona
 *                        passwords, the fixed OTP
 *
 * A value nobody set stays empty, and assertEnv() — the first thing
 * profile-setup does — fails the run naming every missing variable. Some values
 * fall back to deployment-profile.json, which profile-setup writes before any
 * spec imports this file: those are discovered from the live deployment, not
 * defaults.
 *
 * Tenancy is root-only (#2398 decision 2): DIGIT_TENANT is the root tenant the
 * workspace slug resolves to, and every persona, citizen and complaint lives
 * there. ROOT_TENANT survives only as an alias of it.
 *
 * WHY THIS FILE PARSES THE PROFILE ITSELF INSTEAD OF CALLING profile.ts's
 * tryGetProfile(): profile.ts imports probes.ts/auth.ts/personas.ts, which all
 * import from here, so calling into profile.ts would hit its bindings in the
 * temporal dead zone. env.ts stays a leaf module; the `import type` below is
 * erased at compile time. The same cycle is why NO module env.ts's importers
 * pull in may read an env.ts binding at MODULE SCOPE: the CJS emit resolves
 * bindings lazily at the use site, so a top-level `const X = TENANT` in
 * probes/auth/personas would silently be `undefined`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DeploymentProfile } from './profile';

/**
 * Read once, at module scope, so every export below stays a plain `const`.
 * Mirrors profile.ts's tryGetProfile() (path and schemaVersion are duplicated to
 * avoid the cycle above). A profile from another schema counts as no profile.
 */
const PROFILE: DeploymentProfile | null = (() => {
  const path = resolve('deployment-profile.json');
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as DeploymentProfile;
    return parsed?.schemaVersion === 1 ? parsed : null;
  } catch {
    return null; // a half-written or hand-edited profile must not break every import
  }
})();

/** Split a comma-separated env list, dropping blanks so a trailing ',' is inert. */
function splitList(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const env = (name: string): string => process.env[name]?.trim() || '';

/**
 * Deployment target. BASE_URL stays env-only on purpose: it is the input to
 * discovery, and taking it from the profile would let a stale profile silently
 * redirect a run at the wrong host.
 */
export const BASE_URL = env('BASE_URL');
/** The workspace's ROOT tenant. The slug (IDENTITY_TEST_TENANT_SLUG) must resolve to it. */
export const TENANT = env('DIGIT_TENANT');
/** @deprecated Root tenants only: an alias of TENANT. */
export const ROOT_TENANT = TENANT;
/** Self-signed boxes (local k3s, a bare IP) opt in; secure by default. */
export const IGNORE_HTTPS_ERRORS = process.env.IGNORE_HTTPS_ERRORS === '1';
// Node's own fetch (passwordSignIn, the Keycloak admin API, profile probes)
// follows the same switch, set once when the profile loads rather than as a
// side effect of whichever call happens to run first.
if (IGNORE_HTTPS_ERRORS) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ── Personas ────────────────────────────────────────────────────────────────

/**
 * Staff personas sign in through Keycloak with an email login and their own
 * Keycloak password, and are linked to a DIGIT employee at TENANT. The login
 * goes in the env profile, the password in the secrets file; the DIGIT
 * identity comes back from `_select`. scripts/seed-personas.ts creates and
 * links all six on a workspace and prints the lines to set.
 */
export const PERSONA_ENV = {
  admin: 'ADMIN',
  gro: 'GRO',
  lme: 'LME',
  wardCsr: 'WARD_CSR',
  inboxViewer: 'INBOX_VIEWER',
  supervisor: 'SUPERVISOR',
} as const;
export type PersonaRole = keyof typeof PERSONA_ENV;

export interface PersonaLogin {
  role: PersonaRole;
  /** Keycloak login (email). */
  login: string;
  /** Keycloak password. Never logged, never written to disk. */
  password: string;
  /** Provenance, e.g. 'env:GRO_LOGIN'. */
  source: string;
}

/** The configured login for `role`, or null when its env pair is not set. */
export function personaLogin(role: PersonaRole): PersonaLogin | null {
  const prefix = PERSONA_ENV[role];
  const login = env(`${prefix}_LOGIN`);
  const password = process.env[`${prefix}_PASSWORD`] || '';
  return login && password ? { role, login, password, source: `env:${prefix}_LOGIN` } : null;
}

/** Workspace admin: ACCOUNT_ADMIN plus the Configurator admin roles. */
export const ADMIN_USER = env('ADMIN_LOGIN');
export const ADMIN_PASS = process.env.ADMIN_PASSWORD || '';
/** GRO with a department: drives ASSIGN. */
export const GRO_USER = env('GRO_LOGIN');
export const GRO_PASS = process.env.GRO_PASSWORD || '';
/** The general employee persona: SUPERVISOR (GRO + PGR_LME, jurisdiction ALL). */
export const EMPLOYEE_USER = env('SUPERVISOR_LOGIN');
export const EMPLOYEE_PASS = process.env.SUPERVISOR_PASSWORD || '';
/** Ward-scoped CSR for the boundary jurisdiction-filter regression. */
export const WARD_CSR_USER = env('WARD_CSR_LOGIN');
export const WARD_CSR_PASS = process.env.WARD_CSR_PASSWORD || '';

/**
 * Citizen OTP for the fixed-code test box. IDENTITY_TEST_OTP_CODE is the name
 * the identity helpers read; FIXED_OTP is accepted for older profiles. Lives in
 * the secrets file: on a fixed-OTP box it signs in as any phone number.
 */
export const FIXED_OTP = env('IDENTITY_TEST_OTP_CODE') || env('FIXED_OTP');

// ── Fail fast ───────────────────────────────────────────────────────────────

const REQUIRED = ['BASE_URL', 'DIGIT_TENANT', 'IDENTITY_TEST_TENANT_SLUG', 'ADMIN_LOGIN', 'ADMIN_PASSWORD'] as const;

/** Names the pre-#2398 profiles used, and what replaced them. */
const RETIRED: Record<string, string> = {
  DIGIT_USERNAME: 'ADMIN_LOGIN',
  DIGIT_PASSWORD: 'ADMIN_PASSWORD (the Keycloak password, in the secrets file)',
  ADMIN_USER: 'ADMIN_LOGIN',
  GRO_USER: 'GRO_LOGIN',
  EMPLOYEE_USER: 'SUPERVISOR_LOGIN',
  EMPLOYEE_PASSWORD: 'SUPERVISOR_PASSWORD',
  WARD_CSR_USER: 'WARD_CSR_LOGIN',
  CITY_ADMIN_USER: 'ADMIN_LOGIN',
  ROOT_TENANT: 'DIGIT_TENANT (root tenants only)',
  TENANT_CODE: 'DIGIT_TENANT',
  CITY_TENANT: 'DIGIT_TENANT (root tenants only)',
  EMPLOYEE_TENANT: 'DIGIT_TENANT (root tenants only)',
  PERSONA_CANDIDATES: '<ROLE>_LOGIN + <ROLE>_PASSWORD per persona',
  PERSONA_PASSWORD_GUESSES: 'nothing: persona passwords are never guessed',
};

/** Everything wrong with this process's env profile, as one line each. */
export function envProblems(): string[] {
  const out: string[] = REQUIRED.filter((k) => !env(k)).map((k) => `${k} is not set`);
  if (TENANT.includes('.')) out.push(`DIGIT_TENANT=${TENANT} is a city tenant; the suite targets root tenants only`);
  for (const [name, now] of Object.entries(RETIRED)) {
    if (process.env[name] !== undefined) out.push(`${name} is retired; set ${now}`);
  }
  return out;
}

/** Throw one message naming every problem. Called first by profile-setup and the seed script. */
export function assertEnv(): void {
  const problems = envProblems();
  if (problems.length) {
    throw new Error(
      `The env profile is incomplete:\n  - ${problems.join('\n  - ')}\n` +
        'Source deploy/<env>.env and the box secrets file (RUNNER_SECRETS_ENV); see deploy/README.md.',
    );
  }
}

/**
 * The complaint type + boundary leaf every seeded complaint is filed against.
 * Discovered by profile-setup (pgr.seedServiceCode is the one service whose
 * department a real employee holds; pgr.seedLocalityCode is a leaf proven to
 * exist). An env value pins it.
 */
export const SERVICE_CODE = env('SERVICE_CODE') || PROFILE?.pgr.seedServiceCode || '';
export const LOCALITY_CODE = env('LOCALITY_CODE') || PROFILE?.pgr.seedLocalityCode || '';

/**
 * The leaf ward the ward CSR is scoped to, and the sibling wards that MUST NOT
 * appear in its boundary picker (comma-separated). Empty unless pinned: a spec
 * reading these must handle empty rather than assume a ward list exists.
 */
export const WARD_CSR_BOUNDARY = env('WARD_CSR_BOUNDARY');
export const FORBIDDEN_WARDS = splitList(process.env.FORBIDDEN_WARDS || '');

/** The tenant's localized display name (TENANT_TENANTS_<TENANT>), discovered by profile-setup. */
export const TENANT_LABEL = env('TENANT_LABEL') || PROFILE?.tenant.label || '';

// ── Keycloak ────────────────────────────────────────────────────────────────
// Read by tests/keycloak/*.spec.ts. Staff and citizens share one realm.
export const KC_REALM = env('KC_REALM') || 'digit';
export const KC_CLIENT_ID = env('KC_CLIENT_ID') || 'digit-ui';
export const KC_BASE = env('KC_BASE') || `${BASE_URL}/auth`;
export const CITIZEN_BASENAME = env('CITIZEN_BASENAME') || '/citizen';

// ── Citizen-spec deployment parameters ──────────────────────────────────────

/**
 * PGR complaint-ID prefix (the segment before `-PGR-`), discovered from
 * egov-idgen by profile-setup. Empty when neither pinned nor discovered.
 */
export const PGR_ID_PREFIX = env('PGR_ID_PREFIX') || PROFILE?.pgr.idPrefix || '';

/**
 * Localization locales seeded on the deployment, comma-separated. The profile
 * lists only populated locales; en_IN is the locale the SPA boots in.
 */
export const LOCALES = process.env.LOCALES
  ? splitList(process.env.LOCALES)
  : PROFILE?.locales.length
    ? PROFILE.locales
    : ['en_IN'];

/**
 * Postal-code validation pattern + a known-valid sample, as the SPA's own
 * globalConfigs CORE_POSTAL_CONFIGS or MDMS FormValidations define it (read by
 * profile-setup). The floor is the SPA's built-in 5-digit rule.
 */
export const POSTAL_CODE_PATTERN = env('POSTAL_CODE_PATTERN') || PROFILE?.postal.pattern || '^[0-9]{5}$';
export const POSTAL_CODE_VALID = env('POSTAL_CODE_VALID') || PROFILE?.postal.validSample || '00100';

/**
 * Host substring used to match the deployment's own filestore/image URLs in
 * <img src> selectors — derived from BASE_URL.
 */
export const BASE_HOST = (() => {
  try { return new URL(BASE_URL).host; } catch { return ''; }
})();

/**
 * Decode a JWT payload without verifying its signature — for assertion only.
 * Tests should also re-verify any claim that load-bears on a behavior (the
 * overlay re-validates signatures on every API call, so trusting the
 * payload for shape assertions is fine).
 */
export function decodeJwtPayload(jwt: string): Record<string, any> {
  const part = jwt.split('.')[1];
  if (!part) return {};
  const pad = part.length % 4 === 2 ? '==' : part.length % 4 === 3 ? '=' : '';
  const b64 = (part + pad).replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

// ── Mobile numbers ──────────────────────────────────────────────────────────

/**
 * Find a leading digit that the deployment's mobile regex accepts in front of an
 * ARBITRARY tail — which is what generate*Phone() actually appends (a timestamp
 * slice, for uniqueness). Hence `every` and not `some`: a lead that only matches
 * one particular fill (say `^[17][0-9]{7}5$`) cannot back a timestamp, so
 * reporting it would be worse than admitting we didn't find one and letting the
 * legacy default stand. The uniform fills are a cheap proxy for "any tail" —
 * same trick deriveMobileLengths() uses to find the lengths this pattern allows.
 *
 * mz `^8[0-9]{8}$` -> '8'; bomet `^0?[17][0-9]{8}$` -> '1'.
 */
function derivePhonePrefix(pattern: string, len: number): string | null {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return null; // a regex out of a deployment's config is untrusted input
  }
  const digits = '0123456789'.split('');
  for (const lead of digits) {
    if (digits.every((fill) => re.test(lead + fill.repeat(len - 1)))) return lead;
  }
  return null;
}

/**
 * Length of a generated number. The profile derives it from the live regex
 * (deriveMobileLengths); 9 is the length this file assumed unconditionally
 * before the profile existed.
 */
const PHONE_LENGTH = PROFILE?.mobile.length?.min ?? 9;

/**
 * First digit(s) of a mobile number this deployment will accept. Kenya's '7' is
 * the floor; MZ needs '8' and would be rejected outright by user-service with a
 * '7'. Derived from the profile's mobileNumberRegex — the same rule the login
 * form and egov-user validate against.
 */
export const CITIZEN_PHONE_PREFIX =
  process.env.CITIZEN_PHONE_PREFIX ||
  (PROFILE?.mobile.pattern ? derivePhonePrefix(PROFILE.mobile.pattern, PHONE_LENGTH) : null) ||
  '7';

/** Prefix + trailing digits of `seed`, to make each generated number unique. */
function phoneFromSeed(seed: number): string {
  const remaining = Math.max(0, PHONE_LENGTH - CITIZEN_PHONE_PREFIX.length);
  return CITIZEN_PHONE_PREFIX + seed.toString().slice(-remaining);
}

/** Generate a unique citizen phone number valid for the deployment's mobile validation */
export function generateCitizenPhone(): string {
  return phoneFromSeed(Date.now());
}

/** Generate a unique employee phone number */
export function generateEmployeePhone(): string {
  return phoneFromSeed(Date.now() + 1);
}
