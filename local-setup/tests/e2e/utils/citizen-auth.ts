/**
 * Citizen sign-in for the e2e specs: phone OTP through the Identity BFF,
 * with the deployment's fixed test code (IDENTITY_TEST_OTP_CODE). The BFF
 * creates the citizen on its first sign-in, so specs do not seed one.
 *
 * Every OTP send counts against the BFF's hourly send limits (5 per phone and
 * 20 per IP by default), so a worker signs each phone in once and later specs
 * reuse that BFF session, as the integration suite's citizen fixture does.
 */
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { citizenSignIn, configuredOtp, otpRateLimitError, requiredEnv, surfacePath } from './identity';
import { generateValidMobile, getMobileValidationRule } from '../common/mdms-mobile';

export interface CitizenSession {
  token: string;
  userInfo: Record<string, unknown> & { uuid: string; tenantId: string };
}

let runMobile: Promise<string> | undefined;

/** One new citizen per run, valid for the tenant's mobile rule. */
export function runCitizenMobile(): Promise<string> {
  runMobile ??= getMobileValidationRule(requiredEnv('DIGIT_TENANT')).then(generateValidMobile);
  return runMobile;
}

/** BFF citizen sessions this worker signed in, by phone. */
const bffSessions = new Map<string, Awaited<ReturnType<BrowserContext['cookies']>>>();

/** Sign in through the real phone and code steps (#login-mobile, then the code box). This always sends an OTP. */
export async function citizenOtpLogin(page: Page, mobile?: string): Promise<CitizenSession> {
  const phone = mobile ?? await runCitizenMobile();
  await page.goto(surfacePath('citizen', 'login'), { waitUntil: 'domcontentloaded' });
  await page.locator('#login-mobile').fill(phone);
  const submit = page.locator('form button[type="submit"]');
  const sendCode = async () => {
    const sent = page.waitForResponse(r => new URL(r.url()).pathname === '/identity/v1/citizen/otp/_send');
    await submit.click();
    return sent;
  };
  let sent = await sendCode();
  // A citizen signed in moments ago is inside the resend cooldown: wait it out once.
  const retryAfter = Number(sent.headers()['retry-after']);
  if (sent.status() === 429 && Number.isFinite(retryAfter) && retryAfter <= 60) {
    await page.waitForTimeout(retryAfter * 1000 + 500);
    sent = await sendCode();
  }
  if (sent.status() === 429) throw otpRateLimitError(await sent.json().catch(() => null), sent.headers()['retry-after']);
  expect(sent.status(), 'OTP send was refused').toBe(202);
  // The first of the six boxes takes the whole code and fills the rest.
  await page.locator('input[maxlength="6"]').fill(configuredOtp());
  await submit.click();
  const session = await storedCitizenSession(page);
  bffSessions.set(phone, await page.context().cookies());
  return session;
}

/**
 * The same session without the form, for specs where sign-in is only a
 * prerequisite. Reuses this worker's BFF session for the phone while it is
 * live, so only the first call sends an OTP.
 */
export async function citizenLoginViaApi(page: Page, mobile?: string): Promise<CitizenSession> {
  const phone = mobile ?? await runCitizenMobile();
  const baseURL = requiredEnv('BASE_URL');
  const saved = bffSessions.get(phone);
  if (saved) await page.context().addCookies(saved);
  const live = saved && await page.request.get(`${baseURL}/identity/v1/session?surface=citizen`)
    .then(async r => r.ok() && (await r.json()).authenticated === true).catch(() => false);
  if (!live) {
    await citizenSignIn(page.request, baseURL, phone);
    bffSessions.set(phone, await page.context().cookies());
  }
  // The SPA exchanges the BFF cookie for its own DIGIT session on the login route.
  await page.goto(surfacePath('citizen', 'login'), { waitUntil: 'domcontentloaded' });
  return storedCitizenSession(page);
}

async function storedCitizenSession(page: Page): Promise<CitizenSession> {
  let session: CitizenSession | null = null;
  await expect.poll(async () => {
    if (/\/citizen\/login(?:\/|$)/.test(new URL(page.url()).pathname)) return false;
    // The SPA may still be navigating to the citizen home; retry until it settles.
    session = await page.evaluate(() => {
      const token = localStorage.getItem('Citizen.token');
      return token ? { token, userInfo: JSON.parse(localStorage.getItem('Citizen.user-info') || '{}') } : null;
    }).catch(() => null);
    return session !== null;
  }, { message: 'citizen sign-in must leave /citizen/login with a stored session', timeout: 30_000 }).toBe(true);
  return session!;
}
