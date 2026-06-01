import { test, expect } from '@playwright/test';
import { BASE_URL } from '../utils/env';

test('MDMS ThemeConfig is fetched and applied as CSS variables', async ({ page }) => {
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
