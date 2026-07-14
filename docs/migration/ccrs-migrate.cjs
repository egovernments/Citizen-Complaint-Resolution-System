#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ============================================================================
 *  ccrs-migrate.cjs — UNIFIED CCRS data-migration runner
 * ============================================================================
 *
 *  One idempotent script replacing the whole docs/migration suite:
 *    install-schemas.cjs, preflight-dryrun.cjs, migrate.cjs, seed-data.cjs,
 *    seed-pgr-masters.cjs, run-data-migration.sh, landing-config/seed-*.sh
 *
 *  PHASES (each runs in isolation — a failure records its error code and the
 *  run CONTINUES; a final summary table reports every phase):
 *    1. auth          login / token check
 *    2. schemas       register all RAINMAKER-PGR + Landing MDMS v2 schemas
 *    3. hierarchy     2-level -> N-level complaint-hierarchy migration
 *                     (skips itself when already migrated / nothing to do)
 *    4. pgr-masters   ComplaintRelatedToMap / ComplaintTemplateType /
 *                     ComplaintExtendedAttributeSchema seed + v1 verify
 *    5. landing       landing sections + page config + PGR_LANDING_* keys
 *    6. cms           (opt-in: --cms) CMS roles/actions/grants + workflow
 *    7. verify        consolidated read-back across everything
 *
 *  USAGE
 *    node ccrs-migrate.cjs --host http://<gateway> --tenant mz \
 *         [--user ADMIN] [--pass 'eGov@123'] [--token <authToken>] \
 *         [--phases schemas,landing] [--dry-run] [--cms] [--update-wf] \
 *         [--locale en_IN] [--hierarchy PGR] [--report out.json]
 *
 *    Env-var equivalents (CLI wins): BASE_URL TENANT OAUTH_USER OAUTH_PASS
 *    OAUTH_BASIC TOKEN PHASES DRY_RUN CMS UPDATE_WF LOCALE HIERARCHY REPORT
 *    · OAUTH_BASIC accepts EITHER plaintext "client:secret" or base64 —
 *      normalised automatically (the legacy scripts disagreed on this).
 *    · TENANT may be a state root ("mz") or a city ("mz.igsae"); state-level
 *      writes go to the first dot-segment automatically.
 *
 *  EXIT CODE = number of FAILED phases (0 = everything OK or skipped).
 *  Every failure carries a stable ERROR CODE + remediation hint; re-running
 *  is always safe — completed work is detected and skipped.
 *
 *  Requires: Node >= 14 (builtins only, zero npm deps), run from a repo
 *  checkout (seed files are resolved relative to this script).
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

/* ──────────────────────────────── config ──────────────────────────────── */

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const flag = ['dry-run', 'cms', 'update-wf', 'no-color', 'help'].includes(key);
    out[key] = flag ? true : argv[++i];
  }
  return out;
}
const ARGS = parseArgs(process.argv);
if (ARGS.help) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*|^ \*/gm, ''));
  process.exit(0);
}

const truthy = (v) => /^(1|true|yes)$/i.test(String(v || ''));
const CFG = {
  base: String(ARGS.host || process.env.BASE_URL || '').replace(/\/+$/, ''),
  tenant: String(ARGS.tenant || process.env.TENANT || '').trim(),
  user: ARGS.user || process.env.OAUTH_USER || 'ADMIN',
  pass: ARGS.pass || process.env.OAUTH_PASS || 'eGov@123',
  basicRaw: ARGS.basic || process.env.OAUTH_BASIC || 'egov-user-client:',
  token: ARGS.token || process.env.TOKEN || '',
  phases: String(ARGS.phases || process.env.PHASES || 'auth,schemas,hierarchy,pgr-masters,landing,cms,verify')
    .split(',').map((s) => s.trim()).filter(Boolean),
  dryRun: !!ARGS['dry-run'] || truthy(process.env.DRY_RUN),
  cms: !!ARGS.cms || truthy(process.env.CMS),
  updateWf: !!ARGS['update-wf'] || truthy(process.env.UPDATE_WF),
  locale: ARGS.locale || process.env.LOCALE || 'en_IN',
  hierarchy: ARGS.hierarchy || process.env.HIERARCHY || 'PGR',
  report: ARGS.report || process.env.REPORT || '',
};
CFG.state = CFG.tenant.includes('.') ? CFG.tenant.split('.')[0] : CFG.tenant;
// OAUTH_BASIC: legacy scripts disagreed (plaintext vs base64) — accept both.
CFG.basic = /^[A-Za-z0-9+/]+=*$/.test(CFG.basicRaw) && !CFG.basicRaw.includes(':')
  ? CFG.basicRaw
  : Buffer.from(CFG.basicRaw).toString('base64');

if (!CFG.base || !CFG.tenant) {
  console.error('Usage: node ccrs-migrate.cjs --host <BASE_URL> --tenant <TENANT> [options]   (--help for all options)');
  process.exit(2);
}

const REPO = path.join(__dirname, '..', '..');
const SEED = {
  pgrSchemas: path.join(REPO, 'utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json'),
  landingSchemas: path.join(REPO, 'utilities/default-data-handler/src/main/resources/schema/rainmaker-pgr-landing.json'),
  landingSections: path.join(REPO, 'utilities/default-data-handler/src/main/resources/mdmsData/RAINMAKER-PGR/RAINMAKER-PGR.LandingSection.json'),
  landingConfig: path.join(REPO, 'utilities/default-data-handler/src/main/resources/mdmsData/RAINMAKER-PGR/RAINMAKER-PGR.LandingPageConfig.json'),
  locEn: path.join(REPO, 'utilities/default-data-handler/src/main/resources/localisations/en_IN/rainmaker-pgr.json'),
  locPt: path.join(REPO, 'utilities/default-data-handler/src/main/resources/localisations/pt_PT/rainmaker-pgr.json'),
  relatedToMap: path.join(__dirname, 'seed/ComplaintRelatedToMap.json'),
  templateType: path.join(__dirname, 'seed/ComplaintTemplateType.json'),
  extAttrSchema: path.join(__dirname, 'seed/ComplaintExtendedAttributeSchema.json'),
  roles: path.join(REPO, 'utilities/default-data-handler/src/main/resources/mdmsData/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json'),
  roleactions: path.join(REPO, 'utilities/default-data-handler/src/main/resources/mdmsData/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json'),
  actionsTest: path.join(REPO, 'utilities/default-data-handler/src/main/resources/mdmsData/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json'),
  cmsWorkflow: path.join(REPO, 'utilities/default-data-handler/src/main/resources/CmsPgrWorkflowConfig.json'),
};

