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
const LOCALE = path.join(__dirname, "../packages/libraries/src/utils/locale.js");

function load(entry = ENTRY) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tenant-label-")), "mod.cjs");
  esbuild.buildSync({ entryPoints: [entry], bundle: true, format: "cjs", platform: "node", outfile: out, logLevel: "silent" });
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

test("the tenant key prefix turns every dot into _ (#1194)", () => {
  const { tenantKeyPrefix } = load();
  assert.equal(tenantKeyPrefix("ke"), "KE");
  assert.equal(tenantKeyPrefix("ke.bomet"), "KE_BOMET");
  assert.equal(tenantKeyPrefix("ke.bomet.health"), "KE_BOMET_HEALTH");
});

test("locality keys of a depth-3 tenant use the every-dot prefix; one- and two-level keys are unchanged", () => {
  const { getLocalityCode, getRevenueLocalityCode } = load(LOCALE);
  assert.equal(getLocalityCode("W1", "ke.bomet.health"), "KE_BOMET_HEALTH_ADMIN_W1");
  assert.equal(getRevenueLocalityCode({ code: "R1" }, "ke.bomet.health"), "KE_BOMET_HEALTH_REVENUE_R1");
  assert.equal(getLocalityCode("W1", "ke.bomet"), "KE_BOMET_ADMIN_W1");
  assert.equal(getLocalityCode("KE_BOMET_ADMIN_W1", "ke.bomet.health"), "KE_BOMET_ADMIN_W1", "an already-qualified code is kept");
});
