/** The two overlay UI cases now exercise BFF phone and hosted provider entry. */
import { test, expect } from '@playwright/test';
import { BASE_URL, generateCitizenPhone } from '../utils/env';
import { citizenOtpLoginViaUI } from '../utils/citizen-login';
import { authorizeUrl } from '../utils/identity-bff';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe('Keycloak and citizen BFF browser entry', () => {
  test('mobile + OTP authenticates through BFF and reaches the citizen home', { tag: ['@area:keycloak', '@persona:citizen'] }, async ({ page }) => {
    const paths: string[] = [];
    page.on('request', request => { if (request.method() === 'POST') paths.push(new URL(request.url()).pathname); });
    await citizenOtpLoginViaUI(page, generateCitizenPhone());
    expect(paths).toEqual(expect.arrayContaining(['/identity/v1/citizen/otp/_send', '/identity/v1/citizen/otp/_verify', '/identity/v1/contexts/citizen/_select']));
    expect(paths.some(path => path.startsWith('/token-exchange/') || path === '/user/oauth/token')).toBe(false);
    expect(await page.evaluate(() => Boolean(localStorage.getItem('Citizen.token')))).toBe(true);
  });

  test('Google entry uses BFF authorize and server-owned PKCE', { tag: ['@area:keycloak', '@persona:citizen'] }, async ({ page, request }) => {
    const methods = await request.get(`${BASE_URL}/identity/v1/auth-methods?surface=citizen&intent=signin`);
    expect(methods.status()).toBe(200);
    const offered = (await methods.json()).methods;
    test.skip(!offered?.some((m: { id?: string }) => m.id === 'google'), 'this deployment offers citizens no Google sign-in (/identity/v1/auth-methods)');
    expect(offered).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'google', type: 'idp' })]));
    const kcRequest = page.waitForRequest(r => new URL(r.url()).pathname.endsWith('/protocol/openid-connect/auth'));
    // BFF method entry is stable whether a deployment offers one provider or several.
    await page.goto(authorizeUrl(BASE_URL, 'citizen', 'google'), { waitUntil: 'commit' });
    const url = new URL((await kcRequest).url());
    expect(url.searchParams.get('kc_idp_hint')).toBe('google');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(`${BASE_URL}/identity/v1/callback`);
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  test('Configurator login page shows no Google button when Google is not a sign-in method', { tag: ['@area:keycloak', '@persona:system'] }, async ({ page, request }) => {
    const methods = await request.get(`${BASE_URL}/identity/v1/auth-methods?surface=configurator&intent=signin`);
    test.skip(methods.status() !== 200, 'this deployment does not publish configurator sign-in methods (/identity/v1/auth-methods)');
    const offered: Array<{ id?: string }> = (await methods.json()).methods ?? [];
    test.skip(offered.some(m => m.id === 'google'), 'Google is a configurator sign-in method here, so its button is expected');
    await page.goto(authorizeUrl(BASE_URL, 'configurator'));
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#social-google, a[href*="/broker/google/"]')).toHaveCount(0);
  });
});
