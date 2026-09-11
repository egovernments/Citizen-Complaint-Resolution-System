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
  getGeographyMapPinLegendEntry,
  getSharePctBucket,
  getOpenShareFillStyle,
  getResolvedShareFillStyle,
  OPEN_SHARE_LEGEND,
  RESOLVED_SHARE_LEGEND,
  GEOGRAPHY_MAP_PIN_STYLES,
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

/* ------------------------------------------------------------------ */
/* A ward with nothing filed must reach the white swatch               */
/* ------------------------------------------------------------------ */

test("zero filed complaints paints the white 'No complaints' swatch, not 0%", () => {
  // Both share layers compute pct = 0 when filed is 0, and pct 0 used to map to
  // legend[1] ("0%") — so an empty ward looked like a ward with complaints and
  // none open/resolved, and the white swatch was unreachable.
  for (const legend of [OPEN_SHARE_LEGEND, RESOLVED_SHARE_LEGEND]) {
    assert.equal(getSharePctBucket(0, legend, 0).id, "none");
    assert.equal(getSharePctBucket(0, legend, undefined).id, "p0", "legacy call site unchanged");
    assert.equal(getSharePctBucket(0, legend, 4).id, "p0", "filed>0 with 0% stays 0%");
    assert.equal(getSharePctBucket(35, legend, 20).id, "p40");
  }
  assert.equal(getOpenShareFillStyle(0, 0).fillColor, OPEN_SHARE_LEGEND[0].fill);
  assert.notEqual(getOpenShareFillStyle(0, 3).fillColor, OPEN_SHARE_LEGEND[0].fill);
  assert.equal(getResolvedShareFillStyle(0, 0).fillColor, RESOLVED_SHARE_LEGEND[0].fill);
});

/* ------------------------------------------------------------------ */
/* The pin legend row (separate from the colour scale on purpose)      */
/* ------------------------------------------------------------------ */

test("the pin entry is NOT part of the colour scale", () => {
  // getCreatedCountBucket range-scans getGeographyMapLegend's array; a pin entry
  // inside it would corrupt bucket classification.
  const { buckets } = buildCreatedCountScale([1250]);
  for (const layer of ["created", "open", "resolved"]) {
    for (const item of getGeographyMapLegend(layer, buckets)) {
      assert.ok(!/pin/i.test(item.id), `legend scale leaked a pin entry: ${item.id}`);
    }
  }
});

// No message store is primed in this unit test, so translate() exercises the
// same canonical-English fallback used by a standalone dashboard while its
// selected locale is missing a message.

test("pin label and swatch follow the layer under per-layer semantics", () => {
  const of = (layer) => getGeographyMapPinLegendEntry(layer, { semantics: "per-layer" });
  assert.equal(of("created").label, "Pins: complaints filed");
  assert.equal(of("open").label, "Pins: complaints still open");
  assert.equal(of("resolved").label, "Pins: complaints resolved");
  assert.deepEqual(of("created").swatch, GEOGRAPHY_MAP_PIN_STYLES.created);
  assert.deepEqual(of("open").swatch, GEOGRAPHY_MAP_PIN_STYLES.open);
  assert.deepEqual(of("resolved").swatch, GEOGRAPHY_MAP_PIN_STYLES.resolved);
  // Every layer must be visually distinguishable.
  assert.equal(new Set(["created", "open", "resolved"].map((l) => of(l).swatch.fill)).size, 3);
  // Unknown / missing layer degrades to the Created styling rather than throwing.
  assert.deepEqual(
    getGeographyMapPinLegendEntry(undefined, {}).swatch,
    GEOGRAPHY_MAP_PIN_STYLES.created
  );
});

test("open-only semantics says so on EVERY layer", () => {
  for (const layer of ["created", "open", "resolved"]) {
    const entry = getGeographyMapPinLegendEntry(layer, { semantics: "open-only" });
    assert.equal(entry.label, "Pins: complaints still open — pins do not follow this layer");
  }
  // Anything that is not exactly 'open-only' is treated as per-layer.
  assert.equal(
    getGeographyMapPinLegendEntry("open", { semantics: "nonsense" }).label,
    "Pins: complaints still open"
  );
});

test("the coverage note is composed by concatenation, never interpolation", () => {
  const entry = getGeographyMapPinLegendEntry("created", {
    semantics: "per-layer",
    shown: 42,
    total: 137,
  });
  assert.equal(
    entry.note,
    "42 of 137 shown on the map (rest have no location)"
  );
  assert.ok(!/\{|\}|%s/.test(entry.note), "no interpolation placeholders");
  // Nothing to compare against -> no note at all rather than "0 of 0".
  assert.equal(getGeographyMapPinLegendEntry("created", { shown: 0, total: 0 }).note, "");
});

test("truncation and unmapped complaints are surfaced, not swallowed", () => {
  const entry = getGeographyMapPinLegendEntry("open", {
    semantics: "per-layer",
    shown: 1000,
    total: 4200,
    truncated: true,
    unmapped: 17,
  });
  assert.deepEqual(entry.note.split(" \u00b7 "), [
    "1000 of 4200 shown on the map (rest have no location)",
    "Showing the most recent 1,000 only",
    "17 complaints have no ward and are not mapped",
  ]);
  // No cap hit, nothing unmapped -> just the coverage line.
  const clean = getGeographyMapPinLegendEntry("open", { shown: 3, total: 4, unmapped: 0 });
  assert.equal(clean.note.includes("TRUNCATED"), false);
  assert.equal(clean.note.includes("UNMAPPED"), false);
});
