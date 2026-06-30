#!/usr/bin/env node
/**
 * seed-data.cjs — POST MDMS v2 data rows from a JSON array file.
 *
 * Companion to install-schemas.cjs (which only registers schemas, never data).
 *
 * Usage:
 *   BASE_URL=http://localhost:18000 TENANT=ke SCHEMA=RAINMAKER-PGR.ComplaintTemplateType \
 *     FILE=docs/migration/seed/ComplaintTemplateType.json UID_KEY=templateType \
 *     node docs/migration/seed-data.cjs
 * Auth (pick one):
 *   OAUTH_USER/OAUTH_PASS  (default ADMIN / eGov@123, login at STATE_TENANT)
 *   TOKEN=<authToken>
 * UID_KEY  the row field used as the MDMS uniqueIdentifier (default "code").
 * Idempotent: rows that already exist (409 / duplicate) are reported and skipped.
 */
const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');

const BASE = (process.env.BASE_URL || '').replace(/\/$/, '');
const TENANT = (process.env.TENANT || '').trim();
const SCHEMA = (process.env.SCHEMA || '').trim();
const FILE = (process.env.FILE || '').trim();
const UID_KEY = (process.env.UID_KEY || 'code').trim();
const STATE = (process.env.STATE_TENANT || (TENANT.includes('.') ? TENANT.split('.')[0] : TENANT)).trim();
const OAUTH_USER = process.env.OAUTH_USER || 'ADMIN';
const OAUTH_PASS = process.env.OAUTH_PASS || 'eGov@123';
const OAUTH_BASIC = process.env.OAUTH_BASIC || 'egov-user-client:';
let TOKEN = process.env.TOKEN || '';

if (!BASE || !TENANT || !SCHEMA || !FILE) {
  console.error('ERROR: set BASE_URL, TENANT, SCHEMA, FILE (optional UID_KEY).');
  process.exit(2);
}

function req(method, p, body, headers) {
  return new Promise((resolve) => {
    const U = url.parse(BASE + p);
    const lib = U.protocol === 'https:' ? https : http;
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    const r = lib.request({ hostname: U.hostname, port: U.port, path: U.path, method, headers: h }, (s) => {
      let buf = '';
      s.on('data', (c) => { buf += c; });
      s.on('end', () => resolve({ code: s.statusCode, body: buf }));
    });
    r.on('error', (e) => resolve({ code: 0, body: String(e) }));
    if (data) r.write(data);
    r.end();
  });
}

async function login() {
  const form =
    'username=' + encodeURIComponent(OAUTH_USER) +
    '&password=' + encodeURIComponent(OAUTH_PASS) +
    '&grant_type=password&scope=read&userType=EMPLOYEE&tenantId=' + encodeURIComponent(STATE);
  const r = await req('POST', '/user/oauth/token', form, {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Authorization': 'Basic ' + Buffer.from(OAUTH_BASIC).toString('base64'),
  });
  try { return JSON.parse(r.body).access_token || ''; } catch { return ''; }
}

(async () => {
  if (!TOKEN) {
    TOKEN = await login();
    if (!TOKEN) { console.error('ERROR: auth failed.'); process.exit(2); }
  }
  const RI = { apiId: 'seed', ver: '1.0', action: '_create', authToken: TOKEN };

  let rows;
  try { rows = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { console.error('ERROR: cannot read ' + FILE + '\n  ' + e); process.exit(2); }
  if (!Array.isArray(rows)) { console.error('ERROR: FILE must be a JSON array.'); process.exit(2); }

  console.log('Seeding ' + rows.length + ' rows of ' + SCHEMA + ' @ ' + TENANT + '\n');
  let ok = 0, exists = 0, fail = 0;
  for (const data of rows) {
    const uid = data[UID_KEY] != null ? String(data[UID_KEY]) : undefined;
    const r = await req('POST', '/mdms-v2/v2/_create/' + SCHEMA, {
      RequestInfo: RI,
      Mdms: { tenantId: TENANT, schemaCode: SCHEMA, uniqueIdentifier: uid, data, isActive: true },
    });
    if (r.code >= 200 && r.code < 300) { ok++; console.log('  ✓ ' + (uid || '(auto)')); }
    else if (r.code === 409 || /already|exist|duplicate/i.test(r.body)) { exists++; console.log('  • exists  ' + uid); }
    else { fail++; console.log('  ✗ FAILED  ' + uid + '  (HTTP ' + r.code + ') ' + r.body.slice(0, 240)); }
  }
  console.log('\nDone: ' + ok + ' created, ' + exists + ' already present, ' + fail + ' failed.');
  process.exit(fail ? 1 : 0);
})();
