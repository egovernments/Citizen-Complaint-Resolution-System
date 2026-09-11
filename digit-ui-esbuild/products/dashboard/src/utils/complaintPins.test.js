// Per-layer map pins: partitioning + the ward totals the map used to discard.
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/utils/complaintPins.test.js
//
// Same idiom as hierLevelGrouping.test.js / dashboardMetrics.test.js: the module
// under test is ESM, so it is bundled to CJS with the repo's own esbuild.

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
    platform: "neutral",
    outfile: out,
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

const { partitionPinsByLayer, summarizeWardRows, GEO_MAP_LAYER_KEYS } =
  bundle("complaintPins.js");
const { resolvePinKpiId, buildRefs, buildRefsKey, PIN_KPI_ID, PIN_KPI_ID_ALL, PIN_ROW_CAP } =
  bundle("queryPlan.js");

const PINS = [
  { id: "a", isOpen: true, isResolved: false },
  { id: "b", isOpen: false, isResolved: true },
  { id: "c", isOpen: false, isResolved: false }, // e.g. rejected/withdrawn
  { id: "d", isOpen: true, isResolved: false },
];

/* ------------------------------------------------------------------ */
/* partitionPinsByLayer — the QA ticket                                */
/* ------------------------------------------------------------------ */

test("per-layer semantics: each layer gets its own pins", () => {
  const byLayer = partitionPinsByLayer(PINS, true);
  assert.deepEqual(byLayer.created.map((p) => p.id), ["a", "b", "c", "d"]);
  assert.deepEqual(byLayer.open.map((p) => p.id), ["a", "d"]);
  // The bug: the Resolved layer shaded "0 resolved" underneath OPEN pins.
  assert.deepEqual(byLayer.resolved.map((p) => p.id), ["b"]);
});

test("a complaint that is neither open nor resolved appears only under Created", () => {
  const byLayer = partitionPinsByLayer([{ id: "c", isOpen: false, isResolved: false }], true);
  assert.equal(byLayer.created.length, 1);
  assert.equal(byLayer.open.length, 0);
  assert.equal(byLayer.resolved.length, 0);
});

test("open-only semantics: legacy behaviour — the same array on all three layers", () => {
  // The legacy pin def projects no is_open/is_resolved, so nothing can be
  // partitioned; the UI labels this mode instead of guessing.
  const byLayer = partitionPinsByLayer(PINS, false);
  for (const key of GEO_MAP_LAYER_KEYS) {
    assert.equal(byLayer[key], PINS, `layer ${key} must reuse the source array`);
  }
});

test("partitioning is total: junk in, empty layers out", () => {
  for (const input of [null, undefined, "nope", 7]) {
    const byLayer = partitionPinsByLayer(input, true);
    for (const key of GEO_MAP_LAYER_KEYS) assert.deepEqual(byLayer[key], []);
  }
  // Missing flags never count as open/resolved.
  const byLayer = partitionPinsByLayer([{ id: "x" }, null], true);
  assert.equal(byLayer.created.length, 2);
  assert.equal(byLayer.open.length, 0);
  assert.equal(byLayer.resolved.length, 0);
});

/* ------------------------------------------------------------------ */
/* summarizeWardRows — the counts the map silently dropped             */
/* ------------------------------------------------------------------ */

test("ward totals split mapped wards from the ward-less rows the map drops", () => {
  const rows = [
    { ward_code: "W1", filed: 10, open: 4, resolved: 5 },
    { ward_code: "W2", filed: 5, open: 1, resolved: 4 },
    { ward_code: null, filed: 3, open: 2, resolved: 1 },
    { ward_code: "null", filed: 2, open: 2, resolved: 0 },
    { ward_code: "  ", filed: 1, open: 0, resolved: 1 },
  ];
  const { layerTotals, unmapped } = summarizeWardRows(rows, "ward_code");
  assert.deepEqual(layerTotals, { filed: 15, open: 5, resolved: 9 });
  assert.deepEqual(unmapped, { filed: 6, open: 4, resolved: 2 });
});

test("ward totals are total over garbage input", () => {
  assert.deepEqual(summarizeWardRows(null, "ward_code").layerTotals, {
    filed: 0,
    open: 0,
    resolved: 0,
  });
  const { layerTotals } = summarizeWardRows([{ ward_code: "W1", filed: "12" }], "ward_code");
  assert.equal(layerTotals.filed, 12, "numeric strings coerce");
});

/* ------------------------------------------------------------------ */
/* resolvePinKpiId — the catalog fallback                              */
/* ------------------------------------------------------------------ */

test("the per-layer pin def wins when the catalog has it, legacy otherwise", () => {
  assert.equal(resolvePinKpiId({ [PIN_KPI_ID_ALL]: {}, [PIN_KPI_ID]: {} }), PIN_KPI_ID_ALL);
  // A tenant bootstrapped before the new record keeps its pin layer.
  assert.equal(resolvePinKpiId({ [PIN_KPI_ID]: {} }), PIN_KPI_ID);
  assert.equal(resolvePinKpiId({}), PIN_KPI_ID);
  assert.equal(resolvePinKpiId(null), PIN_KPI_ID);
  assert.equal(PIN_ROW_CAP, 1000, "must match AnalyticsPlanner.MAX_LIMIT");
});

test("buildRefs points __pins at the resolved source, keeping the ref key stable", () => {
  const mapDef = { kpiId: "map", viz: { kind: "map" }, params: [] };
  const tiles = [{ kpiId: "map" }];

  const legacy = buildRefs(tiles, { map: mapDef, [PIN_KPI_ID]: {} }, {}, {});
  assert.equal(legacy.map__pins.kpiId, PIN_KPI_ID);

  const upgraded = buildRefs(tiles, { map: mapDef, [PIN_KPI_ID_ALL]: {} }, {}, {});
  assert.equal(upgraded.map__pins.kpiId, PIN_KPI_ID_ALL, "same key, new source");
  assert.deepEqual(Object.keys(upgraded), Object.keys(legacy));
});

test("buildRefsKey changes when a tenant's catalog gains the per-layer def", () => {
  const mapDef = { kpiId: "map", viz: { kind: "map" }, params: [] };
  const tiles = [{ kpiId: "map" }];
  assert.notEqual(
    buildRefsKey(tiles, { map: mapDef }, {}, {}),
    buildRefsKey(tiles, { map: mapDef, [PIN_KPI_ID_ALL]: {} }, {}, {}),
    "the batch effect must refire — the ref key alone never changes"
  );
});
