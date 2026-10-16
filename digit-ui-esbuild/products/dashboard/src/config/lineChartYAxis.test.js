// ours (#1736): the compound line chart's y-axes, one entry per series with a string seriesName.
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/config/lineChartYAxis.test.js
// Bundled to CJS with the repo's esbuild, as geographyMapPresentation.test.js does.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const OUT = path.join(os.tmpdir(), `lineChartPresentation.cjs.${process.pid}.js`);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "lineChartPresentation.js")],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
  define: { "process.env.NODE_ENV": '"production"' },
});
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch (e) {
    /* already gone */
  }
});
const { buildCompoundLineChartYAxis } = require(OUT);

// the employee dashboard's "Complaints over time" on digit-3 (Bomet, 2026-10-14)
const series = [
  { name: "Created", data: [22, 30, 11, 15, 7] },
  { name: "Resolved", data: [0, 0, 0, 0, 0] },
  { name: "Resolution rate", data: [0, 0, 0, 0, 0], yAxisGroup: "percent" },
  { name: "SLA compliance rate", data: [0, 0, 0, 0, 0], yAxisGroup: "percent" },
];

test("one y-axis per series, each naming ONE series (ApexCharts 3.45 maps by a string seriesName)", () => {
  const axes = buildCompoundLineChartYAxis(series);
  assert.equal(axes.length, series.length);
  for (const axis of axes) assert.equal(typeof axis.seriesName, "string");
});

test("count series share the first count series' scale; only that axis is shown", () => {
  const axes = buildCompoundLineChartYAxis(series);
  assert.deepEqual(axes.slice(0, 2).map((a) => a.seriesName), ["Created", "Created"]);
  assert.deepEqual(axes.slice(0, 2).map((a) => a.show), [true, false]);
  assert.equal(axes[0].min, axes[1].min);
  assert.equal(axes[0].max, axes[1].max);
  assert.ok(axes[0].max >= 30, `count axis covers the data (max ${axes[0].max})`);
});

test("percent series share a hidden 0-100 axis on the right", () => {
  const axes = buildCompoundLineChartYAxis(series);
  for (const axis of axes.slice(2)) {
    assert.equal(axis.seriesName, "Resolution rate");
    assert.equal(axis.min, 0);
    assert.equal(axis.max, 100);
    assert.equal(axis.show, false);
    assert.equal(axis.opposite, true);
  }
});

test("series order is kept when percent and count series interleave", () => {
  const mixed = [series[2], series[0], series[3], series[1]];
  const axes = buildCompoundLineChartYAxis(mixed);
  assert.deepEqual(axes.map((a) => a.seriesName), ["Resolution rate", "Created", "Resolution rate", "Created"]);
  assert.deepEqual(axes.map((a) => a.show), [false, true, false, false]);
});

test("a chart without percent series keeps the single axis", () => {
  const axes = buildCompoundLineChartYAxis(series.slice(0, 2));
  assert.ok(!Array.isArray(axes) || axes.length === 1);
});
