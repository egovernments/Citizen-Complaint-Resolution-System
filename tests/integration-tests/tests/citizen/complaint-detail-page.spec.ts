import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { pgrCreate, resolveServiceCode, resolveLocalityCode } from '../utils/launch-fixes/api';
import {
  BASE_URL,
  TENANT,
  ROOT_TENANT,
  FIXED_OTP,
  DEFAULT_PASSWORD,
  SERVICE_CODE,
  LOCALITY_CODE,
} from '../utils/env';
import { readProvisionedCitizen } from '../utils/citizen-provision';

// Disable trace/video so the spec runs cleanly with --no-deps (the
// .playwright-artifacts-0 dir is only created by the full setup DAG).
test.use({ trace: 'off', video: 'off' });

interface CitizenAuth {
  token: string;
  userInfo: Record<string, unknown>;
}

/**
 * Obtain a fresh {token, userInfo} for the suite-wide provisioned citizen by
 * exchanging their mobile for an access token. `pgrCreate` needs the full
 * UserRequest as RequestInfo.userInfo (accountId is derived from it), which
 * the persisted fixture doesn't carry, so we re-exchange here.
 */
async function loginProvisionedCitizen(phone: string): Promise<CitizenAuth> {
  await fetch(`${BASE_URL}/user-otp/v1/_send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otp: { mobileNumber: phone, tenantId: ROOT_TENANT, type: 'login', userType: 'CITIZEN' },
    }),
  }).catch(() => {});

  const oauth = async (password: string) =>
    fetch(`${BASE_URL}/user/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: phone,
        password,
        tenantId: ROOT_TENANT,
        scope: 'read',
        userType: 'CITIZEN',
      }).toString(),
    });

  let resp = await oauth(FIXED_OTP);
  if (!resp.ok) resp = await oauth(DEFAULT_PASSWORD);
  if (!resp.ok) {
    throw new Error(`citizen token exchange failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
  }
  const data = (await resp.json()) as { access_token: string; UserRequest: Record<string, unknown> };
  return { token: data.access_token, userInfo: data.UserRequest };
}

test('complaint details page loads without crashing for a freshly-filed complaint', {
  annotation: {
    type: 'description',
    description: `Robustness check for the citizen complaint detail page. API-seeds a complaint for the suite-wide provisioned citizen (so the test is tenant-agnostic and never depends on a specific seeded ID or a hardcoded phone), navigates to its detail page, and asserts both that the Complaint Summary renders and that no "Cannot read properties of undefined" JS errors fire.

Steps:
1. setTimeout 120s; attach a pageerror listener to capture uncaught JS errors.
2. API-seed a complaint for the provisioned citizen via pgrCreate (resolving a valid service/locality code for the deployment). Skip cleanly if create is blocked (e.g. the ASSIGN department bug prevents create on some tenants).
3. citizenOtpLogin as the provisioned citizen.
4. Navigate to /digit-ui/citizen/pgr/complaints/{id}, wait 12s for hydration.
5. Assert "Complaint Summary" heading is visible and the complaint ID appears in the body.
6. Filter pageErrors for "Cannot read properties of undefined" matches and assert length === 0.

Catches the class of regressions where a service code has missing fields and the detail page deref-crashes.`,
  },
  tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
  test.setTimeout(120_000);

  const provisioned = readProvisionedCitizen();
  if (!provisioned) {
    test.skip(true, 'citizen-fixture.json missing — citizen-setup project did not run');
    return;
  }

  // Track JS errors
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  // API-seed a complaint owned by the provisioned citizen. A freshly-created
  // PENDINGFORASSIGNMENT complaint is enough to render the detail page — no
  // workflow transition (which needs a PGR_LME/dept) is required here.
  let complaintId: string;
  try {
    const auth = await loginProvisionedCitizen(provisioned.mobile);
    const serviceCode = await resolveServiceCode(BASE_URL, auth.token, TENANT, SERVICE_CODE);
    const localityCode = await resolveLocalityCode(BASE_URL, auth.token, TENANT, LOCALITY_CODE);
    const created = await pgrCreate({
      baseUrl: BASE_URL,
      auth,
      tenantId: TENANT,
      serviceCode,
      localityCode,
      description: 'PW detail-page test — auto-filed',
      citizenName: provisioned.name,
      citizenPhone: provisioned.mobile,
    });
    complaintId = created.serviceRequestId;
  } catch (e) {
    test.skip(true, `complaint create blocked on this deployment: ${(e as Error).message.slice(0, 200)}`);
    return;
  }

  console.log(`Testing complaint: ${complaintId}`);

  await citizenOtpLogin(page);

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
