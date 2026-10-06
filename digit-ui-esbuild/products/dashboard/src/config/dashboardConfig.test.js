// Tenant resolution for the dashboard (#2072).
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/config/dashboardConfig.test.js
//
// Bundled to CJS with the repo's own esbuild — same idiom as
// services/dashboardMetrics.test.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "dashboardConfig.js");
const OUT = path.join(os.tmpdir(), `dashboardConfig.cjs.${process.pid}.js`);

esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.REACT_APP_STATE_LEVEL_TENANT_ID": '""',
  },
});
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch (e) {
    /* already gone */
  }
});

const { getTenantId, getLayoutStorageKey } = require(OUT);

const configured = { getConfig: (key) => (key === "STATE_LEVEL_TENANT_ID" ? "ke" : undefined) };

test("getTenantId uses the route tenant on a tenant route", () => {
  global.window = {
    globalConfigs: configured,
    __digitTenantContext: { tenantId: "bometcounty", rootTenantId: "bometcounty" },
  };
  assert.equal(getTenantId(), "bometcounty");
  assert.match(getLayoutStorageKey(), /^bometcounty-/);
});

test("getTenantId keeps the configured state tenant without a route tenant", () => {
  global.window = { globalConfigs: configured };
  assert.equal(getTenantId(), "ke");
  global.window = {};
  assert.equal(getTenantId(), "default");
});

const storageWith = (info) => ({
  getItem: (key) => (key === "Employee.user-info" && info ? JSON.stringify(info) : null),
});
const ROOT_ROUTE = { tenantId: "ke", rootTenantId: "ke" };

test("getTenantId scopes an employee at a child of the route tenant to the token's tenant (D16 amended)", () => {
  global.window = {
    globalConfigs: configured,
    __digitTenantContext: ROOT_ROUTE,
    localStorage: storageWith({ uuid: "sup", type: "EMPLOYEE", tenantId: "ke.nairobi" }),
  };
  assert.equal(getTenantId(), "ke.nairobi");
  assert.match(getLayoutStorageKey(), /^ke\.nairobi-/);
});

test("getTenantId keeps the route tenant for same-tenant, citizen, outside or absent sessions", () => {
  for (const info of [
    { type: "EMPLOYEE", tenantId: "ke" },
    { type: "CITIZEN", tenantId: "ke" },
    { type: "EMPLOYEE", tenantId: "kex.nairobi" },
    null,
  ]) {
    global.window = { globalConfigs: configured, __digitTenantContext: ROOT_ROUTE, localStorage: storageWith(info) };
    assert.equal(getTenantId(), "ke");
  }
});
