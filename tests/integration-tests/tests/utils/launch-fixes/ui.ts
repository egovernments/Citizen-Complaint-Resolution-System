import { Page, expect } from '@playwright/test';
import { BASE_URL, ROOT_TENANT } from '../env';

// NAIPEPEA_BASE is an explicit override for the legacy demo host; default to the
// suite's resolved target rather than that host, which is dead and made every
// caller silently test nothing.
const BASE = process.env.NAIPEPEA_BASE ?? BASE_URL;

// Minimal employee login — UI form, not API. Use this for tests that
// need a real session in browser localStorage (DIGIT-UI reads tenant +
// authToken from there).
export async function loginEmployeeUI(page: Page, username = 'ADMIN', password = 'eGov@123', tenantId = ROOT_TENANT) {
  await page.goto(`${BASE}/digit-ui/employee/user/login`);
  // The login form has username + password + tenant inputs. The exact
  // selectors live in packages/modules/core/src/pages/employee/Login.
  await page.getByPlaceholder(/user.?name|username/i).fill(username);
  await page.getByPlaceholder(/password/i).fill(password);
  // Tenant input is a dropdown / text — populate via label+input.
  const tenantField = page.locator('input[name="tenantId" i], input[placeholder*="tenant" i]').first();
  if (await tenantField.count()) await tenantField.fill(tenantId);
  await page.getByRole('button', { name: /sign.?in|continue|login/i }).first().click();
  // Wait for either the inbox or the city-pick page.
  await page.waitForURL(/digit-ui\/employee/, { timeout: 30_000 });
}

// Citizen login uses Mobile OTP. We bypass the full OTP flow by reading
// the most-recent OTP from the egov-user otp_v1 table over SSH (the box
// uses test mode — no SMS gateway wired up). Tests inject the OTP into
// the form. If your runner doesn't have ssh access to naipepea, use a
// fixed mobile + skip-otp helper.
export async function citizenSendOtp(mobile: string) {
  const r = await fetch(`${BASE}/otp/v1/_send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otp: { mobileNumber: mobile, tenantId: ROOT_TENANT, userType: 'REGISTER', type: 'register' },
      RequestInfo: { apiId: 'Rainmaker', authToken: '' },
    }),
  });
  return r.json();
}

export async function expectNoOnPage(page: Page, text: RegExp | string) {
  await expect(page.getByText(text)).toHaveCount(0);
}
