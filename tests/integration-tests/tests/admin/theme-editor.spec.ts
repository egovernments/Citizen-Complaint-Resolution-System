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

const THEME_RECORD_ID = 'kenya-green';

test('API smoke — ThemeConfig record exists on the expected tenant', async () => {
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

test('edit page renders the flagship editor (tabs + preview)', async ({ page }) => {
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

test('editing primary.main updates the preview live', async ({ page }) => {
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
