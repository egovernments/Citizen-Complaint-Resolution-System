// No boundary-relationships read at a tenant without a hierarchy (a state whose boundaries live at its child tenants answered 400
// HIERARCHY_DEFINITION_DOES_NOT_EXIST to the state admin's File a Complaint and inbox).
// Run from digit-ui-esbuild/:  node --test tests/boundaryGuard.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../packages/libraries/src/services/atoms/Utils/boundaryGuard.js");

function load() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bnd-guard-")), "mod.cjs");
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "node", outfile: out, logLevel: "silent" });
  return require(out);
}

const definitions = (byTenant, calls) => async (criteria) => {
  calls.push(criteria);
  if (byTenant === "fail") throw new Error("503");
  return { totalCount: byTenant[criteria.tenantId] || 0, BoundaryHierarchy: [] };
};

test("the state (no definition) is answered with an empty tree; a county is sent", async () => {
  const g = load();
  const calls = [];
  const search = definitions({ "ke.bomet": 1 }, calls);
  const url = "/boundary-service/boundary-relationships/_search";
  assert.equal(await g.hierarchyMissing(url, { tenantId: "ke", hierarchyType: "ADMIN", includeChildren: true }, search), true);
  assert.equal(await g.hierarchyMissing(url, { tenantId: "ke.bomet", hierarchyType: "ADMIN" }, search), false);
  assert.deepEqual(calls[0], { tenantId: "ke", hierarchyType: "ADMIN", limit: 1, offset: 0 });
  assert.deepEqual(g.emptyTenantBoundary().TenantBoundary, []);
});

test("the tenant can come from the URL's own query string (pgr utils/urls.js)", async () => {
  const g = load();
  const calls = [];
  const url = "boundary-service/boundary-relationships/_search?tenantId=ke&hierarchyType=ADMIN&boundaryType=Ward";
  assert.equal(await g.hierarchyMissing(url, {}, definitions({}, calls)), true);
  assert.equal(calls[0].tenantId, "ke");
});

test("only a positive answer is cached; unknown and other URLs are sent as before", async () => {
  const g = load();
  g._resetBoundaryGuard();
  const calls = [];
  const have = { "ke.bomet": 1 };
  const url = "/boundary-service/boundary-relationships/_search";
  await g.hierarchyMissing(url, { tenantId: "ke.bomet" }, definitions(have, calls));
  await g.hierarchyMissing(url, { tenantId: "ke.bomet" }, definitions(have, calls));
  assert.equal(calls.length, 1, "a known hierarchy is not asked twice");
  const later = {};
  assert.equal(await g.hierarchyMissing(url, { tenantId: "ke.kilima" }, definitions(later, calls)), true);
  later["ke.kilima"] = 1;   // the hierarchy is created during onboarding
  assert.equal(await g.hierarchyMissing(url, { tenantId: "ke.kilima" }, definitions(later, calls)), false, "a 'none' is never cached");
  assert.equal(await g.hierarchyMissing(url, { tenantId: "ke" }, definitions("fail", calls)), false, "unknown: sent");
  assert.equal(await g.hierarchyMissing("/boundary-service/boundary/_search", { tenantId: "ke" }, definitions({}, calls)), false);
  assert.equal(await g.hierarchyMissing(url, {}, definitions({}, calls)), false, "no tenant: sent");
});

test("Request asks the guard before every send", () => {
  const src = fs.readFileSync(path.join(__dirname, "../packages/libraries/src/services/atoms/Utils/Request.js"), "utf8");
  assert.match(src, /import \{ hierarchyMissing, emptyTenantBoundary \} from "\.\/boundaryGuard"/);
  assert.ok(src.indexOf("hierarchyMissing(url, params") < src.indexOf("await Axios({ method, url: _url, data, params, headers, paramsSerializer"));
});
