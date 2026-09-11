// Unit tests for the per-widget "Group by" hierarchy-level control (#1111 PR2).
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/utils/hierLevelGrouping.test.js
//
// The modules under test are ESM (like the rest of products/), so the test
// bundles them to CJS with the repo's own esbuild — the same idiom as
// src/theme/applyTheme.test.js and dashboardMetrics.test.js (#1110).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

function bundle(entry) {
  const out = path.join(
    os.tmpdir(),
    `${path.basename(entry, ".js")}.cjs.${process.pid}.js`
  );
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

const {
  hierLevelParam,
  appliedHierLevel,
  effectiveHierLevel,
  selectHierarchyDefinition,
  orderedLevels,
  buildGroupByOptions,
  applyGroupByToColumns,
} = bundle("hierLevelGrouping.js");

const { buildRefs, buildRefsKey, globalParams } = bundle("queryPlan.js");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const HIER_PARAM = { name: "hierLevel", allowed: ["leaf", "1", "2", "3", "4"], default: "1" };

const chartDef = (kpiId, extra = {}) => ({
  kpiId,
  viz: { kind: "stacked-bar", dimensionKey: "service_code" },
  params: [{ name: "window", default: "last_7d", allowed: ["last_7d"] }, HIER_PARAM],
  ...extra,
});

const cardDef = (kpiId) => ({
  kpiId,
  viz: { kind: "number-tile-sparkline" },
  params: [{ name: "window", default: "last_7d", allowed: ["last_7d"] }],
});

const LEVELS_3 = [
  { levelCode: "CATEGORY", label: "Category", order: 1, isLeafServiceCode: false },
  { levelCode: "SECTOR", label: "SECTOR", order: 2, isLeafServiceCode: false },
  { levelCode: "SUB_TYPE", label: "Sub-Type", order: 3, isLeafServiceCode: true },
];

/* ------------------------------------------------------------------ */
/* Param declaration + effective/applied value                         */
/* ------------------------------------------------------------------ */

test("hierLevelParam: only defs declaring the param opt in", () => {
  assert.equal(hierLevelParam(cardDef("c1")), null);
  assert.deepEqual(hierLevelParam(chartDef("t1")), HIER_PARAM);
  assert.equal(hierLevelParam(null), null);
});

test("appliedHierLevel: sends only a valid stored override, never the default", () => {
  const def = chartDef("t1");
  // no override -> nothing sent (backend applies the def default itself)
  assert.equal(appliedHierLevel(def, {}), null);
  assert.equal(appliedHierLevel(def, null), null);
  // valid override -> sent verbatim (including an explicit "leaf" that must
  // beat the def's non-leaf default server-side)
  assert.equal(appliedHierLevel(def, { t1: "2" }), "2");
  assert.equal(appliedHierLevel(def, { t1: "leaf" }), "leaf");
  // stale override outside the allowed list -> dropped, not sent
  assert.equal(appliedHierLevel(def, { t1: "9" }), null);
  // overrides for OTHER tiles never leak
  assert.equal(appliedHierLevel(def, { other: "2" }), null);
  // defs without the param ignore overrides entirely (stale key after a seed change)
  assert.equal(appliedHierLevel(cardDef("c1"), { c1: "2" }), null);
});

test("effectiveHierLevel: override wins, else declared default, else leaf", () => {
  const def = chartDef("t1");
  assert.equal(effectiveHierLevel(def, { t1: "2" }), "2");
  assert.equal(effectiveHierLevel(def, {}), "1"); // declared default mirrors the server
  const noDefault = chartDef("t2");
  noDefault.params = [{ name: "hierLevel", allowed: ["leaf", "1"] }];
  assert.equal(effectiveHierLevel(noDefault, {}), "leaf");
  assert.equal(effectiveHierLevel(cardDef("c1"), {}), null);
});

/* ------------------------------------------------------------------ */
/* Definition selection (R7a)                                          */
/* ------------------------------------------------------------------ */

const DEF_PGR = { hierarchyType: "PGR", active: true, levels: LEVELS_3.slice(0, 2) };
const DEF_TEST = { hierarchyType: "PGR_TEST", active: true, levels: LEVELS_3 };

test("selectHierarchyDefinition: globalConfigs pin wins over everything", () => {
  const rows = [{ hierarchyType: "PGR_TEST" }]; // rows would pick PGR_TEST
  assert.equal(selectHierarchyDefinition([DEF_PGR, DEF_TEST], rows, "PGR"), DEF_PGR);
  // pinned type absent from MDMS -> no hierarchy (control stays hidden)
  assert.equal(selectHierarchyDefinition([DEF_PGR, DEF_TEST], rows, "NOPE"), null);
});

test("selectHierarchyDefinition: without a pin the rows-backed definition wins (most rows)", () => {
  const rows = [
    { hierarchyType: "PGR" },
    { hierarchyType: "PGR" },
    { hierarchyType: "PGR_TEST" },
  ];
  assert.equal(selectHierarchyDefinition([DEF_TEST, DEF_PGR], rows, ""), DEF_PGR);
  // no rows at all -> first active definition
  assert.equal(selectHierarchyDefinition([DEF_TEST, DEF_PGR], [], ""), DEF_TEST);
  // inactive definitions are never picked
  assert.equal(
    selectHierarchyDefinition([{ ...DEF_PGR, active: false }], rows, ""),
    null
  );
  assert.equal(selectHierarchyDefinition([], rows, ""), null);
});

test("orderedLevels: sorted by order, codes stringified", () => {
  const shuffled = [LEVELS_3[2], LEVELS_3[0], LEVELS_3[1]];
  const levels = orderedLevels({ levels: shuffled });
  assert.deepEqual(
    levels.map((l) => l.levelCode),
    ["CATEGORY", "SECTOR", "SUB_TYPE"]
  );
  assert.equal(levels[2].isLeafServiceCode, true);
  assert.deepEqual(orderedLevels(null), []);
});

/* ------------------------------------------------------------------ */
/* Control visibility / options                                        */
/* ------------------------------------------------------------------ */

test("buildGroupByOptions: non-leaf levels by number + Leaf; leaf level never duplicated", () => {
  const opts = buildGroupByOptions(orderedLevels({ levels: LEVELS_3 }), HIER_PARAM);
  assert.deepEqual(
    opts.map((o) => o.value),
    ["1", "2", "leaf"]
  );
  assert.equal(opts[0].level.levelCode, "CATEGORY");
  assert.equal(opts[2].leaf, true);
});

test("buildGroupByOptions: bomet-shaped 2-level tree offers level 1 vs Leaf", () => {
  const twoLevels = orderedLevels({ levels: LEVELS_3.filter((l) => l.levelCode !== "SECTOR") });
  const opts = buildGroupByOptions(twoLevels, HIER_PARAM);
  assert.deepEqual(
    opts.map((o) => o.value),
    ["1", "leaf"]
  );
});

test("buildGroupByOptions: hidden when there is nothing to choose", () => {
  // no param declared
  assert.equal(buildGroupByOptions(orderedLevels({ levels: LEVELS_3 }), null), null);
  // flat/one-level tenant
  assert.equal(buildGroupByOptions([], HIER_PARAM), null);
  assert.equal(buildGroupByOptions([LEVELS_3[2]], HIER_PARAM), null);
  // allowed list excludes every non-leaf level -> only Leaf would remain
  const leafOnly = { name: "hierLevel", allowed: ["leaf"] };
  assert.equal(buildGroupByOptions(orderedLevels({ levels: LEVELS_3 }), leafOnly), null);
});

test("buildGroupByOptions: allowed list filters level numbers", () => {
  const param = { name: "hierLevel", allowed: ["leaf", "2"] };
  const opts = buildGroupByOptions(orderedLevels({ levels: LEVELS_3 }), param);
  assert.deepEqual(
    opts.map((o) => o.value),
    ["2", "leaf"]
  );
});

/* ------------------------------------------------------------------ */
/* Table columns at a non-leaf level (R4)                              */
/* ------------------------------------------------------------------ */

const TABLE_COLUMNS = [
  { id: "service_code", label: "Subtype", labelKey: "DASHBOARD_COL_SUBTYPE", align: "left" },
  { id: "service_group", label: "Type", labelKey: "DASHBOARD_COL_TYPE", align: "left" },
  { id: "avg_resolution_ms", label: "Avg resolution time", align: "left" },
];

test("applyGroupByToColumns: drops service_group and relabels service_code (labelKey stripped)", () => {
  const cols = applyGroupByToColumns(TABLE_COLUMNS, { level: "1", label: "Category" });
  assert.deepEqual(
    cols.map((c) => c.id),
    ["service_code", "avg_resolution_ms"]
  );
  assert.equal(cols[0].label, "Category");
  assert.equal(cols[0].labelKey, undefined); // else the old key would win in TableSortHeader
  // measure columns pass through untouched (same object)
  assert.equal(cols[1], TABLE_COLUMNS[2]);
});

test("applyGroupByToColumns: leaf/no grouping leaves columns untouched", () => {
  assert.equal(applyGroupByToColumns(TABLE_COLUMNS, null), TABLE_COLUMNS);
});

/* ------------------------------------------------------------------ */
/* Override merge into refs + refsKey refire (R7c)                     */
/* ------------------------------------------------------------------ */

const FILTERS = { geography: "WARD1", complaintType: "all", dateRangeActive: false };

test("buildRefs: override merges into the tile's params BEFORE the companion spreads", () => {
  const kpis = {
    chart: chartDef("chart"),
    spark: { ...cardDef("spark"), params: [HIER_PARAM] }, // hypothetical card declaring hierLevel
    map: { kpiId: "map", viz: { kind: "map" }, params: [HIER_PARAM] },
  };
  const tiles = [{ kpiId: "chart" }, { kpiId: "spark" }, { kpiId: "map" }];
  const overrides = { chart: "2", spark: "2", map: "2" };
  const refs = buildRefs(tiles, kpis, FILTERS, overrides);

  assert.deepEqual(refs.chart.params, { ward: "WARD1", hierLevel: "2" });
  // companions AUTO-INHERIT the override (spread comes after the merge)…
  assert.deepEqual(refs.spark__prior.params, { ward: "WARD1", hierLevel: "2", compare: "prior" });
  assert.deepEqual(refs.spark__series.params, { ward: "WARD1", hierLevel: "2", series: "daily" });
  assert.deepEqual(refs.map__pins.params, { ward: "WARD1", hierLevel: "2" });
  // …and the companion's own marker can never be clobbered by the merge
  assert.equal(refs.spark__prior.params.compare, "prior");
});

test("buildRefs: tiles without the param (or without an override) send no hierLevel", () => {
  const kpis = { chart: chartDef("chart"), card: cardDef("card") };
  const tiles = [{ kpiId: "chart" }, { kpiId: "card" }];
  // stale override for a def that does not declare the param
  const refs = buildRefs(tiles, kpis, FILTERS, { card: "2" });
  assert.deepEqual(refs.chart.params, { ward: "WARD1" }); // default is server-side
  assert.deepEqual(refs.card.params, { ward: "WARD1" });
  assert.equal("hierLevel" in refs.card__prior.params, false);
});

test("buildRefsKey: a Group-by change refires the batch effect; unrelated overrides don't", () => {
  const kpis = { chart: chartDef("chart"), card: cardDef("card") };
  const tiles = [{ kpiId: "chart" }, { kpiId: "card" }];
  const before = buildRefsKey(tiles, kpis, FILTERS, {});
  const after = buildRefsKey(tiles, kpis, FILTERS, { chart: "2" });
  assert.notEqual(before, after); // R7c: without this the effect never refires
  // explicit "leaf" override beats a non-leaf default -> must also refire
  const leaf = buildRefsKey(tiles, kpis, FILTERS, { chart: "leaf" });
  assert.notEqual(before, leaf);
  // an override on a tile that can't use it does not thrash the batch
  const stale = buildRefsKey(tiles, kpis, FILTERS, { card: "2" });
  assert.equal(before, stale);
});

test("globalParams: unchanged filter mapping (regression guard for the extraction)", () => {
  assert.deepEqual(globalParams(null), {});
  assert.deepEqual(
    globalParams({
      geography: "W2",
      complaintType: "CT",
      dateRangeActive: true,
      dateFrom: "2026-07-01",
      dateTo: "2026-07-10",
    }),
    { ward: "W2", serviceCode: "CT", dateFrom: "2026-07-01", dateTo: "2026-07-10" }
  );
  assert.deepEqual(globalParams({ geography: "all", complaintType: "all" }), {});
});
