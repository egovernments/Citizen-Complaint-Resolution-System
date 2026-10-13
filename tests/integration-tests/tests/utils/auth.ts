/**
 * DIGIT auth utilities — token acquisition and session injection.
 *
 * Every staff token comes from a Keycloak hosted sign-in plus the BFF's
 * `_select`. That is a full browser login, so getDigitToken() keeps ONE browser
 * per worker and caches each token per (user, tenant, surface) until shortly
 * before it expires: the ~20 call sites that used to launch a Chromium and
 * sign in again each time now cost one sign-in per persona per worker.
 */
import { BASE_URL, IGNORE_HTTPS_ERRORS } from './env';
import { chromium, type Browser, type Page } from '@playwright/test';
import { hostedSignIn, selectContext, surfacePath } from './identity-bff';

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

let browser: Promise<Browser> | null = null;

/** One headless browser per worker, relaunched if it ever goes away. */
function sharedBrowser(): Promise<Browser> {
  if (!browser) {
    const launched = chromium.launch();
    browser = launched;
    launched.then(
      (b) => b.on('disconnected', () => { if (browser === launched) browser = null; }),
      () => { if (browser === launched) browser = null; },
    );
  }
  return browser;
}

/** Close the shared browser, for scripts that must exit (specs need not call it). */
export async function closeSharedBrowser(): Promise<void> {
  const current = browser;
  browser = null;
  if (current) await (await current.catch(() => null))?.close();
}

/** Tokens are reused until this long before they expire. */
const EXPIRY_MARGIN_MS = 2 * 60_000;
const tokens = new Map<string, { token: TokenResponse; expiresAt: number }>();

/** Acquire a DIGIT token through hosted sign-in and the BFF context exchange. */
export async function getDigitToken(config: AuthConfig): Promise<TokenResponse> {
  if (config.userType === 'CITIZEN') throw new Error('Use citizenSignIn for citizen phone possession');
  const baseURL = config.baseURL || BASE_URL;
  const tenant = config.authTenant || config.tenant;
  // In memory only: the password is part of the key so a wrong one never reads a cached token.
  const key = JSON.stringify([baseURL, 'configurator', tenant, config.username, config.password]);
  const hit = tokens.get(key);
  if (hit && hit.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return hit.token;
  const context = await (await sharedBrowser()).newContext({ ignoreHTTPSErrors: IGNORE_HTTPS_ERRORS });
  try {
    const token = await staffContext(await context.newPage(), config, 'configurator');
    tokens.set(key, { token, expiresAt: Date.now() + token.expires_in * 1000 });
    return token;
  } finally {
    await context.close();
  }
}

export async function staffContext(page: Page, config: AuthConfig, surface: 'configurator' | 'employee') {
  if (config.userType === 'CITIZEN') throw new Error('Use citizenSignIn for citizen phone possession');
  if (!config.username || !config.password) {
    throw new Error('No persona credentials: set <ROLE>_LOGIN in the env profile and <ROLE>_PASSWORD in the secrets file');
  }
  const baseURL = config.baseURL || BASE_URL;
  await hostedSignIn(page, { baseURL, surface, username: config.username, password: config.password });
  return selectContext(page.request, baseURL, surface, config.authTenant || config.tenant);
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
