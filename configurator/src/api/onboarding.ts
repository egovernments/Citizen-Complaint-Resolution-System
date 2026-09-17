/**
 * Self-serve onboarding + identity contract (CCRS#1999).
 *
 * Implements the deployed backend contract:
 * https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1999#issuecomment-5660722071
 *
 * Three things about this contract drive the shape of everything below:
 *
 *  - **The browser never talks to Keycloak, and never handles a credential.**
 *    Sign-in is a full-page navigation to the BFF, which runs Authorization
 *    Code + PKCE and hands off to Keycloak's own hosted page. So there is no
 *    Keycloak base URL to configure, no password field, and no magic-link
 *    token for us to redeem. `authMethods()` only decides which buttons to
 *    draw.
 *
 *  - **The session is an opaque HttpOnly cookie.** Every call is same-origin
 *    with `credentials: "include"`, and no call carries a Keycloak token, a
 *    DIGIT token, or `RequestInfo.authToken`. A DIGIT token only exists after
 *    `selectContext()`, and from there normal DIGIT calls resume as usual.
 *
 *  - **The draft lives on the server.** There is one signup per founder, so
 *    the wizard is a view over a server record rather than local state that
 *    gets posted at the end. That is what makes the flow resumable after a
 *    closed tab, and it is why every mutation returns the full signup and the
 *    caller keeps the returned `version`.
 */

/**
 * Empty in production, where the FE is served from the same origin as the API
 * and every path below is same-origin. Local dev is the exception: the app runs
 * on :5173 while the backend lives elsewhere, so the origin is configured and
 * the calls are cross-origin. The contract works either way — the session is an
 * HttpOnly cookie set by the BFF on its own origin, sent because every request
 * here uses `credentials: "include"` — but the FE origin has to be one the
 * backend allows, and the OAuth callback has to be pointed back at it.
 */
export const API_ORIGIN: string = (import.meta.env.VITE_ONBOARDING_API_ORIGIN as string | undefined)?.replace(/\/$/, '') ?? '';

const IDENTITY_BASE = `${API_ORIGIN}/identity/v1`;
const ONBOARDING_BASE = `${API_ORIGIN}/pgr-services/v2/onboarding`;

/* -------------------------------------------------------------------------- */
/* Contract types                                                             */
/* -------------------------------------------------------------------------- */

export interface AuthMethod {
  id: string;
  label: string;
  type: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  preferredUsername: string;
}

export interface Session {
  authenticated: boolean;
  user?: SessionUser;
  context?: unknown | null;
  expiresAt?: number;
}

export interface TenantOption {
  organizationAlias: string;
  tenantId: string;
  name: string;
  roles: string[];
  /**
   * Tenant-scoped and member-readable, so it answers for the workspace rather
   * than for whoever is asking. Optional because the backend does not send it
   * yet (CCRS#2073 G9); absent is treated as not ready, never as ready.
   */
  readiness?: TenantReadiness;
}

export interface TenantsResponse {
  tenants: TenantOption[];
  selectionRequired: boolean;
  onboardingRequired: boolean;
}

/**
 * How far a tenant has actually been built, which is not the same question as
 * whether you can sign in to it (CCRS#2073 G9).
 *
 *  - `IDENTITY_READY` — the organization and the tenant admin exist and a
 *    correctly scoped DIGIT token can be minted, but no platform configuration
 *    is installed. Management Studio would mount against a tenant with no
 *    role-actions and every call would come back `AccessDeniedException`.
 *  - `PROVISIONING` — a baseline configuration job is actually running.
 *  - `READY` — the workspace is usable.
 *  - `FAILED` — a baseline job ran and did not finish.
 */
export type TenantReadiness = 'IDENTITY_READY' | 'PROVISIONING' | 'READY' | 'FAILED';

