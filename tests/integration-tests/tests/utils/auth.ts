/**
 * DIGIT auth utilities — token acquisition and session injection.
 *
 * Every staff token comes from a Keycloak hosted sign-in plus the BFF's
 * `_select`. The password is posted by passwordSignIn() with Node's fetch, never
 * through a Playwright page or request context: Playwright traces every context
 * a test creates, and a run publishes its traces, step titles and report.json.
 * Tokens are cached per (user, tenant) until shortly before they expire, and a
 * refusal per (user, password) for a while, so one wrong password
 * costs ONE failed login against a realm with brute-force protection, not one
 * per caller. A session is reused per (user, surface) the same way: signing the
 * same person in every few seconds trips Keycloak's temporary lockout.
 */
import { createHash } from 'node:crypto';
import { BASE_URL } from './env';
import { request as playwrightRequest, type Page } from '@playwright/test';
import { IdentityHttpError, KeycloakSessionExpiredError, KeycloakSignInError, passwordSignIn, selectContext, surfacePath, type SignInCookie } from './identity-bff';

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  UserRequest?: Record<string, unknown>;
}

export interface AuthConfig {
  baseURL?: string;
  tenant: string;
  /** Explicit context tenant override retained for existing fixture callers; no parent is derived. */
  authTenant?: string;
  username: string;
  password: string;
  userType?: 'EMPLOYEE' | 'CITIZEN';
}

type StaffSurface = 'configurator' | 'employee';

/** Tokens are reused until this long before they expire. */
const EXPIRY_MARGIN_MS = 2 * 60_000;
const tokens = new Map<string, { token: TokenResponse; expiresAt: number }>();
/**
 * Keycloak refusals, per (user, password) on any surface, kept for a while rather
 * than for the worker's life: "temporarily disabled" clears itself, a wrong
 * password does not. A sign-in Keycloak timed out or restarted is not a
 * refusal (KeycloakSessionExpiredError): it is retried once, never cached.
 */
const REFUSAL_MS = 2 * 60_000;
const refusals = new Map<string, { error: KeycloakSignInError; at: number }>();
/** BFF sessions per (user, surface, password); a dead one is replaced on the next 401. */
const SESSION_MS = 15 * 60_000;
const sessions = new Map<string, { cookies: SignInCookie[]; at: number }>();

/** A digest, not the password: cache keys are only compared, never shown. */
const digest = (password: string) => createHash('sha256').update(password).digest('hex').slice(0, 16);

/**
 * The last Keycloak sign-in queued per user. Two in flight at once (two seeds in
 * a Promise.all, say) trip Keycloak's quick-login check, which disables the user
 * for a minute, so each sign-in waits for the one ahead and reuses its outcome.
 */
const signInQueue = new Map<string, Promise<unknown>>();

/** The BFF session cookies for this persona; a known refusal throws without contacting Keycloak. */
export async function signIn(baseURL: string, surface: StaffSurface, username: string, password: string,
  opts: { fresh?: boolean } = {}): Promise<SignInCookie[]> {
  if (!username || !password) throw new Error(`No credentials for a ${surface} sign-in: set the persona's user and password env vars`);
  const refusalKey = JSON.stringify([baseURL, username, digest(password)]);
  const refused = refusals.get(refusalKey);
  if (refused && Date.now() - refused.at < REFUSAL_MS) throw refused.error;
  const key = JSON.stringify([baseURL, surface, username, digest(password)]);
  const session = sessions.get(key);
  if (!opts.fresh && session && Date.now() - session.at < SESSION_MS) return session.cookies;
  const asked = Date.now();
  const userKey = JSON.stringify([baseURL, username]);
  const turn = (signInQueue.get(userKey) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    // The sign-in ahead may have answered this one already.
    const refusedAhead = refusals.get(refusalKey);
    if (refusedAhead && refusedAhead.at >= asked) throw refusedAhead.error;
    const signedInAhead = sessions.get(key);
    if (signedInAhead && signedInAhead.at >= asked) return signedInAhead.cookies;
    const post = () => passwordSignIn({ baseURL, surface, username, password });
    try {
      const cookies = await post().catch((err) => {
        if (err instanceof KeycloakSessionExpiredError) return post();
        throw err;
      });
      sessions.set(key, { cookies, at: Date.now() });
      return cookies;
    } catch (err) {
      if (err instanceof KeycloakSignInError) refusals.set(refusalKey, { error: err, at: Date.now() });
      throw err;
    }
  });
  signInQueue.set(userKey, turn);
  return turn;
}

