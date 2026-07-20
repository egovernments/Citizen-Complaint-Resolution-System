import { test, expect } from '@playwright/test';
import { BASE_URL } from '../utils/env';

test('MDMS ThemeConfig is fetched and applied as CSS variables', {
  annotation: {
    type: 'description',
    description: `End-to-end check that the MDMS ThemeConfig actually reaches the browser as CSS custom properties on :root. The citizen login page is the simplest place to test — it triggers theme fetch on load. Reads --color-primary-main, --color-primary-dark, --color-digitv2-header-sidenav, etc. and asserts they are non-empty AND not the default DIGIT orange (#c84c0e — that would mean the MDMS override never landed).

Steps:
1. setTimeout 60s; navigate to /digit-ui/citizen/login, wait 8s for theme apply.
2. evaluate getComputedStyle on :root; grab five CSS custom properties.
3. Log the captured theme vars.
4. Assert primaryMain, primaryDark, and headerSidenav are all truthy.
5. Assert primaryMain and headerSidenav lowercased are NOT '#c84c0e' (default orange must be overridden).
6. Assert all three colors match /^#[0-9a-f]{6}$/i.

Catches the most common theme regression — MDMS fetch fails or the applyTheme() call is gated wrong, and the default orange leaks through to a Kenya deployment.`,
  },
  tag: ['@area:configurator-manage', '@area:theme', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto(`${BASE_URL}/digit-ui/citizen/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  // Read the CSS custom properties set on :root by applyTheme()
  const themeVars = await page.evaluate(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    return {
      primaryMain: style.getPropertyValue('--color-primary-main').trim(),
      primaryDark: style.getPropertyValue('--color-primary-dark').trim(),
      headerSidenav: style.getPropertyValue('--color-digitv2-header-sidenav').trim(),
      textPrimary: style.getPropertyValue('--color-text-primary').trim(),
      border: style.getPropertyValue('--color-border').trim(),
    };
  });

  console.log('Theme CSS variables:', themeVars);

  // Verify theme was applied (not empty)
  expect(themeVars.primaryMain).toBeTruthy();
  expect(themeVars.primaryDark).toBeTruthy();
  expect(themeVars.headerSidenav).toBeTruthy();

  // Verify the default orange (#c84c0e) is NOT present — proves MDMS override worked
  expect(themeVars.primaryMain.toLowerCase()).not.toBe('#c84c0e');
  expect(themeVars.headerSidenav.toLowerCase()).not.toBe('#c84c0e');

  // All color values must be valid hex
  const hexPattern = /^#[0-9a-f]{6}$/i;
  expect(themeVars.primaryMain).toMatch(hexPattern);
  expect(themeVars.primaryDark).toMatch(hexPattern);
  expect(themeVars.headerSidenav).toMatch(hexPattern);
});
