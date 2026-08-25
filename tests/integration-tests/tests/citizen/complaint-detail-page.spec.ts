import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL } from '../utils/env';
import { readProvisionedCitizen } from '../utils/citizen-provision';
import { seedComplaintAsCitizen } from '../utils/seed';

// Disable trace/video so the spec runs cleanly with --no-deps (the
// .playwright-artifacts-0 dir is only created by the full setup DAG).
test.use({ trace: 'off', video: 'off' });

test('complaint details page loads without crashing for a freshly-filed complaint', {
  annotation: {
    type: 'description',
    description: `Robustness check for the citizen complaint detail page. API-seeds a complaint for the suite-wide provisioned citizen (so the test is tenant-agnostic and never depends on a specific seeded ID or a hardcoded phone), navigates to its detail page, and asserts both that the Complaint Summary renders and that no "Cannot read properties of undefined" JS errors fire.

Steps:
1. setTimeout 120s; attach a pageerror listener to capture uncaught JS errors.
2. API-seed a complaint for the provisioned citizen via seedComplaintAsCitizen() (the seed plan's deployment-correct serviceCode/localityCode — see personas.ts). Skip cleanly if create is blocked (e.g. no viable (serviceCode, assignee) pair exists on this deployment).
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
  // seedComplaintAsCitizen() always uses a CITIZEN token (APPLY is
  // [CITIZEN, CSR] on every deployment — see seed.ts) and picks the seed
  // plan's deployment-correct (serviceCode, localityCode) rather than
  // guessing env literals that only exist on Nairobi.
  let complaintId: string;
  try {
    const created = await seedComplaintAsCitizen({ description: 'PW detail-page test — auto-filed' });
    complaintId = created.srid;
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

test('complaint location section is hidden when absent and supports valid zero-axis coordinates (#1750)', {
  annotation: {
    type: 'description',
    description: `End-to-end coordinate-display contract for citizen complaint details. API-files four complaints owned by the logged-in citizen: an empty geoLocation, the historical (0,0) sentinel, a point on the equator, and a point on the prime meridian. The whole Complaint Location card must be absent for the first two and must render a Leaflet marker for the latter two. This catches both the empty-header bug and truthiness guards that accidentally reject a legitimate zero coordinate.`,
  },
  tag: ['@area:pgr', '@ccrs:1750', '@kind:regression', '@layer:ui', '@persona:citizen'],
}, async ({ page }) => {
  test.setTimeout(180_000);

  if (!readProvisionedCitizen()) {
    test.skip(true, 'citizen-fixture.json missing — citizen-setup project did not run');
    return;
  }

  let ids: { missing: string; legacyZero: string; equator: string; primeMeridian: string };
  try {
    const [missing, legacyZero, equator, primeMeridian] = await Promise.all([
      seedComplaintAsCitizen({
        description: 'PW #1750 missing geo-location detail test',
        geoLocation: {},
      }),
      seedComplaintAsCitizen({
        description: 'PW #1750 legacy zero geo-location detail test',
        geoLocation: { latitude: 0, longitude: 0 },
      }),
      seedComplaintAsCitizen({
        description: 'PW #1750 equator geo-location detail test',
        geoLocation: { latitude: 0, longitude: 36.8 },
      }),
      seedComplaintAsCitizen({
        description: 'PW #1750 prime-meridian geo-location detail test',
        geoLocation: { latitude: -1.2, longitude: 0 },
      }),
    ]);
    ids = {
      missing: missing.srid,
      legacyZero: legacyZero.srid,
      equator: equator.srid,
      primeMeridian: primeMeridian.srid,
    };
  } catch (error) {
    test.skip(true, `complaint create blocked on this deployment: ${(error as Error).message.slice(0, 200)}`);
    return;
  }

  await citizenOtpLogin(page);
  await page.route('https://nominatim.openstreetmap.org/reverse**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ display_name: 'Playwright coordinate contract' }),
    }),
  );

  const locationHeading = () =>
    page.getByText(/^(Complaint Location|CS_COMPLAINT_LOCATION)$/i, { exact: true });
  const locationMarker = () => page.locator('.leaflet-container .leaflet-marker-icon');
  const openComplaint = async (srid: string) => {
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints/${srid}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await expect(page.getByText('Complaint Summary', { exact: true })).toBeVisible({ timeout: 30_000 });
  };

  await openComplaint(ids.missing);
  await expect(
    locationHeading(),
    'SQL NULL coordinates must hide the complete card, not leave an empty heading',
  ).toHaveCount(0);
  await expect(locationMarker()).toHaveCount(0);

  await openComplaint(ids.legacyZero);
  await expect(locationHeading(), 'historical (0,0) must remain treated as absent').toHaveCount(0);
  await expect(locationMarker()).toHaveCount(0);

  await openComplaint(ids.equator);
  await expect(locationHeading(), 'latitude=0 with non-zero longitude is a valid location').toBeVisible();
  await expect(locationMarker()).toHaveCount(1);

  await openComplaint(ids.primeMeridian);
  await expect(locationHeading(), 'longitude=0 with non-zero latitude is a valid location').toBeVisible();
  await expect(locationMarker()).toHaveCount(1);
});
