/* eslint-disable */
// ============================================================================
// STANDALONE complaint-hierarchy masters migration (headless, idempotent).
//
// This is the self-contained CLI twin of
//   configurator/src/api/services/hierarchyMigration.ts
// It performs the FULL masters migration into the TWO-master model from the
// PR #861 review (docs/design/complaint-hierarchy-2master-rework-plan.md):
//
//   OLD (either shape):
//     - FLAT:        RAINMAKER-PGR.ServiceDefs grouped by menuPath
//     - HIERARCHICAL: RAINMAKER-PGR.ComplaintHierarchyDefinition + ClassificationNode
//                     (interior) + ServiceDefs (leaf)
//   NEW: RAINMAKER-PGR.ComplaintHierarchyDefinition (levels)
//        + RAINMAKER-PGR.ComplaintHierarchy (ONE adjacency list: interior nodes
//          AND leaf complaint types together).
//
// DUAL-MODE:
//   - PRESERVE: if the tenant already has a Definition + ClassificationNode tree,
//     copy the interior nodes 1:1, keep the existing levels, and link the leaves
//     by their existing parentCode/sector.
//   - DERIVE:   otherwise build a flat 2-level CATEGORY -> SUB_TYPE tree, where
//     the categories come from each ServiceDef's menuPath.
//
// Leaf rows keep `code` = serviceCode VERBATIM, carry the primary `department`
// plus the full `departments[]` list, and slaHours/keywords. `menuPath` is read
// ONLY here (migration time) to derive the parent link; it is never written.
// Node localization keys (COMPLAINT_HIERARCHY.<code>) are seeded so labels resolve.
//
// It runs across BOTH the managing/city tenant AND the state-root tenant so
// every downstream read resolves (pgr-services validates at the state root).
//
// BREAKING + one-way: after this runs and the backend is cut over, the old
// ServiceDefs / ClassificationNode / ComplaintTypeDepartments masters are retired.
//
// ---------------------------------------------------------------------------
// USAGE (same auth style as docs/migration/preflight-dryrun.cjs):
//
//   BASE_URL=https://bomet.gov TENANT=ke.bomet \
//   OAUTH_USER=ADMIN OAUTH_PASS='***' node docs/migration/migrate.cjs
//
//   # Or pass a token you already have (skips login):
//   BASE_URL=... TENANT=ke.bomet TOKEN=<authToken> node docs/migration/migrate.cjs
//
//   # Migrate several tenants in one run (comma/space separated):
//   BASE_URL=... TENANTS="ke.bomet ke" OAUTH_PASS='***' node docs/migration/migrate.cjs
//
//   # Preview only — read + plan, make ZERO writes:
//   BASE_URL=... TENANT=ke.bomet DRY_RUN=1 node docs/migration/migrate.cjs
//
// Env:
//   BASE_URL     gateway base, e.g. https://bomet.gov  or http://localhost:18000  (required)
//   TENANT       a tenant to migrate, e.g. ke.bomet                               (required unless TENANTS)
//   TENANTS      space/comma list of tenants to migrate                           (optional)
//   STATE_TENANT state-root tenant; default = first segment before '.' of each   (optional)
//   OAUTH_USER   employee username for login (default ADMIN)
//   OAUTH_PASS   password (default eGov@123)
//   OAUTH_BASIC  base64 of "<client>:<secret>" (default egov-user-client:)
//   TOKEN        pre-obtained authToken (skips login)
//   HIERARCHY    hierarchyType to create (default PGR)
//   LOCALE       localization locale to seed (default en_IN)
//   DRY_RUN      if set/"1"/"true", read + plan only; make no writes
//
// Exits 0 if every targeted tenant migrated/verified cleanly, 1 otherwise.
// ============================================================================

const url = require('url');

// ── env ─────────────────────────────────────────────────────────────────────
const BASE = process.env.BASE_URL;
const RAW_TENANTS = process.env.TENANTS || process.env.TENANT || '';
const HT = process.env.HIERARCHY || 'PGR';
const LOCALE = process.env.LOCALE || 'en_IN';
const STATE_OVERRIDE = (process.env.STATE_TENANT || '').trim();
const DRY_RUN = /^(1|true|yes)$/i.test(String(process.env.DRY_RUN || ''));
const BASIC = process.env.OAUTH_BASIC || 'ZWdvdi11c2VyLWNsaWVudDo='; // egov-user-client:

