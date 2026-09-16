import { test, expect, type Page, type Request } from '@playwright/test';
import {
  ANALYTICS_QUERY,
  NetworkRecorder,
  dashboardUrl,
  installSession,
  queryHasParam,
  waitForStrictReady,
  type Principal,
} from './dashboard-harness';

const principal = (process.env.DASHBOARD_PRINCIPAL || 'full') as Principal;

async function openDashboard(page: Page, recorder: NetworkRecorder): Promise<void> {
  await page.goto(dashboardUrl(process.env.BASE_URL!, principal), {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await waitForStrictReady(page, recorder);
}

test.beforeEach(async ({ context }) => {
  await installSession(context, principal);
});

test('loading reaches a strict, error-free ready state', async ({ page }) => {
  const recorder = new NetworkRecorder(page);
  await recorder.start();
  await openDashboard(page, recorder);

  await expect(page.locator('.dashboard-grid-layout .react-grid-item')).not.toHaveCount(0);
  await expect(page.locator('.kpi-tile__skeleton, .kpi-tile--loading')).toHaveCount(0);
  await expect(page.locator('.kpi-tile--error, [data-error-code]')).toHaveCount(0);
  expect(recorder.dashboardCalls().filter((call) => call.failed || (call.status || 0) >= 400)).toHaveLength(0);
  expect(recorder.pageErrors).toHaveLength(0);
  expect(recorder.consoleErrors).toHaveLength(0);
  recorder.stop();
});

test('ward and date filters issue bounded analytics queries and clear cleanly', async ({ page }) => {
  test.skip(principal === 'public', 'the public dashboard is intentionally read-only');
  const recorder = new NetworkRecorder(page);
  const requests: Request[] = [];
  page.on('request', (request) => {
    if (ANALYTICS_QUERY.test(request.url()) && request.method() === 'POST') requests.push(request);
  });
  await recorder.start();
  await openDashboard(page, recorder);

  const wardSelect = page.locator('select[aria-label="Ward filter"]');
  const wardButton = page.getByRole('button', { name: /ward filter/i });
  const usesNativeSelect = await wardSelect.isVisible().catch(() => false);
  const beforeWard = requests.length;
  if (usesNativeSelect) {
    const optionValues = await wardSelect.locator('option').evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value).filter((value) => value && value !== 'all'),
    );
    test.skip(optionValues.length === 0, 'deployment exposes no selectable ward');
    await wardSelect.selectOption(optionValues[0]);
  } else {
    await expect(wardButton).toBeVisible();
    await wardButton.click();
    const wardOption = page.locator('button.dashboard-menu-item:not([data-selected="true"])').filter({ hasNotText: /^all wards$/i }).first();
    test.skip(!(await wardOption.isVisible().catch(() => false)), 'deployment exposes no selectable ward');
    await wardOption.click();
  }
  await waitForStrictReady(page, recorder);
  expect(queryHasParam(requests.slice(beforeWard), 'ward')).toBe(true);

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 6);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const beforeDate = requests.length;
  await page.getByRole('textbox', { name: /from date/i }).fill(iso(from));
  await page.getByRole('textbox', { name: /to date/i }).fill(iso(to));
  await waitForStrictReady(page, recorder);
  expect(queryHasParam(requests.slice(beforeDate), 'dateFrom', iso(from))).toBe(true);
  expect(queryHasParam(requests.slice(beforeDate), 'dateTo', iso(to))).toBe(true);

  await page.getByRole('button', { name: /^clear$/i }).click();
  await waitForStrictReady(page, recorder);
  if (usesNativeSelect) await expect(wardSelect).toHaveValue('all');
  else await expect(wardButton).toContainText(/all wards/i);
  recorder.stop();
});

