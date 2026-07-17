#!/usr/bin/env node
/**
 * seed-pgr-masters.cjs — ONE-SHOT onboarding for the PGR dynamic-fields masters.
 *
 * Registers + seeds, at a STATE tenant, the two masters that drive the citizen
 * "Complaint related to" dropdown and the per-authority dynamic fields:
 *   - RAINMAKER-PGR.ComplaintRelatedToMap
 *   - RAINMAKER-PGR.ComplaintTemplateType
 *
 * It does everything end-to-end: preflight (login) → register schemas → seed data
 * → verify, printing clear ✓/✗ at each stage. It is idempotent (safe to re-run),
 * and it AUTO-HANDLES the mdms-v2 "x-ref-schema []→{}" quirk (it strips the empty
 * x-ref-schema before registering, and if a pre-existing schema still has the bug
 * it repairs it via the DB and retries). Works for LOCAL and PRODUCTION.
 *
 * USAGE
 *   LOCAL:  BASE_URL=http://localhost:18000 TENANT=mz node docs/migration/seed-pgr-masters.cjs
 *
 *   CMS multi-tier workflow (optional): add CMS=1 to ALSO seed the CMS_* roles,
 *   any missing actions-test catalog entries, their role→action grants (all at the
 *   state tenant) and the CMS PGR BusinessService (at the CITY tenant). Source of
 *   truth = the default-data-handler resources (same files fresh setups use).
 *     BASE_URL=http://localhost:18000 TENANT=mz.igsae CMS=1 node docs/migration/seed-pgr-masters.cjs
 *   With CMS=1, TENANT must be the CITY tenant (or pass CMS_TENANT=<state.city>).
 *   UPDATE_WF=1 additionally applies in-place workflow role/nextState/flag changes
 *   when the live BusinessService differs. After a workflow create/update, restart
 *   egov-workflow-v2 (it caches BusinessServices).
 *   PROD :  BASE_URL=http://<host> TENANT=mz OAUTH_USER=<admin> OAUTH_PASS=<pass> \
 *             PGPASSWORD=<egov-db-pass> node docs/migration/seed-pgr-masters.cjs   (run on the VM)
 *
 * ENV
 *   BASE_URL   (required)  API gateway, e.g. http://localhost:18000
 *   TENANT     (required)  state or sub-tenant; masters are seeded at the STATE (first segment)
 *   OAUTH_USER / OAUTH_PASS   admin login (default ADMIN / eGov@123) — set real values on prod
 *   TOKEN      pre-obtained authToken (skips login)
 *   DB_CONTAINER  postgres container name for the x-ref auto-fix (default docker-postgres)
 *   PGPASSWORD    egov DB password for the x-ref auto-fix on prod (local trust needs none)
 *   NO_DB_FIX=1   don't touch the DB; if the x-ref bug is hit, print the SQL and stop
 */
const http = require("http");
const https = require("https");
const url = require("url");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
const TENANT = (process.env.TENANT || "").trim();
const STATE = TENANT.includes(".") ? TENANT.split(".")[0] : TENANT; // masters are state-level
const OAUTH_USER = process.env.OAUTH_USER || "ADMIN";
const OAUTH_PASS = process.env.OAUTH_PASS || "eGov@123";
const OAUTH_BASIC = process.env.OAUTH_BASIC || "egov-user-client:";
let TOKEN = process.env.TOKEN || "";
const DB_CONTAINER = process.env.DB_CONTAINER || "docker-postgres";
const NO_DB_FIX = process.env.NO_DB_FIX === "1";
const RESEED = process.env.RESEED === "1"; // drop old schema defs + data for these masters first (use when the master SHAPE changed)
const CMS = process.env.CMS === "1";       // also seed the CMS multi-tier workflow (roles/actions/grants/BusinessService)
const CMS_TENANT = process.env.CMS_TENANT || (TENANT.includes(".") ? TENANT : ""); // city tenant for the workflow
const UPDATE_WF = process.env.UPDATE_WF === "1";