const inputTenants = RAW_TENANTS.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
if (!BASE || inputTenants.length === 0) {
  console.error('Set BASE_URL and TENANT (or TENANTS). See header for usage.');
  process.exit(2);
}

const U = new url.URL(BASE);
const http = U.protocol === 'https:' ? require('https') : require('http');
const PORT = U.port || (U.protocol === 'https:' ? 443 : 80);

// ── schema codes ──────────────────────────────────────────────────────────
const HDEF_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchyDefinition';
const HIER_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchy';
const SERVICEDEF_SCHEMA = 'RAINMAKER-PGR.ServiceDefs';
const NODE_SCHEMA = 'RAINMAKER-PGR.ClassificationNode';
const DEPTS_SCHEMA = 'RAINMAKER-PGR.ComplaintTypeDepartments';

const CATEGORY_LEVEL = 'CATEGORY';
const LEAF_LEVEL = 'SUB_TYPE';
// Allowed chars in a code. '/' is permitted: existing serviceCodes use it, MDMS accepts it as a
// uniqueIdentifier, and codes must stay VERBATIM (renaming orphans historical complaints).
const NODE_SAFE = /^[A-Za-z0-9_.\-\/]+$/;

const PASS = '✅', WARN = '⚠️ ', FAIL = '❌', STEP = '•';

// ── transport ───────────────────────────────────────────────────────────────
function req(path, method, headers, body) {
  return new Promise((res) => {
    const r = http.request({ host: U.hostname, port: PORT, path, method, headers }, (s) => {
      let b = '';
      s.on('data', (c) => (b += c));
      s.on('end', () => res({ code: s.statusCode, body: b }));
    });
    r.on('error', (e) => res({ code: 0, body: String(e) }));
    if (body) r.write(body);
    r.end();
  });
}
const form = (p, d) =>
  req(p, 'POST', { authorization: 'Basic ' + BASIC, 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(d) }, d);

let RI = null; // RequestInfo, filled after auth
const post = (p, o) => req(p, 'POST', { 'content-type': 'application/json' }, JSON.stringify(o));

// MDMS v2 search → array of `.data` rows (null on parse/transport failure).
async function search(tenantId, schema, opts = {}) {
  const r = await post('/mdms-v2/v2/_search', {
    RequestInfo: RI,
    MdmsCriteria: { tenantId, schemaCode: schema, limit: opts.limit || 5000, offset: 0, uniqueIdentifiers: opts.uniqueIdentifiers },
  });
  let rows = null;
  try {
    rows = (JSON.parse(r.body).mdms || []).map((m) => m.data);
  } catch {
    rows = null;
  }
  return { code: r.code, rows };
}

// Read a schema across several tenants, concatenating rows (tolerant: a tenant
// that doesn't hold the schema just contributes nothing).
async function searchAcross(tenants, schema) {
  const out = [];
  for (const t of tenants) {
    const r = await search(t, schema);
    if (Array.isArray(r.rows)) out.push(...r.rows);
  }
  return out;
}

// MDMS v2 create. Returns { ok, code, body, duplicate }. "already exists" is
// treated as a tolerated success (idempotent re-run).
async function mdmsCreate(tenantId, schema, uniqueIdentifier, data) {
  const r = await post('/mdms-v2/v2/_create/' + schema, {
    RequestInfo: RI,
    Mdms: { tenantId, schemaCode: schema, uniqueIdentifier, data, isActive: true },
  });
  if (r.code >= 200 && r.code < 300) return { ok: true, code: r.code };
  // Detect duplicates so re-runs are a clean no-op rather than an error.
  const dup = /DUPLICATE|already exist|ALREADY_EXISTS|UniqueIdentifier|unique/i.test(r.body || '');
  return { ok: dup, code: r.code, duplicate: dup, body: r.body };
}

