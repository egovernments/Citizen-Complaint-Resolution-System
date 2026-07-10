import { chromium } from 'playwright';

const BASE = 'https://bometfeedbackhub.digit.org/configurator';
// Chromium resolves the real domain (valid cert) through the SSH tunnel on :8443.
const ARGS = ['--host-resolver-rules=MAP bometfeedbackhub.digit.org 127.0.0.1:8443'];

const log = (...a) => console.log(...a);

const browser = await chromium.launch({ args: ARGS });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

try {
  // --- login (Management mode) ---
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByRole('button', { name: /Management/ }).click().catch(() => {});
  await page.fill('#username', 'ADMIN');
  await page.fill('#password', 'eGov@123');
  await page.fill('#tenantCode', 'ke');
  await page.getByRole('button', { name: /Sign In/i }).click();
  await page.waitForTimeout(4000);
  log('after login url:', page.url());

  // --- localization list ---
  await page.goto(BASE + '/manage/localization', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // pick Module = Configurator UI. Target the module trigger specifically
  // (the header also has a Theme combobox) by its current "All modules" text.
  const moduleTrigger = page.locator('[role=combobox]').filter({ hasText: /All modules/ });
  await moduleTrigger.click();
  await page.getByRole('option', { name: /Configurator UI/ }).click();

  // sample row count right away and again after a delay (catch the "poof")
  await page.waitForTimeout(1500);
  const early = await page.locator('table tbody tr').count();
  await page.waitForTimeout(4000);
  const late = await page.locator('table tbody tr').count();
  const noRecords = await page.getByText('No records found').count();
  const headers = await page.locator('table thead th').allInnerTexts();

  await page.screenshot({ path: '/tmp/loc-multilocale.png', fullPage: true });

  log('HEADERS:', JSON.stringify(headers));
  log('ROWS early:', early, '| ROWS late:', late, '| "No records found":', noRecords);

  // read first row's locale cells to confirm columns are populated
  const firstRow = page.locator('table tbody tr').first();
  const cells = await firstRow.locator('td').allInnerTexts().catch(() => []);
  log('FIRST ROW cells:', JSON.stringify(cells));

  const ok = late > 0 && noRecords === 0
    && headers.some((h) => /en_IN/.test(h)) && headers.some((h) => /fr_FR/.test(h))
    && headers.some((h) => /hi_IN/.test(h)) && headers.some((h) => /pt_BR/.test(h));
  log(ok ? '\n✅ PASS — grid persists with EN/HI/PT/FR columns' : '\n❌ FAIL — see above');
  log('console errors:', errors.slice(0, 8));
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (e) {
  log('THREW:', e.message);
  await page.screenshot({ path: '/tmp/loc-multilocale-error.png', fullPage: true }).catch(() => {});
  log('console errors:', errors.slice(0, 8));
  await browser.close();
  process.exit(2);
}
