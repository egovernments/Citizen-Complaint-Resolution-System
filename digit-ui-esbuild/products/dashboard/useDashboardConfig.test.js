// Unit tests for selectDashboardConfigRecord — the deterministic dss.DashboardConfig
// record selection shared (by rule, not code) with KpiCatalogService.selectDashboardConfigRecord
// (Java) and the pgr_dashboard_tenant_timezone SQL view's ORDER BY.
// Run from digit-ui-esbuild/:  node --test products/dashboard/useDashboardConfig.test.js
//
// useDashboardConfig.js is ESM (like the rest of products/), so the test bundles it to
// CJS with the repo's own esbuild — same idiom as dashboardTimeZone.test.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "useDashboardConfig.js");
const OUT = path.join(os.tmpdir(), `useDashboardConfig.cjs.${process.pid}.js`);

esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
});
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch (e) {
    /* already gone */
  }
});

const { selectDashboardConfigRecord } = require(OUT);

test("selectDashboardConfigRecord: empty list returns null", () => {
  assert.equal(selectDashboardConfigRecord([]), null);
  assert.equal(selectDashboardConfigRecord(undefined), null);
});

test("selectDashboardConfigRecord: single record is returned unchanged", () => {
  const only = { id: "zz", timeZone: "Asia/Kolkata" };
  assert.equal(selectDashboardConfigRecord([only]), only);
});

test("selectDashboardConfigRecord: id 'default' wins regardless of position", () => {
  const aaa = { id: "aaa", timeZone: "Africa/Maputo" };
  const def = { id: "default", timeZone: "Asia/Kolkata" };
  const zzz = { id: "zzz", timeZone: "UTC" };
  assert.equal(selectDashboardConfigRecord([aaa, def, zzz]), def);
  assert.equal(selectDashboardConfigRecord([def, aaa, zzz]), def);
});

test("selectDashboardConfigRecord: no default -> preserves first API record", () => {
  const zzz = { id: "zzz", timeZone: "UTC" };
  const aaa = { id: "aaa", timeZone: "Africa/Maputo" };
  const bbb = { id: "bbb", timeZone: "Asia/Kolkata" };
  assert.equal(selectDashboardConfigRecord([zzz, aaa, bbb]), zzz);
});

test("selectDashboardConfigRecord: first API record wins even when its id is blank", () => {
  const blank = { id: "   ", timeZone: "Africa/Maputo" };
  const missing = { timeZone: "UTC" };
  const real = { id: "abc", timeZone: "Asia/Kolkata" };
  assert.equal(selectDashboardConfigRecord([blank, missing, real]), blank);
});

test("selectDashboardConfigRecord: no usable id anywhere -> first occurrence (stable)", () => {
  const first = { timeZone: "Africa/Maputo" };
  const second = { id: "   ", timeZone: "UTC" };
  assert.equal(selectDashboardConfigRecord([first, second]), first);
});