const SCHEMA_FILE = path.join(
  __dirname, "..", "..",
  "utilities", "default-data-handler", "src", "main", "resources", "schema", "RAINMAKER-PGR.json"
);
const CMS_ROLES = ["CMS_RECEPTION_OFFICER", "CMS_SCREENING_OFFICER", "CMS_SUPERVISOR", "CMS_CASE_MANAGER", "CMS_VIEWER"];
const DDH_RES = path.join(__dirname, "..", "..", "utilities", "default-data-handler", "src", "main", "resources");
const CMS_FILES = {
  roles: path.join(DDH_RES, "mdmsData", "ACCESSCONTROL-ROLE", "ACCESSCONTROL-ROLES.roles.json"),
  roleactions: path.join(DDH_RES, "mdmsData", "ACCESSCONTROL-ROLEACTIONS", "ACCESSCONTROL-ROLEACTIONS.roleactions.json"),
  actions: path.join(DDH_RES, "mdmsData", "ACCESSCONTROL-ACTIONS-TEST", "ACCESSCONTROL-ACTIONS-TEST.actions-test.json"),
  workflow: path.join(DDH_RES, "CmsPgrWorkflowConfig.json"),
};

const MASTERS = [
  { code: "RAINMAKER-PGR.ComplaintRelatedToMap", file: path.join(__dirname, "seed", "ComplaintRelatedToMap.json"), uid: "code" },
  { code: "RAINMAKER-PGR.ComplaintTemplateType", file: path.join(__dirname, "seed", "ComplaintTemplateType.json"), uid: "caseRelatedTo" },
  { code: "RAINMAKER-PGR.ComplaintExtendedAttributeSchema", file: path.join(__dirname, "seed", "ComplaintExtendedAttributeSchema.json"), uid: "schemaRef" },
];

function die(msg) { console.error("\n✗ " + msg + "\n"); process.exit(1); }
if (!BASE || !TENANT) {
  die("Set BASE_URL and TENANT.\n    e.g. BASE_URL=http://localhost:18000 TENANT=mz node docs/migration/seed-pgr-masters.cjs");
}
if (CMS && !CMS_TENANT) {
  die("CMS=1 needs the CITY tenant for the workflow — set TENANT=<state.city> (e.g. mz.igsae) or CMS_TENANT=<state.city>.");
}

