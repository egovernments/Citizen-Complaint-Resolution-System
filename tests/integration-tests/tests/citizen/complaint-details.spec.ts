import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL } from '../utils/env';

test('complaint details page loads without crashing for any service code', {
  annotation: {
    type: 'description',
    description: `Robustness check for the citizen complaint detail page. Picks an arbitrary existing complaint via a search-from-the-browser API call (so the test isn't tied to a specific seeded ID), navigates to its detail page, and asserts both that the Complaint Summary renders and that no "Cannot read properties of undefined" JS errors fire.

Steps:
1. setTimeout 120s; attach a pageerror listener to capture uncaught JS errors.
2. citizenOtpLogin with a fixed phone (711111111).
3. From the page context, call PGR _search via the in-page Digit token to grab any existing serviceRequestId; skip if zero results.
4. Navigate to /digit-ui/citizen/pgr/complaints/{id}, wait 12s for hydration.
5. Assert "Complaint Summary" heading is visible and the complaint ID appears in the body.
6. Filter pageErrors for "Cannot read properties of undefined" matches and assert length === 0.

Skips gracefully if no complaints exist at all — useful for fresh deployments. Catches the class of regressions where a service code has missing fields and the detail page deref-crashes.`,
  },
  tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
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