/* ──────────────────────────────── output ──────────────────────────────── */

const TTY = process.stdout.isTTY && !ARGS['no-color'] && !process.env.NO_COLOR;
const C = {
  g: (s) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
  r: (s) => (TTY ? `\x1b[31m${s}\x1b[0m` : s),
  y: (s) => (TTY ? `\x1b[33m${s}\x1b[0m` : s),
  b: (s) => (TTY ? `\x1b[1m${s}\x1b[0m` : s),
  d: (s) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
};
const ok = (m) => console.log(`   ${C.g('✔')} ${m}`);
const warn = (m) => console.log(`   ${C.y('⚠')} ${m}`);
const bad = (m) => console.log(`   ${C.r('✖')} ${m}`);
const info = (m) => console.log(`   ${C.d('·')} ${m}`);
const section = (n, total, title) =>
  console.log(`\n${C.b(`[${n}/${total}] ${title}`)}\n${C.d('─'.repeat(64))}`);
const truncate = (s, n = 160) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
};

/* ─────────────────────────────── http core ────────────────────────────── */

const U = new URL(CFG.base);
const httpMod = U.protocol === 'https:' ? require('https') : require('http');
const PORT = U.port || (U.protocol === 'https:' ? 443 : 80);
const TIMEOUT_MS = 45000; // legacy scripts hung forever on a dead server

