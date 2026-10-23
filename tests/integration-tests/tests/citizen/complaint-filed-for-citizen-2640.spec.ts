/**
 * A complaint an employee files for a citizen's phone reaches that citizen's
 * own account, and so their My Complaints, in either order (#2640).
 *
 * pgr-services finds the citizen of an employee-filed complaint by
 * userName = mobile number, and creates one when there is none. A phone-OTP
 * citizen's DIGIT account is the identity BFF's own, named `kcbffc-…`, so a
 * complaint filed AFTER the citizen's first sign-in used to go to a second
 * CITIZEN account that pgr-services created, and never reached the citizen.
 * pgr-services now attaches it to the one BFF-created citizen account holding
 * the number. A complaint filed BEFORE the first sign-in already worked: the
 * BFF links the account pgr-services created (#2167). Both orders are covered
 * here, and neither depends on the account's userName.
 *
 * Each test signs in its own new number (one BFF OTP each) and files as the
 * `csr` persona, an employee holding a PGR APPLY role other than CITIZEN.
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE_URL, TENANT } from '../utils/env';
import { requires } from '../utils/capabilities';
import { getPersona, resolveFilingTarget } from '../utils/personas';
import { pgrCreate } from '../utils/launch-fixes/api';
import { freshCitizenMobile, provisionFreshCitizen, type ProvisionedCitizen } from '../utils/citizen-provision';
import { citizenOtpLogin } from '../utils/citizen-login';
import { tenantSlug } from '../utils/identity-bff';

/** The CSR files a complaint for `mobile` and returns its id and the account pgr-services attached. */
async function fileAsCsr(mobile: string): Promise<{ srid: string; accountId: string }> {
  const csr = await getPersona('csr');
  const target = await resolveFilingTarget();
  if ('error' in target) throw new Error(`Cannot file a complaint: ${target.error}`);
  const filed = await pgrCreate({
    baseUrl: BASE_URL,
    auth: { token: csr.token, userInfo: csr.userInfo },
    tenantId: TENANT,
    serviceCode: target.serviceCode,
    localityCode: target.localityCode,
    description: `PW #2640 filed by ${csr.username} for a citizen — ${new Date().toISOString()}`,
    citizenName: 'PW Complainant',
    citizenPhone: mobile,
  });
  const accountId = (filed.rawWrapper.service as { accountId?: string } | undefined)?.accountId;
  expect(accountId, `${filed.serviceRequestId}: pgr-services attached no citizen account`).toBeTruthy();
  return { srid: filed.serviceRequestId, accountId: accountId! };
}

/** The citizen's own PGR search. A citizen only ever sees complaints on their own account. */
async function citizenSees(citizen: ProvisionedCitizen, srid: string): Promise<boolean> {
  const userInfo = {
    uuid: citizen.uuid, type: 'CITIZEN', tenantId: citizen.tenantId,
    userName: citizen.userName, name: citizen.name, mobileNumber: citizen.mobile,
  };
  const r = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${encodeURIComponent(TENANT)}&serviceRequestId=${encodeURIComponent(srid)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizen.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: citizen.token, userInfo } }),
    },
  );
  if (!r.ok) throw new Error(`citizen PGR _search failed: HTTP ${r.status}`);
  const wrappers = ((await r.json()) as { ServiceWrappers?: Array<{ service?: { serviceRequestId?: string } }> }).ServiceWrappers ?? [];
  return wrappers.some((w) => w.service?.serviceRequestId === srid);
}

/** My Complaints, signed in with the session the citizen's own OTP sign-in left. */
async function expectInMyComplaints(page: Page, citizen: ProvisionedCitizen, srid: string): Promise<void> {
  // pgr-services' search lags its write: wait for the citizen's own API view first,
  // so the page's one list load already has the row.
  await expect.poll(() => citizenSees(citizen, srid), {
    message: `${srid} in the citizen's own PGR search`, timeout: 30_000,
  }).toBe(true);
  await citizenOtpLogin(page, citizen.mobile, citizen.sessionCookies);
  await page.goto(`${BASE_URL}/${tenantSlug()}/digit-ui/citizen/pgr/complaints`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const body = page.locator('body');
  await expect(body).toContainText('My Complaints', { timeout: 30_000 });
  await expect(body).toContainText(srid, { timeout: 30_000 });
  await expect(body).not.toContainText('Something went wrong');
}

test.describe('PGR — a complaint filed for a citizen reaches their My Complaints (#2640)', () => {
  test('filed after the citizen signed in by OTP', {
    annotation: {
      type: 'description',
      description: `The #2640 order. A new citizen signs in by phone OTP through the identity BFF, which creates their DIGIT account (userName kcbffc-…, marker keycloak-bff:citizen:). Then an employee holding CSR files a complaint for that phone. No userName = mobile citizen exists, so pgr-services must attach the complaint to the one BFF-created citizen holding the number; before #2640 it created a second CITIZEN and the complaint never appeared.

Steps:
1. requires personas.csr (an employee holding a PGR APPLY role other than CITIZEN).
2. provisionFreshCitizen(): a new valid number signs in by BFF OTP (_send, _verify, citizen _select).
3. As the csr persona, pgrCreate for that number (no accountId, citizen = {name, mobileNumber}).
4. Assert the created complaint's accountId is the citizen's uuid.
5. Poll the citizen's own PGR _search for the complaint id.
6. Reuse the citizen's BFF session in the browser, open /citizen/pgr/complaints, and assert the complaint id is listed.`,
    },
    tag: ['@area:pgr', '@ccrs:2640', '@kind:regression', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    requires(test, 'personas.csr');
    test.setTimeout(180_000);

    const citizen = await provisionFreshCitizen();

    const { srid, accountId } = await fileAsCsr(citizen.mobile);
    expect(accountId, `${srid} must attach to the account the citizen signs in with, not a second CITIZEN (#2640)`)
      .toBe(citizen.uuid);

    await expectInMyComplaints(page, citizen, srid);
  });

  test('filed before the citizen\'s first sign-in', {
    annotation: {
      type: 'description',
      description: `The reverse order. An employee holding CSR files a complaint for a number nobody has used, so pgr-services creates a CITIZEN named by that number. When the number's owner then signs in by OTP, the BFF links that account (#2167) instead of creating one, and the complaint is in their My Complaints.

Steps:
1. requires personas.csr.
2. freshCitizenMobile(): a new number valid for the deployment's mobile rule.
3. As the csr persona, pgrCreate for that number; keep the accountId pgr-services attached.
4. provisionFreshCitizen({ mobile }): the number signs in by BFF OTP.
5. Assert the citizen's uuid is that accountId.
6. Poll the citizen's own PGR _search for the complaint id.
7. Reuse the citizen's BFF session in the browser, open /citizen/pgr/complaints, and assert the complaint id is listed.`,
    },
    tag: ['@area:pgr', '@ccrs:2640', '@kind:regression', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    requires(test, 'personas.csr');
    test.setTimeout(180_000);

    const mobile = await freshCitizenMobile();
    const { srid, accountId } = await fileAsCsr(mobile);

    const citizen = await provisionFreshCitizen({ mobile });
    expect(citizen.uuid, `the citizen's sign-in must take the account ${srid} was filed under`).toBe(accountId);

    await expectInMyComplaints(page, citizen, srid);
  });
});
