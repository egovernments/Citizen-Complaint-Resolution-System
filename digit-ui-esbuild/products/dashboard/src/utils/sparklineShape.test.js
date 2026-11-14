const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const esbuild = require("esbuild");

// digit-3 P0 (2026-10-14): a sparkline of no data or all-equal values never reaches ApexCharts (Infinity paths).
const load = () => {
  const out = esbuild.buildSync({ entryPoints: [path.join(__dirname, "sparklineShape.js")], bundle: true, write: false, format: "cjs", platform: "node" });
  const m = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
};

test("no finite points: none", () => {
  const { sparklineShape } = load();
  assert.deepEqual(sparklineShape([]).kind, "none");
  assert.deepEqual(sparklineShape(undefined).kind, "none");
  assert.deepEqual(sparklineShape([null, NaN, Infinity, "x"]).kind, "none");
});

test("all equal (a quiet county: all zeros): flat, not a chart", () => {
  const { sparklineShape } = load();
  assert.deepEqual(sparklineShape([0, 0, 0, 0]), { kind: "flat", value: 0, data: [0, 0, 0, 0] });
  assert.equal(sparklineShape([{ x: 1, y: 5 }, { x: 2, y: 5 }]).kind, "flat");
});

test("varying points: a chart of the finite ones", () => {
  const { sparklineShape } = load();
  assert.deepEqual(sparklineShape([1, null, 3, 2]), { kind: "chart", data: [1, 3, 2] });
  assert.deepEqual(sparklineShape([{ x: 1, y: 2 }, { x: 2, y: 4 }]), { kind: "chart", data: [2, 4] });
});
