import type { HttpErrorCode, ResultCode } from "./error-codes.js";

/**
 * Every route of the identity BFF in contract v1 (item 0), with its auth and
 * the codes it may return. docs/identity-bff.md §"Routes" describes each one.
 *
 * tests/contract/routes.test.ts checks this list against the Express app:
 * - every registered route is listed here;
 * - every `live`, `changing` or `deleted-later` route is registered;
 * - every `planned` route is not registered yet (so the lane that builds it
 *   flips it to `changing`/`live` in the same PR, and adds its contract test).
 *
 * `state`:
 * - live: built, and the contract matches the code today;
 * - changing: built, but a work item still changes its shape or codes;
 * - planned: not built yet;
 * - deleted-later: built today, removed by item 14 once its replacement is on every box.
 */

export type RouteState = "live" | "changing" | "planned" | "deleted-later";

/**
 * - none: no auth;
 * - session: a surface session cookie (and Origin on writes);
 * - login-attempt: the per-surface login cookie plus state (Keycloak redirects);
 * - workload: `Authorization: Bearer` IDENTITY_ONBOARDING_TOKEN (PGR);
 * - introspection: IDENTITY_ONBOARDING_TOKEN, or IDENTITY_SESSION_INTROSPECTION_TOKEN during the move;
 * - operator: `Authorization: Bearer` IDENTITY_CONTROL_PLANE_TOKEN.
 */
export type RouteAuth = "none" | "session" | "login-attempt" | "workload" | "introspection" | "operator";

export interface RouteContract {
  method: "GET" | "POST";
  /** Express path pattern. */
  path: string;
  auth: RouteAuth;
  state: RouteState;
  /** Design §10 work items that still change this route. */
  items: number[];
  /** JSON error codes this route may return. */
  codes: HttpErrorCode[];
  /** Sign-in result codes this route may hand to auth-results. */
  results?: ResultCode[];
  /** Codes returned per item inside a 200 batch response (account-links). */
  itemCodes?: HttpErrorCode[];
}

const WORKLOAD_AUTH: HttpErrorCode[] = ["WORKLOAD_UNAUTHORIZED", "CONTROL_PLANE_NOT_CONFIGURED", "INVALID_REQUEST"];
const BROWSER_WRITE: HttpErrorCode[] = ["UNTRUSTED_ORIGIN", "INVALID_REQUEST", "SESSION_REQUIRED", "SESSION_REVOKED"];

