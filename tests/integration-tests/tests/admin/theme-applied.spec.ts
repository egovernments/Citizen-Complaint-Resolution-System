import { test, expect } from '@playwright/test';
import { BASE_URL } from '../utils/env';

/** The stock DIGIT orange shipped in `digit-ui-esbuild/src/theme/default.json`.
 *  `src/index.js` calls `applyTheme(defaultTheme)` SYNCHRONOUSLY at bundle load,
 *  so this is what `--color-primary-main` holds until the MDMS override lands. */
const STOCK_DIGIT_ORANGE = '#c84c0e';

/** Shape of the `common-masters.ThemeConfig` MDMS record we care about. */
interface ThemeConfigRecord {
  colors?: {
    primary?: { main?: string; dark?: string };
    digitv2?: Record<string, string>;
    text?: { primary?: string };
    border?: string;
  };
}

test('MDMS ThemeConfig is fetched and applied as CSS variables', {
  annotation: {
    type: 'description',
    description: `End-to-end check that the MDMS ThemeConfig actually reaches the browser as CSS custom properties on :root. The citizen login page is the simplest place to test — StoreService.digitInitData() fetches MDMS on load and calls window.Digit.applyTheme(themeConfig).

Two independent halves, so a green means both "fetched" and "applied":
1. FETCHED — capture the /egov-mdms-service/v1/_search response the app itself makes and pull common-masters.ThemeConfig[0] out of it. That record IS the expectation; nothing is hardcoded.
2. APPLIED — poll getComputedStyle(:root) until the five CSS custom properties EQUAL the colours in that record.

Steps:
1. Attach a response listener for any /v1/_search that captures a body carrying MdmsRes['common-masters'].ThemeConfig[0]. (The MDMS context path is a globalConfig — egov-mdms-service on some deployments, mdms-v2 on others — so the body shape, not the path, identifies the call.)
2. Navigate to /digit-ui/citizen/login.
3. expect.poll until the ThemeConfig has been captured (proves it was fetched).
4. Assert the captured record actually overrides the stock DIGIT orange — otherwise step 5 would be tautological.
5. expect.poll getComputedStyle(:root) until --color-primary-main / --color-primary-dark / --color-digitv2-header-sidenav / --color-text-primary / --color-border all equal the captured values.

Why polling and not a fixed sleep: applyTheme() runs TWICE. src/index.js applies the bundled default synchronously at load; StoreService.digitInitData() overwrites it only after the MDMS round-trip resolves. Reading at a fixed offset races that round-trip — the previous version slept 8s and flipped between pass and fail on the same commit. expect.poll re-reads until the override lands (or fails honestly at the timeout).

Catches the most common theme regression — MDMS fetch fails or the applyTheme() call is gated wrong, and the default orange leaks through to a non-DIGIT-branded deployment.`,
  },
  tag: ['@area:configurator-manage', '@area:theme', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
  test.setTimeout(90_000);

  // --- half 1: the app must FETCH a ThemeConfig ---
  // Pushed into an array rather than a `let` so TypeScript doesn't narrow the
  // capture to `null` (assignment happens inside the listener closure).
  const captured: ThemeConfigRecord[] = [];
  page.on('response', async (res) => {
    // The MDMS context path is a globalConfig (MDMS_V1_CONTEXT_PATH), so it is
    // `egov-mdms-service` on some deployments and `mdms-v2` on others — pinning
    // either literal is a deployment pin. Match the versioned search path and
    // let the MdmsRes body shape below do the actual identification.
    if (!/\/v1\/_search(\?|$)/.test(res.url())) return;
    try {
      const body = (await res.json()) as {
        MdmsRes?: { 'common-masters'?: { ThemeConfig?: ThemeConfigRecord[] } };
      };
      const cfg = body?.MdmsRes?.['common-masters']?.ThemeConfig?.[0];
      if (cfg) captured.push(cfg);
    } catch {
      // Non-JSON / aborted response — not the init call we're after.
    }
  });

  await page.goto(`${BASE_URL}/digit-ui/citizen/login`, { waitUntil: 'domcontentloaded' });

  await expect
    .poll(() => captured.length, {
      timeout: 45_000,
      message:
        'the citizen shell must fetch common-masters.ThemeConfig from the MDMS v1 _search on load',
    })
    .toBeGreaterThan(0);

  const colors = captured[0].colors ?? {};
  const expected = {
    primaryMain: colors.primary?.main ?? '',
    primaryDark: colors.primary?.dark ?? '',
    headerSidenav: colors.digitv2?.['header-sidenav'] ?? '',
    textPrimary: colors.text?.primary ?? '',
    border: colors.border ?? '',
  };
  console.log('MDMS ThemeConfig colours:', expected);

  // The MDMS record itself must be a real, complete override. Without this
  // guard the comparison below could "pass" against a half-empty record.
  const hexPattern = /^#[0-9a-f]{6}$/i;
  for (const [key, value] of Object.entries(expected)) {
    expect(value, `MDMS ThemeConfig must define a hex colour for ${key}`).toMatch(hexPattern);
  }
  expect(
    expected.primaryMain.toLowerCase(),
    'MDMS ThemeConfig still carries the stock DIGIT orange — this deployment has no branding override, so this test could not distinguish "applied" from "never applied"',
  ).not.toBe(STOCK_DIGIT_ORANGE);

  // --- half 2: the browser must APPLY it to :root ---
  // Polled, not slept on: index.js paints the bundled default synchronously and
  // digitInitData() overwrites it only once the MDMS promise resolves.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const style = getComputedStyle(document.documentElement);
          const read = (name: string) => style.getPropertyValue(name).trim().toLowerCase();
          return {
            primaryMain: read('--color-primary-main'),
            primaryDark: read('--color-primary-dark'),
            headerSidenav: read('--color-digitv2-header-sidenav'),
            textPrimary: read('--color-text-primary'),
            border: read('--color-border'),
          };
        }),
      {
        timeout: 45_000,
        message:
          'applyTheme() must overwrite the bundled default theme on :root with the MDMS ThemeConfig colours',
      },
    )
    .toEqual({
      primaryMain: expected.primaryMain.toLowerCase(),
      primaryDark: expected.primaryDark.toLowerCase(),
      headerSidenav: expected.headerSidenav.toLowerCase(),
      textPrimary: expected.textPrimary.toLowerCase(),
      border: expected.border.toLowerCase(),
    });
});
