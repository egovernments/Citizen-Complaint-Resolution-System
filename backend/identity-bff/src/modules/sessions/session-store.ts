import { createHash, randomBytes } from "node:crypto";
import { currentPersonLease, personLeaseKey, withPersonLease, LeaseLostError, type PersonLease } from "../accounts/person-lease.js";
import { privateRef } from "../citizen-otp/otp-store.js";
import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";
import type { IdentityTokenSet, KeycloakClaims } from "../authentication/types.js";
import type {
  IdentityAuthIntent,
  IdentityAuthResult,
} from "../authentication/types.js";
import type { IdentitySession, SelectedIdentityContext, SessionBinding } from "./types.js";
import {
  DEFAULT_SURFACE,
  isTenantBoundSurface,
  parseSurface,
  sessionCookieName,
  type BoundTenant,
  type IdentitySurface,
} from "../authentication/surfaces.js";

export interface IdentityProfileDraft {
  email: string;
  firstName: string;
  lastName: string;
}

export interface LoginAttempt {
  codeVerifier: string;
  nonce: string;
  oidcClientId: string;
  intent: IdentityAuthIntent;
  methodId: string;
  returnTo: string;
  requiresLoginCookie: boolean;
  identityProfileDraft?: IdentityProfileDraft;
  /** Absent on attempts created before #2167, which were all configurator. */
  surface?: IdentitySurface;
  /** Resolved before the redirect; required for employee/citizen attempts. */
  boundTenant?: BoundTenant;
}

export interface PasswordSetupAttempt {
  returnTo: string;
  userId: string;
  hadPassword: boolean;
}

function randomId(): string {
  return randomBytes(32).toString("base64url");
}

function loginKey(state: string): string {
  return `${config.cachePrefix}:identity:login:${state}`;
}

export function sessionKey(sessionId: string): string {
  return `${config.cachePrefix}:identity:session:${sessionId}`;
}

function authResultKey(id: string): string {
  return `${config.cachePrefix}:identity:auth-result:${id}`;
}

function passwordSetupKey(id: string): string {
  return `${config.cachePrefix}:identity:password-setup:${id}`;
}

export function contextKey(sessionId: string): string {
  return `${config.cachePrefix}:identity:context:${sessionId}`;
}

export const revocationGenerationKey = (subject: string) => `${config.cachePrefix}:identity:revgen:${subject}`;
export const personSessionsKey = (subject: string) => `${config.cachePrefix}:identity:person-sessions:${subject}`;

export class SessionRevokedError extends Error {
  readonly status = 401;
  readonly code = "SESSION_REVOKED";
  constructor() { super("This session has ended; sign in again"); }
}

export async function requireCurrentSession(lease: PersonLease, sessionId: string): Promise<IdentitySession> {
  await lease.assertHeld();
  const session = await getIdentitySession(sessionId);
  if (!session || session.claims.sub !== lease.subject || session.sessionExpiresAt <= Date.now()) throw new SessionRevokedError();
  return session;
}

// Fence, generation check, update-only write and session index are one Redis effect.
const WRITE_SESSION = `
if redis.call('get', KEYS[1]) ~= ARGV[1] then return -1 end
if tonumber(redis.call('get', KEYS[3]) or '0') ~= tonumber(ARGV[3]) then return 0 end
if ARGV[5] == 'NX' then
  if redis.call('exists', KEYS[2]) == 1 then return 0 end
else
  local raw = redis.call('get', KEYS[2])
  if not raw then return 0 end
  local previous = cjson.decode(raw)
  if tonumber(previous.revocationGeneration or 0) ~= tonumber(ARGV[3]) then return 0 end
end
local result
if ARGV[4] == 'KEEP' then
  result = redis.call('set', KEYS[2], ARGV[2], 'XX', 'KEEPTTL')
else
  result = redis.call('set', KEYS[2], ARGV[2], ARGV[5], 'PXAT', ARGV[4])
end
if not result then return 0 end
redis.call('sadd', KEYS[4], ARGV[6])
local ttl = redis.call('pttl', KEYS[2])
if redis.call('pttl', KEYS[4]) < ttl then redis.call('pexpire', KEYS[4], ttl) end
return 1`;

async function writeSessionRecord(lease: PersonLease, sessionId: string, session: IdentitySession, expiry: number | "KEEP", mode: "NX" | "XX"): Promise<void> {
  const result = await getRedis().eval(WRITE_SESSION, 4, personLeaseKey(lease.subject), sessionKey(sessionId),
    revocationGenerationKey(lease.subject), personSessionsKey(lease.subject), lease.token,
    JSON.stringify(session), session.revocationGeneration ?? 0, expiry, mode, sessionId);
  if (result === -1) throw new LeaseLostError();
  if (result !== 1) throw new SessionRevokedError();
}

