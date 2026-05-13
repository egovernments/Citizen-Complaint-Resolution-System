/**
 * Citizen PGR Complaint Flow E2E Test
 *
 * Walks through the full citizen complaint creation wizard:
 *   Step 1: Select complaint type + subtype
 *   Step 2: Pin map location (skip)
 *   Step 3: Landmark / postal code (skip)
 *   Step 4: Complaint's Location (boundary dropdowns)
 *   Step 5: Additional details
 *   Step 6: Upload photos (skip)
 *
 * Validates that boundary APIs return data (proxy rewrites
 * state-level tenantId and hierarchy definition tenantId).
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://keycloak-sandbox.live.digit.org';
const KC_URL = process.env.KC_URL || 'http://localhost:18180';
const TENANT = 'pg.citya';
const STATE_TENANT = 'pg';

/** Create a temporary KC user and get a JWT */
async function createCitizenSession(): Promise<{ jwt: string; email: string }> {
  const ts = Date.now();
  const email = `citizen-e2e-${ts}@test.com`;

  // Get admin token
  const adminToken = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=password&client_id=admin-cli&username=admin&password=admin',
  })
    .then((r) => r.json())
    .then((d: any) => d.access_token);

  // Create KC user
  await fetch(`${KC_URL}/admin/realms/digit-sandbox/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: email,
      email,
      firstName: 'E2E',
      lastName: 'Citizen',
      enabled: true,
      emailVerified: true,
      credentials: [{ type: 'password', value: 'Test@12345', temporary: false }],
    }),
  });

  // Get citizen JWT
  const jwt = await fetch(`${KC_URL}/realms/digit-sandbox/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=password&client_id=digit-sandbox-ui&username=${email}&password=Test@12345&scope=openid`,
  })
    .then((r) => r.json())
    .then((d: any) => d.access_token);

  return { jwt, email };
}

test.describe('Citizen PGR complaint wizard', () => {
  test.slow(); // Multi-step wizard with waits

  // Skip when Keycloak admin port is unavailable (needed for citizen session creation)
  test.beforeEach(async () => {
    let kcAvailable = false;
    try {
      const r = await fetch(`${KC_URL}/realms/master`, { signal: AbortSignal.timeout(2000) });
      kcAvailable = r.ok;
    } catch { /* not reachable */ }
    test.skip(!kcAvailable, 'Keycloak admin port not available');
  });

  test('boundary APIs return data through proxy', async () => {
    // Verify the proxy rewrites tenantId=pg -> pg.citya for boundary relationships
    const relResp = await fetch(
      `${BASE_URL}/boundary-service/boundary-relationships/_search?tenantId=${STATE_TENANT}&hierarchyType=ADMIN&includeChildren=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker' } }),
      },
    );
    expect(relResp.ok).toBe(true);
    const relData: any = await relResp.json();
    expect(relData.TenantBoundary).toBeDefined();
    expect(relData.TenantBoundary.length).toBeGreaterThan(0);
    expect(relData.TenantBoundary[0].boundary.length).toBeGreaterThan(0);

    // Verify the proxy rewrites tenantId=dev -> pg for hierarchy definition
    const hierResp = await fetch(`${BASE_URL}/boundary-service/boundary-hierarchy-definition/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BoundaryTypeHierarchySearchCriteria: { tenantId: 'dev', limit: 2, offset: 0, hierarchyType: 'ADMIN' },
        RequestInfo: { apiId: 'Rainmaker' },
      }),
    });
    expect(hierResp.ok).toBe(true);
    const hierData: any = await hierResp.json();
    expect(hierData.totalCount).toBe(1);
    expect(hierData.BoundaryHierarchy).toBeDefined();
    expect(hierData.BoundaryHierarchy[0].boundaryHierarchy.length).toBeGreaterThanOrEqual(4);
  });

  test('walk through complaint wizard to location step', async ({ page }) => {
    const { jwt, email } = await createCitizenSession();

    // Set up citizen auth in localStorage
    await page.goto(`${BASE_URL}/digit-ui/citizen/select-language`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });

    await page.evaluate(
      ({ jwt, email, tenant }) => {
        localStorage.setItem('token', jwt);
        localStorage.setItem('Citizen.token', jwt);
        localStorage.setItem('Citizen.tenant-id', tenant);
        localStorage.setItem(
          'Citizen.user-info',
          JSON.stringify({
            uuid: 'e2e-citizen-uuid',
            name: 'E2E Citizen',
            emailId: email,
            tenantId: tenant,
            type: 'CITIZEN',
            roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: tenant }],
          }),
        );
        localStorage.setItem('selectedLanguage', 'en_IN');
        localStorage.setItem('locale', 'en_IN');
      },
      { jwt, email, tenant: TENANT },
    );

    // Track boundary API responses
    const boundaryResponses: { url: string; status: number; hasData: boolean }[] = [];
    page.on('response', async (res) => {
      if (res.url().includes('boundary')) {
        const body = await res.text().catch(() => '');
        boundaryResponses.push({
          url: res.url(),
          status: res.status(),
          hasData: body.includes('boundaryType') || body.includes('BoundaryHierarchy'),
        });
      }
    });

    // Navigate to complaint creation
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/create-complaint/complaint-type`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    // Step 1: Select complaint type
    const typeInput = page.locator('.digit-dropdown-employee-select-wrap--elipses').first();
    await typeInput.click();
    await page.waitForTimeout(500);
    await page.locator('text=Parks').first().click();
    await page.waitForTimeout(2000);

    // Select complaint subtype (appears after type is selected)
    await page.waitForTimeout(500);
    const subtypeInput = page.locator('.digit-dropdown-employee-select-wrap--elipses').last();
    await subtypeInput.click();
    await page.waitForTimeout(500);
    await page.locator('text=Park requires maintenance').click();
    await page.waitForTimeout(1000);

    // Verify type was selected (value appears in the dropdown input)
    const typeValue = await page.locator('.digit-dropdown-employee-select-wrap--elipses').first().inputValue();
    expect(typeValue).toBeTruthy();

    // Step 1 -> Step 2 (Pin Location)
    await page.click('button:has-text("NEXT")');
    await page.waitForTimeout(3000);
    const step2Text = await page.locator('body').innerText();
    expect(step2Text).toContain('Pin Complaint Location');

    // Step 2 -> Step 3 (Landmark)
    await page.click('button:has-text("NEXT")');
    await page.waitForTimeout(3000);
    const step3Text = await page.locator('body').innerText();
    expect(step3Text).toContain('Landmark');

    // Step 3 -> Step 4 (Complaint's Location / Boundary)
    await page.click('button:has-text("NEXT")');
    await page.waitForTimeout(10_000);

    await page.screenshot({ path: '/tmp/e2e-complaint-location.png' });

    const step4Text = await page.locator('body').innerText();
    expect(step4Text).toContain("Complaint's Location");

    // Verify boundary dropdowns rendered (not stuck on loader)
    // The page should have boundary type labels like City, Zone, Block, Locality
    const hasBoundaryLabels =
      step4Text.includes('City') || step4Text.includes('Zone') || step4Text.includes('Locality');
    expect(hasBoundaryLabels).toBe(true);

    // Verify boundary APIs returned data
    const hierarchyCall = boundaryResponses.find((r) => r.url.includes('hierarchy-definition'));
    const relationshipCall = boundaryResponses.find(
      (r) => r.url.includes('boundary-relationships') && !r.url.includes('Locality'),
    );

    if (hierarchyCall) {
      expect(hierarchyCall.status).toBe(200);
      expect(hierarchyCall.hasData).toBe(true);
    }
    if (relationshipCall) {
      expect(relationshipCall.status).toBe(200);
      expect(relationshipCall.hasData).toBe(true);
    }

    // Verify City dropdown has selectable options (not "No Results Found")
    const cityInput = page.locator('.digit-dropdown-employee-select-wrap--elipses').first();
    await cityInput.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/e2e-city-dropdown.png' });

    const dropdownHtml = await page.locator('.digit-dropdown-options-card').first().innerHTML().catch(() => '');
    const hasNoResults = dropdownHtml.includes('No Results Found');
    const hasOptions = await page.locator('.digit-dropdown-options-card .digit-dropdown-item:not(.unsuccessfulresults)').count();

    console.log(`City dropdown: hasNoResults=${hasNoResults}, optionCount=${hasOptions}`);
    console.log(`Dropdown HTML: ${dropdownHtml.substring(0, 300)}`);

    // City dropdown should have selectable options
    expect(hasNoResults).toBe(false);
    expect(hasOptions).toBeGreaterThan(0);
  });
});
