/**
 * The stable error-code catalogue of the identity BFF (contract v1, item 0).
 *
 * docs/identity-bff.md §"Error codes" is the readable copy of this table, and
 * tests/contract/catalogue.test.ts keeps the two identical. To add, rename or
 * re-status a code, send a `contract.proposal` on thread `identity-contract`
 * first: clients branch on these values.
 *
 * Every JSON error body is `{code, error, ...details}`. `code` is stable;
 * `error` is English display text and may change at any time.
 *
 * `status` is the HTTP status the code is always sent with. "result" means the
 * code is never an HTTP error: it is delivered as a one-time sign-in result
 * (`GET /identity/v1/auth-results/:id`) after a 303 redirect.
 *
 * `retry`:
 * - "yes": retry the same request with back-off;
 * - "no": don't retry; the request or the account must change;
 * - "after-change": retry once the named condition has changed (an admin
 *   action, a wait, a config fix).
 */

export type ErrorRetry = "yes" | "no" | "after-change";

export interface ErrorCodeSpec {
  status: 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503 | "result";
  retry: ErrorRetry;
  meaning: string;
}

export const ERROR_CODES = {
  // Sign-in and action results (auth-results). The callback never emits DIGIT-side codes (D25/B5).
  AUTH_CANCELLED: { status: "result", retry: "no", meaning: "The person cancelled at Keycloak" },
  AUTH_ATTEMPT_EXPIRED: { status: "result", retry: "no", meaning: "The sign-in or setup attempt is missing, expired or already used" },
  IDENTITY_PROVIDER_UNAVAILABLE: { status: "result", retry: "yes", meaning: "The external identity provider failed" },
  ACCOUNT_LINK_REQUIRED: { status: "result", retry: "after-change", meaning: "The provider's email already belongs to an existing account" },
  ACCOUNT_LINK_FAILED: { status: "result", retry: "after-change", meaning: "Keycloak could not link the provider identity" },
  IDENTITY_ALREADY_LINKED: { status: "result", retry: "no", meaning: "That provider identity is linked to another person" },
  EMAIL_VERIFICATION_REQUIRED: { status: "result", retry: "after-change", meaning: "The existing account's email is not verified" },
  SIGN_IN_FAILED: { status: "result", retry: "yes", meaning: "Generic callback failure (cookie mismatch, token check)" },
  PASSWORD_SETUP_COMPLETE: { status: "result", retry: "no", meaning: "Password setup finished (status complete)" },
  PASSWORD_SETUP_FAILED: { status: "result", retry: "after-change", meaning: "The setup link was used but no password exists" },
  ACTION_COMPLETE: { status: "result", retry: "no", meaning: "A Keycloak account action finished (status complete)" },
  ACTION_CANCELLED: { status: "result", retry: "no", meaning: "The person cancelled a Keycloak account action" },
  ACTION_FAILED: { status: "result", retry: "yes", meaning: "A Keycloak account action failed" },

  // Request shape and browser security.
  INVALID_REQUEST: { status: 400, retry: "no", meaning: "Malformed body or query" },
  UNTRUSTED_ORIGIN: { status: 403, retry: "no", meaning: "The Origin header is not allowlisted" },
  UNSUPPORTED_SURFACE: { status: 400, retry: "no", meaning: "Unknown surface" },
  UNSUPPORTED_INTENT: { status: 400, retry: "no", meaning: "Unknown intent, or an intent the surface does not offer" },
  UNSUPPORTED_METHOD: { status: 400, retry: "no", meaning: "Unknown or disabled sign-in method" },
  UNSUPPORTED_RETURN_TO: { status: 400, retry: "no", meaning: "returnTo is not allowed for this surface" },
  AUTH_RESULT_NOT_FOUND: { status: 404, retry: "no", meaning: "The sign-in result was already read or has expired" },

  // Sign-in methods and account actions.
  SIGNIN_METHODS_UNAVAILABLE: { status: 503, retry: "yes", meaning: "The Keycloak client's method catalogue can't be read" },
  SIGNUP_UNAVAILABLE: { status: 503, retry: "after-change", meaning: "Self sign-up (magic link) is not enabled" },
  ACTION_NOT_ALLOWED: { status: 400, retry: "no", meaning: "The action is not in the client's digit.auth.account.actions" },
  CREDENTIAL_NOT_SECOND_FACTOR: { status: 409, retry: "no", meaning: "delete_credential targets a primary credential" },
  PROVIDER_ALREADY_LINKED: { status: 409, retry: "no", meaning: "idp_link for a provider that is already linked" },
  PROVIDER_NOT_LINKED: { status: 404, retry: "no", meaning: "_unlink for a provider that is not linked" },
  LAST_SIGNIN_METHOD: { status: 409, retry: "after-change", meaning: "It would remove the person's last primary sign-in method" },

  // Tenant routes.
  TENANT_ROUTE_NOT_FOUND: { status: 404, retry: "no", meaning: "Slug unmapped, tenant inactive, or Organization not ACTIVE" },
  TENANT_ROUTE_UNAVAILABLE: { status: 503, retry: "yes", meaning: "Keycloak or DIGIT failed while resolving the slug" },

  // Sessions.
  SESSION_REQUIRED: { status: 401, retry: "no", meaning: "No valid session cookie for this surface" },
  SESSION_EXPIRED: { status: 401, retry: "no", meaning: "The session ended during the request" },
  SESSION_REVOKED: { status: 401, retry: "no", meaning: "The session was signed out (logout-all, credential change, revocation)" },
  IDENTITY_BUSY: { status: 503, retry: "yes", meaning: "A lease (person, operation, tenant or slug) is held or was lost mid-request; Retry-After is set" },

  // Staff context selection.
  TENANT_CONTEXT_UNAVAILABLE: { status: 403, retry: "no", meaning: "The tenant is not selectable for this session" },
  EMPLOYEE_ACCOUNT_NOT_LINKED: { status: 403, retry: "after-change", meaning: "No active binding or no Organization membership at the tenant (D10)" },
  PENDING_INVITATION: { status: 403, retry: "after-change", meaning: "The binding at this tenant is pending; accept the invitation first" },
  ACCOUNT_LOCKED: { status: 403, retry: "after-change", meaning: "egov-user reports the DIGIT account locked; no credential repair" },
  DIGIT_ACCOUNT_INACTIVE: { status: 403, retry: "after-change", meaning: "The DIGIT account is inactive (D4); reactivate it in HRMS" },
  TENANT_ROLES_MISSING: { status: 503, retry: "after-change", meaning: "egov-user INVALID_ROLE: the tenant baseline is not seeded" },
  DIGIT_PII_MASKED: { status: 503, retry: "after-change", meaning: "The DIGIT writer refused a write because a read came back masked" },
  DIGIT_ACCOUNT_INVALID: { status: 503, retry: "after-change", meaning: "egov-user rejected a stored field on read-modify-write" },
  DIGIT_UNAVAILABLE: { status: 503, retry: "yes", meaning: "egov-user or MDMS failed, or returned an unparseable error" },
  IDENTITY_UNAVAILABLE: { status: 503, retry: "yes", meaning: "The Keycloak Admin API failed" },

  // Citizens and phone.
  PHONE_OTP_DISABLED: { status: 400, retry: "no", meaning: "Phone sign-in is not enabled for the citizen surface" },
  CITIZEN_SIGNIN_NOT_CONFIGURED: { status: 503, retry: "after-change", meaning: "The tenant has no MobileNumberValidation rule" },
  INVALID_MOBILE_NUMBER: { status: 400, retry: "no", meaning: "The number fails the tenant's mobile rule" },
  OTP_RESEND_TOO_SOON: { status: 429, retry: "after-change", meaning: "Per-phone cooldown; Retry-After is set" },
  OTP_RATE_LIMITED: { status: 429, retry: "after-change", meaning: "Per-phone or per-IP quota, or the OTP channel rate-limited; Retry-After is set" },
  OTP_CHANNEL_UNAVAILABLE: { status: 503, retry: "yes", meaning: "The OTP sender failed; the challenge was dropped and quota refunded" },
  OTP_INVALID: { status: 400, retry: "after-change", meaning: "Wrong code; attemptsRemaining is set" },
  OTP_EXPIRED: { status: 400, retry: "no", meaning: "The challenge is missing, expired, used up, or for another route or purpose" },
  IDENTITY_DISABLED: { status: 403, retry: "no", meaning: "The Keycloak user is disabled: the phone's (D6), or a _link target" },
  IDENTITY_CONFLICT: { status: 409, retry: "no", meaning: "Two verified Keycloak users hold the phone" },
  PHONE_IN_USE: { status: 409, retry: "no", meaning: "Another person owns the phone (step-up or change)" },
  PHONE_NOT_VERIFIED: { status: 403, retry: "after-change", meaning: "The citizen session has no verified phone" },
  CITIZEN_CONTEXT_UNAVAILABLE: { status: 403, retry: "no", meaning: "Wrong client, inactive tenant, or unusable number for citizen _select" },
  CITIZEN_ACCOUNT_AMBIGUOUS: { status: 409, retry: "after-change", meaning: "More than one legacy CITIZEN uses the number; an admin links one" },
  CITIZEN_ACCOUNT_LINK_BLOCKED: { status: 409, retry: "after-change", meaning: "An admin removed this phone link with block" },
  DIGIT_ACCOUNT_MISMATCH: { status: 502, retry: "no", meaning: "egov-user returned the wrong account type or tenant" },

  // Workspace members and invitations.
  ADMIN_EMAIL_CHANGE_NOT_ALLOWED: { status: 403, retry: "no", meaning: "Tenant admin cannot change this global identity email; use UPDATE_EMAIL or operator global recovery" },
  ADMIN_REQUIRED: { status: 403, retry: "no", meaning: "The caller lacks live DIGIT ACCOUNT_ADMIN at the tenant (D5)" },
  SELF_BINDING_FORBIDDEN: { status: 403, retry: "no", meaning: "A browser caller tried to bind themselves" },
  ROLE_ESCALATION_FORBIDDEN: { status: 403, retry: "no", meaning: "The target account holds an administrative role the caller lacks" },
  SELF_REMOVAL_FORBIDDEN: { status: 409, retry: "no", meaning: "An admin tried to remove their own binding" },
  BINDING_REMOVED: { status: 409, retry: "after-change", meaning: "The binding is removed; send reinvite:true to invite again" },
  BINDING_CONFLICT: { status: 409, retry: "no", meaning: "This person already has a different DIGIT account at the tenant" },
  BINDING_BUSY: { status: 503, retry: "yes", meaning: "The DIGIT-account (uuid) lock wait timed out; Retry-After is set" },
  ACTIVATION_NOT_NEEDED: { status: 409, retry: "no", meaning: "_link resend: the member already has a sign-in method and a verified email" },
  RESEND_TOO_SOON: { status: 429, retry: "after-change", meaning: "_link resend: per-member cooldown; Retry-After is set" },
  INVITATION_STALE: { status: 409, retry: "no", meaning: "The invitation was removed, replaced, expired or never existed" },
  INVITATION_EMAIL_UNVERIFIED: { status: 403, retry: "after-change", meaning: "The accepting account's email is not verified in Keycloak" },
  IDENTITY_EMAIL_CHANGED: { status: 409, retry: "after-change", meaning: "A Keycloak user matches by username but its email has changed" },
  WORKSPACE_TENANT_REQUIRED: { status: 400, retry: "no", meaning: "The tenant is not a workspace (Organization) tenant (D16)" },

  // DIGIT accounts and links (members and the internal account-links routes).
  DIGIT_ACCOUNT_NOT_FOUND: { status: 404, retry: "after-change", meaning: "No active DIGIT account matches, or the bound account has disappeared" },
  DIGIT_ACCOUNT_LINKED_ELSEWHERE: { status: 409, retry: "no", meaning: "The DIGIT account is bound to another person" },
  DIGIT_ACCOUNT_MANAGED: { status: 409, retry: "no", meaning: "A kcbff- managed account cannot be bound" },
  SUBJECT_ALREADY_LINKED: { status: 409, retry: "no", meaning: "The person already has a link of that type at the tenant" },
  ACCOUNT_LINK_BUSY: { status: 503, retry: "yes", meaning: "The account-link lock wait timed out (citizen links)" },
  TENANT_NOT_FOUND: { status: 404, retry: "no", meaning: "Unknown or inactive DIGIT tenant" },
  IDENTITY_NOT_FOUND: { status: 404, retry: "no", meaning: "No enabled Keycloak user with that subject" },

  // Workload (PGR onboarding) and operator routes.
  WORKLOAD_UNAUTHORIZED: { status: 401, retry: "no", meaning: "Missing or wrong bearer token for this internal route" },
  CONTROL_PLANE_NOT_CONFIGURED: { status: 503, retry: "after-change", meaning: "The token for this internal route is not configured" },
  ATTEMPT_STALE: { status: 409, retry: "no", meaning: "restartNo is lower than the one recorded for the operation" },
  OPERATION_CONFLICT: { status: 409, retry: "no", meaning: "Same operationId and restartNo with a different payload hash" },
  OPERATION_NOT_FOUND: { status: 404, retry: "after-change", meaning: "No Organization carries this operationId; call organizations/_ensure first" },
  SLUG_TAKEN: { status: 409, retry: "no", meaning: "Another operation or Organization holds the slug" },
  TENANT_TAKEN: { status: 409, retry: "no", meaning: "Another operation or Organization holds the tenant id" },
  LIFECYCLE_CONFLICT: { status: 409, retry: "no", meaning: "The transition conflicts with the recorded lifecycle" },
  TENANT_FOUNDATION_MISSING: { status: 409, retry: "after-change", meaning: "The DIGIT tenant does not exist yet" },
} as const satisfies Record<string, ErrorCodeSpec>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Codes that are delivered only as sign-in results, never as HTTP errors. */
export type ResultCode = {
  [K in ErrorCode]: (typeof ERROR_CODES)[K]["status"] extends "result" ? K : never;
}[ErrorCode];

/** Codes that are sent as HTTP JSON errors. */
export type HttpErrorCode = Exclude<ErrorCode, ResultCode>;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_CODES, value);
}

/** The HTTP status a JSON error code is always sent with. */
export function errorStatus(code: HttpErrorCode): number {
  return ERROR_CODES[code].status as number;
}

/** The frozen JSON error envelope: `{code, error, ...details}`. */
export interface ErrorBody {
  code: HttpErrorCode;
  error: string;
  [detail: string]: unknown;
}

export function errorBody(code: HttpErrorCode, error: string, details: Record<string, unknown> = {}): ErrorBody {
  return { ...details, code, error };
}
