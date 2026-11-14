// Pie slice names: small slices are named only in the tooltip (#1977).
// Run from digit-ui-esbuild/: node --test products/dashboard/src/config/pieChartPresentation.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

function bundle(entry) {
  const out = path.join(os.tmpdir(), `${path.basename(entry, ".js")}.cjs.${process.pid}.js`);
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, entry)],
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: out,
    logLevel: "silent",
  });
  process.on("exit", () => {
    try {
      fs.unlinkSync(out);
    } catch (e) {
      /* already gone */
    }
  });
  return require(out);
}

const { normalizePieChartData, PIE_CHART_MIN_SWEEP_FOR_LABEL } = bundle("pieChartPresentation.js");

// The #1977 screenshot: Web at 95%, three channels at 1–2% that stacked their names.
const CHANNELS = [
  { label: "Web", count: 2064 },
  { label: "IVR", count: 40 },
  { label: "Walk-in", count: 40 },
  { label: "Mobile", count: 30 },
];

test("only slices wide enough for a name get one; the rest keep theirs for the tooltip", () => {
  const slices = normalizePieChartData(CHANNELS);
  assert.deepEqual(
    slices.map((s) => [s.label, s.showLabel]),
    [["Web", true], ["IVR", false], ["Walk-in", false], ["Mobile", false]]
  );
  for (const slice of slices) {
    assert.equal(slice.showLabel, slice.sweep >= PIE_CHART_MIN_SWEEP_FOR_LABEL);
    assert.ok(slice.label, "the tooltip reads slice.label");
  }
});

test("a slice named on the ring also shows its percentage", () => {
  const slices = normalizePieChartData([{ label: "Web", count: 60 }, { label: "Mobile", count: 40 }]);
  assert.deepEqual(slices.map((s) => [s.showLabel, s.showValue]), [[true, true], [true, true]]);
});
