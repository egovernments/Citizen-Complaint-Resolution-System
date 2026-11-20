import { tenantSlug } from '../identity-bff';
import { loginViaApi } from '../auth';
import { Page, expect } from '@playwright/test';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../env';

// The suite's one target. (A NAIPEPEA_BASE override for a dead demo host used to sit here.)
const BASE = BASE_URL;

// Hosted sign-in keeps the BFF cookie alongside the business token.
export async function loginEmployeeUI(page: Page, username = ADMIN_USER, password = ADMIN_PASS, tenantId = ROOT_TENANT) {
  await loginViaApi(page, { baseURL: BASE, username, password, tenant: tenantId });
}

/** Send a BFF challenge; caller must verify it before selecting a context. */
export async function citizenSendOtp(mobile: string) {
  const response = await fetch(`${BASE}/identity/v1/citizen/otp/_send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(BASE).origin },
    body: JSON.stringify({ mobileNumber: mobile, tenantSlug: tenantSlug(), purpose: 'signin' }),
  });
  if (response.status !== 202) throw new Error(`BFF OTP send failed: HTTP ${response.status}`);
  return response.json();
}

export async function expectNoOnPage(page: Page, text: RegExp | string) {
  await expect(page.getByText(text)).toHaveCount(0);
}
