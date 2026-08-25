// Public query plan (#1540; filter-aware since #1797).
// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/utils/publicQueryPlan.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "queryPlan.js");
const OUT = path.join(os.tmpdir(), `publicQueryPlan.cjs.${process.pid}.js`);

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

const { buildPublicRefs, buildPublicRefsKey } = require(OUT);

const NO_FILTERS = { geography: "all", complaintType: "all", dateRangeActive: false };

test("public plan emits one bare base reference per curated tile when nothing narrows", () => {
  const kpis = {
    card: { version: "1", viz: { kind: "number-tile-sparkline" } },
    map: { version: "2", viz: { kind: "map" } },
  };
  const tiles = [{ kpiId: "card" }, { kpiId: "map" }, { kpiId: "not-in-pack" }];

  assert.deepEqual(buildPublicRefs(tiles, kpis, NO_FILTERS), {
    card: { kpiId: "card" },
    map: { kpiId: "map" },
  });
  const refs = buildPublicRefs(tiles, kpis, NO_FILTERS);
  assert.equal(refs.card__prior, undefined);
  assert.equal(refs.card__series, undefined);
  assert.equal(refs.map__pins, undefined);
  assert.equal(Object.hasOwn(refs.card, "params"), false);
  assert.match(buildPublicRefsKey(tiles, kpis, NO_FILTERS), /"public":true/);
});

test("public plan carries exactly the filter-bar params and nothing else (#1797)", () => {
  const kpis = {
    card: { version: "1", viz: { kind: "number-tile-sparkline" } },
    bar: { version: "1", viz: { kind: "bar" } },
  };
  const tiles = [{ kpiId: "card" }, { kpiId: "bar" }];
  const filters = {
    geography: "W1",
    complaintType: "Pothole",
    complaintTypePath: null,
    complaintTypeLeaf: true,
    dateRangeActive: true,
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
  };

  const refs = buildPublicRefs(tiles, kpis, filters);
  const expectedParams = {
    ward: "W1",
    serviceCode: "Pothole",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
  };
  assert.deepEqual(refs, {
    card: { kpiId: "card", params: expectedParams },
    bar: { kpiId: "bar", params: expectedParams },
  });
  // Still no companion fan-out: the backend's public allow-list has no
  // compare/series/hierLevel, and the plan must never ask for them.
  assert.deepEqual(Object.keys(refs).sort(), ["bar", "card"]);
  for (const ref of Object.values(refs)) {
    assert.deepEqual(Object.keys(ref.params).sort(), ["dateFrom", "dateTo", "serviceCode", "ward"]);
  }
  // Each ref owns its params object — mutating one must not leak into the other.
  refs.card.params.ward = "W2";
  assert.equal(refs.bar.params.ward, "W1");

  // The batch effect key must change when a filter changes, else the page
  // never refetches after the visitor picks a ward.
  assert.notEqual(
    buildPublicRefsKey(tiles, kpis, filters),
    buildPublicRefsKey(tiles, kpis, { ...filters, geography: "W2" })
  );
  assert.notEqual(
    buildPublicRefsKey(tiles, kpis, filters),
    buildPublicRefsKey(tiles, kpis, NO_FILTERS)
  );
});

test("an interior complaint-type node narrows via complaintPath, not serviceCode", () => {
  const kpis = { bar: { version: "1", viz: { kind: "bar" } } };
  const refs = buildPublicRefs([{ kpiId: "bar" }], kpis, {
    geography: "all",
    complaintType: "Roads",
    complaintTypePath: "Roads",
    complaintTypeLeaf: false,
    dateRangeActive: false,
  });
  assert.deepEqual(refs.bar.params, { complaintPath: "Roads" });
});

test("public plan ignores hierarchy overrides and unknown tile ids by construction", () => {
  const kpis = { only: { version: "1", viz: { kind: "bar" } } };
  const refs = buildPublicRefs([{ kpiId: "only" }, null, {}, { kpiId: "unknown" }], kpis, NO_FILTERS);
  assert.deepEqual(refs, { only: { kpiId: "only" } });
  assert.equal(Object.hasOwn(refs.only, "params"), false);
  // buildPublicRefs takes no hierOverrides argument at all — there is no seam
  // through which a Group-by level could reach the public wire.
  assert.equal(buildPublicRefs.length, 3);
});
