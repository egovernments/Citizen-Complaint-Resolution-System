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
