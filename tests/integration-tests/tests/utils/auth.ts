/**
 * DIGIT auth utilities — token acquisition and session injection.
 *
 * Every staff token comes from a Keycloak hosted sign-in plus the BFF's
 * `_select`. The password is posted by passwordSignIn() with Node's fetch, never
 * through a Playwright page or request context: Playwright traces every context
 * a test creates, and a run publishes its traces, step titles and report.json.
 * Tokens are cached per (user, tenant, surface) until shortly before they
 * expire, and a refusal per (user, surface) for a while, so one wrong password
 * costs ONE failed login against a realm with brute-force protection, not one
 * per caller. A session is reused per (user, surface) the same way: signing the
 * same person in every few seconds is what tripped Keycloak's temporary
 * lockout on a live run.
 */
import { BASE_URL, IGNORE_HTTPS_ERRORS } from './env';
import { request as playwrightRequest, type Page } from '@playwright/test';
import { KeycloakSignInError, passwordSignIn, selectContext, surfacePath, type SignInCookie } from './identity-bff';

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  UserRequest?: Record<string, unknown>;
}

export interface AuthConfig {
  baseURL?: string;
  /** The root tenant to select. */
  tenant: string;
  /** Explicit context tenant override retained for existing fixture callers; no parent is derived. */
  authTenant?: string;
  /** Keycloak login (email). */
  username: string;
  /** Keycloak password. */
  password: string;
  userType?: 'EMPLOYEE' | 'CITIZEN';
}

type StaffSurface = 'configurator' | 'employee';

/** Tokens are reused until this long before they expire. */
const EXPIRY_MARGIN_MS = 2 * 60_000;
const tokens = new Map<string, { token: TokenResponse; expiresAt: number }>();
/**
 * Keycloak refusals, per (user, surface), kept for a while rather than for the
 * worker's life: "temporarily disabled" clears itself, a wrong password does not.
 */
const REFUSAL_MS = 2 * 60_000;
const refusals = new Map<string, { error: KeycloakSignInError; at: number }>();
/** BFF sessions per (user, surface); a dead one is replaced on the next 401. */
const SESSION_MS = 15 * 60_000;
const sessions = new Map<string, { cookies: SignInCookie[]; at: number }>();

/** The BFF session cookies for this persona; a known refusal throws without contacting Keycloak. */
export async function signIn(baseURL: string, surface: StaffSurface, username: string, password: string,
  opts: { fresh?: boolean } = {}): Promise<SignInCookie[]> {
  if (!username || !password) {
    throw new Error('No persona credentials: set <ROLE>_LOGIN in the env profile and <ROLE>_PASSWORD in the secrets file');
  }
  const key = JSON.stringify([baseURL, surface, username]);
  const refused = refusals.get(key);
  if (refused && Date.now() - refused.at < REFUSAL_MS) throw refused.error;
  const session = sessions.get(key);
  if (!opts.fresh && session && Date.now() - session.at < SESSION_MS) return session.cookies;
  try {
    const cookies = await passwordSignIn({ baseURL, surface, username, password });
    sessions.set(key, { cookies, at: Date.now() });
    return cookies;
  } catch (err) {
    if (err instanceof KeycloakSignInError) refusals.set(key, { error: err, at: Date.now() });
    throw err;
  }
}

/** Retry `run` once on a fresh sign-in when the reused BFF session is gone (401). */
async function withSession<T>(run: (fresh: boolean) => Promise<T>): Promise<T> {
  try {
    return await run(false);
  } catch (err) {
    if (!/HTTP 401/.test(String((err as Error).message))) throw err;
    return run(true);
  }
}

/** Acquire a DIGIT token through hosted sign-in and the BFF context exchange. */
export async function getDigitToken(config: AuthConfig): Promise<TokenResponse> {
  if (config.userType === 'CITIZEN') throw new Error('Use citizenSignIn for citizen phone possession');
  const baseURL = config.baseURL || BASE_URL;
  const tenant = config.authTenant || config.tenant;
  // In memory only: the password is part of the key so a wrong one never reads a cached token.
  const key = JSON.stringify([baseURL, 'configurator', tenant, config.username, config.password]);
  const hit = tokens.get(key);
  if (hit && hit.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return hit.token;
  const token = await withSession(async (fresh) => {
    const cookies = await signIn(baseURL, 'configurator', config.username, config.password, { fresh });
    const api = await playwrightRequest.newContext({ ignoreHTTPSErrors: IGNORE_HTTPS_ERRORS, storageState: { cookies, origins: [] } });
    try {
      return await selectContext(api, baseURL, 'configurator', tenant);
    } finally {
      await api.dispose();
    }
  });
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
