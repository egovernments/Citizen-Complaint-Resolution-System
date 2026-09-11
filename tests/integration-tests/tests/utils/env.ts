/**
 * Environment configuration — all env vars with defaults.
 *
 * Every test reads from here, not from process.env directly.
 * This ensures consistent defaults and documents what's configurable.
 *
 * Every DEPLOYMENT-SHAPED value below resolves through one chain:
 *
 *     explicit env var  ->  deployment-profile.json  ->  legacy hardcoded default
 *
 * The middle link is new. deployment-profile.json is written by the
 * `profile-setup` project (which every other project depends on) BEFORE any spec
 * imports this file, so tryGetProfile() is a plain synchronous file read here and
 * the ~11 specs that already `import { SERVICE_CODE, TENANT_LABEL, ... }` became
 * deployment-correct without being touched. The env var stays at the top of the
 * chain so an operator can still pin anything; the legacy default stays at the
 * bottom so a bare `npx playwright test --no-deps`, a lint pass, or any other
 * entry point that never ran profile-setup degrades instead of throwing.
 *
 * Those legacy defaults are the reason the middle link matters: nearly all of
 * them are bomet/nairobi literals that are silently WRONG on any other
 * deployment (TENANT_LABEL='Bomet County' does not exist in mz.maputo's city
 * picker, so the login just spins for 120s and times out). They are kept only as
 * the no-profile floor — do not read them as "the default deployment".
 *
 * WHY THIS FILE PARSES THE PROFILE ITSELF INSTEAD OF CALLING profile.ts's
 * tryGetProfile(): doing the latter deadlocks on an import cycle. profile.ts
 * imports probes.ts/auth.ts/personas.ts, and all of those import BASE_URL from
 * here — so when the entry point is profile.ts (which it is for profile-setup:
 * profile.setup.ts -> profile.ts -> probes.ts -> env.ts), env.ts runs while
 * profile.ts's own module body has not started. Its `let cached` and
 * `const PROFILE_PATH` are still in the temporal dead zone, and the call dies
 * with "Cannot access 'cached' before initialization". Reading the file here is
 * a dozen lines and makes env.ts a leaf module that imports nothing from the
 * suite, which removes the cycle rather than balancing on top of it. The
 * `import type` below is erased at compile time and adds no runtime edge.
 *
 * The cycle invariant profile.ts and personas.ts document still holds and still
 * matters: NEVER read an env.ts binding at MODULE SCOPE in any module env.ts's
 * importers pull in. The CJS emit resolves bindings lazily at the use site, so a
 * top-level `const X = TENANT` in probes/auth/personas would silently be
 * `undefined`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DeploymentProfile } from './profile';

/**
 * Read once, at module scope, so every export below stays a plain `const` and no
 * spec has to change shape to get a deployment-correct value. Null on the
 * degraded entry points described above.
 *
 * Mirrors profile.ts's tryGetProfile() and must stay in step with it: the path
 * and the accepted schemaVersion are duplicated here because importing either
 * constant would re-create the cycle this read exists to avoid. A profile from a
 * future schema is treated as no profile at all — the field paths below would
 * read `undefined` off it and quietly answer with bomet literals, which is the
 * exact failure this whole chain exists to prevent.
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

/**
 * Deployment target. Defaults to a local stack — real runs point the suite at
 * a deployment by exporting BASE_URL/DIGIT_TENANT (or sourcing a
 * deploy/<tenant>.env, see runner/run-cycle.sh). The previous default hardcoded
 * a now-dead demo host (naipepea) paired with personas from a *different* dead
 * deployment (bomet), so a bare `npx playwright test` authenticated against
 * neither. Keep the default coherent: localhost + ADMIN, which exists on every
 * freshly-bootstrapped deployment.
 *
 * BASE_URL stays env-only on purpose: it is the input to discovery, not an
 * output of it, and taking it from the profile would let a stale profile
 * silently redirect a run at the wrong host.
 */
export const BASE_URL = process.env.BASE_URL || 'http://localhost';
export const TENANT = process.env.DIGIT_TENANT || PROFILE?.tenant.city || 'ke.nairobi';
export const ROOT_TENANT =
  process.env.ROOT_TENANT || PROFILE?.tenant.root || (TENANT.includes('.') ? TENANT.split('.')[0] : TENANT);
