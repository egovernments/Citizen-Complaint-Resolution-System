// DIGIT Environment Configuration

// ── Keycloak / token-exchange shared env contract ───────────────────────────
//
// These are populated at build time on production deploys via Vite env vars
// (see ansible templates/digit.env.j2). On the dev / preview build they're
// empty, which keeps everything inert — `isKeycloakMode()` is false and every
// code path stays identical to the OTP-only behavior.
//
// VITE_AUTH_PROVIDER         "keycloak" turns on the KC button + overlay routing
// VITE_KEYCLOAK_URL          Browser-relative base for the realm (e.g. "/auth")
// VITE_KEYCLOAK_REALM        Realm name (state tenant — "ke" on bomet/naipepea)
// VITE_KEYCLOAK_CLIENT_ID    Public client (default "digit-ui")
// VITE_TOKEN_EXCHANGE_URL    Browser-relative overlay prefix (e.g. "/token-exchange")
//                            When set + a KC token is present, DIGIT API URLs
//                            become `${origin}${overlay}/${original-path}`.
//                            The overlay strips the prefix, validates the JWT,
//                            and proxies upstream with a system token.
export const AUTH_PROVIDER = (import.meta.env.VITE_AUTH_PROVIDER as string) || '';
export const KEYCLOAK_URL = (import.meta.env.VITE_KEYCLOAK_URL as string) || '';
export const KEYCLOAK_REALM = (import.meta.env.VITE_KEYCLOAK_REALM as string) || '';
export const KEYCLOAK_CLIENT_ID =
  (import.meta.env.VITE_KEYCLOAK_CLIENT_ID as string) || 'digit-ui';
export const TOKEN_EXCHANGE_URL =
  (import.meta.env.VITE_TOKEN_EXCHANGE_URL as string) || '';

/** True when the build was wired up for Keycloak. Inert (false) by default. */
export function isKeycloakMode(): boolean {
  return AUTH_PROVIDER === 'keycloak';
}

// ── localStorage keys for KC tokens ────────────────────────────────────────

export const KC_STORAGE_KEYS = {
  access: 'digit_ui_v2_kc_access',
  refresh: 'digit_ui_v2_kc_refresh',
  id: 'digit_ui_v2_kc_id',
  state: 'digit_ui_v2_kc_oauth_state',
  // PKCE code_verifier — generated before /authorize, sent back with the
  // /token exchange. KC rejects public clients without it (the realm
  // sets pkce.code.challenge.method=S256). The verifier lives only as
  // long as the round-trip and is cleared on callback success or error.
  pkceVerifier: 'digit_ui_v2_kc_pkce_verifier',
  expiresAt: 'digit_ui_v2_kc_expires_at',
} as const;

/** True when a KC access token has been minted + saved (post-callback). */
export function hasKcToken(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return !!localStorage.getItem(KC_STORAGE_KEYS.access);
  } catch {
    return false;
  }
}

/** Auto-detect API base URL from the current origin. Each deployment serves
 *  the configurator and DIGIT APIs from the same domain via nginx.
 *
 *  In Keycloak mode with a citizen KC token present, all DIGIT API calls are
 *  transparently routed through `${origin}${TOKEN_EXCHANGE_URL}` so the
 *  overlay can rewrite RequestInfo (inject system token + real user identity)
 *  before forwarding upstream. The OTP login endpoints (used before a KC
 *  token exists) bypass the overlay automatically — `hasKcToken()` is false
 *  during the OTP flow. */
export function getApiBaseUrl(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://localhost';
  if (isKeycloakMode() && TOKEN_EXCHANGE_URL && hasKcToken()) {
    return `${origin}${TOKEN_EXCHANGE_URL}`;
  }
  return origin;
}

/** Explicit overlay-aware base. Kept for callers that want the intent to be
 *  obvious at the call site (the default `getApiBaseUrl` already does this). */
export function getApiBaseUrlWithTokenExchange(): string {
  return getApiBaseUrl();
}

/** The bare origin, no overlay prefix — for KC endpoints themselves (which
 *  must hit /auth/realms/... directly, not via the DIGIT overlay). */
export function getOriginBaseUrl(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'https://localhost';
}

// Service endpoints
export const ENDPOINTS = {
  // Authentication
  AUTH: '/user/oauth/token',
  USER_SEARCH: '/user/_search',

  // Citizen self-service (OTP-based).
  // /user-otp/v1/_send is fronted by Kong's request-termination plugin and
  // returns 200 unconditionally — no real OTP is sent. egov-user has
  // CITIZEN_LOGIN_PASSWORD_OTP_FIXED_ENABLED=true (value 123456), so the
  // citizen login flow is fixed-OTP-mocked end-to-end on this deploy.
  OTP_SEND: '/user-otp/v1/_send',
  CITIZEN_REGISTER: '/user/citizen/_create',

  // MDMS
  MDMS_SEARCH: '/mdms-v2/v2/_search',
  MDMS_CREATE: '/mdms-v2/v2/_create',

  // Boundary
  BOUNDARY_SEARCH: '/boundary-service/boundary/_search',
  BOUNDARY_HIERARCHY_SEARCH: '/boundary-service/boundary-hierarchy-definition/_search',
  BOUNDARY_HIERARCHY_CREATE: '/boundary-service/boundary-hierarchy-definition/_create',
  BOUNDARY_CREATE: '/boundary-service/boundary/_create',
  BOUNDARY_RELATIONSHIP_CREATE: '/boundary-service/boundary-relationships/_create',
  BOUNDARY_RELATIONSHIP_SEARCH: '/boundary-service/boundary-relationships/_search',

  // HRMS
  // KEEP IN SYNC with packages/data-provider/src/client/endpoints.ts
  HRMS_EMPLOYEES_SEARCH: '/egov-hrms/employees/_search',
  HRMS_EMPLOYEES_CREATE: '/egov-hrms/employees/_create',
  HRMS_EMPLOYEES_UPDATE: '/egov-hrms/employees/_update',

  // Localization
  LOCALIZATION_SEARCH: '/localization/messages/v1/_search',
  LOCALIZATION_UPSERT: '/localization/messages/v1/_upsert',

  // Filestore
  FILESTORE_UPLOAD: '/filestore/v1/files',
  FILESTORE_URL: '/filestore/v1/files/url',
};

// MDMS Schema codes
export const MDMS_SCHEMAS = {
  DEPARTMENT: 'common-masters.Department',
  DESIGNATION: 'common-masters.Designation',
  GENDER_TYPE: 'common-masters.GenderType',
  EMPLOYEE_STATUS: 'egov-hrms.EmployeeStatus',
  EMPLOYEE_TYPE: 'egov-hrms.EmployeeType',
  ROLES: 'ACCESSCONTROL-ROLES.roles',
  // 2-master complaint hierarchy: the level definition + the single adjacency
  // list (interior nodes AND leaf complaint types). The old
  // RAINMAKER-PGR.ServiceDefs / ClassificationNode masters are gone.
  PGR_COMPLAINT_HIERARCHY_DEFINITION: 'RAINMAKER-PGR.ComplaintHierarchyDefinition',
  PGR_COMPLAINT_HIERARCHY: 'RAINMAKER-PGR.ComplaintHierarchy',
  TENANT: 'tenant.tenants',
};

// OAuth credentials
export const OAUTH_CONFIG = {
  clientId: 'egov-user-client',
  clientSecret: '',
  grantType: 'password',
  scope: 'read',
};

// Default employee password
export const DEFAULT_PASSWORD = 'eGov@123';
