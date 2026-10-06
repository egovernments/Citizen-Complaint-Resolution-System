import { expect, type APIRequestContext, type APIResponse, type Page, type Request, type Response } from '@playwright/test';

export type Surface = 'configurator' | 'employee' | 'citizen';
export interface DigitContext {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  UserRequest: Record<string, unknown> & { uuid: string; tenantId: string; type: string };
  tenant?: { urlSlug: string; tenantId: string };
}

/** Never include a response body: successful and failed auth responses may hold secrets. */
export async function identityJson<T>(response: Pick<APIResponse, 'status' | 'json'>, status = 200): Promise<T> {
  if (response.status() !== status) {
    const body = await response.json().catch(() => null);
    const code = typeof body?.code === 'string' && /^[A-Z_]+$/.test(body.code) ? body.code : 'UNEXPECTED_RESPONSE';
    throw new Error(`Identity request failed: HTTP ${response.status()} (${code})`);
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

/** Credentials go only to the hosted form. The landing app owns one-use auth results. */
export async function hostedSignIn(page: Page, config: {
  baseURL: string; surface: Surface; username: string; password: string;
}): Promise<void> {
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

export async function citizenSignIn(request: APIRequestContext, baseURL: string, mobileNumber: string, readOtp: ReadOtp = configuredOtp) {
  const tenant = await resolveTenant(request, baseURL);
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