/** Retry `run` once on a fresh sign-in when the reused BFF session is gone (401). */
async function withSession<T>(run: (fresh: boolean) => Promise<T>): Promise<T> {
  try {
    return await run(false);
  } catch (err) {
    if (!(err instanceof IdentityHttpError && err.status === 401)) throw err;
    return run(true);
  }
}

/** Persona credentials the BFF has refused the Configurator (CONFIGURATOR_ROLE_REQUIRED): they go straight to the employee surface. */
const employeeOnly = new Set<string>();

/**
 * Acquire a DIGIT token through hosted sign-in and the BFF context exchange.
 *
 * The Configurator surface comes first: it is not bound to a workspace, so one
 * admin can select any tenant. Staff without a configurator role are refused
 * with exactly CONFIGURATOR_ROLE_REQUIRED (#2607) and fall back to the employee
 * surface, which is bound to the workspace IDENTITY_TEST_TENANT_SLUG names.
 */
export async function getDigitToken(config: AuthConfig): Promise<TokenResponse> {
  if (config.userType === 'CITIZEN') throw new Error('Use citizenSignIn for citizen phone possession');
  const baseURL = config.baseURL || BASE_URL;
  const tenant = config.authTenant || config.tenant;
  const key = JSON.stringify([baseURL, tenant, config.username, digest(config.password)]);
  const hit = tokens.get(key);
  if (hit && hit.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return hit.token;
  const select = (surface: StaffSurface) => withSession(async (fresh) => {
    const cookies = await signIn(baseURL, surface, config.username, config.password, { fresh });
    const api = await playwrightRequest.newContext({ storageState: { cookies, origins: [] }, ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS === '1' });
    try {
      return await selectContext(api, baseURL, surface, tenant);
    } finally {
      await api.dispose();
    }
  });
  const personaKey = JSON.stringify([baseURL, config.username, digest(config.password)]);
  let token: TokenResponse;
  if (employeeOnly.has(personaKey)) token = await select('employee');
  else {
    try {
      token = await select('configurator');
    } catch (err) {
      if (!(err instanceof IdentityHttpError && err.code === 'CONFIGURATOR_ROLE_REQUIRED')) throw err;
      employeeOnly.add(personaKey);
      token = await select('employee');
    }
  }
  tokens.set(key, { token, expiresAt: Date.now() + token.expires_in * 1000 });
  return token;
}

/** Sign in without the page, then give the page's context the BFF session and select. */
export async function staffContext(page: Page, config: AuthConfig, surface: StaffSurface) {
  if (config.userType === 'CITIZEN') throw new Error('Use citizenSignIn for citizen phone possession');
  const baseURL = config.baseURL || BASE_URL;
  return withSession(async (fresh) => {
    await page.context().addCookies(await signIn(baseURL, surface, config.username, config.password, { fresh }));
    return selectContext(page.request, baseURL, surface, config.authTenant || config.tenant);
  });
}

/** Keep the caller's BFF cookie and install the selected DIGIT token for business API tests. */
export async function loginViaApi(
  page: import('@playwright/test').Page,
  config: AuthConfig,
): Promise<TokenResponse> {
  const baseURL = config.baseURL || BASE_URL;
  const tokenResponse = await staffContext(page, config, 'employee');

  await page.goto(`${baseURL}${surfacePath('employee', 'user/login')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  // With the BFF cookie, the login page runs its own _select and then replaces
  // itself with the employee home. Writing localStorage or navigating before
  // that lands races it ("Execution context was destroyed", ERR_ABORTED).
  await page.waitForURL((url) => !url.pathname.endsWith('/user/login'), { waitUntil: 'domcontentloaded', timeout: 30_000 });

  await page.evaluate(
    ({ token, userInfo, tenant }) => {
      localStorage.setItem('Employee.token', token);
      localStorage.setItem('Employee.tenant-id', tenant);
      localStorage.setItem('Employee.user-info', JSON.stringify(userInfo));
      localStorage.setItem('Employee.locale', 'en_IN');
      localStorage.setItem('token', token);
      localStorage.setItem('tenant-id', tenant);
      localStorage.setItem('user-info', JSON.stringify(userInfo));
    },
    {
      token: tokenResponse.access_token,
      userInfo: tokenResponse.UserRequest || {},
      tenant: config.tenant,
    },
  );

  await page.goto(`${baseURL}${surfacePath('employee')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  return tokenResponse;
}
