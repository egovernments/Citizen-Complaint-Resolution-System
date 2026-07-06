'use strict';
/*
 * ============================================================================
 * notif-harness.js — shared helpers for the notification E2E suite (TASK-031)
 * ============================================================================
 *
 * Extracted / generalised from e2e-role-notifications.js so the per-area case
 * files (cases/area-*.js) can share ONE set of primitives:
 *
 *   - config            env-driven connection/tenant knobs
 *   - psql / psqlRaw    read the DIGIT DB via `docker exec <PG> psql`
 *   - http: post/get    Kong-fronted API calls
 *   - token / RI        DIGIT auth + RequestInfo
 *   - provider API      POST /providers, GET /providers/templates,
 *                       POST /providers/verify, POST /providers/test-send
 *                       (via Kong /novu-bridge/novu-adapter/v1/...)
 *   - proxy reads       GET /integrations, /preferences, /logs
 *   - novu direct       list/delete integrations, fetch rendered messages
 *   - mdms v1 search    /mdms-v2/v1/_search (moduleDetails shape)
 *   - dispatch log      nb_dispatch_log query + parse
 *   - complaint fixture ONE shared PGR complaint (APPLY) reused by B/C/E/F
 *
 * Everything is env-driven. Designed to run ON the DIGIT host (it shells out to
 * `docker exec <PG_CONTAINER> psql` and reaches Kong at localhost:18000).
 *
 * NO secrets are committed here. NOVU_API_KEY is taken from the environment; if
 * unset the harness resolves it from the running novu-bridge container (owner's
 * own box) so the Bomet run is turnkey.
 * ============================================================================
 */
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Config (all env-driven)
// ---------------------------------------------------------------------------
const BASE = process.env.BASE || process.env.E2E_KONG || 'http://localhost:18000';
const TENANT = process.env.DIGIT_TENANT || process.env.E2E_TENANT || 'ke.bomet';
const STATE_TENANT = process.env.E2E_STATE_TENANT || TENANT.split('.')[0];
const ROOT = STATE_TENANT;
const BUSINESS_SERVICE = (process.env.E2E_BUSINESS_SERVICE || 'PGR').toUpperCase();
const OTP = process.env.E2E_OTP || '123456';

// C-area complaint: a serviceCode that HAS a `pgr.complaint.category.<code>`
// localization whose message differs from the code (name-not-code, C6).
const SERVICE_CODE = process.env.SERVICE_CODE || 'DamagedRoad';
const SERVICE_NAME = process.env.SERVICE_NAME || 'Damaged road';
const LOCALITY = process.env.LOCALITY || 'BOMET_BOMET_CENTRAL_MUTARAKWA';

const PG_CONTAINER = process.env.PG_CONTAINER || 'docker-postgres';
const PG_USER = process.env.PG_USER || 'egov';
const PG_DB = process.env.PG_DB || 'egov';

const NOVU_BRIDGE_CONTAINER = process.env.NOVU_BRIDGE_CONTAINER || 'novu-bridge';
const NOVU_API_URL = process.env.NOVU_API_URL || 'http://localhost:14002';

// Owner-authorized test recipients (defaults are the owner's own contacts).
const TEST_PHONE = process.env.TEST_PHONE || '+919415787824';
const TEST_EMAIL = process.env.TEST_EMAIL || 'contact@theflywheel.in';

// Employee actor (for auth-gated flows + role fan-out). Optional for read-only cases.
const EMP_USER = process.env.E2E_EMP_USER;
const EMP_PASS = process.env.E2E_EMP_PASS;

// Stock DIGIT public OAuth client (base64 "egov-user-client:"). Not a secret.
const BASIC = process.env.E2E_BASIC_AUTH || 'Basic ZWdvdi11c2VyLWNsaWVudDo=';

const NB_PREFIX = '/novu-bridge/novu-adapter/v1';