// Localization upsert (batch); falls back to one-by-one on a batch failure so
// a single system-inserted duplicate doesn't drop the whole batch.
async function upsertMessages(tenantId, messages) {
  if (!messages.length) return { success: 0, failed: 0 };
  const BATCH = 500;
  let success = 0, failed = 0;
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    const body = { RequestInfo: { ...RI, apiId: 'emp', action: 'create' }, tenantId, locale: LOCALE, messages: batch };
    const r = await post('/localization/messages/v1/_upsert', body);
    if (r.code >= 200 && r.code < 300) {
      success += batch.length;
    } else {
      for (const m of batch) {
        const rr = await post('/localization/messages/v1/_upsert', { RequestInfo: { ...RI, apiId: 'emp', action: 'create' }, tenantId, locale: LOCALE, messages: [m] });
        if (rr.code >= 200 && rr.code < 300) success += 1;
        else failed += 1;
      }
    }
  }
  return { success, failed };
}

async function cacheBust() {
  await post('/localization/messages/cache-bust', { RequestInfo: RI });
}


// ── per-step logging helper ───────────────────────────────────────────────
function logStep(n, total, label) {
  console.log(`\n[${n}/${total}] ${label}`);
}

// ── per-tenant migration ─────────────────────────────────────────────────
// Performs the full migration for one "managing" tenant (writing to both it and
// the resolved state root). Never throws — returns a structured result.
async function migrateTenant(managing) {
  const state = STATE_OVERRIDE || (managing.includes('.') ? managing.split('.')[0] : managing);
  const targets = Array.from(new Set([managing, state].filter(Boolean)));
  const TOTAL = 8;
  console.log(`\n${'='.repeat(72)}`);
  console.log(`TENANT ${managing}  (writes to: ${targets.join(', ')}; hierarchyType=${HT})${DRY_RUN ? '   [DRY-RUN — no writes]' : ''}`);
  console.log('='.repeat(72));

  const result = { tenant: managing, targets, ok: false, mode: null, serviceDefs: 0, nodes: 0, leaves: 0, message: '' };
  const errors = [];

  // ── 1) READ all source masters ───────────────────────────────────────────
  logStep(1, TOTAL, 'Read existing masters (ServiceDefs / ClassificationNode / Definition / Departments)');
  let sdRows, nodeRows, defRows, deptRows;
  try {
    sdRows = await searchAcross(targets, SERVICEDEF_SCHEMA);
    nodeRows = await searchAcross(targets, NODE_SCHEMA);
    defRows = await searchAcross(targets, HDEF_SCHEMA);
    deptRows = await searchAcross(targets, DEPTS_SCHEMA);
  } catch (e) {
    console.log(`${FAIL} Failed to read masters: ${e && e.message ? e.message : e}`);
    result.message = 'Failed to read the existing masters.';
    return result;
  }

  // Confirm the NEW target schemas are reachable before writing.
  const defProbe = await search(managing, HDEF_SCHEMA, { limit: 1 });
  const hierProbe = await search(managing, HIER_SCHEMA, { limit: 1 });
  if (defProbe.rows === null || defProbe.code >= 500 || hierProbe.rows === null || hierProbe.code >= 500) {
    console.log(`${FAIL} Target schemas not reachable (Definition HTTP ${defProbe.code}, ComplaintHierarchy HTTP ${hierProbe.code}). Install the 2-master schemas before migrating.`);
    result.message = 'Target 2-master schemas not installed/reachable.';
    return result;
  }
  console.log(`${PASS} Target schemas present (${HDEF_SCHEMA}, ${HIER_SCHEMA})`);

  // Multi-department list per serviceCode, from the old ComplaintTypeDepartments master.
  const deptByCode = new Map();
  for (const r of deptRows) {
    const sc = String(r.serviceCode ?? '').trim();
    if (!sc) continue;
    const departments = Array.isArray(r.departments) ? r.departments.map(String) : [];
    deptByCode.set(sc, { departments, primary: r.primaryDepartment ? String(r.primaryDepartment) : undefined });
  }

  // Leaves (source), dedupe by serviceCode.
  const byCode = new Map();
  for (const r of sdRows) {
    const sc = String(r.serviceCode ?? '').trim();
    if (!sc) continue;
    const menuPath = String(r.menuPath ?? '').trim();
    const existing = byCode.get(sc);
    if (!existing || (!existing.menuPath && menuPath)) {
      const dep = deptByCode.get(sc);
      const primaryDept = (dep && dep.primary) || (r.department ? String(r.department) : undefined);
      const allDepts = dep && dep.departments && dep.departments.length ? dep.departments : primaryDept ? [primaryDept] : [];
      byCode.set(sc, {
        serviceCode: sc,
        name: String(r.name ?? sc),
        menuPath,
        menuPathName: r.menuPathName ? String(r.menuPathName) : undefined,
        department: primaryDept,
        departments: allDepts,
        slaHours: typeof r.slaHours === 'number' ? r.slaHours : Number(r.slaHours) || undefined,
        keywords: r.keywords ? String(r.keywords) : undefined,
        order: typeof r.order === 'number' ? r.order : undefined,
        parentCode: r.parentCode ? String(r.parentCode) : undefined,
        sector: r.sector ? String(r.sector) : undefined,
      });
    }
  }
  const defs = Array.from(byCode.values());
  result.serviceDefs = defs.length;

  // Existing interior nodes (old ClassificationNode), dedupe by code, scoped to this hierarchyType.
  const interiorByCode = new Map();
  for (const n of nodeRows) {
    if (n.hierarchyType && n.hierarchyType !== HT) continue;
    const code = String(n.code ?? '').trim();
    if (!code || interiorByCode.has(code)) continue;
    interiorByCode.set(code, {
      levelCode: String(n.levelCode ?? CATEGORY_LEVEL),
      code,
      parentCode: n.parentCode != null ? String(n.parentCode) : null,
      name: String(n.name ?? code),
      order: typeof n.order === 'number' ? n.order : undefined,
      path: n.path ? String(n.path) : undefined,
    });
  }
  const existingDef = defRows.find((d) => d.hierarchyType === HT) || defRows[0];
  console.log(`${PASS} Read: ${defs.length} sub-types · ${interiorByCode.size} existing nodes · def:${existingDef ? 'yes' : 'no'} · depts:${deptByCode.size}`);

  if (defs.length === 0) {
    console.log(`${WARN}No complaint types (ServiceDefs) found on ${targets.join(' / ')}. Nothing to migrate.`);
    result.message = 'Nothing to migrate (0 ServiceDefs).';
    result.ok = true; // an empty source is not a failure
    return result;
  }

  // ── 2) DETERMINE SHAPE (dual-mode) ────────────────────────────────────────
  logStep(2, TOTAL, 'Determine hierarchy shape (preserve existing, or derive 2-level)');
  const preserve = !!(existingDef && Array.isArray(existingDef.levels) && existingDef.levels.length && interiorByCode.size > 0);
  const mode = preserve ? 'preserve' : 'derive';
  result.mode = mode;

  let levels, leafLevelCode, interior;
  const linkOf = (l) => l.parentCode || l.sector || l.menuPath || 'Complaint';

  if (preserve) {
    levels = [...existingDef.levels].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    const leafLevel = levels.find((l) => l.isLeafServiceCode) || levels[levels.length - 1];
    leafLevelCode = String((leafLevel && leafLevel.levelCode) ?? LEAF_LEVEL);
    interior = Array.from(interiorByCode.values());
  } else {
    levels = [
      { levelCode: CATEGORY_LEVEL, order: 1, parentLevel: null, isFreeText: false, isLeafServiceCode: false, label: 'Category' },
      { levelCode: LEAF_LEVEL, order: 2, parentLevel: CATEGORY_LEVEL, isFreeText: false, isLeafServiceCode: true, label: 'Sub-Type' },
    ];
    leafLevelCode = LEAF_LEVEL;
    const cats = new Map();
    for (const d of defs) {
      const code = d.menuPath || 'Complaint';
      if (!cats.has(code)) cats.set(code, d.menuPathName || code);
    }
    let i = 0;
    interior = Array.from(cats.entries()).map(([code, name]) => ({ levelCode: CATEGORY_LEVEL, code, parentCode: null, name, order: ++i, path: code }));
    interior.forEach((n) => interiorByCode.set(n.code, n));
  }
  result.nodes = interior.length;
  console.log(`${PASS} Mode=${mode} · ${levels.length} level(s) [${levels.map((l) => l.levelCode).join(' → ')}] · ${interior.length} interior node(s)`);

  // Code-safety: codes become ComplaintHierarchy uniqueIdentifiers and are kept VERBATIM (renaming
  // would orphan historical complaints / escalation / localization). They already exist as valid
  // ServiceDefs uids, so this is a WARNING, not an abort — any code MDMS genuinely rejects will
  // surface as a per-leaf write error below.
  const unsafe = [...interior.map((n) => n.code), ...defs.map((d) => d.serviceCode)].filter((c) => c && !NODE_SAFE.test(c));
  if (unsafe.length) {
    console.log(`${WARN}${unsafe.length} code(s) contain unusual chars (kept verbatim): ${[...new Set(unsafe)].slice(0, 8).join(', ')} — proceeding.`);
  }

  // Collision guard: merged x-unique is (hierarchyType, code).
  const interiorCodes = new Set(interior.map((n) => n.code));
  const collisions = defs.filter((d) => interiorCodes.has(d.serviceCode)).map((d) => d.serviceCode);
  if (collisions.length) {
    console.log(`${FAIL} ${collisions.length} serviceCode(s) collide with an interior node code: ${[...new Set(collisions)].slice(0, 5).join(', ')}`);
    console.log('     Codes must be globally unique in the merged master. Aborting this tenant.');
    result.message = `${collisions.length} code collision(s).`;
    return result;
  }

  // Orphan check: every leaf must link to a known interior node.
  const orphans = defs.filter((d) => !interiorByCode.has(linkOf(d)));
  if (orphans.length) {
    console.log(`${WARN}${orphans.length} leaf/leaves link to an unknown parent (e.g. ${orphans.slice(0, 5).map((d) => `${d.serviceCode}→${linkOf(d)}`).join(', ')}). They will still be written with that parentCode.`);
  }

  if (DRY_RUN) {
    console.log(`\n${WARN}DRY-RUN: would create 1 definition + ${interior.length} interior node(s) + ${defs.length} leaf row(s) into ${HIER_SCHEMA} on ${targets.join(', ')}, then seed localization.`);
    result.leaves = defs.length;
    result.ok = true;
    result.message = 'Dry-run only; no writes performed.';
    return result;
  }

  // ── 3) DEFINITION ─────────────────────────────────────────────────────────
  logStep(3, TOTAL, 'Create / keep the hierarchy definition');
  for (const t of targets) {
    const r = await mdmsCreate(t, HDEF_SCHEMA, HT, { hierarchyType: HT, active: true, levels });
    if (!r.ok) { errors.push(`definition@${t}: HTTP ${r.code}`); console.log(`${WARN}definition @ ${t}: HTTP ${r.code} ${truncate(r.body)}`); }
  }
  console.log(`${PASS} Definition ensured on ${targets.join(', ')}`);

  // ── 4) INTERIOR NODES → ComplaintHierarchy ─────────────────────────────────
  logStep(4, TOTAL, 'Create interior nodes in ComplaintHierarchy');
  let ni = 0, nodeFail = 0;
  for (const n of interior) {
    ni++;
    for (const t of targets) {
      const r = await mdmsCreate(t, HIER_SCHEMA, n.code, {
        hierarchyType: HT, levelCode: n.levelCode, code: n.code, parentCode: n.parentCode ?? null,
        name: n.name, order: n.order ?? ni, active: true, path: n.path || n.code,
      });
      if (!r.ok) { nodeFail++; errors.push(`node ${n.code}@${t}: HTTP ${r.code}`); console.log(`${WARN}node ${n.code} @ ${t}: HTTP ${r.code} ${truncate(r.body)}`); }
    }
    process.stdout.write(`\r     ${STEP} ${ni}/${interior.length} interior nodes`);
  }
  console.log(`\n${nodeFail ? WARN : PASS} ${interior.length} interior node(s) processed${nodeFail ? ` (${nodeFail} write error(s))` : ''}`);

  // ── 5) LEAF ROWS → ComplaintHierarchy (code=serviceCode verbatim, departments[]) ──
  logStep(5, TOTAL, 'Create leaf complaint types in ComplaintHierarchy');
  let li = 0, leafFail = 0;
  for (const d of defs) {
    const parentCode = linkOf(d);
    const parentNode = interiorByCode.get(parentCode);
    const parentPath = (parentNode && parentNode.path) || parentCode;
    li++;
    for (const t of targets) {
      const r = await mdmsCreate(t, HIER_SCHEMA, d.serviceCode, {
        hierarchyType: HT,
        levelCode: leafLevelCode,
        code: d.serviceCode,
        parentCode,
        name: d.name,
        order: d.order ?? li,
        active: true,
        path: `${parentPath}.${d.serviceCode}`,
        ...(d.department ? { department: d.department } : {}),
        ...(d.departments && d.departments.length ? { departments: d.departments } : {}),
        ...(d.slaHours != null ? { slaHours: d.slaHours } : {}),
        ...(d.keywords ? { keywords: d.keywords } : {}),
      });
      if (!r.ok) { leafFail++; errors.push(`leaf ${d.serviceCode}@${t}: HTTP ${r.code}`); console.log(`${WARN}leaf ${d.serviceCode} @ ${t}: HTTP ${r.code} ${truncate(r.body)}`); }
    }
    process.stdout.write(`\r     ${STEP} ${li}/${defs.length} leaves`);
  }
  result.leaves = defs.length;
  console.log(`\n${leafFail ? WARN : PASS} ${defs.length} leaf complaint type(s) processed${leafFail ? ` (${leafFail} write error(s))` : ''}`);

  // ── 6) LOCALIZATION — seed COMPLAINT_HIERARCHY.<code> keys for every node ───
  // Labels are resolved key-based in the UI (like every other service), so each
  // node (interior + leaf) needs a COMPLAINT_HIERARCHY.<code> message in the
  // default locale; emit exact-case + uppercase (the runtime queries upper).
  logStep(6, TOTAL, 'Seed localization keys');
  try {
    const messages = [{ code: 'CS_COMPLAINT_LOCATION', message: 'Complaint Location', module: 'rainmaker-pgr', locale: LOCALE }];
    const seen = new Set(['CS_COMPLAINT_LOCATION']);
    const push = (code, message) => { if (seen.has(code)) return; seen.add(code); messages.push({ code, message, module: 'rainmaker-pgr', locale: LOCALE }); };
    for (const n of interior) { const nm = n.name || n.code; push(`COMPLAINT_HIERARCHY.${n.code}`, nm); push(`COMPLAINT_HIERARCHY.${String(n.code).toUpperCase()}`, nm); }
    for (const d of defs) { const nm = d.name || d.serviceCode; push(`COMPLAINT_HIERARCHY.${d.serviceCode}`, nm); push(`COMPLAINT_HIERARCHY.${String(d.serviceCode).toUpperCase()}`, nm); }
    for (const t of targets) {
      const { success, failed } = await upsertMessages(t, messages);
      console.log(`${failed ? WARN : PASS} localization @ ${t}: ${success} ok${failed ? `, ${failed} failed` : ''}`);
    }
  } catch (e) {
    console.log(`${WARN}localization seed error (non-fatal): ${e && e.message ? e.message : e}`);
  }

  // ── 7) VERIFY at the managing tenant ───────────────────────────────────────
  logStep(7, TOTAL, 'Verify the merged hierarchy is in place');
  try {
    const vDef = await search(managing, HDEF_SCHEMA, { uniqueIdentifiers: [HT] });
    const vHier = await search(managing, HIER_SCHEMA, { limit: 5000 });
    const scoped = (vHier.rows || []).filter((n) => n.hierarchyType === HT);
    const presentInterior = scoped.filter((n) => n.department == null && n.slaHours == null).length;
    const presentLeaves = scoped.filter((n) => n.department != null || n.slaHours != null).length;
    if (!vDef.rows || vDef.rows.length === 0) {
      console.log(`${FAIL} Definition not found after create.`);
      result.message = 'Verification failed: definition missing.';
      return result;
    }
    if (presentInterior < interior.length || presentLeaves < defs.length) {
      console.log(`${WARN}Verification incomplete: ${presentInterior}/${interior.length} interior nodes · ${presentLeaves}/${defs.length} leaves present.`);
      result.message = `Verification incomplete (${presentInterior}/${interior.length} nodes, ${presentLeaves}/${defs.length} leaves).`;
      // Not a hard failure if writes mostly succeeded, but flag it.
      result.ok = errors.length === 0 && presentLeaves > 0;
    } else {
      console.log(`${PASS} Verified: def ok · ${presentInterior} interior node(s) · ${presentLeaves} leaf/leaves`);
      result.ok = true;
    }
    result.nodes = presentInterior;
    result.leaves = presentLeaves;
  } catch (e) {
    console.log(`${WARN}Verification call failed: ${e && e.message ? e.message : e}. Records may still have been created.`);
    result.message = 'Verification call failed.';
  }

  // ── 8) REFRESH caches ───────────────────────────────────────────────────────
  logStep(8, TOTAL, 'Refresh caches');
  try {
    await cacheBust();
    console.log(`${PASS} Localization cache busted`);
  } catch (e) {
    console.log(`${WARN}Cache-bust failed (non-fatal): ${e && e.message ? e.message : e}`);
  }

  if (errors.length) {
    result.message = `${errors.length} write error(s); see log above.`;
    if (result.ok) console.log(`${WARN}Completed with ${errors.length} non-fatal write error(s).`);
  }
  return result;
}

