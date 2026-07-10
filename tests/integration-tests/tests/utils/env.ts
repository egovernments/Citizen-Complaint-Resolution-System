/**
 * Environment configuration — all env vars with defaults.
 *
 * Every test reads from here, not from process.env directly.
 * This ensures consistent defaults and documents what's configurable.
 */

/**
 * Deployment target. Defaults to a local stack — real runs point the suite at
 * a deployment by exporting BASE_URL/DIGIT_TENANT (or sourcing a
 * deploy/<tenant>.env, see runner/run-cycle.sh). The previous default hardcoded
 * a now-dead demo host (naipepea) paired with personas from a *different* dead
 * deployment (bomet), so a bare `npx playwright test` authenticated against
 * neither. Keep the default coherent: localhost + ADMIN, which exists on every
 * freshly-bootstrapped deployment.
 */
export const BASE_URL = process.env.BASE_URL || 'http://localhost';
export const TENANT = process.env.DIGIT_TENANT || 'ke.nairobi';
export const ROOT_TENANT = process.env.ROOT_TENANT || (TENANT.includes('.') ? TENANT.split('.')[0] : TENANT);
export const ADMIN_USER = process.env.DIGIT_USERNAME || 'ADMIN';
export const ADMIN_PASS = process.env.DIGIT_PASSWORD || 'eGov@123';
export const FIXED_OTP = process.env.FIXED_OTP || '123456';
export const CITIZEN_PHONE_PREFIX = process.env.CITIZEN_PHONE_PREFIX || '7';
export const SERVICE_CODE = process.env.SERVICE_CODE || 'IllegalConstruction';
export const LOCALITY_CODE = process.env.LOCALITY_CODE || 'NAIROBI_CITY_VIWANDANI';
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
 */
export const EMPLOYEE_TENANT = process.env.EMPLOYEE_TENANT || ROOT_TENANT;

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

/** The leaf ward this CSR is scoped to. */
export const WARD_CSR_BOUNDARY = process.env.WARD_CSR_BOUNDARY || 'BOMET_BOMET_CENTRAL_CHESOEN';

/**
 * Sibling / cross-sub-county wards that MUST NOT appear in the CSR's
 * boundary picker. Comma-separated. Defaults are bomet wards adjacent
 * to CHESOEN.
 */
export const FORBIDDEN_WARDS = (
  process.env.FORBIDDEN_WARDS ||
  'BOMET_BOMET_CENTRAL_MUTARAKWA,BOMET_BOMET_CENTRAL_NADARAWETA,BOMET_BOMET_CENTRAL_SILIBWET_TOWNSHIP,BOMET_BOMET_CENTRAL_SINGORWET,BOMET_BOMET_EAST_KEMBU,BOMET_CHEPALUNGU_CHEBUNYO,BOMET_KONOIN_KIMULOT'
).split(',').map((s) => s.trim()).filter(Boolean);

/** Tenant display label on digit-ui login City combobox. */
export const TENANT_LABEL = process.env.TENANT_LABEL || 'Bomet County';

/** Known complaint that is assigned to EMPLOYEE_USER on the deployment. */
export const ASSIGNED_COMPLAINT_ID = process.env.ASSIGNED_COMPLAINT_ID || 'PG-PGR-2026-04-13-000848';

/**
 * A real CITY tenant code (not the state root) known to exist in the tenants
 * list — used by the configurator tenants search test. naipepea has
 * ke.nairobi; bomet has ke.bomet.
 */
export const CITY_TENANT = process.env.CITY_TENANT || 'ke.nairobi';

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
 * discovery didn't run. Default 'NCCG' (Nairobi) to match pgr-idgen.ts's
 * DEFAULT_FALLBACK; override with PGR_ID_PREFIX='PG' for Ethiopia/mz.maputo.
 */
export const PGR_ID_PREFIX = process.env.PGR_ID_PREFIX || 'NCCG';

/**
 * Localization locales seeded on the deployment, comma-separated. The timeline
 * localization-completeness spec unions message codes across these. mz.maputo
 * seeds only en_IN (pt_MZ needs a separate upload); Kenya seeded en_IN + sw_KE.
 */
export const LOCALES = (process.env.LOCALES || 'en_IN')
  .split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Postal-code validation pattern + a known-valid sample for this deployment,
 * mirroring the app's globalConfigs CORE_POSTAL_CONFIGS.postalCodePattern.
 * Stock default is the 5-digit rule; mz.maputo pins '^[0-9]{4}(-[0-9]{2})?$'
 * with a '0101-03' sample. Kept in .env so the pure-regex contract test stays
 * deployment-portable rather than hardcoding a country's format.
 */
export const POSTAL_CODE_PATTERN = process.env.POSTAL_CODE_PATTERN || '^[0-9]{5}$';
export const POSTAL_CODE_VALID = process.env.POSTAL_CODE_VALID || '00100';

/**
 * Escape hatch: set true on a deployment whose PGR backend rejects
 * complaint-create (e.g. the bomet ke JsonMappingException 400). Defaults
 * false so the file-complaint wizard asserts a real successful submission —
 * which mz.maputo should now do once the boundary cascade reaches the Bairro
 * leaf. Never fake a pass: only flip this on a genuinely broken backend.
 */
export const PGR_CREATE_UNSUPPORTED = (process.env.PGR_CREATE_UNSUPPORTED || 'false') === 'true';

/**
 * Escape hatch for CCRS#555's detail-page half: set true on a deployment whose
 * complaint detail page doesn't render the uploaded attachment <img> (the
 * unresolved bomet ke regression). Defaults false so the detail assertion runs
 * for real.
 */
export const ATTACHMENT_DETAIL_UNSUPPORTED = (process.env.ATTACHMENT_DETAIL_UNSUPPORTED || 'false') === 'true';

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

/** Generate a unique citizen phone number valid for the deployment's mobile validation */
export function generateCitizenPhone(): string {
  // Prefix + remaining digits from timestamp to ensure uniqueness
  const remaining = 9 - CITIZEN_PHONE_PREFIX.length;
  return CITIZEN_PHONE_PREFIX + Date.now().toString().slice(-remaining);
}

/** Generate a unique employee phone number */
export function generateEmployeePhone(): string {
  const remaining = 9 - CITIZEN_PHONE_PREFIX.length;
  return CITIZEN_PHONE_PREFIX + (Date.now() + 1).toString().slice(-remaining);
}