/**
 * Readiness for one tenant, and deliberately fail-closed.
 *
 * This must answer for the WORKSPACE, not for the person asking. Deriving it
 * from the caller's own signup record was wrong two ways: it said nothing about
 * a tenant the caller did not create, and it returned ready for exactly that
 * case, so an invited admin, or a founder picking a second membership, walked
 * into a half-built tenant.
 *
 * So the only source is the tenant-scoped signal on the option. Until the
 * backend sends one, unknown resolves to `IDENTITY_READY` rather than `READY`.
 * Every tenant reachable through this chooser today was produced by this path,
 * which installs the identity floor and nothing else, and guessing the other
 * way is the failure this exists to prevent.
 */
export function tenantReadiness(option: Pick<TenantOption, 'readiness'>): TenantReadiness {
  return option.readiness ?? 'IDENTITY_READY';
}

/** Server-derived fields are readonly here so a caller cannot try to send them. */
export interface Signup {
  id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'PROVISIONING' | 'ACTIVE' | 'FAILED';
  accountName: string;
  accountCode: string;
  readonly organizationAlias: string;
  readonly requestedTenantId: string;
  urlSlug: string;
  countryCode: string;
  languages: string[];
  timeZone: string;
  financialYearPolicy: string;
  acceptedTermsVersion: string;
  tenantMetadata: TenantMetadata;
  version: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * The only metadata the backend accepts, and it is a closed set.
 *
 * Unknown keys at either level are rejected before provisioning, so there is
 * deliberately no index signature here: a stray field should fail to compile
 * rather than fail a submit. `schemaVersion` must be 1.
 *
 * `countryCode` inside `tenantAdmin` is derived by the backend from the
 * top-level `Signup.countryCode` and must not be sent.
 */
export interface TenantMetadata {
  schemaVersion: 1;
  tenantAdmin: {
    /**
     * E.164, with the dial prefix. `_submit` requires it: the worker creates
     * the tenant-local DIGIT employee from it, and the backend validates it
     * against Signup.countryCode, normalises it to the national number and
     * derives the prefix itself. A draft may be saved without it.
     */
    mobileNumber: string;
  };
}

/** Everything a caller may send. Server-derived fields are absent by design. */
export type SignupDraftInput = Partial<
  Pick<
    Signup,
    | 'accountName'
    | 'accountCode'
    | 'urlSlug'
    | 'countryCode'
    | 'languages'
    | 'timeZone'
    | 'financialYearPolicy'
    | 'acceptedTermsVersion'
    | 'tenantMetadata'
  >
>;

export type IdentifierType =
  | 'ACCOUNT_CODE'
  | 'URL_SLUG'
  | 'ORGANIZATION_ALIAS'
  | 'TENANT_ID';

export interface AvailabilityResult {
  type: IdentifierType;
  value: string;
  available: boolean;
}

export type OperationStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'RETRYABLE_FAILED'
  | 'TERMINAL_FAILED';

/** The worker's fixed step order, for the progress screen's checklist. */
export const PROVISIONING_STEPS = [
  'TENANT_FOUNDATION',
  'ORGANIZATION',
  'TENANT_ADMIN_MEMBERSHIP',
  'TENANT_ADMIN_ROLES',
  'DIGIT_ACCOUNT',
] as const;

export type ProvisioningStep = (typeof PROVISIONING_STEPS)[number];

export interface Operation {
  id: string;
  signupId: string;
  status: OperationStatus;
  currentStep: ProvisioningStep | null;
  completedSteps: ProvisioningStep[];
  errorCode: string | null;
  errorMessage: string | null;
  attempt: number;
  createdAt: number;
  updatedAt: number;
}

/** The DIGIT login shape, minus any refresh token. */
export interface DigitContext {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  /**
   * The documented login profile, passed through from egov-user. `name` and
   * `emailId` are what a person is actually called: do not substitute the
   * managed username for either, and never synthesize an address from it.
   */
  UserRequest: {
    id?: number;
    uuid: string;
    userName: string;
    name?: string;
    mobileNumber?: string;
    countryCode?: string;
    emailId?: string;
    locale?: string;
    type?: string;
    active?: boolean;
    tenantId: string;
    roles: { code: string; name: string; tenantId: string }[];
  };
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Carries the stable backend code alongside the message. The code is what we
 * branch on and what goes in diagnostics; the message is what a person reads.
 */
export class OnboardingError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = 'OnboardingError';
    this.status = status;
    this.code = code;
  }

