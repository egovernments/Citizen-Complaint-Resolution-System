// Unit tests for evaluateCompose (#29 review fix): dailyAvgFromWeekly / hourlyAvgFromDaily
// must never recompute an "elapsed periods since asOf" average with browser-local Date math —
// the backend's D1a composition is now the sole authority for those two types, so this engine
// must return null and let KpiTile's resolveScalar fall through to the backend's result.value.
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/utils/composeKpi.test.js
//
// composeKpi.js is ESM (like the rest of products/), so the test bundles it to CJS with the
// repo's own esbuild — same idiom as dashboardTimeZone.test.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "composeKpi.js");
const OUT = path.join(os.tmpdir(), `composeKpi.cjs.${process.pid}.js`);

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

const { evaluateCompose, requiresBackendComposition } = require(OUT);

test("evaluateCompose: no compose or no type returns null", () => {
  assert.equal(evaluateCompose(null, {}), null);
  assert.equal(evaluateCompose({}, {}), null);
});

test("evaluateCompose: sources not yet loaded returns null", () => {
  const compose = { type: "netBacklogDaily", sourceKpiIds: ["inflow", "outflow"] };
  assert.equal(evaluateCompose(compose, {}), null);
});

test("evaluateCompose: dailyAvgFromWeekly ALWAYS returns null, even with elapsedFromAsOf/asOf/rows present", () => {
  const compose = { type: "dailyAvgFromWeekly", sourceKpiIds: ["weeklyTotal"], elapsedFromAsOf: true };
  const results = {
    weeklyTotal: { rows: [{ total: 140 }], asOf: Date.UTC(2026, 2, 4, 12, 0, 0) },
  };
  assert.equal(evaluateCompose(compose, results), null);
});

test("evaluateCompose: hourlyAvgFromDaily ALWAYS returns null, even with elapsedFromAsOf/asOf/rows present", () => {
  const compose = { type: "hourlyAvgFromDaily", sourceKpiIds: ["dailyTotal"], elapsedFromAsOf: true };
  const results = {
    dailyTotal: { rows: [{ total: 48 }], asOf: Date.UTC(2026, 2, 4, 12, 0, 0) },
  };
  assert.equal(evaluateCompose(compose, results), null);
});

test("evaluateCompose: dailyAvgFromWeekly/hourlyAvgFromDaily return null even without elapsedFromAsOf", () => {
  const daily = { type: "dailyAvgFromWeekly", sourceKpiIds: ["weeklyTotal"] };
  const hourly = { type: "hourlyAvgFromDaily", sourceKpiIds: ["dailyTotal"] };
  const results = {
    weeklyTotal: { rows: [{ total: 140 }] },
    dailyTotal: { rows: [{ total: 48 }] },
  };
  assert.equal(evaluateCompose(daily, results), null);
  assert.equal(evaluateCompose(hourly, results), null);
});

test("evaluateCompose: other compose types are preserved (openRateComplement)", () => {
  const compose = { type: "openRateComplement", sourceKpiIds: ["openRate"] };
  const results = { openRate: { rows: [{ pct: 0.3 }] } };
  assert.equal(evaluateCompose(compose, results), 70);
});

test("evaluateCompose: other compose types are preserved (netBacklogDaily)", () => {
  const compose = { type: "netBacklogDaily", sourceKpiIds: ["inflow", "outflow"] };
  const results = {
    inflow: { rows: [{ total: 12 }] },
    outflow: { rows: [{ total: 5 }] },
  };
  assert.equal(evaluateCompose(compose, results), 7);
});

test("evaluateCompose: unknown compose type returns null", () => {
  const compose = { type: "somethingUnrecognized", sourceKpiIds: ["x"] };
  assert.equal(evaluateCompose(compose, { x: { rows: [{ total: 1 }] } }), null);
});

test("requiresBackendComposition identifies only calendar-aware average rules", () => {
  assert.equal(requiresBackendComposition({ type: "dailyAvgFromWeekly" }), true);
  assert.equal(requiresBackendComposition({ type: "hourlyAvgFromDaily" }), true);
  assert.equal(requiresBackendComposition({ type: "netBacklogDaily" }), false);
  assert.equal(requiresBackendComposition(null), false);
});
