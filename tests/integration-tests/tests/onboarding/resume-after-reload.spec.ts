/**
 * Onboarding — resume after reload (master ticket #21, enrichment #8
 * of the validation/error pass).
 *
 * Verifies the wizard's `currentPhase` / `completedPhases` persistence
 * survives a full page reload. After Phase 1 completes and the wizard
 * advances to Phase 2, a hard reload of the browser must land back on
 * `/configurator/phase/2` with the Phase 2 "Choose Your Data Source"
 * landing rendered — not /phase/1, not the login page, not a blank state.
 *
 * This protects the "operator closed the laptop / browser crashed
 * mid-onboarding" scenario.
 *
 * Per CLAUDE.md the body is UI-only. Teardown deactivates the tenant
 * via API (no UI delete affordance — tracked in #21).
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import {
  freshOnboardingIds,
  tmpXlsx,
  writeTenantFixture,
  deactivateTenantViaApi,
  loginOnboarding,
  completePhase1,
} from '../utils/onboarding';

test.use({ storageState: { cookies: [], origins: [] } });

const createdTenants: string[] = [];
const tempFiles: string[] = [];

test.describe('Onboarding — resume after reload', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('Phase 2 landing survives a full reload + targetTenant persists', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);
    const ids = freshOnboardingIds();
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = tmpXlsx('tenant-resume', ids.SUFFIX);
    await writeTenantFixture(tenantFixture, ids);
    tempFiles.push(tenantFixture);

    await loginOnboarding(page);
    await completePhase1(page, ids, tenantFixture);

    // We're on /phase/2 with the "Choose Your Data Source" landing visible.
    await expect(page.getByText('Phase 2: Boundary Setup')).toBeVisible();
    await expect(page.getByText('Choose Your Data Source')).toBeVisible();
    const beforeUrl = page.url();
    expect(beforeUrl).toMatch(/\/configurator\/phase\/2/);

    // Hard reload — the wizard must rehydrate from localStorage.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Same URL + same Phase 2 landing after rehydrate.
    await expect(page.getByText('Phase 2: Boundary Setup')).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toMatch(/\/configurator\/phase\/2/);
    // The rehydrated landing shows the data-source cards — OSM + Excel,
    // NOT the Option 1/2 hierarchy cards (those are behind "Upload from
    // Excel" now). Both cards must render → the wizard has a session.
    await expect(page.getByText('Choose Your Data Source')).toBeVisible();
    await expect(page.getByRole('button', { name: /Fetch from OpenStreetMap/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Upload from Excel/i })).toBeVisible();
  });
});