  /** The session is gone; the caller must restart sign-in rather than retry. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** A dependency is briefly down — worth a backoff rather than a dead end. */
  get isTransient(): boolean {
    return this.status === 503;
  }
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Injectable so tests can drive the client without a network or a service
 * worker. Production leaves it alone.
 */
let fetchImpl: typeof fetch = (...args) => fetch(...args);

export function __setFetchForTests(impl: typeof fetch | null): void {
  fetchImpl = impl ?? ((...args) => fetch(...args));
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      // Same-origin plus the opaque identity cookie. Both halves matter: the
      // cookie is HttpOnly, so this is the only way the session travels.
      credentials: 'include',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new OnboardingError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    // Three shapes in play. Onboarding answers with the DIGIT `Errors[]`
    // envelope (`{"Errors":[{"code","message"}]}`), identity with a flat
    // `{"error":"..."}`, and a few paths with `{"code","message"}`. Reading
    // only the flat ones turned "Signup.countryCode is required" into
    // "Request failed (400)", which tells the operator nothing.
    const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const first = Array.isArray(record.Errors) ? (record.Errors[0] as Record<string, unknown>) : null;
    const code = ((first?.code as string) || (record.code as string)) ?? null;
    const message =
      (first?.message as string) ||
      (record.message as string) ||
      (record.error as string) ||
      `Request failed (${response.status}).`;
    throw new OnboardingError(response.status, code, message);
  }

  return body as T;
}

/**
 * Required on create and submit, 1–128 chars. The same key must be reused when
 * retrying the *same* user action after a network failure — that is the whole
 * point — so the caller owns its lifetime and we only mint it here.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which sign-in methods are actually enabled. Render only what comes back:
 * Google, GitHub and magic link appear here once their Keycloak providers are
 * switched on, and they use this same redirect flow, so no screen changes when
 * they do.
 */
export function authMethods(): Promise<{ methods: AuthMethod[] }> {
  return call(`${IDENTITY_BASE}/auth-methods`);
}

/**
 * A full-page navigation, not a fetch. The BFF needs to set state/nonce
 * cookies and hand the browser to Keycloak; an XHR cannot do that, and
 * following it in JS would break PKCE.
 */
export function startSignIn(methodId: string): void {
  window.location.assign(`${IDENTITY_BASE}/authorize?method=${encodeURIComponent(methodId)}`);
}

/**
 * Resolves `{ authenticated: false }` rather than throwing on a 401.
 *
 * Takes a signal because one caller runs this on a cold page load to decide
 * which screen to draw, and must not hang there if the identity BFF is slow
 * or absent.
 */
export async function session(signal?: AbortSignal): Promise<Session> {
  try {
    return await call<Session>(`${IDENTITY_BASE}/session`, { signal });
  } catch (error) {
    if (error instanceof OnboardingError && error.isUnauthenticated) {
      return { authenticated: false };
    }
    throw error;
  }
}

/**
 * Authoritative on whether to show onboarding, a chooser, or neither.
 * Onboarding updates it live, so re-read it after provisioning rather than
 * assuming a fresh sign-in is needed.
 */
export function tenants(): Promise<TenantsResponse> {
  return call(`${IDENTITY_BASE}/tenants`);
}

/** Exchanges the chosen tenant for a user-scoped DIGIT token. */
export function selectContext(tenantId: string): Promise<DigitContext> {
  return call(`${IDENTITY_BASE}/contexts/_select`, {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });
}

export function logout(): Promise<void> {
  return call(`${IDENTITY_BASE}/logout`, { method: 'POST' });
}

/* -------------------------------------------------------------------------- */
/* Onboarding                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One signup per founder: repeating this, including after the FE loses all
 * local state, returns the existing draft rather than creating a second.
 */
export async function createSignup(
  input: SignupDraftInput,
  idempotencyKey: string
): Promise<Signup> {
  const { Signup: signup } = await call<{ Signup: Signup }>(
    `${ONBOARDING_BASE}/signups/_create`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ Signup: input }),
    }
  );
  return signup;
}

