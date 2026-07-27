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