function req(method, p, body, headers) {
  return new Promise((resolve) => {
    const U = url.parse(BASE + p);
    const lib = U.protocol === "https:" ? https : http;
    const data = body == null ? null : typeof body === "string" ? body : JSON.stringify(body);
    const h = Object.assign({ "Content-Type": "application/json" }, headers || {});
    if (data) h["Content-Length"] = Buffer.byteLength(data);
    const rq = lib.request({ hostname: U.hostname, port: U.port, path: U.path, method, headers: h }, (s) => {
      let buf = ""; s.on("data", (c) => (buf += c)); s.on("end", () => resolve({ code: s.statusCode, body: buf }));
    });
    rq.on("error", (e) => resolve({ code: 0, body: String(e) }));
    if (data) rq.write(data);
    rq.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const form =
    "username=" + encodeURIComponent(OAUTH_USER) +
    "&password=" + encodeURIComponent(OAUTH_PASS) +
    "&grant_type=password&scope=read&userType=EMPLOYEE&tenantId=" + encodeURIComponent(STATE);
  const r = await req("POST", "/user/oauth/token", form, {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: "Basic " + Buffer.from(OAUTH_BASIC).toString("base64"),
  });
  try { return JSON.parse(r.body).access_token || ""; } catch { return ""; }
}
let RI;

function loadSchemaDefs() {
  let all;
  try { all = JSON.parse(fs.readFileSync(SCHEMA_FILE, "utf8")); }
  catch (e) { die("cannot read schema file " + SCHEMA_FILE + "\n    " + e); }
  const out = {};
  for (const m of MASTERS) {
    const s = all.find((x) => x.code === m.code);
    if (!s) die("schema definition " + m.code + " not found in " + SCHEMA_FILE);
    // Defensive: drop an EMPTY x-ref-schema so mdms-v2 cannot coerce []→{} (the quirk).
    const xref = s.definition && s.definition["x-ref-schema"];
    const empty = Array.isArray(xref) ? xref.length === 0 : xref && typeof xref === "object" && Object.keys(xref).length === 0;
    if (empty) delete s.definition["x-ref-schema"];
    out[m.code] = s;
  }
  return out;
}

async function registerSchemas(defs) {
  for (const m of MASTERS) {
    const s = defs[m.code];
    const r = await req("POST", "/mdms-v2/schema/v1/_create", {
      RequestInfo: RI,
      SchemaDefinition: { tenantId: STATE, code: s.code, description: s.description, definition: s.definition, isActive: s.isActive !== false },
    });
    if (r.code >= 200 && r.code < 300) console.log("  ✓ schema " + m.code + " registered");
    else if (r.code === 409 || /already|exist|duplicate/i.test(r.body)) console.log("  • schema " + m.code + " already present");
    else die("schema create failed for " + m.code + " (HTTP " + r.code + "): " + r.body.slice(0, 220));
  }
}

const isXrefError = (b) => /ClassCastException/i.test(b) && /JSONArray/i.test(b);
const isSchemaNotReady = (b) => /schema/i.test(b) && /(not found|does not exist|no schema|invalid)/i.test(b);

function xrefSql(code) {
  return `UPDATE eg_mdms_schema_definition SET definition=jsonb_set(definition,'{x-ref-schema}','[]'::jsonb) ` +
    `WHERE tenantid='${STATE}' AND code='${code}' AND jsonb_typeof(definition->'x-ref-schema')='object';`;
}
function tryAutoXrefFix(code) {
  if (NO_DB_FIX) return false;
  const pass = process.env.PGPASSWORD != null ? process.env.PGPASSWORD : process.env.PG_PROD_PASS;
  const envArg = pass != null ? `-e PGPASSWORD=${JSON.stringify(pass)} ` : "";
  try {
    execSync(`docker exec ${envArg}${DB_CONTAINER} psql -U egov -d egov -c ${JSON.stringify(xrefSql(code))}`, { stdio: "pipe" });
    return true;
  } catch { return false; }
}
function printManualXrefFix(code) {
  console.error("    FIX — run once, then re-run this script:");
  console.error(`      docker exec ${DB_CONTAINER} psql -U egov -d egov -c "${xrefSql(code)}"`);
  console.error("      (prod: same SQL on the prod DB, with the egov DB password)");
}

// When the master SHAPE changes (e.g. ComplaintRelatedToMap relatedTo→code), the
// already-registered schema defs + data must be removed first — registerSchemas/
// seedMaster are idempotent and would otherwise keep the OLD shape (409 "already
// present"). RESEED=1 clears them (local DB via docker exec; prod prints the SQL).
function reseedCleanup() {
  const codes = MASTERS.map((m) => `'${m.code}'`).join(",");
  const sqlData = `DELETE FROM eg_mdms_data WHERE tenantid='${STATE}' AND schemacode IN (${codes});`;
  const sqlSchema = `DELETE FROM eg_mdms_schema_definition WHERE tenantid='${STATE}' AND code IN (${codes});`;
  if (NO_DB_FIX) {
    console.error("  RESEED needs DB access but NO_DB_FIX=1. Run these once, then re-run WITHOUT RESEED:");
    console.error("    " + sqlData);
    console.error("    " + sqlSchema);
    die("RESEED cleanup not performed (NO_DB_FIX=1).");
  }
  const pass = process.env.PGPASSWORD != null ? process.env.PGPASSWORD : process.env.PG_PROD_PASS;
  const envArg = pass != null ? `-e PGPASSWORD=${JSON.stringify(pass)} ` : "";
  for (const sql of [sqlData, sqlSchema]) {
    try {
      execSync(`docker exec ${envArg}${DB_CONTAINER} psql -U egov -d egov -c ${JSON.stringify(sql)}`, { stdio: "pipe" });
    } catch {
      console.error("  ✗ RESEED cleanup could not run (no DB access?). Run manually, then re-run without RESEED:");
      console.error("    " + sqlData);
      console.error("    " + sqlSchema);
      die("RESEED cleanup failed.");
    }
  }
  console.log("  ✓ removed old schema defs + data for " + MASTERS.map((m) => m.code.split(".")[1]).join(", "));
}

async function seedMaster(m) {
  let rows;
  try { rows = JSON.parse(fs.readFileSync(m.file, "utf8")); }
  catch (e) { die("cannot read seed file " + m.file + "\n    " + e); }
  let ok = 0, exists = 0, fixedXref = false;
  for (const data of rows) {
    const uid = data[m.uid] != null ? String(data[m.uid]) : undefined;
    let schemaWait = 0;
    for (;;) {
      const r = await req("POST", "/mdms-v2/v2/_create/" + m.code, {
        RequestInfo: RI, Mdms: { tenantId: STATE, schemaCode: m.code, uniqueIdentifier: uid, data, isActive: true },
      });
      if (r.code >= 200 && r.code < 300) { ok++; break; }
      if (r.code === 409 || /already|exist|duplicate/i.test(r.body)) { exists++; break; }
      if (isXrefError(r.body)) {
        if (fixedXref) die("x-ref-schema still failing on " + m.code + " after repair: " + r.body.slice(0, 200));
        process.stdout.write("  … x-ref-schema quirk on " + m.code + " — repairing… ");
        if (tryAutoXrefFix(m.code)) { console.log("fixed."); fixedXref = true; await sleep(1500); continue; }
        console.log("could NOT auto-repair (no DB access).");
        printManualXrefFix(m.code);
        die("seeding blocked by the x-ref-schema quirk on " + m.code + " — apply the fix above and re-run.");
      }
      if (isSchemaNotReady(r.body) && schemaWait < 6) { schemaWait++; await sleep(3000); continue; } // schema persists async
      die("data create failed for " + m.code + " uid=" + uid + " (HTTP " + r.code + "): " + r.body.slice(0, 240));
    }
  }
  console.log("  ✓ data " + m.code + ": " + ok + " created, " + exists + " already present");
}

async function verify() {
  const r = await req("POST", "/egov-mdms-service/v1/_search", {
    RequestInfo: RI,
    MdmsCriteria: { tenantId: STATE, moduleDetails: [{ moduleName: "RAINMAKER-PGR", masterDetails: MASTERS.map((m) => ({ name: m.code.split(".")[1] })) }] },
  });
  let mod;
  try { mod = (JSON.parse(r.body).MdmsRes || {})["RAINMAKER-PGR"] || {}; }
  catch { die("verification search failed (HTTP " + r.code + "): " + r.body.slice(0, 200)); }
  let allOk = true;
  for (const m of MASTERS) {
    const name = m.code.split(".")[1];
    const n = Array.isArray(mod[name]) ? mod[name].length : 0;
    console.log("  " + (n > 0 ? "✓" : "✗") + " " + m.code + ": " + n + " row(s) @ " + STATE);
    if (n === 0) allOk = false;
  }
  return allOk;
}


/* ══════════════════ CMS multi-tier workflow (CMS=1) ══════════════════
 * Back-fills envs bootstrapped before the CMS defaults existed in the
 * default-data-handler image. Reads the SAME DDH resource files a fresh
 * setup uses — no data is duplicated here. All phases idempotent.       */

// Workflow _create/_update stamps auditDetails from RequestInfo.userInfo.
const cmsRI = () => Object.assign({}, RI, {
  userInfo: { id: 1, uuid: "cms-migration", userName: OAUTH_USER, type: "EMPLOYEE", tenantId: STATE, roles: [{ code: "SUPERUSER", name: "Super User", tenantId: STATE }] },
});

async function cmsSearchAll(schemaCode) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const r = await req("POST", "/mdms-v2/v2/_search", { MdmsCriteria: { tenantId: STATE, schemaCode, limit: 100, offset }, RequestInfo: cmsRI() });
    let rows = [];
    try { rows = JSON.parse(r.body).mdms || []; } catch { }
    out.push(...rows);
    if (rows.length < 100) return out;
  }
}

