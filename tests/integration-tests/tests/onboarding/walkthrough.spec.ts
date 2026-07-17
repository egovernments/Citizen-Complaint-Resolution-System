/**
 * Onboarding — full wizard walkthrough (master ticket #21, gap B).
 *
 * Drives the configurator's onboarding wizard end-to-end through the UI:
 *
 *   Login (Onboarding mode)
 *     → Phase 1 (tenant xlsx + branding skip)
 *     → Phase 2 (Upload-from-Excel landing → create hierarchy + boundary
 *                xlsx upload + verify + upload)
 *     → Phase 3 (Common-masters xlsx with Departments/Designations →
 *                Create & Continue → Step 3.2 Define Complaint Hierarchy →
 *                upload hierarchy template → Phase 3 Complete!)
 *     → ready at the "Continue to Phase 4" gate (the Phase 4 employee walk
 *       lands in its own specs — employee xlsx requires reference-data
 *       validation that warrants its own setup story).
 *
 * Per CLAUDE.md the body of the test is UI-only. The afterAll teardown
 * deactivates the freshly-created tenant via API because the configurator
 * has no UI delete affordance for tenants today (TenantList + TenantShow +
 * TenantEdit — no delete). Boundary hierarchies and masters created at the
 * disposable child tenant are left in place — soft-deleting the parent
 * tenant logically orphans them.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import {
  freshOnboardingIds,
  tmpXlsx,
  writeTenantFixture,
  writeBoundaryFixture,
  writeMastersSingle,
  writeComplaintHierarchyFixture,
  deactivateTenantViaApi,
  completePhases123,
} from '../utils/onboarding';

test.use({ storageState: { cookies: [], origins: [] } });

const ids = freshOnboardingIds();
const TENANT_FIXTURE = tmpXlsx('tenant', ids.SUFFIX);
const BOUNDARY_FIXTURE = tmpXlsx('boundary', ids.SUFFIX);
const MASTERS_FIXTURE = tmpXlsx('masters', ids.SUFFIX);
const HIERARCHY_FIXTURE = tmpXlsx('hierarchy', ids.SUFFIX);

test.describe('Onboarding — full walkthrough (Phases 1–3)', () => {
  test.beforeAll(async () => {
    await writeTenantFixture(TENANT_FIXTURE, ids);
    await writeBoundaryFixture(BOUNDARY_FIXTURE, ids);
    await writeMastersSingle(MASTERS_FIXTURE, ids);
    await writeComplaintHierarchyFixture(HIERARCHY_FIXTURE, ids);
  });

  test.afterAll(async () => {
    [TENANT_FIXTURE, BOUNDARY_FIXTURE, MASTERS_FIXTURE, HIERARCHY_FIXTURE].forEach((p) => fs.rmSync(p, { force: true }));
    await deactivateTenantViaApi(ids.TENANT_CODE);
  });

  test('login → Phase 1 → Phase 2 → Phase 3 → ready for Phase 4', {
    annotation: {
      type: 'description',
      description: `End-to-end UI walk through the configurator's onboarding wizard for a brand-new tenant: login (Onboarding mode) → Phase 1 (tenant xlsx + skip branding) → Phase 2 (Upload from Excel → create hierarchy + upload boundary xlsx + verify + upload) → Phase 3 (Common-masters xlsx with Departments/Designations → Create & Continue → Step 3.2 Define Complaint Hierarchy → upload hierarchy template → Create N Sub-types) → ready for Phase 4. Drives only the UI; the wizard's internal API calls are exercised through the actual buttons/file pickers, not API helpers.

Steps:
1. setTimeout 360s; generate four xlsx fixtures (tenant, boundary, masters, complaint-hierarchy) in beforeAll.
2. Open /configurator/login, fill ADMIN/eGov@123/ke, click Onboarding, click Sign In, wait for /configurator/phase/1.
3. Phase 1: click Start Setup → upload tenant xlsx → assert tenant code cell → click Upload to DIGIT → on the branding step click Continue → assert "Phase 1 Complete!" → click Continue to Phase 2.
4. Phase 2: click "Upload from Excel" on the "Choose Your Data Source" landing → "Option 1: Create New Hierarchy" → fill #hierarchyType → Create Hierarchy → upload boundary xlsx → verify → "Upload N Boundaries" → Continue to Phase 3.
5. Phase 3: click Start Setup → upload masters xlsx → Create & Continue → Step 3.2 Define Complaint Hierarchy (leave default levels) → Next: Template → upload complaint-hierarchy xlsx → Create N Sub-types → assert "Phase 3 Complete!" within 120s → assert "Continue to Phase 4" button is visible.

Teardown is API-only because the configurator has no UI delete affordance for tenants — tracked in CCRS#21. Phase 4 (employee xlsx) is intentionally a separate spec because it needs jurisdiction+role validation setup. Test timeout is 360s because Phase 2 boundary uploads + Phase 3 creates can each take 60–120s.`,
    },
    tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(360_000);

    // Composite walk: login → Phase 1 → Phase 2 → Phase 3 (incl. the
    // mandatory Step 3.2 complaint-hierarchy sub-flow) → "Phase 3 Complete!".
    await completePhases123(page, ids, {
      tenant: TENANT_FIXTURE,
      boundary: BOUNDARY_FIXTURE,
      masters: MASTERS_FIXTURE,
      hierarchy: HIERARCHY_FIXTURE,
    });

    // Ready for Phase 4 — that walk is its own spec (employee xlsx with
    // jurisdiction + role validation needs its own setup story).
    await expect(page.getByRole('button', { name: /Continue to Phase 4/i })).toBeVisible();
  });
});
