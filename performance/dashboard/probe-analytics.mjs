#!/usr/bin/env node

import { performance } from 'node:perf_hooks';

const expectedRecordCount = Number(process.argv[2]);
if (!Number.isSafeInteger(expectedRecordCount) || expectedRecordCount < 1) {
  throw new Error('usage: probe-analytics.mjs EXPECTED_RECORD_COUNT');
}

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const baseUrl = required('BASE_URL').replace(/\/$/, '');
const tenantId = required('DIGIT_TENANT');
const username = required('DIGIT_USERNAME');
const password = required('DIGIT_PASSWORD');
const authTenant = process.env.DASHBOARD_AUTH_TENANT || tenantId.split('.')[0];
const timeoutMs = Number(process.env.DASHBOARD_PROBE_TIMEOUT_MS || 20_000);

async function post(url, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${url} returned non-JSON HTTP ${response.status}`);
    }
    return { response, json, durationMs: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

const auth = await post(
  `${baseUrl}/user/oauth/token`,
  new URLSearchParams({
    grant_type: 'password',
    username,
    password,
    tenantId: authTenant,
    scope: 'read',
    userType: 'EMPLOYEE',
  }),
  {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
  },
);
if (!auth.response.ok || !auth.json.access_token) {
  throw new Error(`analytics probe authentication failed with HTTP ${auth.response.status}`);
}

const requestInfo = () => ({
  apiId: 'Rainmaker',
  ver: '.01',
  ts: Date.now(),
  action: '_search',
  msgId: `dashboard-readiness-${Date.now()}`,
  authToken: auth.json.access_token,
  userInfo: auth.json.UserRequest || {},
});
const analyticsHeaders = { 'Content-Type': 'application/json' };
const analyticsBase = `${baseUrl}/pgr-services/v2/analytics`;

// Request 1/2: proves the catalog path and the live JDBC-backed record count.
const pack = await post(
  `${analyticsBase}/packs`,
  JSON.stringify({ RequestInfo: requestInfo(), tenantId }),
  analyticsHeaders,
);
if (!pack.response.ok) throw new Error(`analytics pack probe failed with HTTP ${pack.response.status}`);
if (pack.json.recordCount !== expectedRecordCount) {
  throw new Error(`analytics pack recordCount mismatch: expected ${expectedRecordCount}, found ${String(pack.json.recordCount)}`);
}
const kpiId = pack.json.tiles?.find((tile) => typeof tile?.kpiId === 'string')?.kpiId;
if (!kpiId) throw new Error('analytics pack probe returned no queryable KPI');

// Request 2/2: proves Hikari can execute one real KPI query against the selected datasource.
const query = await post(
  `${analyticsBase}/_query`,
  JSON.stringify({
    RequestInfo: requestInfo(),
    tenantId,
    queries: { readiness: { kpiId, params: {} } },
  }),
  analyticsHeaders,
);
if (!query.response.ok) throw new Error(`analytics query probe failed with HTTP ${query.response.status}`);
const result = query.json.results?.readiness;
if (query.json.partial === true || !result || result.error) {
  throw new Error(`analytics query probe failed: ${result?.error || result?.message || 'missing readiness result'}`);
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  expectedRecordCount,
  pack: {
    status: pack.response.status,
    durationMs: Math.round(pack.durationMs * 100) / 100,
    recordCount: pack.json.recordCount,
    packId: pack.json.packId ?? null,
    tileCount: pack.json.tiles.length,
  },
  query: {
    status: query.response.status,
    durationMs: Math.round(query.durationMs * 100) / 100,
    kpiId,
    partial: query.json.partial === true,
    rowCount: result.rowCount ?? null,
    tookMs: result.tookMs ?? null,
  },
}, null, 2)}\n`);