// create-one; DUPLICATE_RECORD counts as "already present" (v2 search pages have
// no stable order, so the pre-scan can miss rows — the server check is the truth).
async function cmsCreate(schemaCode, uniqueIdentifier, data) {
  const r = await req("POST", "/mdms-v2/v2/_create/" + schemaCode, {
    Mdms: { tenantId: STATE, schemaCode, uniqueIdentifier, data, isActive: true },
    RequestInfo: cmsRI(),
  });
  if (r.code >= 200 && r.code < 300) return "created";
  if (/DUPLICATE_RECORD|already|exist/i.test(r.body)) return "present";
  die(schemaCode + " create failed for " + uniqueIdentifier + ": " + (r.body || "").slice(0, 220));
}

async function cmsSeedRoles() {
  const want = JSON.parse(fs.readFileSync(CMS_FILES.roles, "utf8")).filter((x) => CMS_ROLES.includes(x.code));
  if (want.length !== CMS_ROLES.length) die("DDH roles file is missing CMS roles — expected 5, found " + want.length);
  const have = new Set((await cmsSearchAll("ACCESSCONTROL-ROLES.roles")).map((m) => m.data && m.data.code));
  for (const row of want) {
    const st = have.has(row.code) ? "present" : await cmsCreate("ACCESSCONTROL-ROLES.roles", row.code, row);
    console.log("  " + (st === "created" ? "✓ role " + row.code + " created" : "• role " + row.code + " already present"));
  }
}

