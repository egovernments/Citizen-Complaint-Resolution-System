// Data-driven Created-layer scale (#1461).
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/config/geographyMapPresentation.test.js
//
// The module is ESM and imports the i18n runtime, so it is bundled to CJS with
// the repo's own esbuild — same idiom as services/dashboardMetrics.test.js.
// buildCreatedCountScale is pure, so the whole edge-case table is testable with
// no DOM and no Leaflet.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "geographyMapPresentation.js");
const OUT = path.join(os.tmpdir(), `geographyMapPresentation.cjs.${process.pid}.js`);

esbuild.buildSync({
  entryPoints: [ENTRY],
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

const {
  buildCreatedCountScale,
  getCreatedCountBucket,
  getGeographyMapLegend,
  CREATED_COUNT_RAMP,
  MAX_CREATED_COUNT_BUCKETS,
} = require(OUT);

/** Bucket labels minus the leading "No complaints" swatch. */
const ranges = (values) =>
  buildCreatedCountScale(values)
    .buckets.slice(1)
    .map((b) => b.label);

/* ------------------------------------------------------------------ */
/* The bug: real tenant distributions                                  */
/* ------------------------------------------------------------------ */

test("bomet's 23 wards spread across the ramp instead of saturating", () => {
  // Measured on bomet 2026-08-03: one ward holds 1250, the next 55.
  const bomet = [1250, 55, 40, 29, 26, 24, 23, 13, 6, 4, 3, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  assert.deepEqual(ranges(bomet), ["1–5", "6–20", "21–50", "51–200", "201–500", "501+"]);

  // The old scale put ALL of these in the top bucket. Now they separate.
  const bucketOf = (n) => getCreatedCountBucket(n, buildCreatedCountScale(bomet).buckets).label;
  assert.equal(bucketOf(1250), "501+");
  assert.equal(bucketOf(55), "51–200");
  assert.equal(bucketOf(40), "21–50");
  assert.equal(bucketOf(13), "6–20");
  assert.equal(bucketOf(3), "1–5");

  const distinct = new Set(bomet.map(bucketOf));
  assert.ok(distinct.size >= 4, `expected real discrimination, got ${distinct.size} shades`);
});

test("mz's small domain gets per-count shades, not 50-wide buckets", () => {
  // Measured on mz 2026-08-03.
  assert.deepEqual(ranges([32, 21, 15, 1, 1, 1, 1]), ["1–2", "3–5", "6–10", "11–20", "21+"]);
});

/* ------------------------------------------------------------------ */
/* Edge cases                                                          */
/* ------------------------------------------------------------------ */

test("empty / all-zero domains yield only the none bucket", () => {
  for (const input of [[], [0, 0, 0], undefined, null, "nonsense"]) {
    const { max, buckets } = buildCreatedCountScale(input);
    assert.equal(max, 0);
    assert.deepEqual(
      buckets.map((b) => b.id),
      ["none"]
    );
  }
});

test("max below the bucket count gives every count its own shade", () => {
  assert.deepEqual(ranges([6, 2, 1]), ["1", "2", "3", "4", "5", "6+"]);
  assert.deepEqual(ranges([3, 1]), ["1", "2", "3+"]);
});

test("a single ward, and all-equal wards, do not crash or produce empty ranges", () => {
  assert.deepEqual(ranges([1]), ["1+"]);
  assert.deepEqual(ranges([7, 7, 7]), ["1–2", "3–5", "6+"]);
});

test("garbage values are coerced, never thrown on", () => {
  const { max, buckets } = buildCreatedCountScale([null, undefined, NaN, -5, "12", 4.9]);
  assert.equal(max, 12, "strings parse, negatives floor at 0, floats truncate");
  assert.ok(buckets.length > 1);
});

test("counts at or below zero classify as the none bucket", () => {
  const { buckets } = buildCreatedCountScale([100]);
  for (const n of [0, -1, NaN, null, undefined]) {
    assert.equal(getCreatedCountBucket(n, buckets).id, "none");
  }
});

/* ------------------------------------------------------------------ */
/* Invariants that must hold for EVERY domain                          */
/* ------------------------------------------------------------------ */

test("buckets are contiguous, ascending, open-ended, and never exceed the ramp", () => {
  for (const max of [1, 2, 5, 6, 7, 8, 15, 32, 55, 99, 100, 1250, 99999]) {
    const { buckets } = buildCreatedCountScale([max]);
    const data = buckets.slice(1);
    assert.ok(data.length >= 1 && data.length <= MAX_CREATED_COUNT_BUCKETS, `count for max=${max}`);
    assert.equal(data[0].min, 1, `starts at 1 for max=${max}`);
    assert.equal(data[data.length - 1].max, Infinity, `open-ended for max=${max}`);
    for (let i = 1; i < data.length; i += 1) {
      assert.equal(data[i].min, data[i - 1].max + 1, `no gap/overlap at ${i} for max=${max}`);
    }
    // The darkest stop must always mark the top bucket, however few there are.
    assert.equal(
      data[data.length - 1].fill,
      CREATED_COUNT_RAMP[CREATED_COUNT_RAMP.length - 1].fill,
      `darkest stop anchored for max=${max}`
    );
  }
});

test("every value in the domain lands in exactly one bucket", () => {
  const domain = [1250, 55, 40, 13, 6, 1];
  const { buckets } = buildCreatedCountScale(domain);
  for (const value of domain) {
    const hits = buckets.slice(1).filter((b) => value >= b.min && value <= b.max);
    assert.equal(hits.length, 1, `value ${value} matched ${hits.length} buckets`);
  }
});

test("the scale is stable while the max stays on the same ladder rung", () => {
  // Hysteresis is the point of snapping to 1-2-5: a refresh that nudges the max
  // must not redraw the legend under the reader.
  const base = ranges([1250]);
  for (const max of [1180, 1245, 1260, 1400]) {
    assert.deepEqual(ranges([max]), base, `legend moved at max=${max}`);
  }
});

/* ------------------------------------------------------------------ */
/* The share legends must be untouched by all of this                  */
/* ------------------------------------------------------------------ */

test("percent legends keep their fixed buckets and seeded labels", () => {
  for (const layer of ["open", "resolved"]) {
    const legend = getGeographyMapLegend(layer, buildCreatedCountScale([1250]).buckets);
    assert.equal(legend.length, 7);
    assert.deepEqual(
      legend.map((b) => b.id),
      ["none", "p0", "p20", "p40", "p60", "p80", "p100"]
    );
  }
});

test("the created legend reflects the computed scale", () => {
  const { buckets } = buildCreatedCountScale([1250]);
  const legend = getGeographyMapLegend("created", buckets);
  assert.equal(legend.length, buckets.length);
  assert.equal(legend[legend.length - 1].label, "501+");
});
