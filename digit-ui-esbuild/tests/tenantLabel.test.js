// Pins the tenant display-name localization key: every dot of the tenant code becomes _ (#941: a tenant below the
// city level, ke.bomet.health.water, showed its raw key because replace(".", "_") changed only the first dot).
// Run from digit-ui-esbuild/:  node --test tests/tenantLabel.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../packages/libraries/src/utils/tenantLabel.js");

function load() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tenant-label-")), "tenantLabel.cjs");
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "node", outfile: out, logLevel: "silent" });
  return require(out);
}

test("a root, a city and a depth-4 node: every dot becomes _", () => {
  const { tenantLabelKey } = load();
  assert.equal(tenantLabelKey("ke"), "TENANT_TENANTS_KE");
  assert.equal(tenantLabelKey("ke.bomet"), "TENANT_TENANTS_KE_BOMET");
  assert.equal(tenantLabelKey("ke.bomet.health.water"), "TENANT_TENANTS_KE_BOMET_HEALTH_WATER");
});

test("a missing code gives the bare prefix, never 'UNDEFINED'", () => {
  const { tenantLabelKey } = load();
  assert.equal(tenantLabelKey(undefined), "TENANT_TENANTS_");
});