function truncate(s, n = 120) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ── auth + driver ──────────────────────────────────────────────────────────
(async () => {
  console.log(`\nStandalone complaint-hierarchy migration${DRY_RUN ? ' (DRY-RUN)' : ''}`);
  console.log(`  base=${BASE}  hierarchyType=${HT}  locale=${LOCALE}`);
  console.log(`  tenants=${inputTenants.join(', ')}`);

  // Auth once; reuse the token across every tenant write.
  const loginTenant = STATE_OVERRIDE || inputTenants[0];
  let token = process.env.TOKEN;
  if (!token) {
    const d = `username=${encodeURIComponent(process.env.OAUTH_USER || 'ADMIN')}&password=${encodeURIComponent(process.env.OAUTH_PASS || 'eGov@123')}&userType=EMPLOYEE&tenantId=${loginTenant}&scope=read&grant_type=password`;
    const r = await form('/user/oauth/token', d);
    let j;
    try { j = JSON.parse(r.body); } catch { j = null; }
    if (!j || !j.access_token) {
      console.log(`\n${FAIL} Auth failed (HTTP ${r.code}). Check BASE_URL/credentials/OAUTH_BASIC.`);
      process.exit(2);
    }
    token = j.access_token;
    const u = j.UserRequest;
    RI = { apiId: 'Rainmaker', ver: '1.0', msgId: 'migrate', authToken: token, userInfo: { id: u.id, uuid: u.uuid, userName: u.userName, name: u.name, type: u.type, roles: u.roles, tenantId: u.tenantId } };
  } else {
    RI = { apiId: 'Rainmaker', ver: '1.0', msgId: 'migrate', authToken: token, userInfo: { tenantId: loginTenant, type: 'EMPLOYEE', roles: [] } };
  }
  console.log(`${PASS} Auth OK\n`);

  const results = [];
  for (const t of inputTenants) {
    try {
      results.push(await migrateTenant(t));
    } catch (e) {
      // Never let one tenant's unexpected error abort the whole run.
      console.log(`${FAIL} Unexpected error migrating ${t}: ${e && e.stack ? e.stack : e}`);
      results.push({ tenant: t, ok: false, message: e && e.message ? e.message : String(e), nodes: 0, leaves: 0, mode: null });
    }
  }

  // Final summary
  console.log(`\n${'='.repeat(72)}`);
  console.log('SUMMARY');
  console.log('='.repeat(72));
  let allOk = true;
  for (const r of results) {
    const icon = r.ok ? PASS : FAIL;
    if (!r.ok) allOk = false;
    console.log(`${icon} ${r.tenant.padEnd(16)} mode=${r.mode || '-'}  nodes=${r.nodes || 0}  leaves=${r.leaves || 0}${r.message ? `  — ${r.message}` : ''}`);
  }
  console.log('='.repeat(72));
  if (DRY_RUN) {
    console.log(`${WARN}DRY-RUN complete — no writes were made.\n`);
    process.exit(allOk ? 0 : 1);
  }
  if (allOk) {
    console.log(`${PASS} Migration complete for all targeted tenants.`);
    console.log(`${WARN}NEXT: deploy the cutover backend (pgr-services validating against ComplaintHierarchy + V2 grain-MV forward migration), then the frontends, then retire the old ServiceDefs/ClassificationNode/ComplaintTypeDepartments masters.\n`);
    process.exit(0);
  }
  console.log(`${FAIL} One or more tenants did not migrate cleanly — see the log above.\n`);
  process.exit(1);
})();