test('widget move and resize persist and trigger zero analytics queries', async ({ page }) => {
  test.skip(principal === 'public', 'the public dashboard is intentionally read-only');
  const recorder = new NetworkRecorder(page);
  await recorder.start();
  await openDashboard(page, recorder);
  recorder.resetCalls();

  // RGL can reorder its child array after a swap, so keep the widget identity
  // through its unique remove-button name instead of a dynamic `.first()`.
  const removeButton = page.locator('.dashboard-grid-layout .react-grid-item').first()
    .locator('button.dashboard-widget-remove-btn');
  const removeLabel = await removeButton.getAttribute('aria-label');
  expect(removeLabel).toBeTruthy();
  const item = page.getByRole('button', { name: removeLabel!, exact: true }).locator('..');
  const targetItem = page.locator('.dashboard-grid-layout .react-grid-item').nth(1);
  await expect(targetItem).toBeVisible();
  const box = await item.boundingBox();
  const targetBox = await targetItem.boundingBox();
  expect(box, 'first widget must have a draggable surface').not.toBeNull();
  expect(targetBox, 'second widget is the deterministic swap target').not.toBeNull();
  const beforeTransform = await item.getAttribute('style');
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 20);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 20, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(750);
  const afterTransform = await item.getAttribute('style');
  expect(afterTransform, 'drag must change the grid geometry').not.toBe(beforeTransform);
  expect.soft(recorder.analyticsCount(), 'a pure widget move must not query analytics').toBe(0);
  await waitForStrictReady(page, recorder);
  recorder.resetCalls();

  const resizeHandle = item.locator('.react-resizable-handle').first();
  await expect(resizeHandle).toBeVisible();
  const beforeResize = await item.boundingBox();
  const handleBox = await resizeHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + 64, handleBox!.y + 64, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(750);
  const afterResize = await item.boundingBox();
  expect(
    Math.abs((afterResize?.width || 0) - (beforeResize?.width || 0)) +
      Math.abs((afterResize?.height || 0) - (beforeResize?.height || 0)),
    'resize must change at least one widget dimension',
  ).toBeGreaterThan(1);
  expect(recorder.analyticsCount(), 'a pure widget resize must not query analytics').toBe(0);

  const saved = await page.evaluate(() => Object.fromEntries(
    Object.keys(localStorage)
      .filter((key) => key.startsWith('ccrs.dashboard.catalog-layout.v1.'))
      .map((key) => [key, localStorage.getItem(key)]),
  ));
  expect(Object.keys(saved), 'layout must be persisted under a tenant/user scoped key').not.toHaveLength(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForStrictReady(page, recorder);
  const restored = await page.evaluate(() => Object.fromEntries(
    Object.keys(localStorage)
      .filter((key) => key.startsWith('ccrs.dashboard.catalog-layout.v1.'))
      .map((key) => [key, localStorage.getItem(key)]),
  ));
  expect(restored).toEqual(saved);
  recorder.stop();
});

test('group-by re-queries with hierLevel and telemetry correlates the load', async ({ page }) => {
  const recorder = new NetworkRecorder(page);
  const requests: Request[] = [];
  page.on('request', (request) => {
    if (ANALYTICS_QUERY.test(request.url()) && request.method() === 'POST') requests.push(request);
  });
  await recorder.start();
  await openDashboard(page, recorder);

  await expect.poll(() => recorder.metricNames(), { timeout: 8_000 })
    .toContain('dashboard.all_widgets_ready.ms');
  expect(recorder.queryHeaders.some((headers) => headers.traceparent && headers['x-trace-id'])).toBe(true);
  expect(recorder.traceId()).toBeTruthy();

  const groupBy = page.locator('button[aria-label="Group by"]').first();
  test.skip(!(await groupBy.isVisible().catch(() => false)), 'selected pack has no group-by capable widget');
  const before = requests.length;
  await groupBy.click();
  const option = page.locator('button.dashboard-menu-item:not([data-selected="true"])').first();
  test.skip(!(await option.isVisible().catch(() => false)), 'deployment exposes no alternate group-by level');
  await option.click();
  await waitForStrictReady(page, recorder);
  expect(queryHasParam(requests.slice(before), 'hierLevel')).toBe(true);
  recorder.stop();
});