// roleactions x-ref-validate actionid against the actions-test catalog; older envs
// miss recently-added catalog entries — create those first.
async function cmsSeedActions() {
  const grants = JSON.parse(fs.readFileSync(CMS_FILES.roleactions, "utf8")).filter((x) => CMS_ROLES.includes(x.rolecode));
  const needed = [...new Set(grants.map((g) => g.actionid))];
  const catalog = {};
  for (const a of JSON.parse(fs.readFileSync(CMS_FILES.actions, "utf8"))) catalog[a.id] = a;
  const have = new Set((await cmsSearchAll("ACCESSCONTROL-ACTIONS-TEST.actions-test")).map((m) => m.data && Number(m.data.id)));
  let created = 0;
  for (const id of needed) {
    if (have.has(id)) continue;
    const row = catalog[id];
    if (!row) die("actionid " + id + " referenced by CMS grants but absent from the actions-test catalog file");
    if (await cmsCreate("ACCESSCONTROL-ACTIONS-TEST.actions-test", String(id), Object.assign({}, row, { tenantId: STATE })) === "created") {
      console.log("  ✓ action " + id + " (" + (row.displayName || row.name) + ") created");
      created++;
    }
  }
  if (!created) console.log("  • all " + needed.length + " referenced actions already present");
}

async function cmsSeedRoleactions() {
  const want = JSON.parse(fs.readFileSync(CMS_FILES.roleactions, "utf8")).filter((x) => CMS_ROLES.includes(x.rolecode));
  const have = new Set((await cmsSearchAll("ACCESSCONTROL-ROLEACTIONS.roleactions"))
    .map((m) => m.uniqueIdentifier || (m.data && m.data.rolecode + "." + m.data.actionid)));
  let created = 0, present = 0;
  for (const row of want) {
    const key = row.rolecode + "." + row.actionid;
    if (have.has(key)) { present++; continue; }
    const st = await cmsCreate("ACCESSCONTROL-ROLEACTIONS.roleactions", key, Object.assign({}, row, { tenantId: STATE }));
    if (st === "created") created++; else present++;
  }
  console.log("  roleactions: " + created + " created, " + present + " already present (of " + want.length + ")");
}

