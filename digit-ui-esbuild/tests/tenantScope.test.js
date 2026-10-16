// the counties a user can enter from a state - the union trees at /<state> and the File a Complaint
// county picker list only these (coordinator 2026-10-15: never a county the user cannot open).
// Run from digit-ui-esbuild/:  node --test tests/tenantScope.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

function load() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tenant-scope-")), "mod.cjs");
  esbuild.buildSync({ entryPoints: [path.join(__dirname, "../packages/libraries/src/utils/tenantScope.js")], bundle: true, format: "cjs",
    platform: "node", outfile: out, logLevel: "silent" });
  return require(out);
}
const TENANTS = ["ke", "ke.nairobi", "ke.bomet", "ke.bomet.health", "pg", "pg.citya"].map((code) => ({ code }));

test("a state-level role opens every county of the state, and only the direct children", () => {
  const s = load();
  assert.deepEqual(s.enterableChildTenants("ke", TENANTS, [{ code: "SUPERUSER", tenantId: "ke" }]).map((t) => t.code), ["ke.bomet", "ke.nairobi"]);
});

test("a county role opens that county only; a sibling or another root never", () => {
  const s = load();
  assert.deepEqual(s.enterableChildTenants("ke", TENANTS, [{ code: "GRO", tenantId: "ke.bomet" }]).map((t) => t.code), ["ke.bomet"]);
  assert.deepEqual(s.enterableChildTenants("ke", TENANTS, [{ code: "GRO", tenantId: "pg" }, { code: "GRO", tenantId: "ke.bomet.health" }]), []);
  assert.deepEqual(s.enterableChildTenants("ke", TENANTS, []), []);
  assert.equal(s.canEnter("KE.Bomet", [{ tenantId: "ke" }]), true, "case-insensitive");
});

test("the picker's route slug: the tenant's own urlSlug, else code lower-cased with . -> -", () => {
  const s = load();
  assert.equal(s.tenantSlug({ code: "ke.bomet" }), "ke-bomet");
  assert.equal(s.tenantSlug({ code: "ke.bomet", urlSlug: "bomet" }), "bomet");
});