// ---------------------------------------------------------------------------
// NOVU_API_KEY resolution (env first, then the running container on this host)
// ---------------------------------------------------------------------------
function resolveNovuApiKey() {
  if (process.env.NOVU_API_KEY) return process.env.NOVU_API_KEY;
  try {
    const out = execSync(
      `docker inspect ${NOVU_BRIDGE_CONTAINER} --format '{{range .Config.Env}}{{println .}}{{end}}'`,
      { encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.startsWith('NOVU_API_KEY='));
    return line ? line.slice('NOVU_API_KEY='.length).trim() : '';
  } catch {
    return '';
  }
}
const NOVU_API_KEY = resolveNovuApiKey();

// ---------------------------------------------------------------------------
// Low-level primitives
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function psql(sql) {
  const out = execSync(
    `docker exec ${PG_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -t -A -F'|' -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).map((l) => l.split('|'));
}

function psqlRaw(sql) {
  const out = execSync(
    `docker exec ${PG_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -t -A -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean);
}

async function post(path, body, headers, form) {
  const b = form ? new URLSearchParams(body).toString() : JSON.stringify(body);
  const r = await fetch(BASE + path, { method: 'POST', headers, body: b });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = null; }
  return { status: r.status, text: t, json: j };
}

async function get(path, headers) {
  const r = await fetch(BASE + path, { method: 'GET', headers: headers || {} });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = null; }
  return { status: r.status, text: t, json: j };
}

const RI = () => ({ apiId: 'Rainmaker', msgId: `${Date.now()}|en_IN`, action: '_create' });

async function token(username, password, userType, tenantId) {
  const r = await post('/user/oauth/token',
    { grant_type: 'password', username, password, tenantId, scope: 'read', userType },
    { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: BASIC }, true);
  if (r.status !== 200) throw new Error(`auth ${username} failed ${r.status}: ${r.text.slice(0, 200)}`);
  return r.json;
}

// ---------------------------------------------------------------------------
// Provider-management API (novu-bridge, via Kong)
// ---------------------------------------------------------------------------
const providerCreate = (body, auth) =>
  post(`${NB_PREFIX}/providers`, body, jsonHeaders(auth));
const providerTemplates = (auth) =>
  get(`${NB_PREFIX}/providers/templates`, auth ? bearer(auth) : {});
const providerVerify = (body, auth) =>
  post(`${NB_PREFIX}/providers/verify`, body, jsonHeaders(auth));
const providerTestSend = (body, auth) =>
  post(`${NB_PREFIX}/providers/test-send`, body, jsonHeaders(auth));

// Read-only configurator proxies
const integrationsList = (auth) => get(`${NB_PREFIX}/integrations`, auth ? bearer(auth) : {});
const preferencesList = (tenantId, auth) =>
  get(`${NB_PREFIX}/preferences?tenantId=${encodeURIComponent(tenantId)}&limit=200`, auth ? bearer(auth) : {});
const logsList = (params, auth) => {
  const qs = new URLSearchParams(params).toString();
  return get(`${NB_PREFIX}/logs?${qs}`, auth ? bearer(auth) : {});
};

function jsonHeaders(auth) {
  const h = { 'Content-Type': 'application/json' };
  if (auth) h.Authorization = `Bearer ${auth}`;
  return h;
}
function bearer(auth) { return { Authorization: `Bearer ${auth}` }; }

// ---------------------------------------------------------------------------
// Novu direct API (server-side key; used for setup/cleanup + rendered bodies)
// ---------------------------------------------------------------------------
async function novuReq(method, path, body) {
  const headers = { Authorization: `ApiKey ${NOVU_API_KEY}` };
  const opts = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(NOVU_API_URL + path, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = null; }
  return { status: r.status, text: t, json: j };
}
const novuListIntegrations = () => novuReq('GET', '/v1/integrations');
const novuDeleteIntegration = (id) => novuReq('DELETE', `/v1/integrations/${id}`);

