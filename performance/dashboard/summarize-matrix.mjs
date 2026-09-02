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

const output = { schemaVersion: 2, generatedAt: new Date().toISOString(), prefix, rows, comparisons };
const outputBase = resolve(root, `${prefix || 'dashboard'}-matrix`);
writeFileSync(`${outputBase}.json`, `${JSON.stringify(output, null, 2)}\n`);

const headers = [
  'tier', 'vus', 'loads_per_second', 'http_rps', 'http_requests',
  'dashboard_p50_ms', 'dashboard_p80_ms', 'dashboard_p90_ms', 'dashboard_p95_ms',
  'dashboard_p99_ms', 'dashboard_max_ms', 'success_rate', 'partial_rate',
  'http_p50_ms', 'http_p80_ms', 'http_p90_ms', 'http_p95_ms', 'http_p99_ms',
  'http_max_ms', 'http_failure_rate', 'query_rate',
  'host_max_load1', 'host_min_available_mib', 'db_max_connections', 'db_max_active',
  'db_max_waiting', 'pgr_max_cpu_percent', 'pgr_max_memory_percent', 'pgr_restarts', 'pgr_oom',
];
const csv = [headers.join(',')];
for (const row of rows) csv.push(headers.map((key) => csvValue(row[camel(key)])).join(','));
writeFileSync(`${outputBase}.csv`, `${csv.join('\n')}\n`);
console.log(JSON.stringify(output, null, 2));

function readRun(directory, name) {
  const match = name.match(/-bomet-snapshot-(3k|20k|50k|100k|500k)-full-(\d+)vu-k6$/);
  if (!match || !existsSync(resolve(directory, 'summary.json'))) return null;
  const summary = JSON.parse(readFileSync(resolve(directory, 'summary.json'), 'utf8'));
  const metrics = summary.metrics || {};
  const raw = readK6Csv(resolve(directory, 'metrics.csv'));
  const dashboard = trendStats(raw, 'dashboard_load_duration');
  const http = trendStats(raw, 'http_req_duration');
  const loadsPerSecond = metric(metrics, 'iterations{phase:main}', 'rate');
  const iterationCount = metric(metrics, 'iterations{phase:main}', 'count');
  const measuredSeconds = Number.isFinite(loadsPerSecond) && loadsPerSecond > 0 && Number.isFinite(iterationCount)
    ? iterationCount / loadsPerSecond
    : null;
  const httpRequests = counter(raw, 'http_reqs');
  const httpRps = firstFinite(
    metric(metrics, 'http_reqs{phase:main}', 'rate'),
    Number.isFinite(httpRequests) && Number.isFinite(measuredSeconds) && measuredSeconds > 0
      ? httpRequests / measuredSeconds
      : null,
  );
  const runtime = readRuntime(resolve(directory, 'runtime.ndjson'));
  return {
    tier: match[1],
    vus: Number(match[2]),
    loadsPerSecond,
    httpRps,
    httpRequests,
    dashboardP50Ms: firstFinite(dashboard.p50, metric(metrics, 'dashboard_load_duration{phase:main}', 'med')),
    dashboardP80Ms: firstFinite(dashboard.p80, metric(metrics, 'dashboard_load_duration{phase:main}', 'p(80)')),
    dashboardP90Ms: firstFinite(dashboard.p90, metric(metrics, 'dashboard_load_duration{phase:main}', 'p(90)')),
    dashboardP95Ms: firstFinite(dashboard.p95, metric(metrics, 'dashboard_load_duration{phase:main}', 'p(95)')),
    dashboardP99Ms: firstFinite(dashboard.p99, metric(metrics, 'dashboard_load_duration{phase:main}', 'p(99)')),
    dashboardMaxMs: firstFinite(dashboard.max, metric(metrics, 'dashboard_load_duration{phase:main}', 'max')),
    successRate: metric(metrics, 'dashboard_success{phase:main}', 'value'),
    partialRate: metric(metrics, 'dashboard_partial{phase:main}', 'value'),
    httpP50Ms: firstFinite(http.p50, metric(metrics, 'http_req_duration{phase:main}', 'med')),
    httpP80Ms: firstFinite(http.p80, metric(metrics, 'http_req_duration{phase:main}', 'p(80)')),
    httpP90Ms: firstFinite(http.p90, metric(metrics, 'http_req_duration{phase:main}', 'p(90)')),
    httpP95Ms: firstFinite(http.p95, metric(metrics, 'http_req_duration{phase:main}', 'p(95)')),
    httpP99Ms: firstFinite(http.p99, metric(metrics, 'http_req_duration{phase:main}', 'p(99)')),
    httpMaxMs: firstFinite(http.max, metric(metrics, 'http_req_duration{phase:main}', 'max')),
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
function readK6Csv(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n');
  const headers = parseCsvLine(lines.shift() || '');
  const indexes = Object.fromEntries(headers.map((name, index) => [name, index]));
  const wanted = new Set(['dashboard_load_duration', 'http_req_duration', 'http_reqs']);
  const samples = [];
  for (const line of lines) {
    if (!line) continue;
    const firstComma = line.indexOf(',');
    if (firstComma < 0 || !wanted.has(line.slice(0, firstComma))) continue;
    const fields = parseCsvLine(line);
    if (fields[indexes.scenario] !== 'main') continue;
    const value = Number(fields[indexes.metric_value]);
    if (!Number.isFinite(value)) continue;
    samples.push({ name: fields[indexes.metric_name], value });
  }
  return samples;
}
function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      fields.push(field); field = '';
    } else field += character;
  }
  fields.push(field);
  return fields;
}
function trendStats(samples, name) {
  const values = samples.filter((sample) => sample.name === name).map((sample) => sample.value).sort((a, b) => a - b);
  return {
    p50: percentile(values, 50), p80: percentile(values, 80), p90: percentile(values, 90),
    p95: percentile(values, 95), p99: percentile(values, 99),
    max: values.length ? values[values.length - 1] : null,
  };
}
function percentile(values, requested) {
  if (!values.length) return null;
  const position = (values.length - 1) * (requested / 100);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return values[lower] + (values[upper] - values[lower]) * (position - lower);
}
function counter(samples, name) {
  const values = samples.filter((sample) => sample.name === name).map((sample) => sample.value);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}
function firstFinite(...values) { return values.find(Number.isFinite) ?? null; }
function percent(value) { const number = Number(String(value || '').replace('%', '')); return Number.isFinite(number) ? number : null; }
function maximum(values) { const valid = values.filter(Number.isFinite); return valid.length ? Math.max(...valid) : null; }
function minimum(values) { const valid = values.filter(Number.isFinite); return valid.length ? Math.min(...valid) : null; }
function ratio(value, baseline) { return Number.isFinite(value) && Number.isFinite(baseline) && baseline !== 0 ? value / baseline : null; }
function tierRows(tier) { return ({ '3k': 3000, '20k': 20000, '50k': 50000, '100k': 100000, '500k': 500000 })[tier] || Infinity; }
function camel(value) { return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()); }
function csvValue(value) {
  if (value == null) return '';
  const string = String(value);
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}
