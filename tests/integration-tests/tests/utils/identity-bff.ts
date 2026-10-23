import { expect, test, type APIRequestContext, type APIResponse, type Page, type Request, type Response } from '@playwright/test';

export type Surface = 'configurator' | 'employee' | 'citizen';
export interface DigitContext {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  UserRequest: Record<string, unknown> & { uuid: string; tenantId: string; type: string };
  tenant?: { urlSlug: string; tenantId: string };
}

/** An identity response with an unexpected status, and the BFF's error code (never the body). */
export class IdentityHttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`Identity request failed: HTTP ${status} (${code})`);
  }
}

/** Never include a response body: successful and failed auth responses may hold secrets. */
export async function identityJson<T>(response: Pick<APIResponse, 'status' | 'json'>, status = 200): Promise<T> {
  if (response.status() !== status) {
    const body = await response.json().catch(() => null);
    const code = typeof body?.code === 'string' && /^[A-Z_]+$/.test(body.code) ? body.code : 'UNEXPECTED_RESPONSE';
    throw new IdentityHttpError(response.status(), code);
  }
  return response.json() as Promise<T>;
}

export function tenantSlug(): string {
  const slug = process.env.IDENTITY_TEST_TENANT_SLUG;
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error('Set IDENTITY_TEST_TENANT_SLUG to a seeded ACTIVE workspace slug');
  }
  return slug;
}

export function surfacePath(surface: 'employee' | 'citizen', suffix = ''): string {
  return `/${tenantSlug()}/digit-ui/${surface}/${suffix}`;
}

export async function resolveTenant(request: APIRequestContext, baseURL: string, slug = tenantSlug()) {
  const result = await identityJson<{ tenant: { tenantId: string; urlSlug: string } }>(
    await request.get(`${baseURL}/identity/v1/tenant-contexts/${encodeURIComponent(slug)}`),
  );
  if (!result.tenant?.tenantId || result.tenant.urlSlug !== slug) throw new Error('Invalid tenant route response');
  return result.tenant;
}

export function authorizeUrl(baseURL: string, surface: Surface, method = 'password'): string {
  const params = new URLSearchParams({ surface, method, intent: 'signin' });
  if (surface === 'configurator') params.set('returnTo', '/configurator/login');
  else {
    params.set('tenantSlug', tenantSlug());
    params.set('returnTo', surfacePath(surface, surface === 'employee' ? 'user/login' : 'login'));
  }
  return `${baseURL}/identity/v1/authorize?${params}`;
}

/** Organizations can split username and password across two stock Keycloak pages. */
export async function enterHostedUsername(page: Page, value: string): Promise<void> {
  const username = page.locator('#username');
  await expect(username).toBeVisible();
  await username.fill(value);
  if (!await page.locator('#password').isVisible()) {
    await page.locator('#kc-login, button[type="submit"]').first().click();
  }
  await expect(page.locator('#password')).toBeVisible();
}

/** Keycloak refused the credentials. Retrying only feeds its brute-force detection. */
export class KeycloakSignInError extends Error {}

/**
 * Keycloak ended the sign-in itself: the login timed out, the auth session
 * expired or restarted, or its cookie was lost. Nothing was wrong with the
 * credentials, so one fresh attempt is safe.
 */
export class KeycloakSessionExpiredError extends Error {}

// Keycloak's English messages (the suite's deployments sign in in English):
// expiredCodeMessage "Login timeout…", staleCodeMessage "…no longer valid…",
// and the expired/restarted auth session ones. The login page carries no
// message key, so its text is the only signal.
const SESSION_ENDED = /timed out|timeout|expired|no longer valid|start from the beginning|restart|cookie not found/i;

/** The error for a sign-in Keycloak sent back to its form, by what the page says. */
function refusedWith(username: string, shown: string): KeycloakSignInError | KeycloakSessionExpiredError {
  return SESSION_ENDED.test(shown)
    ? new KeycloakSessionExpiredError(`Keycloak ended the sign-in for ${username}: ${shown}`)
    : new KeycloakSignInError(`Keycloak refused the sign-in for ${username}: ${shown}`);
}