// Fetch rendered messages for a complaint. Novu stores the PGR-rendered text in
// payload.body (content is null in this Novu build). Filter by transactionId prefix.
async function messagesForComplaint(complaintId, channel, limit) {
  const ch = channel ? `&channel=${channel}` : '';
  const r = await novuReq('GET', `/v1/messages?limit=${limit || 100}${ch}`);
  const data = (r.json && r.json.data) || [];
  return data
    .filter((m) => typeof m.transactionId === 'string' && m.transactionId.startsWith(complaintId))
    .map((m) => ({
      transactionId: m.transactionId,
      channel: (m.channel || '').toUpperCase(),
      status: m.status,
      phone: m.phone,
      email: m.email,
      body: (m.payload && m.payload.body) || m.content || '',
      subject: (m.payload && m.payload.subject) || '',
    }));
}

// ---------------------------------------------------------------------------
// MDMS v1-compat search (returns MdmsRes[module][master] = [] of flattened rows)
// ---------------------------------------------------------------------------
async function mdmsSearch(moduleName, masterName, tenantId) {
  const r = await post('/mdms-v2/v1/_search', {
    RequestInfo: RI(),
    MdmsCriteria: {
      tenantId: tenantId || STATE_TENANT,
      moduleDetails: [{ moduleName, masterDetails: [{ name: masterName }] }],
    },
  }, { 'Content-Type': 'application/json' });
  const res = r.json && r.json.MdmsRes && r.json.MdmsRes[moduleName];
  const rows = res && res[masterName];
  return { status: r.status, rows: Array.isArray(rows) ? rows : null, raw: r };
}

// ---------------------------------------------------------------------------
// nb_dispatch_log
// ---------------------------------------------------------------------------
// transactionId format: reqId:action:toState:tenantId:subKey:channel
function queryDispatch(complaintId) {
  return psql(`SELECT channel, recipient_value, status, transaction_id, last_error_code `
    + `FROM nb_dispatch_log WHERE reference_number='${complaintId}'`)
    .map(([channel, recipient, status, txn, lastError]) => {
      const parts = (txn || '').split(':');
      return {
        channel: (channel || '').toUpperCase(),
        recipient, status: (status || '').toUpperCase(),
        txn, lastError,
        action: (parts[1] || '').toUpperCase(),
        toState: (parts[2] || '').toUpperCase(),
        uuid: parts.length >= 6 ? parts[parts.length - 2] : '',
      };
    });
}

const _rolesCache = new Map();
function rolesOf(uuid) {
  if (_rolesCache.has(uuid)) return _rolesCache.get(uuid);
  const rows = psql(`SELECT DISTINCT ur.role_code FROM eg_userrole_v1 ur `
    + `JOIN eg_user u ON u.id=ur.user_id AND u.tenantid=ur.user_tenantid WHERE u.uuid='${uuid}'`);
  const set = new Set(rows.map((r) => r[0]));
  _rolesCache.set(uuid, set);
  return set;
}

// ---------------------------------------------------------------------------
// PGR flow primitives (create ONE complaint; APPLY only)
// ---------------------------------------------------------------------------
async function citizenLogin(regPhone, name) {
  await post(`/user-otp/v1/_send?tenantId=${ROOT}`,
    { otp: { mobileNumber: regPhone, tenantId: ROOT, userType: 'citizen', type: 'register' } },
    { 'Content-Type': 'application/json' });
  await post(`/user/citizen/_create?tenantId=${ROOT}`,
    { RequestInfo: RI(), User: { name, username: regPhone, mobileNumber: regPhone,
        emailId: TEST_EMAIL, otpReference: OTP, tenantId: ROOT, type: 'CITIZEN' } },
    { 'Content-Type': 'application/json' });
  return token(regPhone, OTP, 'citizen', ROOT);
}

