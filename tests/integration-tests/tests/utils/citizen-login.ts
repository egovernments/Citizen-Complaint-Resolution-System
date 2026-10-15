/** Citizen sign-in uses the BFF challenge, cookie and tenant-bound context. */
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL } from './env';
import { readProvisionedCitizen } from './citizen-provision';
import { citizenSignIn, configuredOtp, identityJson, resolveTenant, selectContext, surfacePath, type DigitContext } from './identity-bff';

/** localStorage read that survives the SPA navigating mid-poll. */
const hasCitizenToken = (page: Page) =>
  page.evaluate(() => Boolean(localStorage.getItem('Citizen.token'))).catch(() => false);

type SessionCookies = Parameters<BrowserContext['addCookies']>[0];
/**
 * BFF sessions of the phones this worker has signed in. Signing the same phone
 * in again (a serial spec's next test gets a fresh page) reuses its session
 * instead of sending a new code, which the BFF refuses inside its per-phone
 * cooldown (429 OTP_RESEND_TOO_SOON).
 */
const phoneSessions = new Map<string, SessionCookies>();

export async function citizenLoginViaApi(page: Page, phone?: string): Promise<void> {
  const fixture = readProvisionedCitizen();
  const mobile = phone || fixture?.mobile;
  if (!mobile) throw new Error('Citizen fixture missing: run citizen-setup or supply a phone');
  // Reuse the fixture citizen's BFF session when it is still live: every OTP
  // send counts against the BFF's per-phone (5/h) and per-IP (20/h) limits.
  // citizen-setup records them as `sessionCookies` (#2454; absent before it).
  const fixtureCookies = (fixture as unknown as { sessionCookies?: SessionCookies } | null)?.sessionCookies;
  const cookies = phoneSessions.get(mobile) ?? (mobile === fixture?.mobile ? fixtureCookies : undefined);
  let context: DigitContext | null = null;
  if (cookies?.length) {
    await page.context().addCookies(cookies);
    const tenant = await resolveTenant(page.request, BASE_URL);
    context = await selectContext(page.request, BASE_URL, 'citizen', tenant.tenantId).catch(() => null);
  }
  context ??= await citizenSignIn(page.request, BASE_URL, mobile);
  phoneSessions.set(mobile, await page.context().cookies());
  // The real SPA completes its session/context bootstrap and writes its own storage.
  await page.goto(`${BASE_URL}${surfacePath('citizen', 'login')}`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => hasCitizenToken(page)).toBe(true);
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('Citizen.user-info') || '{}'));
  expect(stored.uuid).toBe(context.UserRequest.uuid);
}

export async function citizenOtpLogin(page: Page, phone?: string): Promise<void> {
  return citizenLoginViaApi(page, phone);
}

/** UI coverage must drive both forms; it does not call the API helper or rewrite runtime config. */
export async function citizenOtpLoginViaUI(page: Page, phone: string): Promise<void> {
  const tenant = await resolveTenant(page.request, BASE_URL);
  await page.goto(`${BASE_URL}${surfacePath('citizen', 'login')}`, { waitUntil: 'domcontentloaded' });
  await page.locator('input#login-mobile').fill(phone);
  const requestedAt = Date.now();
  const sent = page.waitForResponse(r => new URL(r.url()).pathname === '/identity/v1/citizen/otp/_send' && r.request().method() === 'POST');
  await page.getByRole('button', { name: /continue|next|send.*(?:otp|code)/i }).first().click();
  const challenge = await identityJson<{ challengeId: string }>(await sent, 202);
  const code = await configuredOtp({ challengeId: challenge.challengeId, mobileNumber: phone, tenantId: tenant.tenantId, requestedAt });
  const inputs = page.locator('input[autocomplete="one-time-code"], input[name="otp"], input[inputmode="numeric"]');
  await expect(inputs.first()).toBeVisible();
  const count = await inputs.count();
  if (count === 1) await inputs.fill(code);
  else {
    expect(count, 'OTP form must expose one input or six digit inputs').toBe(6);
    for (let i = 0; i < count; i++) await inputs.nth(i).fill(code[i]);
  }
  const selected = page.waitForResponse(r => new URL(r.url()).pathname === '/identity/v1/contexts/citizen/_select' && r.request().method() === 'POST');
  // SelectOtp's submit is CS_COMMONS_NEXT ("Next"), falling back to "Continue".
  await page.getByRole('button', { name: /verify|continue|next|sign in|login/i }).first().click();
  expect((await selected).status()).toBe(200);
  await expect.poll(() => hasCitizenToken(page)).toBe(true);
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
}