export const ROUTES: RouteContract[] = [
  // Probes
  { method: "GET", path: "/livez", auth: "none", state: "live", items: [], codes: [] },
  { method: "GET", path: "/readyz", auth: "none", state: "changing", items: [15], codes: [] },

  // Browser, anonymous
  { method: "GET", path: "/identity/v1/auth-methods", auth: "none", state: "changing", items: [1, 2],
    codes: ["UNSUPPORTED_SURFACE", "UNSUPPORTED_INTENT", "SIGNIN_METHODS_UNAVAILABLE"] },
  { method: "GET", path: "/identity/v1/authorize", auth: "none", state: "changing", items: [1, 4],
    codes: ["INVALID_REQUEST", "UNSUPPORTED_SURFACE", "UNSUPPORTED_INTENT", "UNSUPPORTED_METHOD", "UNSUPPORTED_RETURN_TO",
      "TENANT_ROUTE_NOT_FOUND", "TENANT_ROUTE_UNAVAILABLE", "SIGNIN_METHODS_UNAVAILABLE", "ACTION_NOT_ALLOWED",
      "SESSION_REQUIRED", "CREDENTIAL_NOT_SECOND_FACTOR", "PROVIDER_ALREADY_LINKED", "IDENTITY_UNAVAILABLE"] },
  { method: "GET", path: "/identity/v1/callback", auth: "login-attempt", state: "changing", items: [4, 15], codes: [],
    results: ["AUTH_CANCELLED", "AUTH_ATTEMPT_EXPIRED", "IDENTITY_PROVIDER_UNAVAILABLE", "ACCOUNT_LINK_REQUIRED",
      "ACCOUNT_LINK_FAILED", "IDENTITY_ALREADY_LINKED", "EMAIL_VERIFICATION_REQUIRED", "SIGN_IN_FAILED",
      "ACTION_COMPLETE", "ACTION_CANCELLED", "ACTION_FAILED"] },
  { method: "GET", path: "/identity/v1/auth-results/:id", auth: "none", state: "live", items: [], codes: ["AUTH_RESULT_NOT_FOUND"] },
  { method: "POST", path: "/identity/v1/authentication/magic-link-requests", auth: "none", state: "live", items: [],
    codes: ["UNTRUSTED_ORIGIN", "INVALID_REQUEST", "UNSUPPORTED_RETURN_TO", "SIGNIN_METHODS_UNAVAILABLE", "SIGNUP_UNAVAILABLE"] },
  { method: "POST", path: "/identity/v1/password/setup-requests", auth: "none", state: "live", items: [],
    codes: ["UNTRUSTED_ORIGIN", "INVALID_REQUEST", "UNSUPPORTED_SURFACE", "UNSUPPORTED_RETURN_TO", "TENANT_ROUTE_NOT_FOUND", "TENANT_ROUTE_UNAVAILABLE"] },
  { method: "GET", path: "/identity/v1/password/setup-complete/:state", auth: "login-attempt", state: "live", items: [], codes: [],
    results: ["PASSWORD_SETUP_COMPLETE", "PASSWORD_SETUP_FAILED", "AUTH_ATTEMPT_EXPIRED"] },
  { method: "GET", path: "/identity/v1/tenant-contexts/:urlSlug", auth: "none", state: "changing", items: [11, 15],
    codes: ["TENANT_ROUTE_NOT_FOUND", "TENANT_ROUTE_UNAVAILABLE"] },
  { method: "POST", path: "/identity/v1/citizen/otp/_send", auth: "none", state: "changing", items: [3, 13],
    codes: ["UNTRUSTED_ORIGIN", "INVALID_REQUEST", "TENANT_ROUTE_NOT_FOUND", "TENANT_ROUTE_UNAVAILABLE", "PHONE_OTP_DISABLED",
      "CITIZEN_SIGNIN_NOT_CONFIGURED", "INVALID_MOBILE_NUMBER", "OTP_RESEND_TOO_SOON", "OTP_RATE_LIMITED",
      "OTP_CHANNEL_UNAVAILABLE", "IDENTITY_UNAVAILABLE", "SESSION_REQUIRED"] },
  { method: "POST", path: "/identity/v1/citizen/otp/_verify", auth: "none", state: "changing", items: [13],
    codes: ["UNTRUSTED_ORIGIN", "INVALID_REQUEST", "TENANT_ROUTE_NOT_FOUND", "TENANT_ROUTE_UNAVAILABLE", "PHONE_OTP_DISABLED", "OTP_EXPIRED",
      "OTP_INVALID", "IDENTITY_DISABLED", "IDENTITY_CONFLICT", "IDENTITY_UNAVAILABLE", "SESSION_REQUIRED", "PHONE_IN_USE"] },

  // Browser, signed in
  { method: "GET", path: "/identity/v1/session", auth: "session", state: "changing", items: [4, 9, 10, 15],
    codes: ["UNSUPPORTED_SURFACE", "SESSION_REQUIRED", "SESSION_REVOKED", "IDENTITY_UNAVAILABLE"] },
  { method: "POST", path: "/identity/v1/logout", auth: "session", state: "changing", items: [4, 10],
    codes: ["UNTRUSTED_ORIGIN", "INVALID_REQUEST", "UNSUPPORTED_SURFACE"] },
  { method: "GET", path: "/identity/v1/tenants", auth: "session", state: "changing", items: [8, 15],
    codes: ["SESSION_REQUIRED", "SESSION_REVOKED", "DIGIT_UNAVAILABLE", "IDENTITY_UNAVAILABLE"] },
  { method: "POST", path: "/identity/v1/contexts/_select", auth: "session", state: "changing", items: [7, 8, 10, 12],
    codes: [...BROWSER_WRITE, "UNSUPPORTED_SURFACE", "SESSION_EXPIRED", "TENANT_CONTEXT_UNAVAILABLE",
      "EMPLOYEE_ACCOUNT_NOT_LINKED", "PENDING_INVITATION", "ACCOUNT_LOCKED", "DIGIT_ACCOUNT_INACTIVE",
      "DIGIT_ACCOUNT_NOT_FOUND", "TENANT_ROLES_MISSING", "DIGIT_PII_MASKED", "DIGIT_ACCOUNT_INVALID",
      "DIGIT_UNAVAILABLE", "IDENTITY_UNAVAILABLE", "IDENTITY_BUSY"] },
  { method: "POST", path: "/identity/v1/contexts/citizen/_select", auth: "session", state: "changing", items: [10, 12, 13],
    codes: [...BROWSER_WRITE, "UNSUPPORTED_SURFACE", "SESSION_EXPIRED", "PHONE_NOT_VERIFIED", "CITIZEN_CONTEXT_UNAVAILABLE",
      "CITIZEN_SIGNIN_NOT_CONFIGURED", "CITIZEN_ACCOUNT_AMBIGUOUS", "CITIZEN_ACCOUNT_LINK_BLOCKED", "ACCOUNT_LOCKED",
      "DIGIT_ACCOUNT_INACTIVE", "ACCOUNT_LINK_BUSY", "DIGIT_PII_MASKED", "DIGIT_ACCOUNT_MISMATCH", "DIGIT_UNAVAILABLE",
      "IDENTITY_UNAVAILABLE", "IDENTITY_BUSY"] },
  { method: "POST", path: "/identity/v1/workspace-members/_link", auth: "session", state: "live", items: [8, 9],
    codes: [...BROWSER_WRITE, "ADMIN_REQUIRED", "WORKSPACE_TENANT_REQUIRED", "SELF_BINDING_FORBIDDEN",
      "ROLE_ESCALATION_FORBIDDEN", "DIGIT_ACCOUNT_NOT_FOUND", "DIGIT_ACCOUNT_LINKED_ELSEWHERE", "DIGIT_ACCOUNT_MANAGED",
      "BINDING_CONFLICT", "BINDING_REMOVED", "IDENTITY_EMAIL_CHANGED", "ACTIVATION_NOT_NEEDED", "RESEND_TOO_SOON",
      "BINDING_BUSY", "IDENTITY_BUSY", "DIGIT_UNAVAILABLE", "IDENTITY_UNAVAILABLE"] },
  { method: "GET", path: "/identity/v1/workspace-members", auth: "session", state: "live", items: [9],
    codes: ["INVALID_REQUEST", "SESSION_REQUIRED", "SESSION_REVOKED", "ADMIN_REQUIRED", "DIGIT_UNAVAILABLE", "IDENTITY_UNAVAILABLE"] },
  { method: "POST", path: "/identity/v1/workspace-members/_remove", auth: "session", state: "live", items: [9, 10],
    codes: [...BROWSER_WRITE, "ADMIN_REQUIRED", "SELF_REMOVAL_FORBIDDEN", "BINDING_BUSY", "IDENTITY_BUSY",
      "DIGIT_UNAVAILABLE", "IDENTITY_UNAVAILABLE"] },
  { method: "POST", path: "/identity/v1/workspace-members/_updateEmail", auth: "session", state: "live", items: [9],
    codes: [...BROWSER_WRITE, "ADMIN_REQUIRED", "ADMIN_EMAIL_CHANGE_NOT_ALLOWED", "DIGIT_ACCOUNT_NOT_FOUND", "IDENTITY_EMAIL_CHANGED", "IDENTITY_BUSY",
      "DIGIT_UNAVAILABLE", "IDENTITY_UNAVAILABLE"] },
  // `?surface=` (optional, default configurator) picks the session cookie; staff surfaces only.
  { method: "POST", path: "/identity/v1/workspace-invitations/_accept", auth: "session", state: "live", items: [9],
    codes: [...BROWSER_WRITE, "UNSUPPORTED_SURFACE", "INVITATION_STALE", "INVITATION_EMAIL_UNVERIFIED", "BINDING_BUSY", "IDENTITY_BUSY",
      "DIGIT_UNAVAILABLE", "IDENTITY_UNAVAILABLE"] },
  // `?surface=` (optional, default configurator) picks the session cookie.
  { method: "POST", path: "/identity/v1/account/providers/_unlink", auth: "session", state: "changing", items: [4],
    codes: [...BROWSER_WRITE, "UNSUPPORTED_SURFACE", "PROVIDER_NOT_LINKED", "LAST_SIGNIN_METHOD", "IDENTITY_BUSY",
      "IDENTITY_UNAVAILABLE"] },

  // Internal: PGR onboarding (workload)
  { method: "POST", path: "/internal/identity/v1/sessions/_introspect", auth: "introspection", state: "live", items: [11],
    codes: ["WORKLOAD_UNAUTHORIZED", "CONTROL_PLANE_NOT_CONFIGURED", "SESSION_REQUIRED", "IDENTITY_UNAVAILABLE"] },
  { method: "POST", path: "/internal/identity/v1/identifiers/_check", auth: "introspection", state: "live", items: [11],
    codes: [...WORKLOAD_AUTH, "IDENTITY_UNAVAILABLE"] },
  { method: "POST", path: "/internal/identity/v1/organizations/_ensure", auth: "workload", state: "live", items: [11],
    codes: [...WORKLOAD_AUTH, "ATTEMPT_STALE", "OPERATION_CONFLICT", "SLUG_TAKEN", "TENANT_TAKEN",
      "LIFECYCLE_CONFLICT", "TENANT_FOUNDATION_MISSING", "DIGIT_UNAVAILABLE", "IDENTITY_UNAVAILABLE", "IDENTITY_BUSY"] },
  { method: "POST", path: "/internal/identity/v1/organizations/_lifecycle", auth: "workload", state: "live", items: [11],
    codes: [...WORKLOAD_AUTH, "ATTEMPT_STALE", "LIFECYCLE_CONFLICT", "OPERATION_NOT_FOUND", "IDENTITY_UNAVAILABLE", "IDENTITY_BUSY"] },
  { method: "POST", path: "/internal/identity/v1/memberships/_ensure", auth: "workload", state: "live", items: [11, 14],
    codes: [...WORKLOAD_AUTH, "ATTEMPT_STALE", "OPERATION_NOT_FOUND", "IDENTITY_NOT_FOUND", "IDENTITY_UNAVAILABLE", "IDENTITY_BUSY"] },
  { method: "POST", path: "/internal/identity/v1/bindings/_ensure", auth: "workload", state: "live", items: [8, 11],
    codes: [...WORKLOAD_AUTH, "ATTEMPT_STALE", "OPERATION_NOT_FOUND", "IDENTITY_NOT_FOUND", "BINDING_CONFLICT",
      "DIGIT_ACCOUNT_LINKED_ELSEWHERE", "DIGIT_ACCOUNT_NOT_FOUND", "BINDING_BUSY", "IDENTITY_BUSY",
      "DIGIT_UNAVAILABLE", "IDENTITY_UNAVAILABLE"] },

  // Internal: operator
  { method: "POST", path: "/internal/identity/v1/reconciliation/_run", auth: "operator", state: "live", items: [12],
    codes: ["WORKLOAD_UNAUTHORIZED", "CONTROL_PLANE_NOT_CONFIGURED"] },
  { method: "POST", path: "/internal/identity/v1/account-links/_link", auth: "operator", state: "changing", items: [14],
    codes: [...WORKLOAD_AUTH],
    itemCodes: ["INVALID_REQUEST", "TENANT_NOT_FOUND", "IDENTITY_NOT_FOUND", "DIGIT_ACCOUNT_NOT_FOUND", "DIGIT_ACCOUNT_MANAGED",
      "DIGIT_ACCOUNT_LINKED_ELSEWHERE", "SUBJECT_ALREADY_LINKED", "CITIZEN_ACCOUNT_LINK_BLOCKED", "CITIZEN_ACCOUNT_AMBIGUOUS",
      "ACCOUNT_LINK_BUSY", "DIGIT_UNAVAILABLE", "IDENTITY_UNAVAILABLE"] },
  { method: "POST", path: "/internal/identity/v1/account-links/_unlink", auth: "operator", state: "changing", items: [14],
    codes: [...WORKLOAD_AUTH, "ACCOUNT_LINK_BUSY", "IDENTITY_UNAVAILABLE"] },
  { method: "GET", path: "/internal/identity/v1/account-links", auth: "operator", state: "changing", items: [14],
    codes: [...WORKLOAD_AUTH] },
  { method: "POST", path: "/internal/identity/v1/tenant-routes/_backfill", auth: "operator", state: "deleted-later", items: [14],
    codes: [...WORKLOAD_AUTH] },
  { method: "POST", path: "/internal/identity/v1/tenant-groups/_ensure", auth: "operator", state: "deleted-later", items: [14],
    codes: [...WORKLOAD_AUTH] },
  { method: "POST", path: "/internal/identity/v1/role-assignments/_ensure", auth: "operator", state: "deleted-later", items: [14],
    codes: [...WORKLOAD_AUTH] },
];

export function routeContract(method: string, path: string): RouteContract | undefined {
  return ROUTES.find((route) => route.method === method && route.path === path);
}