/** Each hosted sign-in request; past it, Keycloak or the BFF is stuck, not slow. */
const SIGN_IN_REQUEST_MS = 30_000;

/** A cookie the BFF or Keycloak set, in the shape BrowserContext.addCookies takes. */
export interface SignInCookie {
  name: string; value: string; domain: string; path: string;
  expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None';
}

// Keycloak's login pages, read from their HTML. The themes render the form with
// JS, so the page's kcContext JSON carries the pageId and the post target.
const unescapeHtml = (v: string) => v.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/&#x3D;/gi, '=').replace(/&#61;/g, '=');
const keycloakPageId = (html: string) => html.match(/pageId"\s*:\s*"([^"]+)"/)?.[1];
function keycloakLoginAction(html: string): string | undefined {
  const match = html.match(/loginAction"\s*:\s*"([^"]+)"/) ?? html.match(/<form[^>]*action="([^"]+)"/);
  return match ? unescapeHtml(match[1]) : undefined;
}
/** The sign-in pages: one page, or identity-first (username, then password). */
const KEYCLOAK_LOGIN_PAGES = new Set(['login', 'login.ftl', 'login-username', 'login-password']);
/** The error Keycloak rendered on the page, if any. */
const keycloakError = (html: string) =>
  unescapeHtml(html.match(/"summary"\s*:\s*"([^"]+)"/)?.[1] ?? html.match(/id="input-error"[^>]*>([^<]+)</)?.[1] ?? 'no message').trim();

/**
 * Hosted sign-in WITHOUT a browser: the Keycloak form is posted with Node's own
 * fetch, which no Playwright context records. Every staff helper signs in this
 * way, because Playwright traces every context and request a test creates, and
 * a password typed or posted there lands in the trace, the step titles and
 * report.json, all of which a run publishes. Returns the BFF session cookies
 * for a context to adopt. A refused password throws KeycloakSignInError after
 * ONE post; a sign-in Keycloak timed out or restarted throws
 * KeycloakSessionExpiredError, which a caller may retry.
 */
export async function passwordSignIn(config: { baseURL: string; surface: Surface; username: string; password: string }): Promise<SignInCookie[]> {
  const jar = new Map<string, SignInCookie>();
  const header = (url: URL) => [...jar.values()]
    .filter((c) => (url.hostname === c.domain || url.hostname.endsWith(`.${c.domain}`)) && url.pathname.startsWith(c.path))
    .map((c) => `${c.name}=${c.value}`).join('; ');
  const store = (raw: string, url: URL) => {
    const [pair, ...attrs] = raw.split(';').map((p) => p.trim());
    const at = pair.indexOf('=');
    const attr = (name: string) => attrs.find((a) => a.toLowerCase().startsWith(`${name}=`))?.slice(name.length + 1);
    const flag = (name: string) => attrs.some((a) => a.toLowerCase() === name);
    const cookie: SignInCookie = { name: pair.slice(0, at), value: pair.slice(at + 1),
      domain: (attr('domain') || url.hostname).replace(/^\./, ''), path: attr('path') || '/', expires: -1,
      httpOnly: flag('httponly'), secure: flag('secure'),
      sameSite: (['Strict', 'Lax', 'None'].find((v) => v.toLowerCase() === attr('samesite')?.toLowerCase()) ?? 'Lax') as SignInCookie['sameSite'] };
    const maxAge = attr('max-age');
    const expires = maxAge !== undefined ? Date.now() / 1000 + Number(maxAge) : attr('expires') ? Date.parse(attr('expires')!) / 1000 : -1;
    const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
    if (expires !== -1 && expires <= Date.now() / 1000) jar.delete(key);
    else jar.set(key, { ...cookie, expires: expires === -1 ? -1 : Math.floor(expires) });
  };
  const go = async (start: string, form?: Record<string, string>) => {
    let url = new URL(start);
    let body = form ? new URLSearchParams(form).toString() : undefined;
    for (let hop = 0; hop < 15; hop++) {
      const cookies = header(url);
      const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'manual', body, signal: AbortSignal.timeout(SIGN_IN_REQUEST_MS),
        headers: { ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(cookies ? { Cookie: cookies } : {}) } });
      for (const raw of response.headers.getSetCookie()) store(raw, url);
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url);
        body = undefined;
        continue;
      }
      return { url, html: await response.text() };
    }
    throw new Error('Hosted sign-in redirected too many times');
  };
  // A login form: Keycloak's pageId (login, login-username, login-password), or a plain form.
  const formOf = (html: string) => {
    const pageId = keycloakPageId(html);
    const action = keycloakLoginAction(html);
    if (pageId && /expired|timeout/i.test(pageId)) throw new KeycloakSessionExpiredError(`Keycloak ended the sign-in for ${config.username} (${pageId})`);
    if (pageId && !KEYCLOAK_LOGIN_PAGES.has(pageId)) throw new Error(`Hosted sign-in stopped on Keycloak page ${pageId}`);
    return action ? { action, kind: pageId ?? `form${/id="username"/.test(html) ? '+user' : ''}${/id="password"/.test(html) ? '+password' : ''}` } : null;
  };
  const origin = new URL(config.baseURL).origin;
  let page = await go(authorizeUrl(config.baseURL, config.surface));
  let posted: string | undefined;
  for (let step = 0; step < 3; step++) {
    const form = formOf(page.html);
    if (!form) break;
    // The same login page again after a post means Keycloak refused the credentials.
    if (form.kind === posted) throw refusedWith(config.username, keycloakError(page.html));
    page = await go(new URL(form.action, page.url).href, { username: config.username, password: config.password });
    posted = form.kind;
  }
  if (page.url.origin !== origin || page.url.pathname.startsWith('/auth/')) throw new Error('Hosted sign-in did not return to the application');
  const resultId = page.url.searchParams.get('authResult');
  if (resultId) {
    const resultUrl = new URL(`${origin}/identity/v1/auth-results/${encodeURIComponent(resultId)}`);
    const result = await fetch(resultUrl, { headers: { Cookie: header(resultUrl) }, signal: AbortSignal.timeout(SIGN_IN_REQUEST_MS) });
    if (result.status !== 200 || (await result.json().catch(() => null))?.status !== 'complete') throw new Error('Hosted sign-in was rejected by the BFF');
  }
  const sessionUrl = new URL(`${origin}/identity/v1/session?surface=${config.surface}`);
  const session = await fetch(sessionUrl, { headers: { Cookie: header(sessionUrl) }, signal: AbortSignal.timeout(SIGN_IN_REQUEST_MS) });
  if (session.status !== 200 || (await session.json().catch(() => null))?.authenticated !== true) {
    throw new Error('Hosted sign-in did not establish a BFF session');
  }
  return [...jar.values()];
}

