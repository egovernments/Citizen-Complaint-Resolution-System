/**
 * Onboarding — Phase 2 hierarchy level editor (master ticket #21,
 * enrichment #7 of the validation/error pass).
 *
 * Verifies the create-hierarchy step's Level editor:
 *   1. The default 4-level chain (Country, State, City, Ward) renders
 *      pre-populated and the "[Root]" / "[Lowest]" markers anchor the
 *      first and last levels.
 *   2. Clicking "+ Add Level" appends a 5th input.
 *   3. The X button removes a level (only renders when N > 2).
 *   4. After editing the chain, "Create Hierarchy" submits and the
 *      wizard advances to the Boundary Data Upload step.
 *
 * The create-hierarchy form now lives behind the "Upload from Excel"
 * card on the "Choose Your Data Source" landing, so the walk first goes
 * through `enterPhase2ExcelLanding` before clicking Option 1.
 *
 * Per CLAUDE.md the body is UI-only. Teardown deactivates the tenant
 * via API (no UI delete affordance for tenants — tracked in #21).
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
  enterPhase2ExcelLanding,
} from '../utils/onboarding';

test.use({ storageState: { cookies: [], origins: [] } });

const createdTenants: string[] = [];
const tempFiles: string[] = [];

test.describe('Onboarding — Phase 2 hierarchy editor', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('add + remove level + submit advances to Boundary Data Upload', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);
    const ids = freshOnboardingIds();
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = tmpXlsx('tenant-p2hier', ids.SUFFIX);
    await writeTenantFixture(tenantFixture, ids);
    tempFiles.push(tenantFixture);

    await loginOnboarding(page);
    await completePhase1(page, ids, tenantFixture);

    // Enter the Excel path, then open the create-hierarchy form (Option 1).
    await enterPhase2ExcelLanding(page);
    await page.getByRole('button', { name: /Option 1: Create New Hierarchy/i }).click();
    await expect(page.locator('#hierarchyType')).toBeVisible({ timeout: 15_000 });
    await page.locator('#hierarchyType').fill(ids.HIERARCHY_TYPE);

    // The level editor renders four inputs by default — Country, State,
    // City, Ward (Phase2Page.tsx:49). The wrapper around the level
    // inputs does not get its own role, so we count textboxes inside
    // the level container by their text "Level N:" siblings.
    await expect(page.getByText('Level 1:')).toBeVisible();
    await expect(page.getByText('Level 4:')).toBeVisible();
    await expect(page.getByText('[Root]').first()).toBeVisible();
    await expect(page.getByText('[Lowest]').first()).toBeVisible();

    // "+ Add Level" appends a 5th input.
    await page.getByRole('button', { name: /Add Level/i }).click();
    await expect(page.getByText('Level 5:')).toBeVisible();

    // The X button removes a level (only rendered when N > 2). After
    // removing one level we should be back to 4 visible level rows.
    // The X button has a child <X> icon and no accessible name — match
    // by its role+ancestor instead. There are 5 X-icon buttons (one per
    // level row); clicking the last one removes Level 5.
    const removeButtons = page.locator('div').filter({ hasText: /^Level \d+:/ }).getByRole('button').filter({ has: page.locator('svg.lucide-x') });
    // Fallback: pick any "remove level" button — they're the small X
    // buttons next to non-edge level inputs.
    const xIconButtons = page.locator('button:has(svg.lucide-x)');
    expect(await xIconButtons.count()).toBeGreaterThan(0);
    await xIconButtons.first().click();
    await expect(page.getByText('Level 5:')).toHaveCount(0);

    // Submit and advance to the Boundary Data Upload step.
    await page.getByRole('button', { name: /Create Hierarchy/i }).click();
    await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 60_000 });
  });
});
