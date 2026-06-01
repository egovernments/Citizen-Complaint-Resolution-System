/**
 * Citizen home + landing surfaces — Stories 2.1, 2.2, 2.3.
 *
 * Three surfaces:
 *   - /citizen/all-services — post-login default landing
 *   - /citizen/pgr-home     — branded "Nai Pepea" PGR module home
 *   - Header language pill — toggles localization
 *
 * Also smoke-checks that /citizen/ redirects to /all-services (per the
 * Routes table in docs/personas/citizen-flows.md).
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

test.describe('Citizen home + landing', () => {
  test('/citizen/ redirects to /citizen/all-services', {
    annotation: {
      type: 'description',
      description: `Routes-table contract from docs/personas/citizen-flows.md: bare /citizen/ must redirect a logged-in citizen to /citizen/all-services. Catches a regression where the index route changes silently and citizens land on a 404 or a different home.

Steps:
1. setTimeout 60s; OTP-login as a fresh citizen.
2. Navigate to /digit-ui/citizen and wait 3s.
3. Assert page.url() contains '/citizen/all-services'.

Smoke-level routing check; pairs with the all-services + pgr-home tests in this file.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    await page.goto(`${BASE_URL}/digit-ui/citizen`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    expect(page.url()).toContain('/citizen/all-services');
  });

  test('/all-services renders CCRS title + File a Complaint + My Complaints links', {
    annotation: {
      type: 'description',
      description: `Inventory check on the citizen home landing — every label a citizen needs to file/track complaints + the four sidebar items must render. Catches both shrinkage (a tile or sidebar entry disappearing) and crash regressions (the page fully erroring).

Steps:
1. setTimeout 60s; OTP-login as a fresh citizen.
2. Navigate to /digit-ui/citizen/all-services, wait 3s for hydration.
3. Assert body does NOT contain "Something went wrong".
4. Assert body contains "Citizen Complaint Resolution System", "File a Complaint", and "My Complaints".
5. For each sidebar item ['Home', 'Edit Profile', 'Logout', 'HELPLINE'], assert body contains it.

Catalog test — if a label gets renamed legitimately, update this spec and Story 2.1 in the same PR.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    await page.goto(`${BASE_URL}/digit-ui/citizen/all-services`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    const body = page.locator('body');
    await expect(body).not.toContainText('Something went wrong');
    await expect(body).toContainText('Citizen Complaint Resolution System');
    await expect(body).toContainText('File a Complaint');
    await expect(body).toContainText('My Complaints');

    // Sidebar inventory — Story 2.x note
    for (const item of ['Home', 'Edit Profile', 'Logout', 'HELPLINE']) {
      await expect(body, `sidebar item "${item}" missing`).toContainText(item);
    }
  });

  test('/pgr-home renders the PGR module home with action links', {
    annotation: {
      type: 'description',
      description: `Catalog test for the PGR-branded home (/citizen/pgr-home). Asserts the actionable content + PGR badge renders. Brand assets ("Nai Pepea", hero text) are CSS-content and intentionally NOT asserted on — only DOM text is tested.

Steps:
1. setTimeout 60s; OTP-login as a fresh citizen.
2. Navigate to /digit-ui/citizen/pgr-home, wait 3s.
3. Assert body does NOT contain "Something went wrong".
4. Assert body contains "PGR", "Citizen Complaint Resolution System", "My Complaints", and "File a Complaint".

If the brand assets ever land as real DOM text, extend this spec — leaving the hero out keeps it stable across CSS changes.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr-home`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    const body = page.locator('body');
    await expect(body).not.toContainText('Something went wrong');
    // Note: "Nai Pepea" + "Report a grievance" + "Nairobi City County
    // Government" are rendered as background-image / CSS-content on the
    // hero, not DOM text. Asserting on the actionable content + PGR badge
    // instead. If the brand assets ever land as real DOM text, extend.
    await expect(body).toContainText('PGR');
    await expect(body).toContainText('Citizen Complaint Resolution System');
    await expect(body).toContainText('My Complaints');
    await expect(body).toContainText('File a Complaint');
  });

  test('header language pill renders the current locale', {
    annotation: {
      type: 'description',
      description: `Smoke check that the header language pill renders with the current locale ("English" by default). Doesn't assert the dropdown options because clicking the pill opens a native OS-level select with no [role="listbox"] in the DOM — only confirms the pill exists.

Steps:
1. setTimeout 60s; OTP-login as a fresh citizen.
2. Wait 2s for header to render.
3. Locate label:has-text("English"); assert it is visible (within 5s).

Tightly scoped — bigger localization assertions live in dedicated specs (e.g. complaint-type-labels.spec.ts).`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(60_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);
    await page.waitForTimeout(2000);

    // Language pill is a <label> with the current locale name. Clicking
    // it opens a native OS-level dropdown (no [role="listbox"] in the
    // DOM) so we don't assert the options list — just that the pill
    // renders with the current locale text.
    const pill = page.locator('label:has-text("English")').first();
    await expect(pill, 'language pill should render with current locale').toBeVisible({
      timeout: 5_000,
    });
  });
});
