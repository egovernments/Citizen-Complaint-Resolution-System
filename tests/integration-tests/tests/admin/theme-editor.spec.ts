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

// Theme record under common-masters.ThemeConfig — override per deployment
// (e.g. `bomet-green`, `india-saffron`). Defaults to the naipepea seed.
const THEME_RECORD_ID = process.env.THEME_RECORD_ID || 'kenya-green';

test('API smoke — ThemeConfig record exists on the expected tenant', {
  annotation: {
    type: 'description',
    description: `Pre-flight for the theme editor specs: the kenya-green ThemeConfig record must exist on root tenant 'ke' and carry a colors tree. If this fails, the editor specs below have nothing to load and would fail with a less useful "page didn't render" error.

Steps:
1. getDigitToken(ROOT_TENANT, ADMIN_USER, ADMIN_PASS).
2. POST /mdms-v2/v2/_search with schemaCode 'common-masters.ThemeConfig' and uniqueIdentifiers ['kenya-green'].
3. Assert response.mdms.length === 1.
4. Assert response.mdms[0].data.colors is truthy.

Smoke-tier test — keeps the failure mode clear when the seed has been wiped.`,
  },
  tag: ['@area:configurator-manage', '@area:theme', '@kind:smoke', '@layer:ui', '@persona:admin'] }, async () => {
  const t = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
  const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: {
        apiId: 'Rainmaker', ver: '1.0', ts: Date.now(),
        msgId: `${Date.now()}|en_IN`, authToken: t.access_token,
      },
      MdmsCriteria: {
        tenantId: ROOT_TENANT, schemaCode: 'common-masters.ThemeConfig',
        uniqueIdentifiers: [THEME_RECORD_ID],
      },
    }),
  });
  const body = (await resp.json()) as { mdms?: Array<{ data?: { colors?: unknown } }> };
  expect(body.mdms?.length, `${THEME_RECORD_ID} must exist on ${ROOT_TENANT}`).toBe(1);
  expect(body.mdms?.[0].data?.colors, 'record should carry a colors tree').toBeTruthy();
});

test('edit page renders the flagship editor (tabs + preview)', {
  annotation: {
    type: 'description',
    description: `Catches regression on PR #4 (flagship theme editor). The /manage/theme-config/<id>/edit URL must render the dedicated editor — tabs (Primary/Link, Text, Grey, Charts) plus a live preview. If the customEditor escape hatch on SchemaDescriptor regresses, the fallback would be the generic MdmsResourceEdit form (no tabs, no preview), which this test would catch.

Steps:
1. setTimeout 90s; navigate to /configurator/manage/theme-config/kenya-green/edit (45s timeout).
2. For each tab name in ['Primary / Link', 'Text', 'Grey', 'Charts'], assert the matching role=tab is visible (within 30s).
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

  // Tabs render — means customEditor hatch fired.
  const tabLabels = ['Primary / Link', 'Text', 'Grey', 'Charts'];
  for (const label of tabLabels) {
    const tab = page.getByRole('tab', { name: label }).first();
    await expect(tab, `tab "${label}" should render`).toBeVisible({ timeout: 30_000 });
  }

  // Preview widget present — something with data-token is the giveaway.
  const preview = page.locator('[data-token]').first();
  await expect(preview, 'live preview should render').toBeVisible({ timeout: 10_000 });
});

test('editing primary.main updates the preview live', {
  annotation: {
    type: 'description',
    description: `Round-trip test for the editor's live preview: changing the primary.main color in the form must mutate the matching preview element's computed backgroundColor on the next render. Uses #FF1493 (hot pink) so it can't collide with any kenya-green default. Reverts before exiting so the test is idempotent and never leaves MDMS dirty.

Steps:
1. setTimeout 90s; navigate to the edit URL.
2. Click the "Primary / Link" tab.
3. Locate the Primary/main row, find its <input type="text"> (the form-bound hex input); wait for visibility.
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

  // Switch to the Primary/Link tab so the input is visible.
  await page.getByRole('tab', { name: 'Primary / Link' }).first().click({ timeout: 30_000 });

  // ColorInput renders a native <input type=color> + a text box. Target the
  // text box since that binds directly to the form value.
  const primaryMainRow = page
    .locator('text=/Primary\\s*\\/\\s*main/i')
    .first()
    .locator('..')
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