/**
 * A configured password (any *_PASS or *_PASSWORD in the env) must not be typed
 * into a traced page. Pausing the trace does not help: the step title of a fill
 * carries its value, and the trace's network log keeps the form post's fields
 * whether or not a chunk is recording. Runs that do not trace (the identity-real
 * config) may type them.
 *
 * "Traced" is this test's own setting: the `trace` option after every
 * test.use() override, as the runner resolved it for this test. Playwright
 * exposes that only on testInfo's internal tracing state (`_tracing`), so when
 * that cannot be read the guard fails and says so, rather than guessing.
 */
function assertUntracedOrThrowaway(password: string): void {
  let info: ReturnType<typeof test.info>;
  try {
    info = test.info();
  } catch {
    return; // outside the Playwright runner: nothing records the page
  }
  if (!password) return;
  const configured = Object.entries(process.env).some(([name, value]) => /_PASS(WORD)?$/.test(name) && value === password);
  if (!configured) return;
  const tracing = (info as unknown as { _tracing?: { traceOptions?: () => unknown } })._tracing;
  if (typeof tracing?.traceOptions !== 'function') {
    throw new Error('hostedSignIn cannot determine tracing; Playwright internals changed (testInfo._tracing.traceOptions). ' +
      'Refusing to type a configured password into a page that may be traced.');
  }
  if (tracing.traceOptions() !== undefined) {
    throw new Error('hostedSignIn types the password into a traced page; sign personas in with passwordSignIn() (auth.ts staffContext/loginViaApi)');
  }
}

