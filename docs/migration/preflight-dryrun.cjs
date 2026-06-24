/* eslint-disable */
// READ-ONLY pre-flight for the TWO-master complaint-hierarchy migration
// (ServiceDefs + ClassificationNode -> the single RAINMAKER-PGR.ComplaintHierarchy).
// Makes ZERO writes. Run it against production BEFORE migrating to guarantee the
// real migration will not error. Exits non-zero if anything needs attention.
//
// DUAL-MODE aware: it also reads the existing N-level tree (ComplaintHierarchyDefinition
// + ClassificationNode). If a definition with levels AND interior nodes already exist it
// reports mode=preserve and predicts copying those N interior nodes + linking M leaves by
// their existing parentCode/sector; otherwise it reports mode=derive (flat 2-level from menuPath).
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

const HIER_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchy';
const DEF_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchyDefinition';
const SD_SCHEMA = 'RAINMAKER-PGR.ServiceDefs';
const NODE_SCHEMA = 'RAINMAKER-PGR.ClassificationNode';
// '/' allowed: existing serviceCodes use it, MDMS accepts it, and codes stay verbatim.
const NODE_SAFE = /^[A-Za-z0-9_.\-\/]+$/;

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
  console.log(`\nPre-flight (2-master): ${TENANT} @ ${BASE}  (hierarchyType=${HT})\n${'='.repeat(64)}`);

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
    const r = await post('/mdms-v2/v2/_search', { RequestInfo: RI, MdmsCriteria: { tenantId: TENANT, schemaCode: schema, limit: opts.limit || 5000 } });
    return { code: r.code, rows: (() => { try { return (JSON.parse(r.body).mdms || []).map((m) => m.data); } catch { return null; } })() };
  };

  // 2) Target schemas installed? (the merged master MUST exist before migrating)
  for (const sc of [DEF_SCHEMA, HIER_SCHEMA]) {
    const r = await search(sc, { limit: 1 });
    if (r.rows === null || r.code >= 500) { console.log(`${FAIL} Schema ${sc} not reachable/installed (HTTP ${r.code}). Install the 2-master schemas (P0) before migrating.`); problems++; }
    else console.log(`${PASS} Schema present: ${sc} (${r.rows.length} existing record(s))`);
  }

  // 3) Already migrated? (leaf rows already in ComplaintHierarchy)
  const existingHier = await search(HIER_SCHEMA);
  if (existingHier.rows && existingHier.rows.some((n) => n.hierarchyType === HT && (n.department != null || n.slaHours != null))) {
    console.log(`${WARN}ComplaintHierarchy already has leaf rows for '${HT}' on ${TENANT}. This tenant looks already migrated — re-running is an idempotent no-op.`);
  }

  // 4) Read ServiceDefs (the migration SOURCE) + the existing N-level tree (Definition + ClassificationNode).
  //    DUAL-MODE: if a Definition with levels AND interior ClassificationNode rows already exist, the real
  //    migration PRESERVES that tree (copies the interior nodes 1:1, links leaves by their own
  //    parentCode/sector). Otherwise it DERIVES a flat 2-level CATEGORY -> SUB_TYPE tree from menuPath.
  const sd = await search(SD_SCHEMA);
  if (!sd.rows) { console.log(`${FAIL} Could not read ServiceDefs source (HTTP ${sd.code}).`); process.exit(2); }
  const defs = sd.rows;
  console.log(`${PASS} ServiceDefs (source) found: ${defs.length}`);
  if (defs.length === 0) { console.log(`${WARN}Nothing to migrate (0 complaint types).`); }

  const nodeRes = await search(NODE_SCHEMA);
  const defRes = await search(DEF_SCHEMA);
  // Interior nodes from the old ClassificationNode master, scoped to this hierarchyType, deduped by code.
  const interiorByCode = new Map();
  for (const n of nodeRes.rows || []) {
    if (n.hierarchyType && n.hierarchyType !== HT) continue;
    const code = String(n.code || '').trim();
    if (code && !interiorByCode.has(code)) interiorByCode.set(code, { code, name: String(n.name || code) });
  }
  const existingDef = (defRes.rows || []).find((d) => d.hierarchyType === HT) || (defRes.rows || [])[0];
  const preserve = !!(existingDef && Array.isArray(existingDef.levels) && existingDef.levels.length && interiorByCode.size > 0);
  const mode = preserve ? 'preserve' : 'derive';
  console.log(`${PASS} MODE = ${mode}  (existing definition: ${existingDef ? 'yes' : 'no'} · ClassificationNodes: ${interiorByCode.size})`);

  // 5) Duplicate serviceCode
  const seen = new Set(), dups = new Set();
  defs.forEach((d) => { const c = String(d.serviceCode || ''); if (seen.has(c)) dups.add(c); seen.add(c); });
  if (dups.size) { console.log(`${FAIL} Duplicate serviceCode(s): ${[...dups].join(', ')}`); problems++; }
  else console.log(`${PASS} serviceCodes unique`);

  // 6) Interior categories. In PRESERVE mode they ARE the existing ClassificationNodes; in DERIVE mode
  //    they are synthesised from each ServiceDef's menuPath (read ONLY here, to derive the parent link).
  const cats = new Map(); // code -> name
  let missing = 0;
  if (preserve) {
    interiorByCode.forEach((n, code) => cats.set(code, n.name));
  } else {
    defs.forEach((d) => { const mp = String(d.menuPath || '').trim(); if (!mp) { missing++; if (!cats.has('Complaint')) cats.set('Complaint', 'Complaint'); } else if (!cats.has(mp)) cats.set(mp, String(d.menuPathName || mp)); });
  }
  console.log(`${PASS} Interior categories (${preserve ? 'existing ClassificationNodes' : 'derived from menuPath'}): ${cats.size}`);
  console.log('     ' + [...cats.keys()].join('  |  '));
  if (missing) console.log(`${WARN}${missing} ServiceDef(s) have NO menuPath -> bucket under "Complaint".`);

  // The link a leaf uses to find its parent. PRESERVE prefers the leaf's own parentCode/sector;
  // DERIVE falls back to menuPath. Mirrors hierarchyMigration.ts `linkOf`.
  const linkOf = (d) => preserve
    ? (d.parentCode ?? d.sector ?? (String(d.menuPath || '').trim() || 'Complaint'))
    : (String(d.menuPath || '').trim() || 'Complaint');

  // 7) Code safety — BOTH category codes AND leaf serviceCodes become ComplaintHierarchy codes now.
  const unsafeCats = [...cats.keys()].filter((c) => !NODE_SAFE.test(c));
  const unsafeLeaves = defs.map((d) => String(d.serviceCode || '')).filter((c) => c && !NODE_SAFE.test(c));
  if (unsafeCats.length || unsafeLeaves.length) {
    console.log(`${WARN}${unsafeCats.length + unsafeLeaves.length} code(s) contain unusual chars (kept VERBATIM — they already work as ServiceDefs uids, so this is informational, not a blocker):`);
    [...unsafeCats, ...unsafeLeaves].slice(0, 12).forEach((c) => console.log(`        "${c}"`));
  } else {
    console.log(`${PASS} All ${cats.size} category + ${defs.length} leaf codes are MDMS-safe`);
  }

  // 8) Leaf-link resolves: every leaf's link (parentCode/sector in preserve, else menuPath) equals a category code.
  const catCodes = new Set(cats.keys());
  const orphan = defs.filter((d) => !catCodes.has(linkOf(d)));
  if (orphan.length) {
    console.log(`${FAIL} ${orphan.length} ServiceDef(s) would NOT link to any ${preserve ? 'existing node' : 'category'}.`);
    orphan.slice(0, 10).forEach((d) => console.log(`        ${d.serviceCode} (link=${linkOf(d)})`));
    problems++;
  } else {
    console.log(`${PASS} All ${defs.length} leaves link to a ${preserve ? 'node' : 'category'} (0 orphans predicted)`);
  }

  // 9) NEW HAZARD — merged x-unique is (hierarchyType, code). A leaf serviceCode equal to a category/node
  //    code would silently drop a row on create. Must be globally unique across interior + leaf.
  const collisions = defs.map((d) => String(d.serviceCode || '')).filter((c) => catCodes.has(c));
  if (collisions.length) {
    console.log(`${FAIL} ${collisions.length} serviceCode(s) collide with an interior node code (merged master needs globally-unique codes): ${[...new Set(collisions)].slice(0, 8).join(', ')}`);
    problems++;
  } else {
    console.log(`${PASS} No code collisions between interior nodes and leaves (merged keyspace unique)`);
  }

  // Verdict
  console.log('='.repeat(64));
  if (preserve) {
    const levelCodes = existingDef.levels.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)).map((l) => l.levelCode).join(' -> ');
    console.log(`PLAN (preserve): into ${HIER_SCHEMA} keep the existing definition (${HT}: ${levelCodes}) + copy ${cats.size} interior node rows + create ${defs.length} leaf rows`);
  } else {
    console.log(`PLAN (derive): into ${HIER_SCHEMA} create 1 definition (${HT}: CATEGORY -> SUB_TYPE) + ${cats.size} category rows + ${defs.length} leaf rows`);
  }
  console.log(`      leaf code = serviceCode VERBATIM (preserves historical complaints / EscalationConfig / localization).`);
  console.log(`${WARN}AFTER migration you MUST: (a) deploy pgr-services that validates against ComplaintHierarchy + run the V2 grain-MV forward migration; (b) deploy the frontends; (c) only THEN retire the ServiceDefs master. This is a BREAKING, lockstep change — see docs/design/complaint-hierarchy-2master-rework-plan.md §5.`);
  if (problems === 0) { console.log(`${PASS} SAFE TO MIGRATE — no errors predicted.\n`); process.exit(0); }
  else { console.log(`${FAIL} ${problems} issue(s) above must be resolved before migrating.\n`); process.exit(1); }
})();
