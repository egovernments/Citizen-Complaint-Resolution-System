// The map's relationship tree follows the tenant's own hierarchy (#2260).
// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/services/boundaryHierarchy.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const OUT = path.join(os.tmpdir(), `boundaryHierarchy.cjs.${process.pid}.js`);
esbuild.buildSync({
  stdin: {
    contents: `
      export { configurePublicDashboardRuntime } from './dashboardRuntime.js';
      export { fetchBoundaryRelationshipsByCodes } from './boundaryService.js';
    `,
    resolveDir: __dirname,
    sourcefile: "boundary-hierarchy-test-entry.js",
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

const store = { getItem: () => null, setItem() {}, removeItem() {} };

async function relationshipHierarchy({ tenantId, schemaRows, configuredType }) {
  global.window = {
    globalConfigs: { getConfig: (key) => ({ STATE_LEVEL_TENANT_ID: tenantId, HIERARCHY_TYPE: configuredType })[key] },
    localStorage: store,
    sessionStorage: store,
    dispatchEvent() {},
  };
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    const payload = String(url).includes("_search?")
      ? { TenantBoundary: [] }
      : { MdmsRes: schemaRows ? { "CMS-BOUNDARY": { HierarchySchema: schemaRows } } : {} };
    return { ok: true, status: 200, json: async () => payload };
  };
  delete require.cache[require.resolve(OUT)];
  const mod = require(OUT);
  mod.configurePublicDashboardRuntime();
  await mod.fetchBoundaryRelationshipsByCodes(["ROOT_WARD_1"]);
  const relationships = urls.find((url) => String(url).includes("boundary-relationships"));
  return new URL(relationships, "http://x").searchParams.get("hierarchyType");
}

test("relationships use the tenant's HierarchySchema hierarchy", async () => {
  const type = await relationshipHierarchy({
    tenantId: "newtown",
    schemaRows: [{ moduleName: "CMS", department: "All", hierarchy: "NEWTOWN", highestHierarchy: "District", lowestHierarchy: "Ward" }],
    configuredType: "ADMIN",
  });
  assert.equal(type, "NEWTOWN");
});

test("a tenant without a HierarchySchema row keeps the deployment's HIERARCHY_TYPE", async () => {
  assert.equal(await relationshipHierarchy({ tenantId: "ke", schemaRows: null, configuredType: "REVENUE" }), "REVENUE");
  assert.equal(await relationshipHierarchy({ tenantId: "ke", schemaRows: [], configuredType: undefined }), "ADMIN");
});