export async function createLoginAttempt(input: {
  oidcClientId: string;
  intent: IdentityAuthIntent;
  methodId: string;
  returnTo: string;
  requiresLoginCookie?: boolean;
  identityProfileDraft?: IdentityProfileDraft;
  surface?: IdentitySurface;
  boundTenant?: BoundTenant;
}): Promise<{
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  nonce: string;
}> {
  const state = randomId();
  const codeVerifier = randomId();
  const nonce = randomId();
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  await getRedis().set(
    loginKey(state),
    JSON.stringify({
      codeVerifier,
      nonce,
      requiresLoginCookie: input.requiresLoginCookie !== false,
      ...input,
    } satisfies LoginAttempt),
    "EX",
    config.identityLoginTtlSeconds,
  );
  return { state, codeVerifier, codeChallenge, nonce };
}

function validBoundTenant(value: unknown): value is BoundTenant {
  const tenant = value as BoundTenant | undefined;
  return typeof tenant === "object" && tenant !== null &&
    typeof tenant.urlSlug === "string" && Boolean(tenant.urlSlug) &&
    typeof tenant.tenantId === "string" && Boolean(tenant.tenantId) &&
    typeof tenant.rootTenantId === "string" && Boolean(tenant.rootTenantId) &&
    typeof tenant.name === "string";
}

/** Surface bindings must be internally consistent or the record is discarded. */
function validBinding(surfaceValue: unknown, boundTenant: unknown): boolean {
  const surface = parseSurface(surfaceValue);
  if (!surface) return false;
  return isTenantBoundSurface(surface)
    ? validBoundTenant(boundTenant)
    : boundTenant === undefined;
}

export function attemptSurface(attempt: Pick<LoginAttempt, "surface">): IdentitySurface {
  return attempt.surface || DEFAULT_SURFACE;
}

function parseLoginAttempt(raw: string | null): LoginAttempt | null {
  if (!raw) return null;
  try {
    const attempt = JSON.parse(raw) as LoginAttempt;
    if (!validBinding(attempt.surface, attempt.boundTenant)) return null;
    const profileDraft = attempt.identityProfileDraft;
    const validProfileDraft = profileDraft === undefined || (
      typeof profileDraft.email === "string" &&
      typeof profileDraft.firstName === "string" &&
      typeof profileDraft.lastName === "string"
    );
    return typeof attempt.codeVerifier === "string" &&
      typeof attempt.nonce === "string" &&
      typeof attempt.oidcClientId === "string" &&
      (attempt.intent === "signin" || attempt.intent === "signup") &&
      typeof attempt.methodId === "string" &&
      typeof attempt.returnTo === "string" &&
      typeof attempt.requiresLoginCookie === "boolean" &&
      validProfileDraft ? attempt : null;
  } catch {
    return null;
  }
}

export async function getLoginAttempt(state: string): Promise<LoginAttempt | null> {
  return parseLoginAttempt(await getRedis().get(loginKey(state)));
}

export async function consumeLoginAttempt(
  state: string,
): Promise<LoginAttempt | null> {
  return parseLoginAttempt(await getRedis().getdel(loginKey(state)));
}

export async function createAuthResult(result: IdentityAuthResult): Promise<string> {
  const id = randomId();
  await getRedis().set(
    authResultKey(id),
    JSON.stringify(result),
    "EX",
    config.identityAuthResultTtlSeconds,
  );
  return id;
}

export async function consumeAuthResult(id: string): Promise<IdentityAuthResult | null> {
  const raw = await getRedis().getdel(authResultKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as IdentityAuthResult;
  } catch {
    return null;
  }
}

export async function createPasswordSetupAttempt(
  attempt: PasswordSetupAttempt,
): Promise<string> {
  const id = randomId();
  await getRedis().set(
    passwordSetupKey(id),
    JSON.stringify(attempt),
    "EX",
    // The action token may be opened just before its own expiry and then use a
    // full Keycloak browser-login session to finish. Keep correlation state
    // for both windows rather than expiring it while the form is still valid.
    config.identityPasswordSetupTtlSeconds + config.identityLoginTtlSeconds,
  );
  return id;
}

function parsePasswordSetupAttempt(raw: string | null): PasswordSetupAttempt | null {
  if (!raw) return null;
  try {
    const attempt = JSON.parse(raw) as PasswordSetupAttempt;
    return typeof attempt.returnTo === "string" &&
      typeof attempt.userId === "string" &&
      typeof attempt.hadPassword === "boolean" ? attempt : null;
  } catch {
    return null;
  }
}

export async function getPasswordSetupAttempt(
  id: string,
): Promise<PasswordSetupAttempt | null> {
  return parsePasswordSetupAttempt(await getRedis().get(passwordSetupKey(id)));
}

