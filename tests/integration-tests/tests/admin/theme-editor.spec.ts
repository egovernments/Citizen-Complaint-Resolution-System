/**
 * Theme editor UI test — regression guard for PR #4 (flagship theme editor).
 *
 * Asserts that /manage/theme-config/<id>/edit renders the dedicated editor
 * (tabs + grouped color pickers + live preview) rather than the generic
 * form. Also asserts the preview actually watches form state — editing a
 * color in the form should mutate the matching element's style in the
 * preview on the next render.
 *
 * If the `customEditor` escape hatch on SchemaDescriptor regresses, the
 * fallback would be the generic MdmsResourceEdit form (no tabs, no preview)
 * — this spec catches that.
 *
 * Auth: relies on the project-level auth.setup.ts storageState (auth.json).
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

// Theme record under common-masters.ThemeConfig. An explicit THEME_RECORD_ID
// wins; otherwise we RESOLVE the deployment's active record at runtime rather
// than hardcoding one deployment's seed.
//
// Why: the old default `kenya-green` is the naipepea seed. On other deployments
// that record can still EXIST while being isActive=false (bomet ships an active
// `bomet-county` and keeps `kenya-green` around, deactivated). The configurator's
// dataProvider filters `isActive` on BOTH getList and getOne
// (packages/data-provider/src/providers/dataProvider.ts), so an inactive id is
// unloadable: react-admin's Edit gets nothing from getOne and bounces to the
// list, the editor never mounts, and every tab assertion fails with a bare
// "element(s) not found" that points nowhere near the real cause.
const THEME_RECORD_ID_OVERRIDE = process.env.THEME_RECORD_ID;

interface ThemeRecord {
  id?: string;
  uniqueIdentifier?: string;
  isActive?: boolean;
  data?: { colors?: unknown };
}

/** Raw MDMS _search for ThemeConfig on ROOT_TENANT. Returns records as stored. */
async function searchThemeConfigs(uniqueIdentifiers?: string[]): Promise<ThemeRecord[]> {
  const t = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
  const criteria: Record<string, unknown> = {
    tenantId: ROOT_TENANT,
    schemaCode: 'common-masters.ThemeConfig',
  };
  if (uniqueIdentifiers?.length) criteria.uniqueIdentifiers = uniqueIdentifiers;
  const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: {
        apiId: 'Rainmaker', ver: '1.0', ts: Date.now(),
        msgId: `${Date.now()}|en_IN`, authToken: t.access_token,
      },
      MdmsCriteria: criteria,
    }),
  });
  const body = (await resp.json()) as { mdms?: ThemeRecord[] };
  return body.mdms || [];
}

const recordIdOf = (r: ThemeRecord): string => String(r.uniqueIdentifier ?? r.id ?? '');

/**
 * The id the editor specs drive. Resolved once in beforeAll: explicit override,
 * else the tenant's single active ThemeConfig — i.e. exactly what the UI can load.
 */
let THEME_RECORD_ID = THEME_RECORD_ID_OVERRIDE || '';

test.beforeAll(async () => {
  if (THEME_RECORD_ID) return;
  const records = await searchThemeConfigs();
  const active = records.filter((r) => r.isActive !== false && r.data?.colors);
  expect(
    active.length,
    `no active common-masters.ThemeConfig record with a colors tree on ${ROOT_TENANT} — `
      + `found ${records.length} record(s): `
      + JSON.stringify(records.map((r) => ({ id: recordIdOf(r), isActive: r.isActive })))
      + '. Seed one, or set THEME_RECORD_ID.',
  ).toBeGreaterThan(0);
  THEME_RECORD_ID = recordIdOf(active[0]);
});

test('API smoke — ThemeConfig record exists on the expected tenant', {
  annotation: {
    type: 'description',
    description: `Pre-flight for the theme editor specs: the ThemeConfig record the editor specs drive (THEME_RECORD_ID, or the tenant's active record) must exist on the root tenant, be ACTIVE, and carry a colors tree. If this fails, the editor specs below have nothing to load and would fail with a less useful "page didn't render" error.

Asserting isActive matters: the configurator's dataProvider filters isActive on getOne, so an existing-but-deactivated record is unloadable in the UI. Checking existence alone reports a false green and pushes the real failure into the UI specs as an unexplained "tab not found".

Steps:
1. MDMS _search for THEME_RECORD_ID on ROOT_TENANT (schemaCode 'common-masters.ThemeConfig').
2. Assert exactly one record came back.
3. Assert it is not isActive=false — i.e. the UI's getOne can actually load it.
4. Assert data.colors is truthy.

Smoke-tier test — keeps the failure mode clear when the seed has been wiped or deactivated.`,
  },
  tag: ['@area:configurator-manage', '@area:theme', '@kind:smoke', '@layer:ui', '@persona:admin'] }, async () => {
  const records = await searchThemeConfigs([THEME_RECORD_ID]);
  expect(records.length, `${THEME_RECORD_ID} must exist on ${ROOT_TENANT}`).toBe(1);
  expect(
    records[0].isActive,
    `${THEME_RECORD_ID} exists on ${ROOT_TENANT} but is deactivated (isActive=false), so the `
      + `configurator's getOne filters it out and the edit page bounces back to the list. `
      + `Point THEME_RECORD_ID at the tenant's active theme record.`,
  ).not.toBe(false);
  expect(records[0].data?.colors, 'record should carry a colors tree').toBeTruthy();
});