async function createComplaint(tok, ui, contact) {
  const r = await post(`/pgr-services/v2/request/_create?tenantId=${TENANT}`, {
    RequestInfo: { ...RI(), authToken: tok, userInfo: ui },
    service: { tenantId: TENANT, serviceCode: SERVICE_CODE, description: `zz-e2e-notif ${Date.now()}`,
      source: 'web', address: { city: TENANT, locality: { code: LOCALITY, name: 'e2e' },
        geoLocation: { latitude: -0.7813, longitude: 35.3416 } },
      citizen: { name: contact.name, mobileNumber: contact.mobileNumber, countryCode: contact.countryCode,
        emailId: contact.emailId, type: 'CITIZEN', tenantId: ROOT, uuid: ui.uuid } },
    workflow: { action: 'APPLY' },
  }, jsonHeaders(tok));
  if (r.status !== 200) throw new Error(`complaint create failed ${r.status}: ${r.text.slice(0, 300)}`);
  return r.json.ServiceWrappers[0].service;
}

// Poll nb_dispatch_log until the citizen SMS+EMAIL rows appear (or timeout).
async function pollDispatch(complaintId, timeoutMs) {
  const start = Date.now();
  let rows = [];
  while (Date.now() - start < (timeoutMs || 120000)) {
    rows = queryDispatch(complaintId);
    const sms = rows.some((r) => r.channel === 'SMS' && r.status === 'SENT');
    const email = rows.some((r) => r.channel === 'EMAIL' && r.status === 'SENT');
    const wa = rows.some((r) => r.channel === 'WHATSAPP');
    if (sms && email && wa) { await sleep(3000); return queryDispatch(complaintId); }
    await sleep(4000);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Shared complaint fixture — created once, reused by B/C/E/F cases.
// Stored on ctx so each area file can `await ensureComplaint(ctx)`.
// ---------------------------------------------------------------------------
async function ensureComplaint(ctx) {
  if (ctx._complaint) return ctx._complaint;
  if (ctx._complaintErr) throw ctx._complaintErr;
  try {
    const regPhone = '7' + String(Date.now()).slice(-8);
    const citizen = await citizenLogin(regPhone, 'zz-e2e Notif Citizen');
    const cUi = citizen.UserRequest, cTok = citizen.access_token;
    const contact = { name: 'zz-e2e Notif Citizen', mobileNumber: regPhone, countryCode: null, emailId: TEST_EMAIL };
    const service = await createComplaint(cTok, cUi, contact);
    const id = service.serviceRequestId;
    const rows = await pollDispatch(id, 120000);
    let messages = [];
    if (NOVU_API_KEY) {
      try { messages = await messagesForComplaint(id, null, 200); } catch (e) { /* non-fatal */ }
    }
    ctx._complaint = { id, service, citizenUuid: cUi.uuid, rows, messages, regPhone, contact };
    return ctx._complaint;
  } catch (e) {
    ctx._complaintErr = e;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------
const PASS = (id, detail) => ({ id, status: 'PASS', detail });
const FAIL = (id, detail) => ({ id, status: 'FAIL', detail });
const SKIP = (id, detail) => ({ id, status: 'SKIP', detail });

// Wrap a case fn so a thrown error becomes a FAIL (never crashes the runner).
async function guard(id, fn) {
  try {
    const r = await fn();
    if (r && r.status) return r;
    return FAIL(id, 'case returned no result');
  } catch (e) {
    return FAIL(id, 'threw: ' + (e && e.message ? e.message : String(e)));
  }
}

module.exports = {
  // config
  BASE, TENANT, STATE_TENANT, ROOT, BUSINESS_SERVICE, SERVICE_CODE, SERVICE_NAME, LOCALITY,
  TEST_PHONE, TEST_EMAIL, EMP_USER, EMP_PASS, NB_PREFIX, NOVU_API_URL, NOVU_API_KEY,
  // primitives
  sleep, psql, psqlRaw, post, get, RI, token,
  // provider api
  providerCreate, providerTemplates, providerVerify, providerTestSend,
  integrationsList, preferencesList, logsList,
  // novu direct
  novuReq, novuListIntegrations, novuDeleteIntegration, messagesForComplaint,
  // mdms
  mdmsSearch,
  // dispatch
  queryDispatch, rolesOf,
  // complaint fixture
  citizenLogin, createComplaint, pollDispatch, ensureComplaint,
  // results
  PASS, FAIL, SKIP, guard,
};
