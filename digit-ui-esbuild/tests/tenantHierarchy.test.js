// Pins the per-tenant boundary hierarchy (#2260): a tenant's own
// CMS-BOUNDARY.HierarchySchema row wins; without one (legacy tenants) the
// globalConfigs keys apply exactly as before; an MDMS failure degrades.
// Run from digit-ui-esbuild/:  node --test tests/tenantHierarchy.test.js

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/services/tenantHierarchy.js");
const OUT = path.join(os.tmpdir(), `tenantHierarchy.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});

const CONFIG = { HIERARCHY_TYPE: "ADMIN", PGR_BOUNDARY_HIGHEST_LEVEL: "County", PGR_BOUNDARY_LOWEST_LEVEL: "Ward" };
let mdms;
let calls;
let load;
beforeEach(() => {
  calls = [];
  global.window = { globalConfigs: { getConfig: (key) => CONFIG[key] } };
  global.Digit = {
    MDMSService: {
      call: async (tenantId, details) => {
        calls.push({ tenantId, details });
        return mdms(tenantId);
      },
    },
  };
  delete require.cache[require.resolve(OUT)];
  load = require(OUT);
});

const schema = (rows) => ({ MdmsRes: { "CMS-BOUNDARY": { HierarchySchema: rows } } });

test("the tenant's own HierarchySchema row wins over globalConfigs", async () => {
  mdms = () =>
    schema([
      { moduleName: "HRMS", department: "All", hierarchy: "OTHER", highestHierarchy: "X", lowestHierarchy: "Y" },
      { moduleName: "CMS", department: "All", hierarchy: "NEWTOWN", highestHierarchy: "District", lowestHierarchy: "Locality" },
    ]);
  assert.deepEqual(await load.getTenantHierarchy("newtown"), {
    hierarchyType: "NEWTOWN",
    highestLevel: "District",
    lowestLevel: "Locality",
    fromTenant: true,
  });
  await load.getTenantHierarchy("newtown");
  assert.equal(calls.length, 1, "resolved once per tenant");
  assert.equal(calls[0].tenantId, "newtown");
  assert.equal(calls[0].details.moduleDetails[0].moduleName, "CMS-BOUNDARY");
});

test("without a row the legacy globalConfigs hierarchy is unchanged", async () => {
  mdms = () => ({ MdmsRes: {} });
  assert.deepEqual(await load.getTenantHierarchy("ke.bomet"), {
    hierarchyType: "ADMIN",
    highestLevel: "County",
    lowestLevel: "Ward",
    fromTenant: false,
  });
});

test("an MDMS failure degrades to globalConfigs and retries next time", async () => {
  mdms = () => Promise.reject(new Error("MDMS down"));
  assert.equal((await load.getTenantHierarchy("newtown")).hierarchyType, "ADMIN");
  mdms = () => schema([{ moduleName: "CMS", hierarchy: "NEWTOWN", highestHierarchy: "District", lowestHierarchy: "Ward" }]);
  assert.equal((await load.getTenantHierarchy("newtown")).hierarchyType, "NEWTOWN");
});

test("no tenant falls back without calling MDMS", async () => {
  mdms = () => assert.fail("no MDMS call without a tenant");
  assert.equal((await load.getTenantHierarchy(undefined)).hierarchyType, "ADMIN");
});
