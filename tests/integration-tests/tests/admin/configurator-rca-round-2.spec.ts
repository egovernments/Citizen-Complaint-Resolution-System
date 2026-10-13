/**
 * Configurator RCA round 2: the two checks kept from
 * configurator/e2e-onboarding/configurator-rca-round-2.spec.ts when that
 * suite was retired (#2398 D). Its other checks have counterparts here:
 * #417 in admin/recently-shipped-fixes, #461/#462 in
 * specs/configurator/user-create, and #459 was city-tenant only (decision 2).
 *
 * The configurator session comes from the chromium project's storageState.
 */
import { test, expect } from '@playwright/test';
import { ROOT_TENANT } from '../utils/env';
import { CONFIGURATOR_BASE } from '../utils/configurator-auth';
import { loadAuth, mdmsSearch } from '../utils/manage/api';

test.describe('Configurator RCA round 2', () => {
  test('#476: hardcoded RETIRED/TERMINATED/RESIGNED floor is gone from the served bundle', {
    annotation: {
      type: 'description',
      description: `CCRS#476 removed a hardcoded deactivation-reason floor; reasons now come only from MDMS egov-hrms.DeactivationReason. The dropdown only mounts for an employee being deactivated, so this reads the served bundle instead: TERMINATED and RESIGNED appear nowhere else in the configurator (Employee Status uses EMPLOYED / INACTIVE / RETIRED), so their absence proves the floor is gone. The configurator is one Vite chunk (no lazy imports), so index-*.js is the whole app.`,
    },
    tag: ['@persona:admin', '@area:configurator-manage', '@area:hrms', '@layer:ui', '@kind:regression', '@ccrs:476'],
  }, async ({ request }) => {
    const html = await (await request.get(`${CONFIGURATOR_BASE}/`)).text();
    const entry = html.match(/assets\/index-[^"']+\.js/)?.[0];
    expect(entry, 'configurator index.html must reference its assets/index-*.js bundle').toBeTruthy();

    const bundle = await (await request.get(`${CONFIGURATOR_BASE}/${entry}`)).text();
    expect(bundle.length).toBeGreaterThan(10_000);
    expect(bundle).not.toContain('TERMINATED');
    expect(bundle).not.toContain('RESIGNED');
  });

  test('#483: Gender Types edit renders the active flag as a checkbox, not text', {
    annotation: {
      type: 'description',
      description: `CCRS#483: MdmsResourceEdit rendered boolean MDMS fields as text inputs, so an operator could save the string "false" and MDMS rejected it. GenderType's data.active duplicates the record's root isActive, so MdmsResourceEdit hides it and shows the root "Active" checkbox (BooleanInput) instead. Opens a live gender type's edit page and asserts that checkbox exists and no text input for active does.`,
    },
    tag: ['@persona:admin', '@area:configurator-manage', '@area:mdms-schema', '@layer:ui', '@kind:regression', '@ccrs:483'],
  }, async ({ page }) => {
    const [record] = await mdmsSearch(loadAuth(), ROOT_TENANT, 'common-masters.GenderType', { limit: 1, isActive: true });
    expect(record?.uniqueIdentifier, `no active common-masters.GenderType at ${ROOT_TENANT}`).toBeTruthy();

    // react-admin keys MDMS records by uniqueIdentifier (normalizeMdmsRecord).
    await page.goto(`${CONFIGURATOR_BASE}/manage/gender-types/${encodeURIComponent(record.uniqueIdentifier)}/edit`);
    await expect(page.getByRole('checkbox', { name: /^Active$/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('textbox', { name: /active/i })).toHaveCount(0);
  });
});
