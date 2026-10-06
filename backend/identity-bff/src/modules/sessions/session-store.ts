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
  accountAction?: { sid: string; sub: string; action: string };
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

const loginKey = (state: string) => `${config.cachePrefix}:identity:login:${state}`;
const authResultKey = (id: string) => `${config.cachePrefix}:identity:auth-result:${id}`;
const passwordSetupKey = (id: string) => `${config.cachePrefix}:identity:password-setup:${id}`;
export const sessionKey = (sessionId: string) => `${config.cachePrefix}:identity:session:${sessionId}`;
export const contextKey = (sessionId: string) => `${config.cachePrefix}:identity:context:${sessionId}`;

/** Short-lived JSON under a fresh random id: login attempts, auth results, password setups. */
async function store(key: (id: string) => string, value: unknown, ttlSeconds: number, id = randomId()): Promise<string> {
  await getRedis().set(key(id), JSON.stringify(value), "EX", ttlSeconds);
  return id;
}

/** Reads (or, single-use, consumes) a stored JSON record; malformed records read as absent. */
async function load<T>(key: string, consume: boolean, valid: (value: T) => boolean = () => true): Promise<T | null> {
  const raw = consume ? await getRedis().getdel(key) : await getRedis().get(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as T;
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

export const revocationGenerationKey = (subject: string) => `${config.cachePrefix}:identity:revgen:${subject}`;
export const personSessionsKey = (subject: string) => `${config.cachePrefix}:identity:person-sessions:${subject}`;
/** Keycloak session id → subject, so a Keycloak session event finds its person without a realm scan. */
export const kcSessionSubjectKey = (kcSessionId: string) => `${config.cachePrefix}:identity:kc-session:${kcSessionId}`;

/** The subject whose BFF session last recorded this Keycloak session id, or null. */
export async function subjectForKcSession(kcSessionId: string): Promise<string | null> {
  return getRedis().get(kcSessionSubjectKey(kcSessionId));
}

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
if ARGV[7] ~= '' then
  local indexTtl = redis.call('pttl', KEYS[5])
  if redis.call('get', KEYS[5]) ~= ARGV[7] or indexTtl < ttl then redis.call('set', KEYS[5], ARGV[7], 'PX', math.max(ttl, indexTtl)) end
end
return 1`;

async function writeSessionRecord(lease: PersonLease, sessionId: string, session: IdentitySession, expiry: number | "KEEP", mode: "NX" | "XX"): Promise<void> {
  // Without a Keycloak sid the index argument is empty and its key is a never-written placeholder.
  const result = await getRedis().eval(WRITE_SESSION, 5, personLeaseKey(lease.subject), sessionKey(sessionId),
    revocationGenerationKey(lease.subject), personSessionsKey(lease.subject), kcSessionSubjectKey(session.kcSessionId || ""), lease.token,
    JSON.stringify(session), session.revocationGeneration ?? 0, expiry, mode, sessionId, session.kcSessionId ? lease.subject : "");
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
  accountAction?: { sid: string; sub: string; action: string };
  surface?: IdentitySurface;
  boundTenant?: BoundTenant;
}): Promise<{
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  nonce: string;
}> {
  const codeVerifier = randomId();
  const nonce = randomId();
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const state = await store(loginKey, {
    codeVerifier,
    nonce,
    requiresLoginCookie: input.requiresLoginCookie !== false,
    ...input,
  } satisfies LoginAttempt, config.identityLoginTtlSeconds);
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

function validLoginAttempt(attempt: LoginAttempt): boolean {
  if (!validBinding(attempt.surface, attempt.boundTenant)) return false;
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
    validProfileDraft;
}

export function getLoginAttempt(state: string): Promise<LoginAttempt | null> {
  return load(loginKey(state), false, validLoginAttempt);
}

export function consumeLoginAttempt(state: string): Promise<LoginAttempt | null> {
  return load(loginKey(state), true, validLoginAttempt);
}

export function createAuthResult(result: IdentityAuthResult): Promise<string> {
  return store(authResultKey, result, config.identityAuthResultTtlSeconds);
}

export function consumeAuthResult(id: string): Promise<IdentityAuthResult | null> {
  return load(authResultKey(id), true);
}

export function createPasswordSetupAttempt(attempt: PasswordSetupAttempt): Promise<string> {
  // The action token may be opened just before its own expiry and then use a
  // full Keycloak browser-login session to finish. Keep correlation state
  // for both windows rather than expiring it while the form is still valid.
  return store(passwordSetupKey, attempt, config.identityPasswordSetupTtlSeconds + config.identityLoginTtlSeconds);
}

const validPasswordSetupAttempt = (attempt: PasswordSetupAttempt) =>
  typeof attempt.returnTo === "string" && typeof attempt.userId === "string" && typeof attempt.hadPassword === "boolean";

export function getPasswordSetupAttempt(id: string): Promise<PasswordSetupAttempt | null> {
  return load(passwordSetupKey(id), false, validPasswordSetupAttempt);
}

export function consumePasswordSetupAttempt(id: string): Promise<PasswordSetupAttempt | null> {
  return load(passwordSetupKey(id), true, validPasswordSetupAttempt);
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
  await saveIdentitySession(
    sessionId, tokens, claims, maxAge, oidcClientId, undefined, binding, true,
  );
  return { sessionId, maxAge };
}

/** A token's `auth_time` (s) as ms; a refresh without the claim keeps the stored value. */
function authTimeOf(claims: KeycloakClaims, previous: IdentitySession | null): number | undefined {
  return typeof claims.auth_time === "number" && Number.isFinite(claims.auth_time) ? claims.auth_time * 1000 : previous?.authTime;
}

/** Refresh is update-only: only createIdentitySession/createPhoneOtpSession pass `create`. */
export async function saveIdentitySession(
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
      ...(authTimeOf(claims, previous) !== undefined && { authTime: authTimeOf(claims, previous) }),
      kcSessionId: claims.sid ?? previous?.kcSessionId,
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
  await saveIdentitySession(
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

/**
 * Rewrites a session record without changing its expiry. Only an existing,
 * unrevoked record is rewritten (`XX`): a logout or revocation that ended it
 * meanwhile is never undone. Returns false, without throwing, when the
 * session has ended, so the caller can treat it as signed out.
 *
 * `session` only pins the revocation generation the caller saw. The write
 * starts from the record re-read under the lease, so a change made since the
 * caller's read (rotated tokens, a phone proof) is never reverted; `update`
 * applies the caller's own change to that fresh copy.
 */
export async function touchIdentitySession(
  sessionId: string,
  session: IdentitySession,
  update: (fresh: IdentitySession) => IdentitySession = fresh => fresh,
): Promise<boolean> {
  return withPersonLease(session.claims.sub, async (lease) => {
    try {
      const fresh = await requireCurrentSession(lease, sessionId);
      if ((fresh.revocationGeneration ?? 0) !== (session.revocationGeneration ?? 0)) return false;
      await writeSessionRecord(lease, sessionId, { ...update(fresh), lastSeenAt: Date.now() }, "KEEP", "XX");
      return true;
    } catch (error) {
      if (error instanceof SessionRevokedError) return false;
      throw error;
    }
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

/** Public session metadata only; expired/revoked index entries are pruned. */
export async function listPersonSessions(subject: string): Promise<Array<{
  sessionId: string; surface: IdentitySurface; oidcClientId?: string;
  createdAt?: number; lastSeenAt?: number; kcSessionId?: string;
}>> {
  const sessions = [];
  for (const sessionId of await getRedis().smembers(personSessionsKey(subject))) {
    const session = await getIdentitySession(sessionId);
    if (!session || session.claims.sub !== subject || session.sessionExpiresAt <= Date.now()) {
      await getRedis().srem(personSessionsKey(subject), sessionId);
      continue;
    }
    sessions.push({ sessionId, surface: identitySessionSurface(session), oidcClientId: session.oidcClientId,
      createdAt: session.createdAt, lastSeenAt: session.lastSeenAt, kcSessionId: session.kcSessionId });
  }
  return sessions;
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

function cookie(name: string, value: string, path: string, maxAge: number): string {
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=${config.identityCookieSameSite}; Max-Age=${maxAge}${config.identityCookieSecure ? "; Secure" : ""}`;
}

export function sessionCookie(
  sessionId: string,
  maxAge: number,
  surface: IdentitySurface = DEFAULT_SURFACE,
): string {
  return cookie(sessionCookieName(surface), sessionId, "/", maxAge);
}

export function clearedSessionCookie(surface: IdentitySurface = DEFAULT_SURFACE): string {
  return cookie(sessionCookieName(surface), "", "/", 0);
}

/**
 * Per-surface login-attempt cookie. Separate names let an employee and a
 * citizen sign-in run in the same browser without clobbering each other's
 * callback binding.
 */
export function loginCookie(state: string, surface: IdentitySurface = DEFAULT_SURFACE): string {
  return cookie(`${sessionCookieName(surface)}_login`, state, "/identity/v1/callback", config.identityLoginTtlSeconds);
}

export function clearedLoginCookie(surface: IdentitySurface = DEFAULT_SURFACE): string {
  return cookie(`${sessionCookieName(surface)}_login`, "", "/identity/v1/callback", 0);
}