test('edit page renders the flagship editor (tabs + preview)', {
  annotation: {
    type: 'description',
    description: `Catches regression on PR #4 (flagship theme editor). The /manage/theme-config/<id>/edit URL must render the dedicated editor — the v3 designer-1:1 token tabs plus a live preview. If the customEditor escape hatch on SchemaDescriptor regresses, the fallback would be the generic MdmsResourceEdit form (no tabs, no preview), which this test would catch.

Steps:
1. setTimeout 90s; navigate to /configurator/manage/theme-config/kenya-green/edit (45s timeout).
2. For each tab name in ['Brand & Surface', 'Text', 'Buttons', 'Inputs', 'Header & Sidebar', 'Status', 'Tables & Misc', 'Charts'] (the ThemeConfig descriptor's non-Identity groups), assert the matching role=tab is visible (within 30s).
3. Assert at least one element with [data-token] (the live preview marker) is visible within 10s.

Uses the auth.setup.ts storageState — admin token already in localStorage.`,
  },
  tag: ['@area:configurator-manage', '@area:theme', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
  test.setTimeout(90_000);

  // storageState from auth.setup already has the session in localStorage;
  // go straight to the edit URL.
  await page.goto(`/configurator/manage/theme-config/${THEME_RECORD_ID}/edit`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });

  // Tabs render — means customEditor hatch fired. These are the
  // ThemeConfig descriptor's field groups minus the "Identity" strip
  // (see schemaDescriptors/theme-config.ts). The old v1 tab set
  // ('Primary / Link', 'Grey', …) no longer exists — the editor is v3
  // designer-1:1 with flat tokens like colors.primary-1.
  const tabLabels = [
    'Brand & Surface',
    'Text',
    'Buttons',
    'Inputs',
    'Header & Sidebar',
    'Status',
    'Tables & Misc',
    'Charts',
  ];
  for (const label of tabLabels) {
    const tab = page.getByRole('tab', { name: label }).first();
    await expect(tab, `tab "${label}" should render`).toBeVisible({ timeout: 30_000 });
  }

  // Preview widget present — something with data-token is the giveaway.
  const preview = page.locator('[data-token]').first();
  await expect(preview, 'live preview should render').toBeVisible({ timeout: 10_000 });
});

test('editing a brand token updates the preview live', {
  annotation: {
    type: 'description',
    description: `Round-trip test for the editor's live preview: changing a color token in the form must mutate the matching preview element's computed backgroundColor on the next render. We drive the "Primary button / bg default" token (colors.button-primary-bg-default) — ThemePreview fans it into the v1 primary.main path that the Primary preview button renders, and it is the last writer to primary.main in ThemePreview's V2_TO_V1_FALLBACK map, so the change is deterministic regardless of the seed record's other tokens. Uses #FF1493 (hot pink) so it can't collide with any kenya-green default. Reverts before exiting so the test is idempotent and never leaves MDMS dirty.

Steps:
1. setTimeout 90s; navigate to the edit URL.
2. Click the "Buttons" tab.
3. Locate the "Primary button / bg default" row, find its <input type="text"> (the form-bound hex input); wait for visibility.
4. Capture the originalHex (default '#006B3F' fallback).
5. Fill TEST_HEX = '#FF1493' and blur.
6. Locate the preview button [data-token~="colors.primary.main"] filtered by text "Primary"; assert visible.
7. Use expect.poll on getComputedStyle(button).backgroundColor; assert it becomes 'rgb(255, 20, 147)' within 5s.
8. Fill the input back to originalHex and blur.

Doesn't actually click Save — the revert keeps MDMS clean even if a stray click hits the save button.`,
  },
  tag: ['@area:configurator-manage', '@area:theme', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto(`/configurator/manage/theme-config/${THEME_RECORD_ID}/edit`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });

  // Switch to the Buttons tab so the input is visible.
  await page.getByRole('tab', { name: 'Buttons' }).first().click({ timeout: 30_000 });

  // ColorInput renders a native <input type=color> + a text box. Target the
  // text box since that binds directly to the form value. The label text
  // comes from the theme-config descriptor (colors.button-primary-bg-default).
  const primaryMainRow = page
    .locator('label', { hasText: /Primary button \/ bg default/i })
    .first()
    .locator('..');
  const hexInput = primaryMainRow.locator('input[type="text"]').first();
  await expect(hexInput).toBeVisible({ timeout: 15_000 });

  const originalHex = (await hexInput.inputValue()) || '#006B3F';

  // A clearly-distinct test color — hot pink, won't collide with any
  // kenya-green default.
  const TEST_HEX = '#FF1493';
  await hexInput.fill(TEST_HEX);
  await hexInput.blur();

  // Read the computed bg color off the primary button in the preview.
  // Several elements carry data-token~="colors.primary.main" (sidebar
  // active item, button) but only the button's background is driven by
  // primary.main — the sidebar active item uses selected-bg. Target the
  // button by its visible label.
  const previewButton = page
    .locator('[data-token~="colors.primary.main"]')
    .filter({ hasText: /^Primary$/ })
    .first();
  await expect(previewButton).toBeVisible();

  await expect
    .poll(
      async () =>
        previewButton.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor),
      { timeout: 5_000 },
    )
    .toBe('rgb(255, 20, 147)');

  // Revert so the test is idempotent — we don't want to leave MDMS dirty
  // if the Save button gets accidentally clicked.
  await hexInput.fill(originalHex);
  await hexInput.blur();
});
