import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import exec from 'k6/execution';
import { login, makeRequestInfo } from '../helpers/auth.js';

const VUS = parseInt(__ENV.VUS || '2', 10);
const HOLD = __ENV.HOLD_DURATION || '2m';
const WARMUP = __ENV.WARMUP_DURATION || '30s';
const EXPECTED_ROWS = parseInt(__ENV.EXPECTED_ROWS || '0', 10);
const PACING_SECONDS = Number(__ENV.PACING_SECONDS || '10');

if (!Number.isInteger(VUS) || VUS < 1) throw new Error('VUS must be a positive integer');
if (!Number.isInteger(EXPECTED_ROWS) || EXPECTED_ROWS < 1) {
  throw new Error('EXPECTED_ROWS must be a positive integer');
}

export const dashboardLoadDuration = new Trend('dashboard_load_duration', true);
export const dashboardSuccess = new Rate('dashboard_success');
export const dashboardPartial = new Rate('dashboard_partial');
export const dashboardQueries = new Counter('dashboard_queries');

export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-vus',
      vus: Math.max(1, Math.floor(VUS / 10)),
      duration: WARMUP,
      gracefulStop: '0s',
      exec: 'dashboardVisit',
      tags: { phase: 'warmup' },
    },
    main: {
      executor: 'constant-vus',
      vus: VUS,
      duration: HOLD,
      startTime: WARMUP,
      exec: 'dashboardVisit',
      tags: { phase: 'main' },
    },
  },
  thresholds: {
    'dashboard_success{phase:main}': ['rate>0.99'],
    'dashboard_partial{phase:main}': ['rate<0.01'],
    'dashboard_load_duration{phase:main}': ['p(95)<15000'],
    'http_req_failed{phase:main}': ['rate<0.01'],
    'http_req_duration{phase:main}': ['p(95)>=0'],
    'http_reqs{phase:main}': ['rate>=0'],
    'iterations{phase:main}': ['rate>=0'],
    'dashboard_queries{phase:main}': ['count>=0'],
  },
};

let token = null;
let userInfo = null;

function required(name) {
  const value = __ENV[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requestInfo() {
  return makeRequestInfo(token, userInfo);
}

function postJson(url, payload, name) {
  return http.post(url, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      traceparent: `00-${String(exec.vu.idInTest).padStart(32, '0')}-${String(exec.scenario.iterationInTest + 1).padStart(16, '0')}-01`,
      'x-trace-id': `dashboard-k6-${exec.vu.idInTest}-${exec.scenario.iterationInTest}`,
    },
    tags: { name },
    timeout: '60s',
  });
}

function ensureAuth(baseUrl, username, password, authTenant) {
  if (token) return true;
  const auth = login(baseUrl, username, password, authTenant, 'EMPLOYEE');
  if (!auth) return false;
  token = auth.token;
  userInfo = auth.userInfo;
  return true;
}

function queryChunks(tiles, maximum) {
  const refs = {};
  for (const tile of tiles || []) {
    if (!tile || typeof tile.kpiId !== 'string') continue;
    refs[tile.kpiId] = { kpiId: tile.kpiId, params: {} };
  }
  const entries = Object.entries(refs);
  const size = Number.isInteger(maximum) && maximum > 0 ? maximum : 20;
  const chunks = [];
  for (let offset = 0; offset < entries.length; offset += size) {
    chunks.push(Object.fromEntries(entries.slice(offset, offset + size)));
  }
  return chunks;
}

export function dashboardVisit() {
  const baseUrl = required('BASE_URL').replace(/\/$/, '');
  const tenantId = required('DIGIT_TENANT');
  const username = required('DIGIT_USERNAME');
  const password = required('DIGIT_PASSWORD');
  const authTenant = __ENV.DASHBOARD_AUTH_TENANT || tenantId.split('.')[0];
  const analyticsBase = `${baseUrl}/pgr-services/v2/analytics`;
  const started = Date.now();
  let success = false;
  let partial = false;

  try {
    if (!ensureAuth(baseUrl, username, password, authTenant)) return;

    const bootstrap = http.batch([
      ['POST', `${analyticsBase}/packs`, JSON.stringify({
        RequestInfo: requestInfo(), tenantId,
      }), { headers: { 'Content-Type': 'application/json' }, tags: { name: 'Dashboard_Packs' }, timeout: '60s' }],
      ['POST', `${analyticsBase}/catalog/_search`, JSON.stringify({
        RequestInfo: requestInfo(), tenantId, filters: { status: 'published' },
      }), { headers: { 'Content-Type': 'application/json' }, tags: { name: 'Dashboard_Catalog' }, timeout: '60s' }],
    ]);
    const packResponse = bootstrap[0];
    const catalogResponse = bootstrap[1];
    if (!check(packResponse, { 'pack HTTP 200': (response) => response.status === 200 }) ||
        !check(catalogResponse, { 'catalog HTTP 200': (response) => response.status === 200 })) return;

    const pack = packResponse.json();
    const catalog = catalogResponse.json();
    if (!check(pack, {
      'pack row count matches tier': (value) => Number(value.recordCount) === EXPECTED_ROWS,
      'pack contains tiles': (value) => Array.isArray(value.tiles) && value.tiles.length > 0,
    })) return;
    if (!check(catalog, {
      'catalog contains visible tiles': (value) => Array.isArray(value.tiles) && value.tiles.length > 0,
    })) return;

    const visible = new Set(catalog.tiles.map((tile) => tile?.kpiId).filter(Boolean));
    const tiles = pack.tiles.filter((tile) => visible.has(tile?.kpiId));
    const chunks = queryChunks(tiles, Number(pack.maxBatchQueries));
    if (!chunks.length) return;

    for (let index = 0; index < chunks.length; index += 1) {
      const response = postJson(`${analyticsBase}/_query`, {
        RequestInfo: requestInfo(), tenantId, queries: chunks[index],
      }, 'Dashboard_Query');
      dashboardQueries.add(Object.keys(chunks[index]).length);
      if (!check(response, { 'query HTTP 200': (value) => value.status === 200 })) return;
      const body = response.json();
      partial = partial || body.partial === true;
      const results = body.results || {};
      if (!check(results, {
        'all KPI results present': (value) => Object.keys(chunks[index]).every((key) => value[key] && !value[key].error),
      })) return;
    }
    success = !partial;
  } finally {
    const elapsedMs = Date.now() - started;
    const phase = exec.scenario.name === 'main' ? 'main' : 'warmup';
    dashboardLoadDuration.add(elapsedMs, { phase });
    dashboardSuccess.add(success, { phase });
    dashboardPartial.add(partial, { phase });
    const remaining = PACING_SECONDS - elapsedMs / 1000;
    if (remaining > 0) sleep(remaining);
  }
}

export default dashboardVisit;
