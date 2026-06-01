import { test } from '@playwright/test';

test('inspect theme-config edit page colors', {
  annotation: {
    type: 'description',
    description: `Diagnostic spec for the theme-config editor — captures the exact color-input names and values the form is rendering, plus all MDMS/theme network calls and console output, then snapshots a full-page screenshot. Used when investigating cases where an admin edits theme colors and sees swatches that don't match the underlying hex values.

Steps:
1. Attach listeners for console messages, MDMS/theme/oauth requests, and theme/MDMS responses.
2. Open the configurator root; if the login form appears, fill ADMIN / eGov@123 / tenant ke, pick Management mode, and sign in.
3. Navigate to /configurator/manage/theme-config/kenya-green/edit and wait 8s for hydration.
4. From the page, evaluate the DOM to collect: count of <input type="color">, name+value of the first 30 colors, computed background of color swatches, hex-bearing text inputs, and a 500-char snippet of body text.
5. Log the captured state, the first 30 console messages, the first 10 captured requests, and the first 5 captured responses.
6. Save a fullPage screenshot at /tmp/theme-config-edit.png.

Diagnostic-only; no assertions. Long-timeout (120s) because login + heavy MDMS hydration before the editor renders.`,
  },
  tag: ['@area:theme', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
  test.setTimeout(120_000);

  const consoleMessages: string[] = [];
  page.on('console', msg => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
  const requests: { url: string; method: string; body?: string }[] = [];
  page.on('request', req => {
    if (req.url().includes('mdms') || req.url().includes('theme') || req.url().includes('user/oauth')) {
      requests.push({ url: req.url(), method: req.method(), body: req.postData() || undefined });
    }
  });
  const responses: { url: string; status: number; body?: any }[] = [];
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('theme') || (url.includes('mdms') && url.includes('_search'))) {
      try {
        const body = await resp.json();
        responses.push({ url, status: resp.status(), body });
      } catch {
        responses.push({ url, status: resp.status() });
      }
    }
  });

  // 1. Log in to configurator
  await page.goto('https://naipepea.digit.org/configurator/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const url1 = page.url();
  console.log('After load, URL:', url1);

  // If on login page, fill in and submit
  if (url1.includes('login') || await page.getByLabel(/username|user name/i).isVisible().catch(() => false)) {
    console.log('Filling login form...');
    await page.getByLabel(/username|user name/i).fill('ADMIN');
    await page.getByLabel(/password/i).fill('eGov@123');
    // Tenant field
    const tenantField = page.getByLabel(/tenant/i).first();
    if (await tenantField.isVisible().catch(() => false)) {
      await tenantField.fill('ke');
    }
    // Choose Management Mode
    const mgmtRadio = page.getByText(/management/i).first();
    if (await mgmtRadio.isVisible().catch(() => false)) {
      await mgmtRadio.click().catch(() => {});
    }
    await page.getByRole('button', { name: /sign in|login|submit/i }).first().click();
    await page.waitForTimeout(5000);
    console.log('After login, URL:', page.url());
  }

  // 2. Navigate to theme-config edit page
  await page.goto('https://naipepea.digit.org/configurator/manage/theme-config/kenya-green/edit', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(8000);

  console.log('Final URL:', page.url());

  // 3. Inspect color inputs
  const colorState = await page.evaluate(() => {
    const result: any = {};
    // All color inputs
    const colorInputs = document.querySelectorAll('input[type="color"]');
    result.colorInputCount = colorInputs.length;
    result.colorInputs = Array.from(colorInputs).slice(0, 30).map(el => ({
      name: (el as HTMLInputElement).name || (el as HTMLElement).getAttribute('data-source') || (el as HTMLElement).id,
      value: (el as HTMLInputElement).value,
    }));
    // Visible color swatches (divs with style background)
    const swatches: any[] = [];
    document.querySelectorAll('[class*="swatch"],[class*="color-preview"],[class*="ColorPreview"]').forEach(el => {
      const style = window.getComputedStyle(el as HTMLElement);
      swatches.push({
        cls: (el as HTMLElement).className,
        bg: style.backgroundColor,
      });
    });
    result.swatches = swatches.slice(0, 20);
    // Form input fields by name (text inputs holding hex)
    const textInputs: any[] = [];
    document.querySelectorAll('input[type="text"]').forEach(el => {
      const v = (el as HTMLInputElement).value;
      const name = (el as HTMLInputElement).name;
      if (v && /#[0-9a-fA-F]/.test(v)) {
        textInputs.push({ name, value: v });
      }
    });
    result.hexTextInputs = textInputs.slice(0, 30);
    // Page text snippet
    result.bodyTextSnip = document.body.innerText.slice(0, 500);
    return result;
  });
  console.log('Color state:', JSON.stringify(colorState, null, 2));

  console.log('--- console messages ---');
  consoleMessages.slice(0, 30).forEach(m => console.log(m));

  console.log('--- MDMS / theme requests ---');
  requests.slice(0, 10).forEach(r => console.log(`${r.method} ${r.url}\n  body: ${(r.body || '').slice(0, 200)}`));

  console.log('--- MDMS / theme responses ---');
  for (const r of responses.slice(0, 5)) {
    console.log(`${r.status} ${r.url}`);
    if (r.body) {
      const snippet = JSON.stringify(r.body).slice(0, 800);
      console.log('  body:', snippet);
    }
  }

  await page.screenshot({ path: '/tmp/theme-config-edit.png', fullPage: true });
  console.log('Screenshot at /tmp/theme-config-edit.png');
});