/**
 * Browser sign-in through the hosted form, for specs that test that form.
 * It TYPES the password on the page, so in a traced test the value lands in
 * the trace, step titles and report.json: throwaway credentials only there,
 * which assertUntracedOrThrowaway() enforces. Persona sign-ins go through
 * passwordSignIn() (auth.ts staffContext/getDigitToken). The landing app owns
 * one-use auth results.
 */
export async function hostedSignIn(page: Page, config: {
  baseURL: string; surface: Surface; username: string; password: string;
}): Promise<void> {
  assertUntracedOrThrowaway(config.password);
  const origin = new URL(config.baseURL).origin;
  let resultId: string | null = null;
  let observedResult: Promise<{ httpStatus: number; body: { status?: string } | null }> | undefined;
  const navigation = (request: Request) => {
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
    const url = new URL(request.url());
    if (url.origin === origin && url.searchParams.has('authResult')) resultId = url.searchParams.get('authResult');
  };
  const response = (event: Response) => {
    const url = new URL(event.url());
    if (resultId && url.origin === origin && url.pathname === `/identity/v1/auth-results/${encodeURIComponent(resultId)}`) {
      // Observe the application's fetch without issuing a competing GETDEL read.
      observedResult = event.json().catch(() => null).then(body => ({ httpStatus: event.status(), body }));
    }
  };
  page.on('request', navigation);
  page.on('response', response);
  try {
    await page.goto(authorizeUrl(config.baseURL, config.surface));
    await enterHostedUsername(page, config.username);
    await page.locator('#password').fill(config.password);
    const consent = page.locator('#privacy-component-check');
    if (await consent.count()) {
      // Employee PrivacyConsent (keycloak/theme-src Privacy.tsx): the transparent
      // input and the styled label's svg overlap, and which one wins the hit-test
      // varies by build (8c gate run 4), so tick the input without the hit-test.
      await consent.check({ force: true });
      await expect(consent).toBeChecked();
    }
    await page.locator('#kc-login, button[type="submit"]').first().click();
    await page.waitForURL(url => url.origin === origin &&
      (url.pathname.startsWith('/configurator/') || url.pathname.includes('/digit-ui/')), { timeout: 30_000 });
    if (resultId) {
      await expect.poll(() => observedResult !== undefined, { message: 'Landing app must consume the one-use auth result', timeout: 30_000 }).toBe(true);
      const result = await observedResult!;
      if (result.httpStatus !== 200 || result.body?.status !== 'complete') {
        throw new Error('Hosted sign-in was rejected by the BFF');
      }
    }
    const session = await identityJson<{ authenticated: boolean }>(
      await page.request.get(`${config.baseURL}/identity/v1/session?surface=${config.surface}`),
    );
    if (session.authenticated !== true) throw new Error('Hosted sign-in did not establish a BFF session');
  } finally {
    page.off('request', navigation);
    page.off('response', response);
  }
}

/** The root tenant egov-user keeps a CITIZEN account at (first dotted segment). */
export function citizenAccountTenantId(tenantId: string) {
  return tenantId.split('.')[0];
}

/** `_select` refusals that say this person has no context at the tenant, not that the BFF failed. */
const CONTEXT_REFUSALS = new Set(['TENANT_CONTEXT_UNAVAILABLE', 'EMPLOYEE_ACCOUNT_NOT_LINKED', 'PENDING_INVITATION', 'DIGIT_ACCOUNT_NOT_FOUND', 'DIGIT_ACCOUNT_INACTIVE', 'CONFIGURATOR_ROLE_REQUIRED']);
export const isContextRefusal = (err: unknown) => err instanceof IdentityHttpError && CONTEXT_REFUSALS.has(err.code);