export const ADMIN_USER = process.env.DIGIT_USERNAME || 'ADMIN';
export const ADMIN_PASS = process.env.DIGIT_PASSWORD || 'eGov@123';
export const FIXED_OTP = process.env.FIXED_OTP || '123456';
/**
 * The complaint type + boundary leaf every seeded complaint is filed against.
 * The profile does not just echo a config value here: pgr.seedServiceCode is the
 * one service whose department a real employee on this deployment actually holds
 * (see the persona-triple comment in personas.ts), and pgr.seedLocalityCode is a
 * leaf proven to exist in the live boundary tree. Guessing either wrong fails the
 * create/assign with DEPARTMENT_NOT_FOUND or a silently dropped record, so the
 * nairobi literals below are a floor, never a plan.
 */
export const SERVICE_CODE = process.env.SERVICE_CODE || PROFILE?.pgr.seedServiceCode || 'IllegalConstruction';
export const LOCALITY_CODE = process.env.LOCALITY_CODE || PROFILE?.pgr.seedLocalityCode || 'NAIROBI_CITY_VIWANDANI';
export const DEFAULT_PASSWORD = 'eGov@123';

/**
 * Non-ADMIN persona usernames + boundary codes for the employee / lifecycle
 * specs. Defaults fall back to ADMIN because the bootstrap now grants ADMIN the
 * full PGR bundle (GRO + PGR_LME roles — mdms-tenant.ts), so ADMIN can drive
 * ASSIGN/RESOLVE on a stock deployment. Override with real persona users on
 * tenants that enforce role-separation.
 */

/** PGR_LME / GRO employee for digit-ui employee flows (escalate, inbox). */
export const EMPLOYEE_USER = process.env.EMPLOYEE_USER || ADMIN_USER;
export const EMPLOYEE_PASS = process.env.EMPLOYEE_PASSWORD || ADMIN_PASS;

/**
 * Tenant the employee personas authenticate against. ADMIN lives at
 * ROOT_TENANT, but a real onboarded employee (e.g. EMP001 on mz.maputo)
 * lives at the CITY tenant and 400s ("Invalid login credentials") when the
 * OAuth call targets the root. Defaults to ROOT_TENANT — correct for the
 * stock case where the employee persona *is* ADMIN. The portable login
 * helpers (employee-ui.ts getPrincipal) probe CITY→ROOT regardless; this var
 * is the explicit override for specs that don't go through that helper.
 *
 * The profile supplies the hint in between: it already logged the employee
 * persona in and recorded which tenant accepted it, so prefer that measured
 * answer over guessing the city. ROOT_TENANT remains the floor — with no profile
 * the persona *is* ADMIN, and ADMIN lives at the root.
 */
export const EMPLOYEE_TENANT =
  process.env.EMPLOYEE_TENANT || PROFILE?.personas.resolved.employee?.tenant || PROFILE?.tenant.city || ROOT_TENANT;

/**
 * GRO employee — the role the PGR workflow requires for the ASSIGN action
 * (PENDINGFORASSIGNMENT → PENDINGATLME). The bootstrap grants ADMIN the GRO
 * role, so ADMIN is a valid default; override on role-strict tenants.
 */
export const GRO_USER = process.env.GRO_USER || ADMIN_USER;
export const GRO_PASS = process.env.GRO_PASSWORD || ADMIN_PASS;

/** Ward-scoped CSR for boundary jurisdiction-filter regression. */
export const WARD_CSR_USER = process.env.WARD_CSR_USER || 'BOMET_CSR_CHESOEN_1780282462';
export const WARD_CSR_PASS = process.env.WARD_CSR_PASSWORD || DEFAULT_PASSWORD;

/**
 * The leaf ward this CSR is scoped to, and the sibling / cross-sub-county wards
 * that MUST NOT appear in its boundary picker (comma-separated).
 *
 * Both used to default to bomet ward codes. That made the jurisdiction spec pass
 * vacuously everywhere else: on a deployment that has never heard of
 * BOMET_BOMET_CENTRAL_MUTARAKWA, "no forbidden ward is visible" is true for the
 * boring reason, and the assertion measured nothing. Empty is the honest floor —
 * Stage 3 derives the real siblings from the profile's boundary tree, which is
 * the only place that knows them. Until then a spec reading these must handle
 * empty rather than assume a ward list exists.
 */
export const WARD_CSR_BOUNDARY = process.env.WARD_CSR_BOUNDARY || '';

export const FORBIDDEN_WARDS = splitList(process.env.FORBIDDEN_WARDS || '');

/**
 * Tenant display label on the digit-ui login City combobox.
 *
 * The single most deployment-specific string in this file: the combobox renders
 * the localized TENANT_TENANTS_<TENANT> value, and picking a city that isn't in
 * the list is not a fast error — the login just waits, then times out at 120s. So
 * the profile discovers the label from localization rather than trusting the
 * chain's floor, and profile-setup warns when it had to fall back
 * (labelSource !== 'localization').
 *
 * 'Bomet County' survives underneath only because it is what a no-profile run has
 * always done. It is wrong on every deployment except bomet.
 */
