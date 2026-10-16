// ours (#1754): where the employee dashboard reads boundaries. A state in the county layout has no boundary
// hierarchy of its own (boundary-relationships at it answered 400 HIERARCHY_DEFINITION_DOES_NOT_EXIST): it reads its
// counties'. A county, or a state in the legacy flat layout, reads itself as before.
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/services/boundaryTenants.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const OUT = path.join(os.tmpdir(), `boundaryTenants.cjs.${process.pid}.js`);
esbuild.buildSync({
  stdin: {
    contents: `
      export { configurePublicDashboardRuntime } from './dashboardRuntime.js';
      export { fetchBoundaryRelationshipsByCodes, fetchBoundariesByCodes, resolveBoundaryTenants } from './boundaryService.js';
    `,
    resolveDir: __dirname,
    sourcefile: "boundary-tenants-test-entry.js",
    loader: "js",
  },
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
  define: { "process.env.NODE_ENV": '"production"', "process.env.REACT_APP_STATE_LEVEL_TENANT_ID": '""' },
});
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch (e) {
    /* already gone */
  }
});

/** A signed-in employee at `tenantId` against a stack where `definitions` tenants have a hierarchy. */
function stack({ tenantId, definitions, tenants = ["ke", "ke.bomet", "ke.nairobi"] }) {
  const store = { getItem: () => JSON.stringify("employee-token"), setItem() {}, removeItem() {} };
  global.window = {
    globalConfigs: { getConfig: (key) => ({ STATE_LEVEL_TENANT_ID: tenantId, HIERARCHY_TYPE: "ADMIN" })[key] },
    localStorage: store,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    dispatchEvent() {},
  };
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const u = new URL(String(url), "http://x");
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ path: u.pathname, params: Object.fromEntries(u.searchParams), body });
    let payload = {};
    if (u.pathname.endsWith("/boundary-hierarchy-definition/_search")) {
      const t = body.BoundaryTypeHierarchySearchCriteria.tenantId;
      payload = { totalCount: definitions.includes(t) ? 1 : 0 };
    } else if (u.pathname.endsWith("/boundary-relationships/_search")) {
      const t = u.searchParams.get("tenantId");
      if (!definitions.includes(t)) return { ok: false, status: 400, json: async () => ({}) };
      const root = t.split(".").pop().toUpperCase();
      payload = { TenantBoundary: [{ tenantId: t, boundary: [{ code: root, boundaryType: "County", children: [{ code: `${root}_W1`, boundaryType: "Ward" }] }] }] };
    } else if (u.pathname.endsWith("/boundary/_search")) {
      const t = u.searchParams.get("tenantId");
      const codes = u.searchParams.get("codes").split(",");
      payload = { Boundary: definitions.includes(t) ? codes.filter((c) => c.startsWith(t.split(".").pop().toUpperCase())).map((code) => ({ code, tenantId: t })) : [] };
    } else {
      payload = { MdmsRes: { tenant: { tenants: tenants.map((code) => ({ code })) } } };
    }
    return { ok: true, status: 200, json: async () => payload };
  };
  delete require.cache[require.resolve(OUT)];
  return { mod: require(OUT), calls };
}

const relationshipCalls = (calls) => calls.filter((c) => c.path.endsWith("/boundary-relationships/_search"));

test("a county-layout state reads its counties' boundaries and never asks boundary-relationships at itself", async () => {
  const { mod, calls } = stack({ tenantId: "ke", definitions: ["ke.bomet", "ke.nairobi"] });
  assert.deepEqual(await mod.resolveBoundaryTenants("ke"), ["ke.bomet", "ke.nairobi"]);
  const index = await mod.fetchBoundaryRelationshipsByCodes(["BOMET_W1", "NAIROBI_W1"]);
  const rel = relationshipCalls(calls);
  assert.deepEqual(rel.map((c) => c.params.tenantId), ["ke.bomet", "ke.nairobi"]);
  assert.ok(rel.every((c) => !("codes" in c.params)), "a county is read whole (the state's ward codes span counties)");
  assert.ok(index.BOMET_W1 && index.NAIROBI_W1, `both counties' wards are indexed: ${Object.keys(index)}`);
  const boundaries = await mod.fetchBoundariesByCodes(["BOMET_W1", "NAIROBI_W1"]);
  assert.deepEqual(boundaries.map((b) => b.code).sort(), ["BOMET_W1", "NAIROBI_W1"]);
  assert.ok(!calls.some((c) => c.path.includes("/boundary") && c.params.tenantId === "ke"), "no boundary read at the state");
});

test("a county reads itself, by its root code, as before", async () => {
  const { mod, calls } = stack({ tenantId: "ke.bomet", definitions: ["ke.bomet", "ke.nairobi"] });
  assert.deepEqual(await mod.resolveBoundaryTenants("ke.bomet"), ["ke.bomet"]);
  await mod.fetchBoundaryRelationshipsByCodes(["BOMET_W1"]);
  assert.deepEqual(relationshipCalls(calls).map((c) => [c.params.tenantId, c.params.codes]), [["ke.bomet", "BOMET"]]);
});

test("a state in the legacy flat layout (its own hierarchy) reads itself, as before", async () => {
  const { mod, calls } = stack({ tenantId: "ke", definitions: ["ke"], tenants: ["ke"] });
  await mod.fetchBoundaryRelationshipsByCodes(["KE_W1"]);
  assert.deepEqual(relationshipCalls(calls).map((c) => [c.params.tenantId, c.params.codes]), [["ke", "KE"]]);
});

test("no county holds boundaries: falls back to the tenant itself", async () => {
  const { mod } = stack({ tenantId: "ke", definitions: [] });
  assert.deepEqual(await mod.resolveBoundaryTenants("ke"), ["ke"]);
});
