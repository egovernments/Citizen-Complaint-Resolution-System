import { test, expect } from '@playwright/test';
import {
  NetworkRecorder,
  dashboardUrl,
  heapMetrics,
  installPaintProbe,
  installSession,
  waitForStrictReady,
  writeSample,
  type DashboardSample,
  type Principal,
} from './dashboard-harness';

test('cold-context dashboard hard-navigation sample', async ({ page, context }, testInfo) => {
  const warmups = Number(process.env.DASHBOARD_WARMUPS || 2);
  const principal = (process.env.DASHBOARD_PRINCIPAL || 'full') as Principal;
  const recorder = new NetworkRecorder(page);
  const startedAt = new Date().toISOString();
  let strictReadyMs: number | null = null;
  let ttfbMs: number | null = null;
  let firstWidgetVisibleMs: number | null = null;
  let jsHeapUsedBytes: number | null = null;
  let jsHeapTotalBytes: number | null = null;
  let visibleWidgets = 0;
  let erroredWidgets = 0;
  let failure: string | null = null;
  let callsAtReady: ReturnType<NetworkRecorder['dashboardCalls']> = [];
  let requestCountAtReady = 0;
  let transferBytesAtReady = 0;

  await installPaintProbe(page);
  await installSession(context, principal);
  await recorder.start();

  try {
    const response = await page.goto(dashboardUrl(process.env.BASE_URL!, principal), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    if (!response || response.status() >= 400) {
      throw new Error(`dashboard navigation returned HTTP ${response?.status() ?? 'no response'}`);
    }

    strictReadyMs = await waitForStrictReady(page, recorder);
    callsAtReady = recorder.dashboardCalls().map((call) => ({ ...call }));
    requestCountAtReady = recorder.calls.length;
    transferBytesAtReady = recorder.encodedTransferBytes();
    const nav = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return entry ? { ttfb: entry.responseStart, first: (window as any).__dashboardBenchmark?.firstWidgetVisibleMs ?? null } : null;
    });
    ttfbMs = nav?.ttfb ?? null;
    firstWidgetVisibleMs = nav?.first ?? null;
    visibleWidgets = await page.locator('.dashboard-grid-layout .react-grid-item').count();
    erroredWidgets = await page.locator('.kpi-tile--error, [data-error-code]').count();
    const heap = await heapMetrics(page);
    jsHeapUsedBytes = heap.used;
    jsHeapTotalBytes = heap.total;

    // The production emitter flushes two seconds after its own ready mark. This
    // wait is deliberately after strictReadyMs is frozen and is not included in
    // the benchmark duration.
    await expect.poll(() => recorder.metricNames(), { timeout: 8_000 })
      .toContain('dashboard.all_widgets_ready.ms');
  } catch (error) {
    failure = error instanceof Error ? error.stack || error.message : String(error);
  }

  const failedCalls = callsAtReady.filter((call) => call.failed || (call.status != null && call.status >= 400));
  const sortedCalls = [...callsAtReady]
    .filter((call) => call.durationMs != null)
    .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));
  const queryHeadersPresent = recorder.queryHeaders.some((headers) =>
    Boolean(headers.traceparent && headers['x-trace-id']),
  );
  const pack = recorder.packPayloads.at(-1) || {};
  const scopes = recorder.queryPayloads
    .map((payload) => payload?.scope)
    .filter((scope) => scope != null);
  if (failure == null && principal === 'department') {
    const restricted = scopes.some((scope) =>
      (Array.isArray(scope?.departments) && scope.departments.length > 0) || Boolean(scope?.boundaryPrefix),
    );
    if (!restricted) failure = 'department principal did not receive a restricted analytics scope';
  }
  const success = failure == null && failedCalls.length === 0 && erroredWidgets === 0 &&
    recorder.pageErrors.length === 0 && recorder.consoleErrors.length === 0;

  const sample: DashboardSample = {
    schemaVersion: 1,
    runId: process.env.RUN_ID || 'manual',
    target: process.env.DASHBOARD_TARGET || 'unknown',
    targetSha: process.env.DASHBOARD_TARGET_SHA || 'unknown',
    tier: process.env.DATASET_TIER || 'unknown',
    principal,
    repeatIndex: testInfo.repeatEachIndex,
    discardedWarmup: testInfo.repeatEachIndex < warmups,
    startedAt,
    success,
    failure,
    timings: {
      strictReadyMs,
      ttfbMs,
      firstWidgetVisibleMs,
      productionAllWidgetsReadyMs: recorder.productionMetric('dashboard.all_widgets_ready.ms'),
    },
    network: {
      requestCount: requestCountAtReady,
      dashboardRequestCount: callsAtReady.length,
      analyticsRoundTrips: callsAtReady.filter((call) => /\/analytics(?:\/public)?\/_query(?:\?|$)/.test(call.url)).length,
      transferBytes: transferBytesAtReady,
      slowestDashboardCalls: sortedCalls.slice(0, 3),
      failedDashboardCalls: failedCalls,
    },
    page: {
      visibleWidgets,
      erroredWidgets,
      jsHeapUsedBytes,
      jsHeapTotalBytes,
      consoleErrors: recorder.consoleErrors,
      pageErrors: recorder.pageErrors,
    },
    telemetry: {
      metricNames: [...new Set(recorder.metricNames())].sort(),
      traceId: recorder.traceId(),
      queryTraceHeadersPresent: queryHeadersPresent,
    },
    catalog: {
      packId: pack.packId == null ? null : String(pack.packId),
      reportedRecordCount: pack.recordCount != null && Number.isFinite(Number(pack.recordCount))
        ? Number(pack.recordCount)
        : null,
      persona: pack.persona == null ? null : String(pack.persona),
      scopes,
    },
  };

  const resultPath = writeSample(sample);
  await testInfo.attach('dashboard-sample', { path: resultPath, contentType: 'application/json' });
  recorder.stop();

  expect(sample.failure, sample.failure || undefined).toBeNull();
  expect(sample.network.failedDashboardCalls, 'dashboard-owned requests must succeed').toHaveLength(0);
  expect(sample.page.erroredWidgets, 'all visible widgets must render without an error state').toBe(0);
  expect(sample.page.pageErrors, 'page must not throw an uncaught exception').toHaveLength(0);
  expect(sample.page.consoleErrors, 'dashboard must not log browser-console errors').toHaveLength(0);
  expect(sample.telemetry.queryTraceHeadersPresent, 'analytics query must carry trace headers').toBe(true);
  if (principal === 'department') expect(sample.catalog.scopes, sample.failure || undefined).not.toHaveLength(0);
});