export async function consumePasswordSetupAttempt(
  id: string,
): Promise<PasswordSetupAttempt | null> {
  return parsePasswordSetupAttempt(await getRedis().getdel(passwordSetupKey(id)));
}

function sessionTtl(tokens: IdentityTokenSet): number {
  const tokenTtl = tokens.refreshExpiresIn || tokens.accessExpiresIn;
  return Math.max(1, Math.min(config.identitySessionTtlSeconds, tokenTtl));
}

export async function createIdentitySession(
  tokens: IdentityTokenSet,
  claims: KeycloakClaims,
  oidcClientId: string,
  binding: SessionBinding = {},
): Promise<{ sessionId: string; maxAge: number }> {
  const sessionId = randomId();
  const maxAge = sessionTtl(tokens);
  await writeIdentitySession(
    sessionId, tokens, claims, maxAge, oidcClientId, undefined, binding, true,
  );
  return { sessionId, maxAge };
}

async function writeIdentitySession(
  sessionId: string,
  tokens: IdentityTokenSet,
  claims: KeycloakClaims,
  ttl = sessionTtl(tokens),
  oidcClientId?: string,
  sessionExpiresAt = Date.now() + ttl * 1000,
  binding: SessionBinding = {},
  create = false,
): Promise<void> {
  return withPersonLease(claims.sub, async (lease) => {
    const previous = create ? null : await requireCurrentSession(lease, sessionId);
    if (binding.surface && !validBinding(binding.surface, binding.boundTenant)) {
      throw new Error("Invalid identity session surface binding");
    }
    const now = Date.now();
    const session: IdentitySession = {
      claims,
      schemaVersion: 2,
      revocationGeneration: previous?.revocationGeneration ?? Number(await getRedis().get(revocationGenerationKey(claims.sub)) || 0),
      createdAt: previous?.createdAt ?? now,
      lastSeenAt: now,
      kcSessionId: (claims as KeycloakClaims & { sid?: string }).sid ?? previous?.kcSessionId,
      ...(claims.phone_number && { phoneRef: privateRef("phone", claims.phone_number) }),
      ...(oidcClientId && { oidcClientId }),
      // Configurator is the default surface and needs no tenant binding.
      ...(binding.surface && binding.surface !== DEFAULT_SURFACE && {
        surface: binding.surface,
        boundTenant: binding.boundTenant,
      }),
      ...(binding.authMethod && { authMethod: binding.authMethod, identityCheckedAt: now }),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: now + tokens.accessExpiresIn * 1000,
      refreshExpiresAt: tokens.refreshExpiresIn
        ? now + tokens.refreshExpiresIn * 1000
        : undefined,
      sessionExpiresAt,
    };
    await writeSessionRecord(lease, sessionId, session, Math.min(sessionExpiresAt, now + ttl * 1000), create ? "NX" : "XX");
  });
}

/** Refresh is update-only. Only createIdentitySession/createPhoneOtpSession create records. */
export async function saveIdentitySession(
  sessionId: string, tokens: IdentityTokenSet, claims: KeycloakClaims,
  ttl = sessionTtl(tokens), oidcClientId?: string,
  sessionExpiresAt = Date.now() + ttl * 1000, binding: SessionBinding = {},
): Promise<void> {
  return writeIdentitySession(sessionId, tokens, claims, ttl, oidcClientId, sessionExpiresAt, binding);
}

/**
 * A citizen session proved by a BFF phone OTP (#2189). It carries the same
 * claims `contexts/citizen/_select` reads from a Keycloak-issued citizen
 * session, so that route stays unchanged, but no Keycloak token.
 */
export async function createPhoneOtpSession(input: {
  subject: string;
  name: string;
  phoneNumber: string;
  boundTenant: BoundTenant;
}): Promise<{ sessionId: string; maxAge: number }> {
  const sessionId = randomId();
  const maxAge = config.identitySessionTtlSeconds;
  await writeIdentitySession(
    sessionId,
    { accessToken: "", accessExpiresIn: maxAge },
    {
      sub: input.subject,
      email: "",
      name: input.name,
      phone_number: input.phoneNumber,
      phone_number_verified: true,
      azp: config.keycloakCitizenClientId,
    },
    maxAge,
    config.keycloakCitizenClientId,
    undefined,
    { surface: "citizen", boundTenant: input.boundTenant, authMethod: "phone_otp" },
    true,
  );
  return { sessionId, maxAge };
}

/** Rewrites a session record without changing its expiry. */
export async function touchIdentitySession(sessionId: string, session: IdentitySession): Promise<void> {
  await withPersonLease(session.claims.sub, async (lease) => {
    const fresh = await requireCurrentSession(lease, sessionId);
    if ((fresh.revocationGeneration ?? 0) !== (session.revocationGeneration ?? 0)) throw new SessionRevokedError();
    await writeSessionRecord(lease, sessionId, { ...session, lastSeenAt: Date.now() }, "KEEP", "XX");
  });
}