export async function selectContext(request: APIRequestContext, baseURL: string, surface: Surface, tenantId: string) {
  const path = surface === 'citizen' ? 'contexts/citizen/_select' : 'contexts/_select';
  const body = surface === 'citizen' ? { surface } : { surface, tenantId };
  const context = await identityJson<DigitContext>(await request.post(`${baseURL}/identity/v1/${path}`, {
    headers: { Origin: new URL(baseURL).origin }, data: body,
  }));
  const userType = surface === 'citizen' ? 'CITIZEN' : 'EMPLOYEE';
  // egov-user issues CITIZEN tokens at the state root (`ke.bomet` -> `ke`); the
  // route tenant comes back as `context.tenant`. Employees stay on the tenant.
  const tokenTenant = surface === 'citizen' ? citizenAccountTenantId(tenantId) : tenantId;
  if (!context.access_token || !context.UserRequest?.uuid || context.UserRequest.tenantId !== tokenTenant ||
      context.UserRequest.type !== userType || !Number.isFinite(context.expires_in) || context.expires_in <= 0 ||
      context.token_type?.toLowerCase() !== 'bearer' || context.scope !== 'read' || 'refresh_token' in context ||
      (surface === 'citizen' && context.tenant?.tenantId !== tenantId)) {
    throw new Error('BFF returned an invalid or wrong-tenant DIGIT context');
  }
  return context;
}

export type ReadOtp = (challenge: { challengeId: string; mobileNumber: string; tenantId: string; requestedAt: number }) => Promise<string>;

/** Fixed codes are explicitly opted into; this helper never labels them real non-fixed OTP evidence. */
export const configuredOtp: ReadOtp = async () => {
  const code = process.env.IDENTITY_TEST_OTP_CODE;
  if (!code || !/^\d{6}$/.test(code)) throw new Error('Set IDENTITY_TEST_OTP_CODE for fixed-code fixtures or provide a real delivery reader');
  return code;
};

export async function citizenSignIn(request: APIRequestContext, baseURL: string, mobileNumber: string, readOtp: ReadOtp = configuredOtp, slug?: string) {
  const tenant = await resolveTenant(request, baseURL, slug);
  const headers = { Origin: new URL(baseURL).origin };
  const send = () => request.post(`${baseURL}/identity/v1/citizen/otp/_send`, {
    headers, data: { tenantSlug: tenant.urlSlug, mobileNumber, purpose: 'signin', locale: 'en_IN' },
  });
  let requestedAt = Date.now();
  let sent = await send();
  // A shared citizen fixture may have signed in during the preceding project.
  // Respect the declared cooldown once; never switch authentication mechanisms.
  if (sent.status() === 429) {
    const refusal = await sent.json().catch(() => null);
    const retryAfter = Number(sent.headers()['retry-after']);
    if (refusal?.code === 'OTP_RESEND_TOO_SOON' && Number.isFinite(retryAfter) && retryAfter >= 0 && retryAfter <= 60) {
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000 + 50));
      requestedAt = Date.now();
      sent = await send();
    }
  }
  const challenge = await identityJson<{ challengeId: string }>(sent, 202);
  if (!challenge.challengeId) throw new Error('BFF did not return an OTP challenge');
  const code = await readOtp({ challengeId: challenge.challengeId, mobileNumber, tenantId: tenant.tenantId, requestedAt });
  const verified = await identityJson<{ authenticated: boolean; tenant: typeof tenant }>(
    await request.post(`${baseURL}/identity/v1/citizen/otp/_verify`, {
      headers, data: { tenantSlug: tenant.urlSlug, challengeId: challenge.challengeId, code, purpose: 'signin' },
    }),
  );
  if (!verified.authenticated || verified.tenant?.tenantId !== tenant.tenantId || verified.tenant.urlSlug !== tenant.urlSlug) {
    throw new Error('OTP verification did not establish the expected tenant session');
  }
  // The same request context carries the HttpOnly session cookie from _verify to _select.
  const context = await selectContext(request, baseURL, 'citizen', tenant.tenantId);
  if (context.tenant?.urlSlug !== tenant.urlSlug) throw new Error('Citizen context has the wrong tenant slug');
  return context;
}
