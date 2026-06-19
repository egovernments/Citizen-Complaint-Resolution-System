/* eslint-disable */
// READ-ONLY pre-flight for the 2-level -> N-level complaint hierarchy migration.
// Makes ZERO writes. Run it against production BEFORE migrating to guarantee the
// real migration will not error. Exits non-zero if anything needs attention.
//
//   BASE_URL=https://bomet.gov TENANT=ke.bomet \
//   OAUTH_USER=ADMIN OAUTH_PASS='***' node docs/migration/preflight-dryrun.cjs
//
// Or skip login by passing a token you already have:
//   BASE_URL=... TENANT=ke.bomet TOKEN=<authToken> node docs/migration/preflight-dryrun.cjs
//
// Env:
//   BASE_URL     gateway base, e.g. https://bomet.gov  or http://localhost:18000  (required)
//   TENANT       tenant to check, e.g. ke.bomet                                   (required)
//   OAUTH_USER   employee username for login (default ADMIN)
//   OAUTH_PASS   password (default eGov@123)
//   OAUTH_BASIC  base64 of "<client>:<secret>" (default egov-user-client:)
//   TOKEN        pre-obtained authToken (skips login)
//   HIERARCHY    hierarchyType to create (default PGR)

const url = require('url');
const BASE = process.env.BASE_URL;
const TENANT = process.env.TENANT;
const HT = process.env.HIERARCHY || 'PGR';
if (!BASE || !TENANT) { console.error('Set BASE_URL and TENANT'); process.exit(2); }
const U = new url.URL(BASE);
const http = U.protocol === 'https:' ? require('https') : require('http');
const PORT = U.port || (U.protocol === 'https:' ? 443 : 80);
const BASIC = process.env.OAUTH_BASIC || 'ZWdvdi11c2VyLWNsaWVudDo='; // egov-user-client:

const NODE_SAFE = /^[A-Za-z0-9_.\-]+$/; // chars safe to use as an MDMS uniqueIdentifier / URL path segment

function req(path, method, headers, body) {
  return new Promise((res) => {
    const r = http.request({ host: U.hostname, port: PORT, path, method, headers }, (s) => {
      let b = ''; s.on('data', (c) => (b += c)); s.on('end', () => res({ code: s.statusCode, body: b }));
    });
    r.on('error', (e) => res({ code: 0, body: String(e) }));
    if (body) r.write(body);
    r.end();
  });
}
const form = (p, d) => req(p, 'POST', { authorization: 'Basic ' + BASIC, 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(d) }, d);
const post = (p, o) => req(p, 'POST', { 'content-type': 'application/json' }, JSON.stringify(o));

const PASS = '✅', WARN = '⚠️ ', FAIL = '❌';
let problems = 0;

