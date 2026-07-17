#!/usr/bin/env node
/**
 * install-schemas.cjs — register the N-level ComplaintHierarchy MDMS schemas.
 *
 * PREREQUISITE for migrate.cjs and the configurator "Migrate" button: both
 * WRITE into RAINMAKER-PGR.ComplaintHierarchy[Definition] but neither creates
 * the schema. On a stack whose default-data-handler predates the N-level work
 * (e.g. built from develop), the schemas are missing and migration aborts.
 *
 * This reads the schema definitions straight from default-data-handler's
 * resources, substitutes the tenant, and POSTs them to /mdms-v2/schema/v1/_create
 * at BOTH the managing tenant AND its state root (matching where migrate.cjs
 * writes data). Idempotent: schemas that already exist are skipped.
 *
 * Usage:
 *   BASE_URL=http://localhost:18000 TENANT=ke.ige node docs/migration/install-schemas.cjs
 * Auth (pick one):
 *   OAUTH_USER/OAUTH_PASS  (default ADMIN / eGov@123, login at STATE_TENANT)
 *   TOKEN=<authToken>      (skip login)
 * Optional:
 *   STATE_TENANT  state root (default = first segment before '.' of TENANT)
 *   SCHEMA_FILE   override path to the schema json
 */
const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE_URL || '').replace(/\/$/, '');
const TENANT = (process.env.TENANT || '').trim();
const STATE = (process.env.STATE_TENANT || (TENANT.includes('.') ? TENANT.split('.')[0] : TENANT)).trim();
const OAUTH_USER = process.env.OAUTH_USER || 'ADMIN';
const OAUTH_PASS = process.env.OAUTH_PASS || 'eGov@123';
const OAUTH_BASIC = process.env.OAUTH_BASIC || 'egov-user-client:';
let TOKEN = process.env.TOKEN || '';
const SCHEMA_FILE = process.env.SCHEMA_FILE || path.join(
  __dirname, '..', '..',
  'utilities', 'default-data-handler', 'src', 'main', 'resources', 'schema', 'RAINMAKER-PGR.json'
);

if (!BASE || !TENANT) {
  console.error('ERROR: set BASE_URL and TENANT.\n  e.g. BASE_URL=http://localhost:18000 TENANT=ke.ige node docs/migration/install-schemas.cjs');
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
    if (!TOKEN) {
      console.error('ERROR: auth failed. Pass TOKEN=<authToken>, or check OAUTH_USER/OAUTH_PASS/STATE_TENANT.');
      process.exit(2);
    }
  }
  const RI = { apiId: 'migration', ver: '1.0', action: '_create', authToken: TOKEN };

  let all;
  try { all = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8')); }
  catch (e) { console.error('ERROR: cannot read schema file ' + SCHEMA_FILE + '\n  ' + e); process.exit(2); }

  const want = all.filter((x) => String(x.code || '').startsWith('RAINMAKER-PGR.ComplaintHierarchy'));
  if (!want.length) { console.error('ERROR: no ComplaintHierarchy schemas in ' + SCHEMA_FILE); process.exit(2); }

  const targets = Array.from(new Set([TENANT, STATE].filter(Boolean)));
  console.log('Registering ' + want.map((s) => s.code).join(', ') + '\n  at: ' + targets.join(', ') + '\n');

  let created = 0, exists = 0, failed = 0;
  for (const t of targets) {
    for (const s of want) {
      const SchemaDefinition = {
        tenantId: t,
        code: s.code,
        description: s.description,
        definition: s.definition,
        isActive: s.isActive !== false,
      };
      const r = await req('POST', '/mdms-v2/schema/v1/_create', { RequestInfo: RI, SchemaDefinition });
      if (r.code >= 200 && r.code < 300) { created++; console.log('  ✓ created ' + s.code + ' @ ' + t); }
      else if (r.code === 409 || /already|exist|duplicate/i.test(r.body)) { exists++; console.log('  • exists  ' + s.code + ' @ ' + t); }
      else { failed++; console.log('  ✗ FAILED  ' + s.code + ' @ ' + t + '  (HTTP ' + r.code + ') ' + r.body.slice(0, 240)); }
    }
  }
  console.log('\nDone: ' + created + ' created, ' + exists + ' already present, ' + failed + ' failed.');
  if (created || exists) {
    console.log('\nNEXT: apply the x-ref-schema jsonb fix (the create may persist [] as {}), then run preflight.');
  }
  process.exit(failed ? 1 : 0);
})();