// canonical view of a BusinessService: state -> {flags, actions{name -> {next, roles}}}
function cmsCanon(bs, nameByUuid) {
  const out = {};
  for (const s of bs.states) {
    const actions = {};
    for (const a of s.actions || []) {
      const next = nameByUuid ? (nameByUuid[a.nextState] || a.nextState) : a.nextState;
      actions[a.action] = { next, roles: (a.roles || []).slice().sort() };
    }
    out[s.state || "<START>"] = { appStatus: s.applicationStatus || null, doc: !!s.docUploadRequired, term: !!s.isTerminateState, sla: s.sla == null ? null : s.sla, actions };
  }
  return out;
}
function cmsDiff(wantC, liveC) {
  const diffs = [];
  for (const st of new Set([...Object.keys(wantC), ...Object.keys(liveC)])) {
    if (!liveC[st]) { diffs.push("state " + st + " missing in live"); continue; }
    if (!wantC[st]) { diffs.push("state " + st + " extra in live"); continue; }
    const w = wantC[st], l = liveC[st];
    for (const f of ["appStatus", "doc", "term", "sla"])
      if (JSON.stringify(w[f]) !== JSON.stringify(l[f])) diffs.push(st + "." + f + ": want " + JSON.stringify(w[f]) + " live " + JSON.stringify(l[f]));
    for (const act of new Set([...Object.keys(w.actions), ...Object.keys(l.actions)])) {
      const wa = w.actions[act], la = l.actions[act];
      if (!la) { diffs.push(st + "." + act + " missing in live"); continue; }
      if (!wa) { diffs.push(st + "." + act + " extra in live"); continue; }
      if (wa.next !== la.next) diffs.push(st + "." + act + ".nextState: want " + wa.next + " live " + la.next);
      if (JSON.stringify(wa.roles) !== JSON.stringify(la.roles)) diffs.push(st + "." + act + ".roles: want " + wa.roles + " live " + la.roles);
    }
  }
  return diffs;
}

async function cmsSeedWorkflow() {
  const want = JSON.parse(fs.readFileSync(CMS_FILES.workflow, "utf8").split("{tenantid}").join(CMS_TENANT)).BusinessServices[0];
  const r = await req("POST", "/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=" + CMS_TENANT + "&businessServices=PGR", { RequestInfo: cmsRI() });
  let live = null;
  try { live = (JSON.parse(r.body).BusinessServices || [])[0] || null; } catch { }

  if (!live) {
    const c = await req("POST", "/egov-workflow-v2/egov-wf/businessservice/_create", { RequestInfo: cmsRI(), BusinessServices: [want] });
    if (c.code < 200 || c.code >= 300) die("workflow create failed: " + (c.body || "").slice(0, 300));
    console.log("  ✓ CMS PGR workflow CREATED at " + CMS_TENANT + " (" + want.states.length + " states)");
    return "created";
  }

  const nameByUuid = {}; for (const s of live.states) nameByUuid[s.uuid] = s.state || "<START>";
  const diffs = cmsDiff(cmsCanon(want), cmsCanon(live, nameByUuid));
  if (!diffs.length) { console.log("  • workflow already present and matches (" + live.states.length + " states)"); return "present"; }

  console.log("  ! workflow present but DIFFERS:");
  diffs.forEach((d) => console.log("      - " + d));
  if (!UPDATE_WF) { console.log("  → re-run with UPDATE_WF=1 to apply role/nextState/flag changes in place."); return "differs"; }
  if (diffs.some((d) => d.includes("missing in live") || d.includes("extra in live")))
    die("UPDATE_WF can only patch existing states/actions (roles, nextState, flags). State/action add/remove needs a manual _update.");

  const uuidByName = {}; for (const s of live.states) uuidByName[s.state || "<START>"] = s.uuid;
  const wantC = cmsCanon(want);
  for (const s of live.states) {
    const w = wantC[s.state || "<START>"];
    s.applicationStatus = w.appStatus; s.docUploadRequired = w.doc; s.isTerminateState = w.term; s.sla = w.sla;
    for (const a of s.actions || []) { const wa = w.actions[a.action]; a.roles = wa.roles; a.nextState = uuidByName[wa.next] || a.nextState; }
  }
  const u = await req("POST", "/egov-workflow-v2/egov-wf/businessservice/_update", { RequestInfo: cmsRI(), BusinessServices: [live] });
  if (u.code < 200 || u.code >= 300) die("workflow update failed: " + (u.body || "").slice(0, 300));
  console.log("  ✓ workflow UPDATED in place (" + diffs.length + " differences applied)");
  return "updated";
}

