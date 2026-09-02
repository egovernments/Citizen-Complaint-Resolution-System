#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] || 'performance/results/dashboard-runs');
const prefix = process.argv[3] || '';
if (!existsSync(root)) throw new Error(`results directory not found: ${root}`);

const rows = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.includes(prefix) && entry.name.endsWith('vu-k6'))
  .map((entry) => readRun(resolve(root, entry.name), entry.name))
  .filter(Boolean)
  .sort((a, b) => tierRows(a.tier) - tierRows(b.tier) || a.vus - b.vus);

if (!rows.length) throw new Error(`no dashboard k6 results found for prefix '${prefix}' under ${root}`);

const comparisons = [];
const tiers = [...new Set(rows.map((row) => row.tier))];
const vusLevels = [...new Set(rows.map((row) => row.vus))].sort((a, b) => a - b);
for (const tier of tiers) {
  const baseline = rows.find((row) => row.tier === tier);
  for (const row of rows.filter((candidate) => candidate.tier === tier)) {
    comparisons.push({
      kind: 'concurrency', tier, vus: row.vus,
      p95VsLowestVu: ratio(row.dashboardP95Ms, baseline?.dashboardP95Ms),
      throughputVsLowestVu: ratio(row.loadsPerSecond, baseline?.loadsPerSecond),
    });
  }
}
for (const vus of vusLevels) {
  const atVu = rows.filter((row) => row.vus === vus);
  if (atVu.length < 2) continue;
  const baseline = atVu[0];
  for (const row of atVu.slice(1)) {
    comparisons.push({
      kind: 'dataset', vus, fromTier: baseline.tier, toTier: row.tier,
      p95Ratio: ratio(row.dashboardP95Ms, baseline.dashboardP95Ms),
      throughputRatio: ratio(row.loadsPerSecond, baseline.loadsPerSecond),
    });
  }
}

const output = { schemaVersion: 1, generatedAt: new Date().toISOString(), prefix, rows, comparisons };
const outputBase = resolve(root, `${prefix || 'dashboard'}-matrix`);
writeFileSync(`${outputBase}.json`, `${JSON.stringify(output, null, 2)}\n`);

const headers = [
  'tier', 'vus', 'loads_per_second', 'dashboard_p50_ms', 'dashboard_p95_ms', 'dashboard_max_ms',
  'success_rate', 'partial_rate', 'http_p95_ms', 'http_failure_rate', 'query_rate',
  'host_max_load1', 'host_min_available_mib', 'db_max_connections', 'db_max_active',
  'db_max_waiting', 'pgr_max_cpu_percent', 'pgr_max_memory_percent', 'pgr_restarts', 'pgr_oom',
];
const csv = [headers.join(',')];
for (const row of rows) csv.push(headers.map((key) => csvValue(row[camel(key)])).join(','));
writeFileSync(`${outputBase}.csv`, `${csv.join('\n')}\n`);
console.log(JSON.stringify(output, null, 2));

function readRun(directory, name) {
  const match = name.match(/-bomet-snapshot-(3k|20k|50k|100k)-full-(\d+)vu-k6$/);
  if (!match || !existsSync(resolve(directory, 'summary.json'))) return null;
  const summary = JSON.parse(readFileSync(resolve(directory, 'summary.json'), 'utf8'));
  const metrics = summary.metrics || {};
  const runtime = readRuntime(resolve(directory, 'runtime.ndjson'));
  return {
    tier: match[1],
    vus: Number(match[2]),
    loadsPerSecond: metric(metrics, 'iterations{phase:main}', 'rate'),
    dashboardP50Ms: metric(metrics, 'dashboard_load_duration{phase:main}', 'med'),
    dashboardP95Ms: metric(metrics, 'dashboard_load_duration{phase:main}', 'p(95)'),
    dashboardMaxMs: metric(metrics, 'dashboard_load_duration{phase:main}', 'max'),
    successRate: metric(metrics, 'dashboard_success{phase:main}', 'value'),
    partialRate: metric(metrics, 'dashboard_partial{phase:main}', 'value'),
    httpP95Ms: metric(metrics, 'http_req_duration{phase:main}', 'p(95)'),
    httpFailureRate: metric(metrics, 'http_req_failed{phase:main}', 'value'),
    queryRate: metric(metrics, 'dashboard_queries{phase:main}', 'rate'),
    ...runtime,
    resultDirectory: directory,
  };
}

function readRuntime(path) {
  const empty = {
    hostMaxLoad1: null, hostMinAvailableMib: null,
    dbMaxConnections: null, dbMaxActive: null, dbMaxWaiting: null,
    pgrMaxCpuPercent: null, pgrMaxMemoryPercent: null,
    pgrRestarts: null, pgrOom: null,
  };
  if (!existsSync(path)) return empty;
  const samples = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (!samples.length) return empty;
  const pgrStats = samples.flatMap((sample) => sample.containers || [])
    .filter((container) => /pgr-services/i.test(container.name));
  return {
    hostMaxLoad1: maximum(samples.map((sample) => Number(String(sample.host?.loadAverage || '').split(' ')[0]))),
    hostMinAvailableMib: minimum(samples.map((sample) => Number(sample.host?.memoryAvailableKiB) / 1024)),
    dbMaxConnections: maximum(samples.map((sample) => Number(sample.postgres?.connections))),
    dbMaxActive: maximum(samples.map((sample) => Number(sample.postgres?.active))),
    dbMaxWaiting: maximum(samples.map((sample) => Number(sample.postgres?.waiting))),
    pgrMaxCpuPercent: maximum(pgrStats.map((sample) => percent(sample.cpu))),
    pgrMaxMemoryPercent: maximum(pgrStats.map((sample) => percent(sample.memoryPercent))),
    pgrRestarts: maximum(samples.map((sample) => Number(sample.pgr?.restartCount))),
    pgrOom: samples.some((sample) => sample.pgr?.oomKilled === true),
  };
}

function metric(metrics, name, field) {
  const value = metrics[name]?.[field];
  return Number.isFinite(value) ? value : null;
}
function percent(value) { const number = Number(String(value || '').replace('%', '')); return Number.isFinite(number) ? number : null; }
function maximum(values) { const valid = values.filter(Number.isFinite); return valid.length ? Math.max(...valid) : null; }
function minimum(values) { const valid = values.filter(Number.isFinite); return valid.length ? Math.min(...valid) : null; }
function ratio(value, baseline) { return Number.isFinite(value) && Number.isFinite(baseline) && baseline !== 0 ? value / baseline : null; }
function tierRows(tier) { return ({ '3k': 3000, '20k': 20000, '50k': 50000, '100k': 100000 })[tier] || Infinity; }
function camel(value) { return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()); }
function csvValue(value) {
  if (value == null) return '';
  const string = String(value);
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}
