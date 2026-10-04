/** Citizen sign-in uses the BFF challenge, cookie and tenant-bound context. */
import { expect, type Page } from '@playwright/test';
import { BASE_URL } from './env';
import { readProvisionedCitizen } from './citizen-provision';
import { citizenSignIn, configuredOtp, identityJson, resolveTenant, surfacePath } from './identity-bff';

export async function citizenLoginViaApi(page: Page, phone?: string): Promise<void> {
  const mobile = phone || readProvisionedCitizen()?.mobile;
  if (!mobile) throw new Error('Citizen fixture missing: run citizen-setup or supply a phone');
  const context = await citizenSignIn(page.request, BASE_URL, mobile);
  // The real SPA completes its session/context bootstrap and writes its own storage.
  await page.goto(`${BASE_URL}${surfacePath('citizen', 'login')}`, { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => page.evaluate(() => Boolean(localStorage.getItem('Citizen.token')))).toBe(true);
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
  await page.locator('input#login-mobile, input[name="mobileNumber"], input[type="tel"]').first().fill(phone);
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
  await page.getByRole('button', { name: /verify|continue|sign in|login/i }).first().click();
  expect((await selected).status()).toBe(200);
  await expect.poll(async () => page.evaluate(() => Boolean(localStorage.getItem('Citizen.token')))).toBe(true);
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
}