async function cmsRun() {
  console.log("[CMS 1/4] Roles @ " + STATE + " …");
  await cmsSeedRoles();
  console.log("\n[CMS 2/4] Actions catalog (referenced by CMS grants) @ " + STATE + " …");
  await cmsSeedActions();
  console.log("\n[CMS 3/4] Role→action mappings @ " + STATE + " …");
  await cmsSeedRoleactions();
  console.log("\n[CMS 4/4] CMS PGR workflow @ " + CMS_TENANT + " …");
  const wf = await cmsSeedWorkflow();
  const roles = new Set((await cmsSearchAll("ACCESSCONTROL-ROLES.roles")).map((m) => m.data && m.data.code));
  const missing = CMS_ROLES.filter((c) => !roles.has(c));
  if (missing.length) die("CMS verify failed — roles still missing: " + missing);
  console.log("\n  ✓ all 5 CMS roles present @ " + STATE);
  if (wf === "created" || wf === "updated")
    console.log("  ⚠ RESTART egov-workflow-v2 now (it caches BusinessServices): docker restart digit-egov-workflow-v2-1");
  console.log("  Employees: assign the CMS_* roles to real staff via HRMS/configurator (not created here).");
}

(async () => {
  console.log("PGR dynamic-fields masters → state tenant '" + STATE + "' @ " + BASE + "\n");

  console.log("[1/4] Preflight — logging in…");
  if (!TOKEN) {
    TOKEN = await login();
    if (!TOKEN) die("login failed for tenant '" + STATE + "'. Check the gateway is reachable (BASE_URL), and the creds (local: ADMIN/eGov@123; prod: set OAUTH_USER/OAUTH_PASS or TOKEN).");
  }
  RI = { apiId: "seed-pgr-masters", ver: "1.0", action: "_create", authToken: TOKEN };
  console.log("  ✓ authenticated\n");

  if (RESEED) {
    console.log("[reseed] Removing old-shape schema defs + data first…");
    reseedCleanup();
    console.log();
  }

  console.log("[2/4] Registering schemas…");
  await registerSchemas(loadSchemaDefs());
  await sleep(4000); // let the async schema-create persist before seeding
  console.log();

  console.log("[3/4] Seeding data (idempotent; auto-handles the x-ref quirk)…");
  for (const m of MASTERS) await seedMaster(m);
  console.log();

  console.log("[4/4] Verifying…");
  const ok = await verify();
  console.log();

  if (!ok) die("Some masters have 0 rows — see ✗ above.");

  if (CMS) {
    console.log("── CMS multi-tier workflow (CMS=1) ──\n");
    await cmsRun();
    console.log();
  }

  console.log("✅ DONE — all masters present at '" + STATE + "'. Sub-tenants inherit them via state-fallback."
    + (CMS ? " CMS roles/grants @ '" + STATE + "', workflow @ '" + CMS_TENANT + "'." : ""));
  console.log("   Final check in the UI: <host>/digit-ui/citizen → File a Complaint (hard-refresh).");
  process.exit(0);
})();
