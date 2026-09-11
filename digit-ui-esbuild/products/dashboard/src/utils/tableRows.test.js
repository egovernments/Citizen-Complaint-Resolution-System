// Catalog-driven table comparison/filter transforms.
// Run from digit-ui-esbuild/: node --test products/dashboard/src/utils/tableRows.test.js

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
    try { fs.unlinkSync(out); } catch (_) { /* already gone */ }
  });
  return require(out);
}

const { transformTableRows } = bundle("tableRows.js");
const { buildRefs, buildRefsKey } = bundle("queryPlan.js");

const recurringViz = {
  comparison: {
    period: "prior",
    mode: "percentChange",
    joinBy: ["ward_code", "service_code"],
    valueKey: "total",
    outputKey: "trend_pct",
  },
  rowFilter: { column: "total", gte: 3 },
};

test("joins prior rows by every declared dimension and applies the minimum count", () => {
  const rows = transformTableRows({
    rows: [
      { ward_code: "W1", service_code: "A", total: 6 },
      { ward_code: "W1", service_code: "B", total: 2 },
      { ward_code: "W2", service_code: "A", total: 3 },
    ],
    priorRows: [
      { ward_code: "W1", service_code: "A", total: 4 },
      { ward_code: "W2", service_code: "A", total: 6 },
    ],
  }, recurringViz);

  assert.deepEqual(rows.map(({ id, ...row }) => row), [
    { ward_code: "W1", service_code: "A", total: 6, trend_pct: 50 },
    { ward_code: "W2", service_code: "A", total: 3, trend_pct: -50 },
  ]);
  assert.equal(rows[0].id, "W1\u001fA");
});

test("new recurring pairs have a finite +100% trend and zero stays flat", () => {
  const rows = transformTableRows({
    rows: [
      { ward_code: "W1", service_code: "A", total: 5 },
      { ward_code: "W2", service_code: "B", total: 0 },
    ],
    priorRows: [],
  }, { ...recurringViz, rowFilter: null });
  assert.deepEqual(rows.map((row) => row.trend_pct), [100, 0]);
});

test("comparison tables request prior data; ordinary tables remain single-query", () => {
  const tiles = [{ kpiId: "recurring" }, { kpiId: "ordinary" }];
  const kpis = {
    recurring: { viz: { kind: "table", comparison: recurringViz.comparison } },
    ordinary: { viz: { kind: "table" } },
  };
  const refs = buildRefs(tiles, kpis, {}, {});
  assert.deepEqual(Object.keys(refs), ["recurring", "recurring__prior", "ordinary"]);
  assert.equal(refs.recurring__prior.params.compare, "prior");
  assert.equal(refs.ordinary__prior, undefined);
});

test("the request fingerprint changes when comparison semantics change", () => {
  const tiles = [{ kpiId: "recurring" }];
  const base = { recurring: { viz: { kind: "table" } } };
  const compared = {
    recurring: { viz: { kind: "table", comparison: recurringViz.comparison } },
  };
  assert.notEqual(buildRefsKey(tiles, base, {}, {}), buildRefsKey(tiles, compared, {}, {}));
});