/** The founder's own signup, or null. Another user's is never visible. */
export async function findSignup(id?: string): Promise<Signup | null> {
  const { Signups } = await call<{ Signups: Signup[] }>(
    `${ONBOARDING_BASE}/signups/_search`,
    {
      method: 'POST',
      body: JSON.stringify({ Signup: id ? { id } : {} }),
    }
  );
  return Signups?.[0] ?? null;
}

/** Send only what changed, plus `id`. Only a DRAFT is editable. */
export async function updateSignup(
  id: string,
  changes: SignupDraftInput
): Promise<Signup> {
  const { Signup: signup } = await call<{ Signup: Signup }>(
    `${ONBOARDING_BASE}/signups/_update`,
    {
      method: 'POST',
      body: JSON.stringify({ Signup: { id, ...changes } }),
    }
  );
  return signup;
}

/**
 * Advisory only — submit performs the atomic reservation and is authoritative.
 * Pass `signupId` while editing so the draft's own reservation reads as
 * available instead of colliding with itself.
 */
export async function checkIdentifier(
  type: IdentifierType,
  value: string,
  signupId?: string
): Promise<AvailabilityResult> {
  const { Identifier } = await call<{ Identifier: AvailabilityResult }>(
    `${ONBOARDING_BASE}/identifiers/_check`,
    {
      method: 'POST',
      body: JSON.stringify({ Identifier: { type, value, ...(signupId ? { signupId } : {}) } }),
    }
  );
  return Identifier;
}

/** Repeating a submit returns the existing operation rather than a second one. */
export async function submitSignup(
  id: string,
  idempotencyKey: string
): Promise<Operation> {
  const { Operation: operation } = await call<{ Operation: Operation }>(
    `${ONBOARDING_BASE}/signups/_submit`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ Signup: { id } }),
    }
  );
  return operation;
}

export async function findOperation(id: string): Promise<Operation | null> {
  const { Operations } = await call<{ Operations: Operation[] }>(
    `${ONBOARDING_BASE}/operations/_search`,
    {
      method: 'POST',
      body: JSON.stringify({ Operation: { id } }),
    }
  );
  return Operations?.[0] ?? null;
}

/** Only a RETRYABLE_FAILED operation may be retried; TERMINAL_FAILED is a dead end. */
export async function retryOperation(id: string): Promise<Operation> {
  const { Operation: operation } = await call<{ Operation: Operation }>(
    `${ONBOARDING_BASE}/operations/_retry`,
    {
      method: 'POST',
      body: JSON.stringify({ Operation: { id } }),
    }
  );
  return operation;
}

export function isOperationSettled(status: OperationStatus): boolean {
  return status === 'SUCCEEDED' || status === 'RETRYABLE_FAILED' || status === 'TERMINAL_FAILED';
}

/* -------------------------------------------------------------------------- */
/* Derivations and normalisation                                              */
/* -------------------------------------------------------------------------- */

/**
 * "Bomet County Government" -> "bomet-county-government".
 * 2–63 chars, lowercase, and the server also requires at least two letters —
 * so a name of pure digits produces a slug the user must fix rather than one
 * we silently pad.
 */
export function slugifyAccountName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

/** The server's own rule, mirrored so the field can say why before submit does. */
export function isValidUrlSlug(slug: string): boolean {
  if (!/^[a-z0-9-]{2,63}$/.test(slug)) return false;
  return (slug.match(/[a-z]/g) || []).length >= 2;
}

/** 2–32 of A-Z, 0-9 and hyphen. */
export function isValidAccountCode(code: string): boolean {
  return /^[A-Z0-9-]{2,32}$/.test(code);
}

/**
 * "Bomet County Government" + KE -> "KE-BCG". Initials of the first three
 * words, prefixed by the country, matching the lovable reference.
 */
export function deriveAccountCode(name: string, countryCode: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0])
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  if (!initials) return '';
  return countryCode ? `${countryCode.toUpperCase()}-${initials}` : initials;
}
