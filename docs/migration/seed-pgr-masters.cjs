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

const SCHEMA_FILE = path.join(
  __dirname, "..", "..",
  "utilities", "default-data-handler", "src", "main", "resources", "schema", "RAINMAKER-PGR.json"
);
const MASTERS = [
  { code: "RAINMAKER-PGR.ComplaintRelatedToMap", file: path.join(__dirname, "seed", "ComplaintRelatedToMap.json"), uid: "templateType" },
  { code: "RAINMAKER-PGR.ComplaintTemplateType", file: path.join(__dirname, "seed", "ComplaintTemplateType.json"), uid: "templateType" },
];

function die(msg) { console.error("\n✗ " + msg + "\n"); process.exit(1); }
if (!BASE || !TENANT) {
  die("Set BASE_URL and TENANT.\n    e.g. BASE_URL=http://localhost:18000 TENANT=mz node docs/migration/seed-pgr-masters.cjs");
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

(async () => {
  console.log("PGR dynamic-fields masters → state tenant '" + STATE + "' @ " + BASE + "\n");

  console.log("[1/4] Preflight — logging in…");
  if (!TOKEN) {
    TOKEN = await login();
    if (!TOKEN) die("login failed for tenant '" + STATE + "'. Check the gateway is reachable (BASE_URL), and the creds (local: ADMIN/eGov@123; prod: set OAUTH_USER/OAUTH_PASS or TOKEN).");
  }
  RI = { apiId: "seed-pgr-masters", ver: "1.0", action: "_create", authToken: TOKEN };
  console.log("  ✓ authenticated\n");

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

  if (ok) {
    console.log("✅ DONE — both masters present at '" + STATE + "'. Sub-tenants inherit them via state-fallback.");
    console.log("   Final check in the UI: <host>/digit-ui/citizen → File a Complaint (hard-refresh).");
    process.exit(0);
  }
  die("Some masters have 0 rows — see ✗ above.");
})();