function req(pathname, method, headers, body) {
  return new Promise((resolve) => {
    const data = body == null ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const r = httpMod.request(
      {
        host: U.hostname, port: PORT, path: pathname, method,
        headers: { ...headers, ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ code: res.statusCode || 0, body: buf }));
      }
    );
    r.on('timeout', () => { r.destroy(new Error('timeout')); });
    r.on('error', (e) => resolve({ code: 0, body: String(e && e.message ? e.message : e) }));
    if (data) r.write(data);
    r.end();
  });
}
const postJson = (p, body) => req(p, 'POST', { 'content-type': 'application/json' }, body);
const parse = (body) => { try { return JSON.parse(body); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────── auth + RequestInfo ───────────────────────── */

let RI = null; // set by the auth phase
const ri = (extra) => ({ apiId: 'ccrs-migrate', ver: '1.0', msgId: 'ccrs-migrate', authToken: CFG.token, ...RI, ...extra });

async function login() {
  if (CFG.token) {
    RI = { authToken: CFG.token, userInfo: { tenantId: CFG.state, type: 'EMPLOYEE', roles: [] } };
    return { ok: true, how: 'pre-supplied TOKEN' };
  }
  const form =
    `username=${encodeURIComponent(CFG.user)}&password=${encodeURIComponent(CFG.pass)}` +
    `&userType=EMPLOYEE&tenantId=${encodeURIComponent(CFG.state)}&scope=read&grant_type=password`;
  const r = await req('/user/oauth/token', 'POST',
    { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${CFG.basic}` }, form);
  const j = parse(r.body);
  if (!j || !j.access_token) return { ok: false, code: r.code, body: r.body };
  CFG.token = j.access_token;
  const u = j.UserRequest || {};
  RI = {
    authToken: CFG.token,
    userInfo: { id: u.id, uuid: u.uuid, userName: u.userName, name: u.name, type: u.type, roles: u.roles, tenantId: u.tenantId },
  };
  return { ok: true, how: `password grant as ${CFG.user}@${CFG.state}` };
}

/* ───────────────────────────── mdms helpers ───────────────────────────── */

async function mdmsSearch(tenantId, schemaCode, opts = {}) {
  const r = await postJson('/mdms-v2/v2/_search', {
    RequestInfo: ri(),
    MdmsCriteria: { tenantId, schemaCode, limit: opts.limit || 5000, offset: 0, ...(opts.uniqueIdentifiers ? { uniqueIdentifiers: opts.uniqueIdentifiers } : {}) },
  });
  const j = parse(r.body);
  return { code: r.code, rows: j && Array.isArray(j.mdms) ? j.mdms.map((m) => m.data) : null, raw: j && j.mdms };
}
async function searchAcross(tenants, schema) {
  const all = [];
  for (const t of tenants) {
    const { rows } = await mdmsSearch(t, schema);
    if (rows) all.push(...rows);
  }
  return all;
}
const DUP_RE = /already|exist|duplicate/i;
async function mdmsCreate(tenantId, schemaCode, uniqueIdentifier, data) {
  const r = await postJson(`/mdms-v2/v2/_create/${schemaCode}`, {
    RequestInfo: ri(), Mdms: { tenantId, schemaCode, uniqueIdentifier, data, isActive: true },
  });
  const okResp = r.code >= 200 && r.code < 300;
  return { ok: okResp, exists: !okResp && (r.code === 409 || DUP_RE.test(r.body)), code: r.code, body: r.body };
}
async function schemaSearch(tenantId, codes) {
  // NB: schema _search pages at 10 by default — always pass an explicit limit.
  const r = await postJson('/mdms-v2/schema/v1/_search', { RequestInfo: ri(), SchemaDefCriteria: { tenantId, codes, limit: 200 } });
  const j = parse(r.body);
  return new Set(((j && j.SchemaDefinitions) || []).map((s) => s.code));
}
async function schemaCreate(tenantId, s) {
  // Old MDMS images silently drop schema creates with non-ASCII descriptions
  // (seen on the pilot box) — sanitise. Also strip empty x-ref-schema so the
  // known []->{} coercion bug can't corrupt the stored definition.
  const definition = JSON.parse(JSON.stringify(s.definition));
  const x = definition['x-ref-schema'];
  if ((Array.isArray(x) && !x.length) || (x && typeof x === 'object' && !Array.isArray(x) && !Object.keys(x).length)) {
    delete definition['x-ref-schema'];
  }
  const r = await postJson('/mdms-v2/schema/v1/_create', {
    RequestInfo: ri(),
    SchemaDefinition: {
      tenantId, code: s.code, definition,
      description: String(s.description || '').replace(/[^\x20-\x7E]/g, '').slice(0, 500),
      isActive: s.isActive !== false,
    },
  });
  const okResp = r.code >= 200 && r.code < 300;
  return { ok: okResp, exists: !okResp && (r.code === 409 || DUP_RE.test(r.body)), code: r.code, body: r.body };
}
async function v1Search(tenantId, masterNames) {
  const r = await postJson('/egov-mdms-service/v1/_search', {
    RequestInfo: ri(),
    MdmsCriteria: { tenantId, moduleDetails: [{ moduleName: 'RAINMAKER-PGR', masterDetails: masterNames.map((name) => ({ name })) }] },
  });
  const j = parse(r.body);
  return (j && j.MdmsRes && j.MdmsRes['RAINMAKER-PGR']) || {};
}
async function upsertMessages(tenantId, locale, messages) {
  let success = 0, failed = 0;
  for (let i = 0; i < messages.length; i += 500) {
    const batch = messages.slice(i, i + 500);
    const r = await postJson(`/localization/messages/v1/_upsert?tenantId=${encodeURIComponent(tenantId)}`, {
      RequestInfo: ri({ apiId: 'emp', action: 'create' }), tenantId, locale, messages: batch,
    });
    if (r.code >= 200 && r.code < 300) success += batch.length;
    else {
      for (const m of batch) { // per-message fallback
        const r2 = await postJson(`/localization/messages/v1/_upsert?tenantId=${encodeURIComponent(tenantId)}`, {
          RequestInfo: ri({ apiId: 'emp', action: 'create' }), tenantId, locale, messages: [m],
        });
        r2.code >= 200 && r2.code < 300 ? success++ : failed++;
      }
    }
  }
  return { success, failed };
}
const cacheBust = () => postJson('/localization/messages/cache-bust', { RequestInfo: ri() });
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/* ──────────────────────────── phase framework ─────────────────────────── */

const OUTCOME = { OK: 'OK', SKIPPED: 'SKIPPED', FAILED: 'FAILED', PARTIAL: 'PARTIAL' };
const results = [];
function record(id, status, detail, errorCode, remediation) {
  results.push({ phase: id, status, detail: detail || '', errorCode: errorCode || null, remediation: remediation || null, at: new Date().toISOString() });
  return status;
}

/* ═══════════════════════════ PHASE: schemas ═══════════════════════════ */

async function phaseSchemas() {
  const wanted = [];
  for (const [file, label] of [[SEED.pgrSchemas, 'RAINMAKER-PGR'], [SEED.landingSchemas, 'landing']]) {
    try {
      for (const s of readJson(file)) if (String(s.code || '').startsWith('RAINMAKER-PGR.')) wanted.push(s);
    } catch (e) {
      return record('schemas', OUTCOME.FAILED, `cannot read ${label} schema seed: ${e.message}`, 'SEED_FILE_MISSING',
        `Run from a full repo checkout (expected ${file}).`);
    }
  }
  const existing = await schemaSearch(CFG.state, wanted.map((s) => s.code));
  const todo = wanted.filter((s) => !existing.has(s.code));
  ok(`${existing.size}/${wanted.length} schemas already registered @ ${CFG.state}`);
  if (!todo.length) return record('schemas', OUTCOME.SKIPPED, `all ${wanted.length} schemas present`);
  if (CFG.dryRun) return record('schemas', OUTCOME.SKIPPED, `dry-run: would register ${todo.map((s) => s.code).join(', ')}`);

  let created = 0, failed = 0;
  const failures = [];
  for (const s of todo) {
    const r = await schemaCreate(CFG.state, s);
    if (r.ok || r.exists) { created++; ok(`${s.code} ${r.exists ? '(already present)' : 'submitted'}`); }
    else { failed++; failures.push(`${s.code}: HTTP ${r.code} ${truncate(r.body)}`); bad(`${s.code}: HTTP ${r.code} ${truncate(r.body)}`); }
  }
  // Schema creates persist ASYNC on some stacks (202 via persister) — verify.
  await sleep(6000);
  const after = await schemaSearch(CFG.state, todo.map((s) => s.code));
  const dropped = todo.filter((s) => !after.has(s.code)).map((s) => s.code);
  if (dropped.length) {
    for (const c of dropped) bad(`${c}: accepted but NOT persisted (async persister dropped it)`);
    return record('schemas', OUTCOME.PARTIAL, `${created - dropped.length} persisted, ${dropped.length} dropped, ${failed} failed`,
      'SCHEMA_NOT_PERSISTED',
      `Silently-dropped schema creates need a direct DB insert (known old-image issue): insert the definition into eg_mdms_schema_definition and 'docker restart egov-mdms-service', then re-run. Dropped: ${dropped.join(', ')}`);
  }
  if (failed) return record('schemas', OUTCOME.PARTIAL, `${created} ok, ${failed} failed`, 'SCHEMA_CREATE_FAILED', failures.join(' | '));
  return record('schemas', OUTCOME.OK, `${created} registered, ${existing.size} pre-existing`);
}

/* ══════════════════════════ PHASE: hierarchy ══════════════════════════ */
/* Ported VERBATIM (adapted I/O only) from docs/migration/migrate.cjs —
 * the battle-tested 2-level -> N-level migration. Dual-mode:
 *   preserve — an N-level definition + interior nodes already exist
 *   derive   — synthesise CATEGORY -> SUB_TYPE from ServiceDefs.menuPath
 * Codes are kept VERBATIM (renaming would orphan historical complaints). */

const HDEF = 'RAINMAKER-PGR.ComplaintHierarchyDefinition';
const HIER = 'RAINMAKER-PGR.ComplaintHierarchy';
const SDEF = 'RAINMAKER-PGR.ServiceDefs';
const NODE = 'RAINMAKER-PGR.ClassificationNode';
const DEPTS = 'RAINMAKER-PGR.ComplaintTypeDepartments';
const NODE_SAFE = /^[A-Za-z0-9_.\-\/]+$/; // '/' allowed: real serviceCodes contain it

async function phaseHierarchy() {
  const HT = CFG.hierarchy;
  const managing = CFG.tenant;
  const targets = Array.from(new Set([managing, CFG.state]));

  // detect: already migrated? (leaf rows carry department/slaHours)
  const probe = await mdmsSearch(managing, HIER);
  if (probe.rows && probe.rows.some((n) => n.hierarchyType === HT && (n.department != null || n.slaHours != null))) {
    return record('hierarchy', OUTCOME.SKIPPED, `already migrated (${probe.rows.length} ComplaintHierarchy rows present)`);
  }
  const defProbe = await mdmsSearch(managing, HDEF, { limit: 1 });
  if (probe.rows === null || probe.code >= 500 || defProbe.rows === null || defProbe.code >= 500) {
    return record('hierarchy', OUTCOME.FAILED, `target schemas unreachable (Definition HTTP ${defProbe.code}, Hierarchy HTTP ${probe.code})`,
      'TARGET_SCHEMAS_MISSING', 'Re-run after the schemas phase succeeds.');
  }

  const sdRows = await searchAcross(targets, SDEF);
  const nodeRows = await searchAcross(targets, NODE);
  const defRows = await searchAcross(targets, HDEF);
  const deptRows = await searchAcross(targets, DEPTS);

  const deptByCode = new Map();
  for (const r of deptRows) {
    const sc = String(r.serviceCode == null ? '' : r.serviceCode).trim();
    if (!sc) continue;
    deptByCode.set(sc, {
      departments: Array.isArray(r.departments) ? r.departments.map(String) : [],
      primary: r.primaryDepartment ? String(r.primaryDepartment) : undefined,
    });
  }
  const byCode = new Map();
  for (const r of sdRows) {
    const sc = String(r.serviceCode == null ? '' : r.serviceCode).trim();
    if (!sc) continue;
    const menuPath = String(r.menuPath == null ? '' : r.menuPath).trim();
    const existing = byCode.get(sc);
    if (!existing || (!existing.menuPath && menuPath)) {
      const dep = deptByCode.get(sc);
      const primaryDept = (dep && dep.primary) || (r.department ? String(r.department) : undefined);
      const allDepts = dep && dep.departments && dep.departments.length ? dep.departments : primaryDept ? [primaryDept] : [];
      byCode.set(sc, {
        serviceCode: sc, name: String(r.name == null ? sc : r.name), menuPath,
        menuPathName: r.menuPathName ? String(r.menuPathName) : undefined,
        department: primaryDept, departments: allDepts,
        slaHours: typeof r.slaHours === 'number' ? r.slaHours : Number(r.slaHours) || undefined,
        keywords: r.keywords ? String(r.keywords) : undefined,
        order: typeof r.order === 'number' ? r.order : undefined,
        parentCode: r.parentCode ? String(r.parentCode) : undefined,
        sector: r.sector ? String(r.sector) : undefined,
      });
    }
  }
  const defs = Array.from(byCode.values());
  if (!defs.length) return record('hierarchy', OUTCOME.SKIPPED, 'nothing to migrate (0 ServiceDefs on source)');

  const interiorByCode = new Map();
  for (const n of nodeRows) {
    if (n.hierarchyType && n.hierarchyType !== HT) continue;
    const code = String(n.code == null ? '' : n.code).trim();
    if (!code || interiorByCode.has(code)) continue;
    interiorByCode.set(code, {
      levelCode: String(n.levelCode == null ? 'CATEGORY' : n.levelCode), code,
      parentCode: n.parentCode != null ? String(n.parentCode) : null,
      name: String(n.name == null ? code : n.name),
      order: typeof n.order === 'number' ? n.order : undefined,
      path: n.path ? String(n.path) : undefined,
    });
  }
  const existingDef = defRows.find((d) => d.hierarchyType === HT) || defRows[0];
  const preserve = !!(existingDef && Array.isArray(existingDef.levels) && existingDef.levels.length && interiorByCode.size > 0);
  info(`mode=${preserve ? 'preserve' : 'derive'} · ${defs.length} sub-types · ${interiorByCode.size} existing nodes`);

  let levels, leafLevelCode, interior;
  const linkOf = (l) => l.parentCode || l.sector || l.menuPath || 'Complaint';
  if (preserve) {
    levels = [...existingDef.levels].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    const leafLevel = levels.find((l) => l.isLeafServiceCode) || levels[levels.length - 1];
    leafLevelCode = String((leafLevel && leafLevel.levelCode) == null ? 'SUB_TYPE' : leafLevel.levelCode);
    interior = Array.from(interiorByCode.values());
  } else {
    levels = [
      { levelCode: 'CATEGORY', order: 1, parentLevel: null, isFreeText: false, isLeafServiceCode: false, label: 'Category' },
      { levelCode: 'SUB_TYPE', order: 2, parentLevel: 'CATEGORY', isFreeText: false, isLeafServiceCode: true, label: 'Sub-Type' },
    ];
    leafLevelCode = 'SUB_TYPE';
    const cats = new Map();
    for (const d of defs) {
      const code = d.menuPath || 'Complaint';
      if (!cats.has(code)) cats.set(code, d.menuPathName || code);
    }
    let i = 0;
    interior = Array.from(cats.entries()).map(([code, name]) => ({ levelCode: 'CATEGORY', code, parentCode: null, name, order: ++i, path: code }));
    interior.forEach((n) => interiorByCode.set(n.code, n));
  }

  const unsafe = [...interior.map((n) => n.code), ...defs.map((d) => d.serviceCode)].filter((c) => c && !NODE_SAFE.test(c));
  if (unsafe.length) warn(`${unsafe.length} code(s) contain unusual chars (kept verbatim): ${[...new Set(unsafe)].slice(0, 8).join(', ')}`);
  const interiorCodes = new Set(interior.map((n) => n.code));
  const collisions = defs.filter((d) => interiorCodes.has(d.serviceCode)).map((d) => d.serviceCode);
  if (collisions.length) {
    return record('hierarchy', OUTCOME.FAILED, `${collisions.length} serviceCode(s) collide with interior codes: ${[...new Set(collisions)].slice(0, 5).join(', ')}`,
      'CODE_COLLISIONS', 'Codes must be unique across levels in the merged master; rename the colliding interior nodes first.');
  }
  const orphans = defs.filter((d) => !interiorByCode.has(linkOf(d)));
  if (orphans.length) warn(`${orphans.length} leaf/leaves link to an unknown parent (written with that parentCode anyway)`);

  if (CFG.dryRun) {
    return record('hierarchy', OUTCOME.SKIPPED,
      `dry-run [${preserve ? 'preserve' : 'derive'}]: would create 1 definition + ${interior.length} interior + ${defs.length} leaf rows on ${targets.join(', ')} + localization`);
  }

  const errors = [];
  for (const t of targets) {
    const r = await mdmsCreate(t, HDEF, HT, { hierarchyType: HT, active: true, levels });
    if (!r.ok && !r.exists) errors.push(`definition@${t}: HTTP ${r.code}`);
  }
  let ni = 0;
  for (const n of interior) {
    ni++;
    for (const t of targets) {
      const r = await mdmsCreate(t, HIER, n.code, {
        hierarchyType: HT, levelCode: n.levelCode, code: n.code, parentCode: n.parentCode == null ? null : n.parentCode,
        name: n.name, order: n.order == null ? ni : n.order, active: true, path: n.path || n.code,
      });
      if (!r.ok && !r.exists) errors.push(`node ${n.code}@${t}: HTTP ${r.code}`);
    }
  }
  ok(`${interior.length} interior node(s) processed`);
  let li = 0;
  for (const d of defs) {
    const parentCode = linkOf(d);
    const parentNode = interiorByCode.get(parentCode);
    const parentPath = (parentNode && parentNode.path) || parentCode;
    li++;
    for (const t of targets) {
      const payload = {
        hierarchyType: HT, levelCode: leafLevelCode, code: d.serviceCode, parentCode,
        name: d.name, order: d.order == null ? li : d.order, active: true, path: `${parentPath}.${d.serviceCode}`,
      };
      if (d.department) payload.department = d.department;
      if (d.departments && d.departments.length) payload.departments = d.departments;
      if (d.slaHours != null) payload.slaHours = d.slaHours;
      if (d.keywords) payload.keywords = d.keywords;
      const r = await mdmsCreate(t, HIER, d.serviceCode, payload);
      if (!r.ok && !r.exists) errors.push(`leaf ${d.serviceCode}@${t}: HTTP ${r.code}`);
    }
  }
  ok(`${defs.length} leaf complaint type(s) processed`);

  // localization: COMPLAINT_HIERARCHY.<code> (exact + UPPER) per node
  const messages = [{ code: 'CS_COMPLAINT_LOCATION', message: 'Complaint Location', module: 'rainmaker-pgr', locale: CFG.locale }];
  const seen = new Set(['CS_COMPLAINT_LOCATION']);
  const push = (code, message) => { if (!seen.has(code)) { seen.add(code); messages.push({ code, message, module: 'rainmaker-pgr', locale: CFG.locale }); } };
  for (const n of interior) { push(`COMPLAINT_HIERARCHY.${n.code}`, n.name || n.code); push(`COMPLAINT_HIERARCHY.${String(n.code).toUpperCase()}`, n.name || n.code); }
  for (const d of defs) { push(`COMPLAINT_HIERARCHY.${d.serviceCode}`, d.name || d.serviceCode); push(`COMPLAINT_HIERARCHY.${String(d.serviceCode).toUpperCase()}`, d.name || d.serviceCode); }
  for (const t of targets) {
    const { success, failed } = await upsertMessages(t, CFG.locale, messages);
    (failed ? warn : ok)(`localization @ ${t}: ${success} ok${failed ? `, ${failed} failed` : ''}`);
  }
  await cacheBust();

  // verify
  const vHier = await mdmsSearch(managing, HIER);
  const scoped = (vHier.rows || []).filter((n) => n.hierarchyType === HT);
  const pInterior = scoped.filter((n) => n.department == null && n.slaHours == null).length;
  const pLeaves = scoped.filter((n) => n.department != null || n.slaHours != null).length;
  const detail = `${pInterior}/${interior.length} interior · ${pLeaves}/${defs.length} leaves verified`;
  if (pLeaves >= defs.length && pInterior >= interior.length && !errors.length) return record('hierarchy', OUTCOME.OK, detail);
  return record('hierarchy', errors.length ? OUTCOME.FAILED : OUTCOME.PARTIAL, `${detail}; ${errors.length} write error(s)`,
    'HIERARCHY_INCOMPLETE', errors.slice(0, 8).join(' | ') || 'Async persister may still be catching up — re-run to verify.');
}

/* ═════════════════════════ PHASE: pgr-masters ═════════════════════════ */

const MASTERS = [
  { code: 'RAINMAKER-PGR.ComplaintRelatedToMap', short: 'ComplaintRelatedToMap', file: SEED.relatedToMap, uid: 'code' },
  { code: 'RAINMAKER-PGR.ComplaintTemplateType', short: 'ComplaintTemplateType', file: SEED.templateType, uid: 'caseRelatedTo' },
  { code: 'RAINMAKER-PGR.ComplaintExtendedAttributeSchema', short: 'ComplaintExtendedAttributeSchema', file: SEED.extAttrSchema, uid: 'schemaRef' },
];
const XREF_RE = { cast: /ClassCastException/i, arr: /JSONArray/i };
const NOT_READY_RE = /schema/i;
const NOT_READY_RE2 = /(not found|does not exist|no schema|invalid)/i;

async function phasePgrMasters() {
  let created = 0, present = 0, failed = 0;
  const failures = [];
  for (const m of MASTERS) {
    let rows;
    try { rows = readJson(m.file); }
    catch (e) { failed++; failures.push(`${m.short}: seed file unreadable (${e.message})`); bad(`${m.short}: ${e.message}`); continue; }

    // skip-if-present: does the master already have rows at state (v2)?
    const have = await mdmsSearch(CFG.state, m.code, { limit: 100 });
    const haveUids = new Set((have.raw || []).filter((x) => x.isActive).map((x) => x.uniqueIdentifier));
    const todo = rows.filter((row) => !haveUids.has(String(row[m.uid])));
    if (!todo.length) { present += rows.length; ok(`${m.short}: all ${rows.length} rows present`); continue; }
    if (CFG.dryRun) { info(`dry-run: would create ${todo.length}/${rows.length} rows of ${m.short}`); continue; }

    for (const row of todo) {
      const uid = row[m.uid] != null ? String(row[m.uid]) : undefined;
      let waits = 0, done = false;
      while (!done) {
        const r = await mdmsCreate(CFG.state, m.code, uid, row);
        if (r.ok) { created++; done = true; }
        else if (r.exists) { present++; done = true; }
        else if (XREF_RE.cast.test(r.body) && XREF_RE.arr.test(r.body)) {
          failed++; done = true;
          failures.push(`${m.short}/${uid}: x-ref-schema []->{} bug`);
          bad(`${m.short}/${uid}: x-ref-schema corruption — fix with: UPDATE eg_mdms_schema_definition SET definition=jsonb_set(definition,'{x-ref-schema}','[]'::jsonb) WHERE code='${m.code}' AND jsonb_typeof(definition->'x-ref-schema')='object'; then restart mdms + re-run`);
        } else if (NOT_READY_RE.test(r.body) && NOT_READY_RE2.test(r.body) && waits < 6) {
          waits++; await sleep(3000); // schema persists async — wait up to 18s
        } else {
          failed++; done = true;
          failures.push(`${m.short}/${uid}: HTTP ${r.code} ${truncate(r.body, 120)}`);
          bad(`${m.short}/${uid}: HTTP ${r.code} ${truncate(r.body)}`);
        }
      }
    }
    ok(`${m.short}: seeded (see summary)`);
  }
  if (CFG.dryRun) return record('pgr-masters', OUTCOME.SKIPPED, 'dry-run: plan printed above');

  // verify via the v1 read path the runtime uses
  const res = await v1Search(CFG.state, MASTERS.map((m) => m.short));
  const empty = MASTERS.filter((m) => !((res[m.short] || []).length)).map((m) => m.short);
  const detail = `${created} created, ${present} present, ${failed} failed; v1-visible: ${MASTERS.map((m) => `${m.short}=${(res[m.short] || []).length}`).join(', ')}`;
  if (failed || empty.length) {
    return record('pgr-masters', failed ? OUTCOME.FAILED : OUTCOME.PARTIAL, detail,
      empty.length ? 'MASTER_EMPTY_AFTER_SEED' : 'ROW_CREATE_FAILED', failures.slice(0, 6).join(' | ') || `Empty after seed: ${empty.join(', ')}`);
  }
  return record('pgr-masters', created ? OUTCOME.OK : OUTCOME.SKIPPED, detail);
}

/* ═══════════════════════════ PHASE: landing ═══════════════════════════ */

async function phaseLanding() {
  let sections, config, locEn, locPt;
  try {
    sections = readJson(SEED.landingSections);
    config = readJson(SEED.landingConfig);
    locEn = readJson(SEED.locEn).filter((m) => m.code.startsWith('PGR_LANDING_'));
    locPt = readJson(SEED.locPt).filter((m) => m.code.startsWith('PGR_LANDING_'));
  } catch (e) {
    // Seed files absent (checkout predates the merged landing feature) — the
    // environment may still be fully seeded already, so verify before failing.
    const res = await v1Search(CFG.state, ['LandingSection', 'LandingPageConfig']);
    const nSec = (res.LandingSection || []).length;
    const nCfg = (res.LandingPageConfig || []).length;
    if (nSec >= 1 && nCfg >= 1) {
      ok(`seed files not in this checkout, but environment already seeded (${nSec} sections + ${nCfg} config)`);
      return record('landing', OUTCOME.SKIPPED,
        `already seeded (${nSec} sections + ${nCfg} config via v1); seed files absent locally — git pull to enable (re)seeding`);
    }
    return record('landing', OUTCOME.FAILED, `seed files unreadable: ${e.message}`, 'SEED_FILE_MISSING',
      'Run from a full repo checkout containing the merged landing feature (git pull).');
  }
  const failures = [];
  let created = 0, present = 0, failed = 0;

  const seedRows = async (schemaCode, rows) => {
    for (const row of rows) {
      const uid = String(row.code);
      const have = await mdmsSearch(CFG.state, schemaCode, { uniqueIdentifiers: [uid] });
      if ((have.raw || []).some((x) => x.isActive)) { present++; continue; }
      if (CFG.dryRun) { info(`dry-run: would create ${schemaCode.split('.')[1]}/${uid}`); continue; }
      const r = await mdmsCreate(CFG.state, schemaCode, uid, row);
      if (r.ok || r.exists) created++;
      else { failed++; failures.push(`${schemaCode.split('.')[1]}/${uid}: HTTP ${r.code} ${truncate(r.body, 100)}`); bad(`${uid}: HTTP ${r.code} ${truncate(r.body)}`); }
    }
  };
  await seedRows('RAINMAKER-PGR.LandingSection', sections);
  await seedRows('RAINMAKER-PGR.LandingPageConfig', config);
  ok(`rows: ${created} created, ${present} present, ${failed} failed`);

  if (!CFG.dryRun) {
    for (const [msgs, locale] of [[locEn, 'en_IN'], [locPt, 'pt_PT']]) {
      const { success, failed: f } = await upsertMessages(CFG.state, locale,
        msgs.map((m) => ({ code: m.code, message: m.message, module: 'rainmaker-pgr', locale })));
      (f ? warn : ok)(`localization ${locale}: ${success} keys${f ? `, ${f} failed` : ''}`);
      if (f) { failed += f; failures.push(`localization ${locale}: ${f} failed`); }
    }
  }
  if (CFG.dryRun) return record('landing', OUTCOME.SKIPPED, 'dry-run: plan printed above');

  const res = await v1Search(CFG.state, ['LandingSection', 'LandingPageConfig']);
  const nSec = (res.LandingSection || []).length;
  const nCfg = (res.LandingPageConfig || []).length;
  const detail = `${nSec} sections + ${nCfg} config readable via v1; ${created} created, ${present} pre-existing`;
  if (nSec >= sections.length && nCfg >= 1 && !failed) return record('landing', created ? OUTCOME.OK : OUTCOME.SKIPPED, detail);
  return record('landing', OUTCOME.PARTIAL, detail, 'LANDING_INCOMPLETE',
    failures.slice(0, 6).join(' | ') || 'Rows accepted but not yet v1-visible — async persister; re-run to verify.');
}

/* ═════════════════════════════ PHASE: cms ═════════════════════════════ */

const CMS_ROLES = ['CMS_RECEPTION_OFFICER', 'CMS_SCREENING_OFFICER', 'CMS_SUPERVISOR', 'CMS_CASE_MANAGER', 'CMS_VIEWER'];

async function cmsSearchAll(schemaCode) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const r = await postJson('/mdms-v2/v2/_search', {
      RequestInfo: ri({ userInfo: cmsUserInfo() }), MdmsCriteria: { tenantId: CFG.state, schemaCode, limit: 100, offset },
    });
    const j = parse(r.body);
    const page = (j && j.mdms) || [];
    out.push(...page);
    if (page.length < 100) return out;
  }
}
const cmsUserInfo = () => ({ id: 1, uuid: 'cms-migration', userName: CFG.user, type: 'EMPLOYEE', tenantId: CFG.state, roles: [{ code: 'SUPERUSER', name: 'Super User', tenantId: CFG.state }] });

async function phaseCms() {
  if (!CFG.cms) return record('cms', OUTCOME.SKIPPED, 'opt-in phase — pass --cms to run');
  const city = CFG.tenant.includes('.') ? CFG.tenant : null;
  if (!city) return record('cms', OUTCOME.FAILED, 'CMS workflow needs a city tenant (e.g. mz.igsae), got a state root', 'CMS_TENANT_REQUIRED',
    'Re-run with --tenant <state.city> --phases cms --cms');
  const failures = [];
  try {
    // 1: roles
    const roleRows = readJson(SEED.roles).filter((r) => CMS_ROLES.includes(r.code));
    const haveRoles = new Set((await cmsSearchAll('ACCESSCONTROL-ROLES.roles')).map((m) => m.data && m.data.code));
    for (const r of roleRows.filter((r) => !haveRoles.has(r.code))) {
      if (CFG.dryRun) { info(`dry-run: would create role ${r.code}`); continue; }
      const res = await mdmsCreate(CFG.state, 'ACCESSCONTROL-ROLES.roles', r.code, { ...r, tenantId: CFG.state });
      if (!res.ok && !res.exists) failures.push(`role ${r.code}: HTTP ${res.code}`);
    }
    ok(`roles: ${CMS_ROLES.length} ensured`);
    // 2+3: actions + grants
    const grants = readJson(SEED.roleactions).filter((g) => CMS_ROLES.includes(g.rolecode));
    const catalog = new Map(readJson(SEED.actionsTest).map((a) => [Number(a.id), a]));
    const haveActions = new Set((await cmsSearchAll('ACCESSCONTROL-ACTIONS-TEST.actions-test')).map((m) => Number(m.data && m.data.id)));
    for (const id of [...new Set(grants.map((g) => Number(g.actionid)))].filter((id) => !haveActions.has(id))) {
      const a = catalog.get(id);
      if (!a) { failures.push(`action ${id}: not in catalog seed`); continue; }
      if (CFG.dryRun) continue;
      const res = await mdmsCreate(CFG.state, 'ACCESSCONTROL-ACTIONS-TEST.actions-test', String(id), { ...a, tenantId: CFG.state });
      if (!res.ok && !res.exists) failures.push(`action ${id}: HTTP ${res.code}`);
    }
    const haveGrants = new Set((await cmsSearchAll('ACCESSCONTROL-ROLEACTIONS.roleactions'))
      .map((m) => m.uniqueIdentifier || `${m.data && m.data.rolecode}.${m.data && m.data.actionid}`));
    for (const g of grants.filter((g) => !haveGrants.has(`${g.rolecode}.${g.actionid}`))) {
      if (CFG.dryRun) continue;
      const res = await mdmsCreate(CFG.state, 'ACCESSCONTROL-ROLEACTIONS.roleactions', `${g.rolecode}.${g.actionid}`, { ...g, tenantId: CFG.state });
      if (!res.ok && !res.exists) failures.push(`grant ${g.rolecode}.${g.actionid}: HTTP ${res.code}`);
    }
    ok(`actions + grants ensured (${grants.length} grants)`);
    // 4: workflow BusinessService at the city tenant
    const wfWant = JSON.parse(fs.readFileSync(SEED.cmsWorkflow, 'utf8').split('{tenantid}').join(city)).BusinessServices[0];
    const wfSearch = await postJson(`/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=${encodeURIComponent(city)}&businessServices=PGR`,
      { RequestInfo: ri({ userInfo: cmsUserInfo() }) });
    const live = ((parse(wfSearch.body) || {}).BusinessServices || [])[0] || null;
    if (!live) {
      if (!CFG.dryRun) {
        const r = await postJson('/egov-workflow-v2/egov-wf/businessservice/_create', { RequestInfo: ri({ userInfo: cmsUserInfo() }), BusinessServices: [wfWant] });
        if (r.code < 200 || r.code >= 300) failures.push(`workflow create: HTTP ${r.code} ${truncate(r.body, 120)}`);
        else warn('workflow CREATED — restart egov-workflow-v2 (it caches BusinessServices)');
      } else info('dry-run: would create the CMS PGR BusinessService');
    } else {
      info('workflow BusinessService already present — in-place diff/patch requires the legacy UPDATE_WF path; differences (if any) are not fatal');
    }
  } catch (e) {
    return record('cms', OUTCOME.FAILED, `unexpected: ${e.message}`, 'CMS_UNEXPECTED', e.stack ? truncate(e.stack, 300) : null);
  }
  if (CFG.dryRun) return record('cms', OUTCOME.SKIPPED, 'dry-run: plan printed above');
  if (failures.length) return record('cms', OUTCOME.PARTIAL, `${failures.length} step(s) failed`, 'CMS_STEP_FAILED', failures.slice(0, 6).join(' | '));
  return record('cms', OUTCOME.OK, 'roles, actions, grants, workflow ensured');
}

/* ════════════════════════════ PHASE: verify ═══════════════════════════ */

async function phaseVerify() {
  const checks = [];
  const res = await v1Search(CFG.state, ['ComplaintHierarchy', 'ComplaintRelatedToMap', 'ComplaintTemplateType', 'LandingSection', 'LandingPageConfig']);
  const count = (k) => ((res[k] || []).length);
  checks.push(`ComplaintHierarchy=${count('ComplaintHierarchy')}`);
  checks.push(`RelatedToMap=${count('ComplaintRelatedToMap')}`);
  checks.push(`TemplateType=${count('ComplaintTemplateType')}`);
  checks.push(`LandingSection=${count('LandingSection')}`);
  checks.push(`LandingPageConfig=${count('LandingPageConfig')}`);
  const landingOkStatus = count('LandingSection') >= 10 && count('LandingPageConfig') >= 1;
  const detail = checks.join(' · ');
  info(detail);
  // Only the landing counts have a universal expectation; hierarchy/masters
  // depend on the environment's data, so they're reported, not asserted.
  return record('verify', landingOkStatus ? OUTCOME.OK : OUTCOME.PARTIAL, detail,
    landingOkStatus ? null : 'VERIFY_LOW_COUNTS', landingOkStatus ? null : 'Landing counts below expected (10 sections + 1 config).');
}

/* ═══════════════════════════════ driver ═══════════════════════════════ */

(async () => {
  const started = Date.now();
  console.log(C.b(`\nCCRS unified migration${CFG.dryRun ? '  [DRY-RUN — no writes]' : ''}`));
  console.log(C.d(`host=${CFG.base}  tenant=${CFG.tenant} (state=${CFG.state})  phases=${CFG.phases.join(',')}\n${'═'.repeat(64)}`));

  const PIPELINE = [
    ['auth', async () => {
      const r = await login();
      if (!r.ok) return record('auth', OUTCOME.FAILED, `HTTP ${r.code}: ${truncate(r.body)}`, 'AUTH_FAILED',
        `Check --host/--user/--pass (or pass --token). Login tenant used: ${CFG.state}.`);
      ok(`authenticated (${r.how})`);
      return record('auth', OUTCOME.OK, r.how);
    }],
    ['schemas', phaseSchemas],
    ['hierarchy', phaseHierarchy],
    ['pgr-masters', phasePgrMasters],
    ['landing', phaseLanding],
    ['cms', phaseCms],
    ['verify', phaseVerify],
  ];

  let n = 0;
  const enabled = PIPELINE.filter(([id]) => CFG.phases.includes(id));
  for (const [id, fn] of enabled) {
    section(++n, enabled.length, id);
    if (id !== 'auth' && !RI) { record(id, OUTCOME.SKIPPED, 'skipped: no authentication', 'NO_AUTH'); warn('skipped (auth failed)'); continue; }
    try {
      await fn();
    } catch (e) {
      record(id, OUTCOME.FAILED, `unexpected error: ${e.message}`, 'UNEXPECTED', e.stack ? truncate(e.stack, 400) : null);
      bad(`unexpected: ${e.message}`);
    }
  }

  /* summary */
  console.log(`\n${C.b('SUMMARY')}\n${'═'.repeat(64)}`);
  const pad = (s, w) => String(s).padEnd(w);
  console.log(C.d(pad('PHASE', 14) + pad('RESULT', 10) + pad('ERROR CODE', 26) + 'DETAIL'));
  for (const r of results) {
    const mark = r.status === 'OK' ? C.g('OK     ') : r.status === 'SKIPPED' ? C.d('SKIPPED') : r.status === 'PARTIAL' ? C.y('PARTIAL') : C.r('FAILED ');
    console.log(pad(r.phase, 14) + pad('', 0) + mark + '   ' + pad(r.errorCode || '—', 26) + truncate(r.detail, 90));
    if (r.remediation) console.log(C.d(pad('', 24) + '↳ ' + truncate(r.remediation, 140)));
  }
  const failedCount = results.filter((r) => r.status === 'FAILED' || r.status === 'PARTIAL').length;
  console.log('═'.repeat(64));
  console.log(`${failedCount ? C.y(`${failedCount} phase(s) need attention`) : C.g('All phases clean')} · ${((Date.now() - started) / 1000).toFixed(1)}s · safe to re-run any time (completed work is skipped)`);

  if (CFG.report) {
    fs.writeFileSync(CFG.report, JSON.stringify({ host: CFG.base, tenant: CFG.tenant, dryRun: CFG.dryRun, startedAt: new Date(started).toISOString(), results }, null, 2));
    console.log(C.d(`report written: ${CFG.report}`));
  }
  process.exit(Math.min(failedCount, 125));
})();
