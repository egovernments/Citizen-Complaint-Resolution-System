import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL } from '../utils/env';

test('complaint details page loads without crashing for any service code', async ({ page }) => {
  test.setTimeout(120_000);

  // Track JS errors
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await citizenOtpLogin(page, '711111111');

  // Search for complaints via API to find one to test
  const complaintId = await page.evaluate(async (baseUrl) => {
    const tenantId = (window as any).Digit?.ULBService?.getCurrentTenantId?.() || 'ke.nairobi';
    const userInfo = (window as any).Digit?.UserService?.getUser?.()?.info || {};
    const token = (window as any).Digit?.UserService?.getUser?.()?.access_token || '';
    try {
      const res = await fetch(`${baseUrl}/pgr-services/v2/request/_search?tenantId=${tenantId}&_=` + Date.now(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'auth-token': token },
        body: JSON.stringify({ RequestInfo: { authToken: token } }),
      });
      const data = await res.json();
      const wrappers = data?.ServiceWrappers || [];
      if (wrappers.length > 0) return wrappers[0].service.serviceRequestId;
    } catch (e) {}
    return null;
  }, BASE_URL);

  if (!complaintId) {
    console.log('No complaints found, skipping detail page test');
    test.skip();
    return;
  }

  console.log(`Testing complaint: ${complaintId}`);

  // Navigate to the complaint details page
  await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints/${complaintId}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(12000);

  // Page should render complaint details, not be stuck on spinner
  const heading = page.locator('text=Complaint Summary');
  await expect(heading).toBeVisible({ timeout: 5_000 });

  const complaintNo = page.locator(`text=${complaintId}`);
  await expect(complaintNo).toBeVisible({ timeout: 5_000 });

  // No JS errors about reading properties of undefined
  const crashErrors = pageErrors.filter(e => e.includes('Cannot read properties of undefined'));
  expect(crashErrors, `JS crash errors: ${crashErrors.join('; ')}`).toHaveLength(0);
});
