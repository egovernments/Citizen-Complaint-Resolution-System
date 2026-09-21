import { createHash, randomBytes } from "node:crypto";
import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";
import type { IdentityTokenSet, KeycloakClaims } from "../authentication/types.js";
import type {
  IdentityAuthIntent,
  IdentityAuthResult,
} from "../authentication/types.js";
import type { IdentitySession, SelectedIdentityContext } from "./types.js";

interface LoginAttempt {
  codeVerifier: string;
  nonce: string;
  oidcClientId: string;
  intent: IdentityAuthIntent;
  methodId: string;
  returnTo: string;
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

function sessionKey(sessionId: string): string {
  return `${config.cachePrefix}:identity:session:${sessionId}`;
}

function authResultKey(id: string): string {
  return `${config.cachePrefix}:identity:auth-result:${id}`;
}

function passwordSetupKey(id: string): string {
  return `${config.cachePrefix}:identity:password-setup:${id}`;
}

function contextKey(sessionId: string): string {
  return `${config.cachePrefix}:identity:context:${sessionId}`;
}

export async function createLoginAttempt(input: {
  oidcClientId: string;
  intent: IdentityAuthIntent;
  methodId: string;
  returnTo: string;
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
    JSON.stringify({ codeVerifier, nonce, ...input } satisfies LoginAttempt),
    "EX",
    config.identityLoginTtlSeconds,
  );
  return { state, codeVerifier, codeChallenge, nonce };
}

export async function consumeLoginAttempt(
  state: string,
): Promise<LoginAttempt | null> {
  const raw = await getRedis().getdel(loginKey(state));
  if (!raw) return null;
  try {
    const attempt = JSON.parse(raw) as LoginAttempt;
    return typeof attempt.codeVerifier === "string" &&
      typeof attempt.nonce === "string" &&
      typeof attempt.oidcClientId === "string" &&
      (attempt.intent === "signin" || attempt.intent === "signup") &&
      typeof attempt.methodId === "string" &&
      typeof attempt.returnTo === "string" ? attempt : null;
  } catch {
    return null;
  }
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
): Promise<{ sessionId: string; maxAge: number }> {
  const sessionId = randomId();
  const maxAge = sessionTtl(tokens);
  await saveIdentitySession(sessionId, tokens, claims, maxAge, oidcClientId);
  return { sessionId, maxAge };
}

export async function saveIdentitySession(
  sessionId: string,
  tokens: IdentityTokenSet,
  claims: KeycloakClaims,
  ttl = sessionTtl(tokens),
  oidcClientId?: string,
  sessionExpiresAt = Date.now() + ttl * 1000,
): Promise<void> {
  const now = Date.now();
  const session: IdentitySession = {
    claims,
    ...(oidcClientId && { oidcClientId }),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: now + tokens.accessExpiresIn * 1000,
    refreshExpiresAt: tokens.refreshExpiresIn
      ? now + tokens.refreshExpiresIn * 1000
      : undefined,
    sessionExpiresAt,
  };
  await getRedis().set(
    sessionKey(sessionId),
    JSON.stringify(session),
    "EX",
    ttl,
  );
}

export async function getIdentitySession(
  sessionId: string,
): Promise<IdentitySession | null> {
  const raw = await getRedis().get(sessionKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as IdentitySession;
  } catch {
    return null;
  }
}

export async function deleteIdentitySession(sessionId: string): Promise<void> {
  await getRedis().del(sessionKey(sessionId), contextKey(sessionId));
}

export async function getSelectedIdentityContext(
  sessionId: string,
): Promise<SelectedIdentityContext | null> {
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
  const ttl = await getRedis().ttl(sessionKey(sessionId));
  if (ttl <= 0) return false;
  await getRedis().set(
    contextKey(sessionId),
    JSON.stringify(context),
    "EX",
    ttl,
  );
  return true;
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

export function sessionIdFromCookie(cookieHeader?: string): string | null {
  return cookieValue(cookieHeader, config.identityCookieName);
}

export function loginStateFromCookie(cookieHeader?: string): string | null {
  return cookieValue(cookieHeader, `${config.identityCookieName}_login`);
}

export function sessionCookie(sessionId: string, maxAge: number): string {
  const secure = config.identityCookieSecure ? "; Secure" : "";
  return `${config.identityCookieName}=${sessionId}; Path=/; HttpOnly; SameSite=${config.identityCookieSameSite}; Max-Age=${maxAge}${secure}`;
}

export function clearedSessionCookie(): string {
  const secure = config.identityCookieSecure ? "; Secure" : "";
  return `${config.identityCookieName}=; Path=/; HttpOnly; SameSite=${config.identityCookieSameSite}; Max-Age=0${secure}`;
}

export function loginCookie(state: string): string {
  const secure = config.identityCookieSecure ? "; Secure" : "";
  return `${config.identityCookieName}_login=${state}; Path=/identity/v1/callback; HttpOnly; SameSite=${config.identityCookieSameSite}; Max-Age=${config.identityLoginTtlSeconds}${secure}`;
}

export function clearedLoginCookie(): string {
  const secure = config.identityCookieSecure ? "; Secure" : "";
  return `${config.identityCookieName}_login=; Path=/identity/v1/callback; HttpOnly; SameSite=${config.identityCookieSameSite}; Max-Age=0${secure}`;
}