export async function getIdentitySession(
  sessionId: string,
): Promise<IdentitySession | null> {
  const raw = await getRedis().get(sessionKey(sessionId));
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as IdentitySession;
    if (session.surface !== undefined &&
        !validBinding(session.surface, session.boundTenant)) return null;
    const generation = Number(await getRedis().get(revocationGenerationKey(session.claims.sub)) || 0);
    if ((session.revocationGeneration ?? 0) !== generation) return null;
    return session;
  } catch {
    return null;
  }
}

export function identitySessionSurface(session: IdentitySession): IdentitySurface {
  return session.surface || DEFAULT_SURFACE;
}

export async function deleteIdentitySession(sessionId: string): Promise<void> {
  const raw = await getRedis().get(sessionKey(sessionId));
  const subject = raw ? (JSON.parse(raw) as IdentitySession).claims.sub : undefined;
  const transaction = getRedis().multi().del(sessionKey(sessionId), contextKey(sessionId));
  if (subject) transaction.srem(personSessionsKey(subject), sessionId);
  await transaction.exec();
}

export async function getSelectedIdentityContext(
  sessionId: string,
): Promise<SelectedIdentityContext | null> {
  if (!await getIdentitySession(sessionId)) return null;
  const raw = await getRedis().get(contextKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SelectedIdentityContext;
  } catch {
    return null;
  }
}

export async function saveSelectedIdentityContext(
  sessionId: string,
  context: SelectedIdentityContext,
): Promise<boolean> {
  const lease = currentPersonLease();
  const session = await getIdentitySession(sessionId);
  if (!session || (lease && lease.subject !== session.claims.sub)) return false;
  if (!lease) return withPersonLease(session.claims.sub, () => saveSelectedIdentityContext(sessionId, context));
  const result = await getRedis().eval(`
    if redis.call('get', KEYS[1]) ~= ARGV[1] then return -1 end
    local raw = redis.call('get', KEYS[2])
    if not raw then redis.call('del', KEYS[4]); return 0 end
    local session = cjson.decode(raw)
    if tonumber(session.revocationGeneration or 0) ~= tonumber(redis.call('get', KEYS[3]) or '0') then return 0 end
    local ttl = redis.call('pttl', KEYS[2])
    if ttl <= 0 then return 0 end
    redis.call('set', KEYS[4], ARGV[2], 'PX', ttl)
    return 1`, 4, personLeaseKey(lease.subject), sessionKey(sessionId), revocationGenerationKey(lease.subject), contextKey(sessionId), lease.token, JSON.stringify(context));
  if (result === -1) throw new LeaseLostError();
  return result === 1;
}

function cookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === cookieName) {
      return valueParts.join("=") || null;
    }
  }
  return null;
}

export function sessionIdFromCookie(
  cookieHeader?: string,
  surface: IdentitySurface = DEFAULT_SURFACE,
): string | null {
  return cookieValue(cookieHeader, sessionCookieName(surface));
}

export function loginStateFromCookie(
  cookieHeader?: string,
  surface: IdentitySurface = DEFAULT_SURFACE,
): string | null {
  return cookieValue(cookieHeader, `${sessionCookieName(surface)}_login`);
}

function secureFlag(): string {
  return config.identityCookieSecure ? "; Secure" : "";
}

export function sessionCookie(
  sessionId: string,
  maxAge: number,
  surface: IdentitySurface = DEFAULT_SURFACE,
): string {
  return `${sessionCookieName(surface)}=${sessionId}; Path=/; HttpOnly; SameSite=${config.identityCookieSameSite}; Max-Age=${maxAge}${secureFlag()}`;
}

export function clearedSessionCookie(surface: IdentitySurface = DEFAULT_SURFACE): string {
  return `${sessionCookieName(surface)}=; Path=/; HttpOnly; SameSite=${config.identityCookieSameSite}; Max-Age=0${secureFlag()}`;
}

/**
 * Per-surface login-attempt cookie. Separate names let an employee and a
 * citizen sign-in run in the same browser without clobbering each other's
 * callback binding.
 */
export function loginCookie(state: string, surface: IdentitySurface = DEFAULT_SURFACE): string {
  return `${sessionCookieName(surface)}_login=${state}; Path=/identity/v1/callback; HttpOnly; SameSite=${config.identityCookieSameSite}; Max-Age=${config.identityLoginTtlSeconds}${secureFlag()}`;
}

export function clearedLoginCookie(surface: IdentitySurface = DEFAULT_SURFACE): string {
  return `${sessionCookieName(surface)}_login=; Path=/identity/v1/callback; HttpOnly; SameSite=${config.identityCookieSameSite}; Max-Age=0${secureFlag()}`;
}
