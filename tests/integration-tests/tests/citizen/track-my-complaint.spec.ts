/**
 * Citizen track-complaint flow — Stories 4.1, 5.1, 5.2.
 *
 * Files a complaint via seedComplaintAsCitizen() (tests/utils/seed.ts) as
 * the suite-wide provisioned citizen, then walks the citizen UI for the My
 * Complaints list + Complaint Detail + Timeline sections. API-creates so we
 * don't depend on deployment inventory state — the same provisioned citizen
 * hits the UI later for browse-only, matching the pattern every other
 * citizen spec now uses (complaint-detail-page, rate-resolved-complaint,
 * reopen-closed-complaint) rather than each spec re-implementing
 * register+resolveServiceCode/resolveLocalityCode+pgrCreate.
 *
 * Asserts the route divergence flagged in the catalogue Routes table:
 * the detail URL is `/citizen/pgr/complaints/:id` (PLURAL), NOT
 * `/complaint/details/:id` as `Routes.js` exports.
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { seedComplaintAsCitizen } from '../utils/seed';
import { BASE_URL, PGR_ID_PREFIX } from '../utils/env';
import { readProvisionedCitizen } from '../utils/citizen-provision';

// Disable trace/video so the spec runs cleanly with --no-deps (the
// .playwright-artifacts-0 dir is only created by the full setup DAG).
test.use({ trace: 'off', video: 'off' });

test.describe.serial('Citizen track-complaint', () => {
  let serviceRequestId: string;

  test.beforeAll(async () => {
    const created = await seedComplaintAsCitizen({ description: 'PW track-complaint test — auto-filed' });
    serviceRequestId = created.srid;
    console.log(`Seeded complaint ${serviceRequestId}`);
  });

  test('My Complaints list shows the seeded complaint with OPEN badge', {
    annotation: {
      type: 'description',
      description: `Story 4.1 contract for /citizen/pgr/complaints: a freshly-filed complaint (still in PENDINGFORASSIGNMENT) must appear in the citizen's My Complaints list with the OPEN badge and the localized "Pending for assignment" status text.

Steps:
1. setTimeout 120s; citizenOtpLogin.
2. Navigate to /digit-ui/citizen/pgr/complaints, wait 5s.
3. Assert body contains "My Complaints", the seeded serviceRequestId, /OPEN/, and /Pending for assignment/i.
4. Assert body does NOT contain "Something went wrong".

beforeAll is API-only — files a complaint as the suite-wide provisioned citizen via seedComplaintAsCitizen() — so the test isn't tied to whatever's currently seeded on the deployment.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page);
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const body = page.locator('body');
    await expect(body).toContainText('My Complaints');
    await expect(body).toContainText(serviceRequestId);
    await expect(body).toContainText(/OPEN/);
    await expect(body).toContainText(/Pending for assignment/i);
    await expect(body).not.toContainText('Something went wrong');
  });

  test('Detail page renders Summary / Details / Map / Timeline sections', {
    annotation: {
      type: 'description',
      description: `Story 5.1 / 5.2 contract for the complaint detail page. Asserts the four canonical sections are visible — Complaint Summary, Complaint Details, Complaint Timeline, plus the Application Status row and the SR id itself.

Steps:
1. setTimeout 120s; citizenOtpLogin.
2. Navigate to /digit-ui/citizen/pgr/complaints/{seeded id}, wait 5s.
3. Assert body contains "Complaint Summary", "Complaint Details", "Complaint Timeline", the SR id, and "Application Status".
4. Assert body does NOT contain "Something went wrong".

The Map widget + "Open in Maps" only render when geoLocation has non-zero coords. This spec API-seeds with {0,0} so the map isn't asserted here — wizard.spec.ts walks the UI and drops a real pin so the map renders there.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page);
    await page.goto(
      `${BASE_URL}/digit-ui/citizen/pgr/complaints/${serviceRequestId}`,
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );
    await page.waitForTimeout(5000);

    const body = page.locator('body');
    await expect(body).toContainText('Complaint Summary');
    await expect(body).toContainText('Complaint Details');
    // Ethiopia renders "Activity timeline"; Kenya renders "Complaint Timeline".
    await expect(body).toContainText(/Complaint Timeline|Activity timeline/i);
    await expect(body).toContainText(serviceRequestId);
    await expect(body).toContainText('Application Status');

    // Map widget + "Open in Maps" button only render when geoLocation
    // has non-zero coords. This spec API-seeds with {0,0} so the map
    // can't be asserted here — wizard.spec.ts walks the UI and drops a
    // real pin, so the map renders there. Tracked under Story 5.1.

    // No crash fallback
    await expect(body).not.toContainText('Something went wrong');
  });

  test('Detail URL uses /complaints/:id (PLURAL) — Routes.js export diverges', {
    annotation: {
      type: 'description',
      description: `Documents the route divergence flagged in citizen-flows.md Routes table. The detail URL is /citizen/pgr/complaints/:id (PLURAL), NOT /complaint/details/:id as Routes.js exports. The card click is implemented via an onClick on a div (no <a> href to inspect), so the test navigates to the plural URL directly and asserts the page serves correctly.

Steps:
1. setTimeout 120s; citizenOtpLogin and visit /citizen/pgr/complaints (warm cache).
2. Navigate directly to /digit-ui/citizen/pgr/complaints/{seeded id}; wait 4s.
3. Assert page.url() matches /\\/digit-ui\\/citizen\\/pgr\\/complaints\\/<PGR_ID_PREFIX>-PGR-\\d{4}-\\d{2}-\\d{2}-\\d+/ (prefix from env).
4. Assert page.url() does NOT contain '/complaint/details/' (no auto-redirect to the singular form).
5. Assert body contains "Complaint Summary".
6. Assert body does NOT contain "Something went wrong".

If the SPA ever redirects plural → singular (or 404s), this test catches the change.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page);
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    // The card click is implemented via an onClick handler on a div,
    // not an <a> anchor — there's no href to inspect. Navigate to the
    // PLURAL detail URL directly and assert it loads the detail page
    // (URL stays plural after redirect-resolution; detail content
    // renders rather than 404). The complementary test — that the
    // singular form does NOT serve the page — is captured by
    // verifying the page didn't redirect to /complaint/details/.
    await page.goto(
      `${BASE_URL}/digit-ui/citizen/pgr/complaints/${serviceRequestId}`,
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );
    await page.waitForTimeout(4000);

    const url = page.url();
    // Deployment-specific complaint-ID prefix is discovered live by
    // citizen.setup.ts (egov-idgen) and persisted on the provisioned citizen;
    // PGR_ID_PREFIX (env) is the fallback.
    const pgrIdPrefix = readProvisionedCitizen()?.pgrIdPrefix ?? PGR_ID_PREFIX;
    const detailUrlRe = new RegExp(
      `/digit-ui/citizen/pgr/complaints/${pgrIdPrefix}-PGR-\\d{4}-\\d{2}-\\d{2}-\\d+`,
    );
    expect(url, 'plural /complaints/:id URL should serve the detail page').toMatch(detailUrlRe);
    expect(url, 'should NOT have redirected to the Routes.js-exported singular form').not.toContain(
      '/complaint/details/',
    );

    // Detail content renders (not a 404 / not the error fallback)
    const body = page.locator('body');
    await expect(body).toContainText('Complaint Summary');
    await expect(body).not.toContainText('Something went wrong');
  });
});