export const TENANT_LABEL = process.env.TENANT_LABEL || PROFILE?.tenant.label || 'Bomet County';

/** Known complaint that is assigned to EMPLOYEE_USER on the deployment. */
export const ASSIGNED_COMPLAINT_ID = process.env.ASSIGNED_COMPLAINT_ID || 'PG-PGR-2026-04-13-000848';

/**
 * A real CITY tenant code (not the state root) known to exist in the tenants
 * list — used by the configurator tenants search test. naipepea has
 * ke.nairobi; bomet has ke.bomet.
 *
 * On a flat deployment (bomet's `ke`) the profile reports city === root, so this
 * degenerates to the root and the search test asserts against the only tenant
 * there is — correct, and better than searching for a ke.nairobi nobody seeded.
 */
export const CITY_TENANT = process.env.CITY_TENANT || PROFILE?.tenant.city || 'ke.nairobi';

// ── Keycloak SSO config ────────────────────────────────────────────────────
// Read by tests/keycloak/*.spec.ts. Each spec self-skips when the realm's
// OIDC discovery endpoint isn't reachable (deployments without KC enabled).
export const KC_REALM = process.env.KC_REALM || ROOT_TENANT;
export const KC_CLIENT_ID = process.env.KC_CLIENT_ID || 'digit-ui';
export const KC_BASE = process.env.KC_BASE || `${BASE_URL}/auth`;
export const TOKEN_EXCHANGE_BASE = process.env.TOKEN_EXCHANGE_BASE || `${BASE_URL}/token-exchange`;
export const CITIZEN_BASENAME = process.env.CITIZEN_BASENAME || '/citizen';

// ── Citizen-spec deployment parameters ──────────────────────────────────────
// Additive vars owned by the citizen suite. Each defaults to a stock value so a
// bare run stays coherent; a deployment supplies its own via .env. No
// location-specific literal should live inside a citizen spec — it reads here.

/**
 * Fallback PGR complaint-ID prefix (segment before `-PGR-`). The suite
 * discovers the real prefix live from egov-idgen at setup time (pgr-idgen.ts)
 * and persists it on the provisioned citizen; this only load-bears when that
 * discovery didn't run. The profile asks egov-idgen the same question once per
 * run, so the 'NCCG' (Nairobi) floor is now reached only with no profile at all.
 */
export const PGR_ID_PREFIX = process.env.PGR_ID_PREFIX || PROFILE?.pgr.idPrefix || 'NCCG';

/**
 * Localization locales seeded on the deployment, comma-separated. The timeline
 * localization-completeness spec unions message codes across these. mz.maputo
 * seeds only en_IN (pt_MZ needs a separate upload); Kenya seeded en_IN + sw_KE.
 *
 * The profile lists only locales that are actually populated, not merely
 * declared: every deployment inherits 205-row stub locales from the pg seed, and
 * unioning message codes across a stub reports a mistranslation that is really
 * just an empty table. An empty profile list therefore means "discovery found
 * nothing usable" and falls through to en_IN, the locale the SPA boots in.
 */
export const LOCALES = process.env.LOCALES
  ? splitList(process.env.LOCALES)
  : PROFILE?.locales.length
    ? PROFILE.locales
    : ['en_IN'];

/**
 * Postal-code validation pattern + a known-valid sample for this deployment,
 * mirroring the app's globalConfigs CORE_POSTAL_CONFIGS.postalCodePattern.
 * Stock default is the 5-digit rule; mz.maputo runs '^[0-9]{4}(-[0-9]{2})?$'
 * with a '0101-03' sample. The profile reads the pattern out of the SPA's own
 * globalConfigs — the same source the form validates against — so the pure-regex
 * contract test compares the app to itself instead of to a country literal
 * someone typed into a .env. The sample is expanded from the pattern
 * deterministically (profile.ts sampleFromPattern), so it cannot drift from it.
 */
export const POSTAL_CODE_PATTERN = process.env.POSTAL_CODE_PATTERN || PROFILE?.postal.pattern || '^[0-9]{5}$';
export const POSTAL_CODE_VALID = process.env.POSTAL_CODE_VALID || PROFILE?.postal.validSample || '00100';

/**
 * Host substring used to match the deployment's own filestore/image URLs in
 * <img src> selectors — derived from BASE_URL so the attachment spec doesn't
 * hardcode dead demo hostnames. e.g. 'localhost' for the local stack.
 */
export const BASE_HOST = (() => {
  try { return new URL(BASE_URL).host; } catch { return 'localhost'; }
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