(async () => {
  console.log(`\nPre-flight: ${TENANT} @ ${BASE}  (hierarchyType=${HT})\n${'='.repeat(60)}`);

  // 1) Auth
  let RI, token = process.env.TOKEN;
  if (!token) {
    const d = `username=${encodeURIComponent(process.env.OAUTH_USER || 'ADMIN')}&password=${encodeURIComponent(process.env.OAUTH_PASS || 'eGov@123')}&userType=EMPLOYEE&tenantId=${TENANT}&scope=read&grant_type=password`;
    const r = await form('/user/oauth/token', d);
    let j; try { j = JSON.parse(r.body); } catch { j = null; }
    if (!j || !j.access_token) { console.log(`${FAIL} Auth failed (HTTP ${r.code}). Check BASE_URL/credentials/OAUTH_BASIC.`); process.exit(2); }
    token = j.access_token; const u = j.UserRequest;
    RI = { apiId: 'Rainmaker', ver: '1.0', msgId: 'preflight', authToken: token, userInfo: { id: u.id, uuid: u.uuid, userName: u.userName, name: u.name, type: u.type, roles: u.roles, tenantId: u.tenantId } };
  } else {
    RI = { apiId: 'Rainmaker', ver: '1.0', msgId: 'preflight', authToken: token, userInfo: { tenantId: TENANT, type: 'EMPLOYEE', roles: [] } };
  }
  console.log(`${PASS} Auth OK`);

  const search = async (schema, opts = {}) => {
    const r = await post('/mdms-v2/v2/_search', { RequestInfo: RI, MdmsCriteria: { tenantId: TENANT, schemaCode: schema, limit: opts.limit || 2000 } });
    return { code: r.code, rows: (() => { try { return (JSON.parse(r.body).mdms || []).map((m) => m.data); } catch { return null; } })() };
  };

  // 2) Schemas installed?
  for (const sc of ['RAINMAKER-PGR.ComplaintHierarchyDefinition', 'RAINMAKER-PGR.ClassificationNode']) {
    const r = await search(sc, { limit: 1 });
    if (r.rows === null || r.code >= 500) { console.log(`${FAIL} Schema ${sc} not reachable/installed (HTTP ${r.code}). Install schemas before migrating.`); problems++; }
    else console.log(`${PASS} Schema present: ${sc} (${r.rows.length} existing record(s))`);
  }

  // 3) Already migrated?
  const existingDef = await search('RAINMAKER-PGR.ComplaintHierarchyDefinition');
  if (existingDef.rows && existingDef.rows.some((d) => d.hierarchyType === HT)) {
    console.log(`${WARN}A '${HT}' hierarchy definition ALREADY exists on ${TENANT}. This tenant is already migrated — the migrate button will be hidden and re-running is a no-op.`);
  }

  // 4) Read ServiceDefs (the 2-level data)
  const sd = await search('RAINMAKER-PGR.ServiceDefs');
  if (!sd.rows) { console.log(`${FAIL} Could not read ServiceDefs (HTTP ${sd.code}).`); process.exit(2); }
  const defs = sd.rows;
  console.log(`${PASS} ServiceDefs found: ${defs.length}`);
  if (defs.length === 0) { console.log(`${WARN}Nothing to migrate (0 complaint types).`); }

  // 5) Duplicate serviceCode
  const seen = new Set(), dups = new Set();
  defs.forEach((d) => { const c = String(d.serviceCode || ''); if (seen.has(c)) dups.add(c); seen.add(c); });
  if (dups.size) { console.log(`${FAIL} Duplicate serviceCode(s): ${[...dups].join(', ')}`); problems++; }
  else console.log(`${PASS} serviceCodes unique`);

  // 6) Categories from menuPath
  const cats = new Map(); let missing = 0;
  defs.forEach((d) => { const mp = String(d.menuPath || '').trim(); if (!mp) { missing++; if (!cats.has('Complaint')) cats.set('Complaint', 'Complaint'); } else if (!cats.has(mp)) cats.set(mp, String(d.menuPathName || mp)); });
  console.log(`${PASS} Distinct categories (menuPath): ${cats.size}`);
  console.log('     ' + [...cats.keys()].map((c) => c).join('  |  '));
  if (missing) console.log(`${WARN}${missing} ServiceDef(s) have NO menuPath -> will bucket under "Complaint".`);

  // 7) Node-code safety (code = menuPath). Unsafe chars = risky uniqueIdentifier.
  const unsafe = [...cats.keys()].filter((c) => !NODE_SAFE.test(c));
  if (unsafe.length) {
    console.log(`${FAIL} ${unsafe.length} menuPath value(s) contain spaces/special chars and are UNSAFE as node codes:`);
    unsafe.forEach((c) => console.log(`        "${c}"`));
    console.log('        -> Either rename these menuPath values to code-safe ([A-Za-z0-9_.-]) on the ServiceDefs first,');
    console.log('           or use the slug strategy (slug node code AND update ServiceDefs.menuPath to the slug).');
    problems++;
  } else {
    console.log(`${PASS} All ${cats.size} category codes are MDMS-safe (no rename needed)`);
  }

  // 8) Leaf-link resolves: every leaf's (parentCode??sector??menuPath) will equal a node code we create.
  const codes = new Set(cats.keys());
  const orphan = defs.filter((d) => { const link = d.parentCode ?? d.sector ?? (String(d.menuPath || '').trim() || 'Complaint'); return !codes.has(link); });
  if (orphan.length) { console.log(`${FAIL} ${orphan.length} ServiceDef(s) would NOT link to any category node (unexpected).`); orphan.slice(0, 10).forEach((d) => console.log(`        ${d.serviceCode} (link=${d.parentCode ?? d.sector ?? d.menuPath})`)); problems++; }
  else console.log(`${PASS} All ${defs.length} sub-types will link to a category (0 orphans predicted)`);

  // Verdict
  console.log('='.repeat(60));
  console.log(`PLAN: create 1 definition (${HT}: CATEGORY -> SUB_TYPE) + ${cats.size} category nodes. ServiceDefs: 0 rewrites.`);
  if (problems === 0) { console.log(`${PASS} SAFE TO MIGRATE — no errors predicted.\n`); process.exit(0); }
  else { console.log(`${FAIL} ${problems} issue(s) above must be resolved before migrating.\n`); process.exit(1); }
})();
