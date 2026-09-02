#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const resultDir = resolve(process.argv[2] || process.env.DASHBOARD_RESULTS_DIR || '');
if (!process.argv[2] && !process.env.DASHBOARD_RESULTS_DIR) {
  console.error('usage: summarize-results.mjs RESULT_DIR');
  process.exit(2);
}

const sampleDir = resolve(resultDir, 'samples');
const samples = existsSync(sampleDir)
  ? readdirSync(sampleDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => JSON.parse(readFileSync(resolve(sampleDir, name), 'utf8')))
  : [];
const measured = samples.filter((sample) => !sample.discardedWarmup);
const successful = measured.filter((sample) => sample.success);

const loadStarts = measured.map((sample) => Date.parse(sample.loadStartedAt)).filter(Number.isFinite);
const loadFinishes = measured.map((sample) => Date.parse(sample.loadFinishedAt)).filter(Number.isFinite);
const measuredWindowSeconds = loadStarts.length && loadFinishes.length
  ? (Math.max(...loadFinishes) - Math.min(...loadStarts)) / 1000
  : null;

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function stats(path) {
  const values = successful
    .map((sample) => path.split('.').reduce((value, key) => value?.[key], sample))
    .filter(Number.isFinite);
  return {
    count: values.length,
    min: values.length ? Math.min(...values) : null,
    p50: percentile(values, 50),
    median: percentile(values, 50),
    p80: percentile(values, 80),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.length ? Math.max(...values) : null,
  };
}

const first = samples[0] || {};
const summary = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  runId: first.runId || null,
  target: first.target || null,
  targetSha: first.targetSha || null,
  tier: first.tier || null,
  principal: first.principal || null,
  vus: first.vus || 1,
  warmups: samples.filter((sample) => sample.discardedWarmup).length,
  measuredSamples: measured.length,
  successfulSamples: successful.length,
  failedSamples: measured.length - successful.length,
  failureRate: measured.length ? (measured.length - successful.length) / measured.length : null,
  measuredWindowSeconds,
  successfulLoadsPerSecond: measuredWindowSeconds > 0 ? successful.length / measuredWindowSeconds : null,
  timingsMs: {
    strictReady: stats('timings.strictReadyMs'),
    ttfb: stats('timings.ttfbMs'),
    firstWidgetVisible: stats('timings.firstWidgetVisibleMs'),
    productionAllWidgetsReady: stats('timings.productionAllWidgetsReadyMs'),
  },
  jsHeapUsedBytes: stats('page.jsHeapUsedBytes'),
  transferBytes: stats('network.transferBytes'),
  analyticsRoundTrips: stats('network.analyticsRoundTrips'),
  failures: measured.filter((sample) => !sample.success).map((sample) => ({
    repeatIndex: sample.repeatIndex,
    failure: sample.failure,
    failedDashboardCalls: sample.network?.failedDashboardCalls || [],
    pageErrors: sample.page?.pageErrors || [],
  })),
};

mkdirSync(resultDir, { recursive: true });
writeFileSync(resolve(resultDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

const headers = [
  'run_id', 'target', 'sha', 'tier', 'principal', 'vus', 'virtual_user', 'iteration',
  'repeat_index', 'warmup', 'success', 'load_started_at', 'load_finished_at',
  'strict_ready_ms', 'ttfb_ms', 'first_widget_ms', 'production_ready_ms',
  'dashboard_requests', 'analytics_round_trips', 'transfer_bytes', 'js_heap_used_bytes',
  'errored_widgets', 'trace_id', 'failure',
  'pack_id', 'reported_record_count', 'reported_persona',
];
const csv = [headers.join(',')];
for (const sample of samples) {
  const row = [
    sample.runId, sample.target, sample.targetSha, sample.tier, sample.principal,
    sample.vus || 1, sample.virtualUserIndex ?? 0, sample.iterationIndex ?? sample.repeatIndex,
    sample.repeatIndex, sample.discardedWarmup, sample.success,
    sample.loadStartedAt, sample.loadFinishedAt,
    sample.timings?.strictReadyMs, sample.timings?.ttfbMs,
    sample.timings?.firstWidgetVisibleMs, sample.timings?.productionAllWidgetsReadyMs,
    sample.network?.dashboardRequestCount, sample.network?.analyticsRoundTrips,
    sample.network?.transferBytes, sample.page?.jsHeapUsedBytes,
    sample.page?.erroredWidgets, sample.telemetry?.traceId, sample.failure,
    sample.catalog?.packId, sample.catalog?.reportedRecordCount, sample.catalog?.persona,
  ];
  csv.push(row.map(csvValue).join(','));
}
writeFileSync(resolve(resultDir, 'samples.csv'), `${csv.join('\n')}\n`);
console.log(JSON.stringify(summary, null, 2));

function csvValue(value) {
  if (value == null) return '';
  const string = String(value);
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}
