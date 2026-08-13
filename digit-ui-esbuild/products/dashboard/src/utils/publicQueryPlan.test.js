// Read-only public query plan (#1540).
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

test("public plan emits one bare base reference per curated tile", () => {
  const kpis = {
    card: { version: "1", viz: { kind: "number-tile-sparkline" } },
    map: { version: "2", viz: { kind: "map" } },
  };
  const tiles = [{ kpiId: "card" }, { kpiId: "map" }, { kpiId: "not-in-pack" }];

  assert.deepEqual(buildPublicRefs(tiles, kpis), {
    card: { kpiId: "card" },
    map: { kpiId: "map" },
  });
  assert.equal(buildPublicRefs(tiles, kpis).card__prior, undefined);
  assert.equal(buildPublicRefs(tiles, kpis).card__series, undefined);
  assert.equal(buildPublicRefs(tiles, kpis).map__pins, undefined);
  assert.match(buildPublicRefsKey(tiles, kpis), /"public":true/);
});

test("public plan ignores filters, overrides and unknown tile ids by construction", () => {
  const kpis = { only: { version: "1", viz: { kind: "bar" } } };
  const refs = buildPublicRefs([{ kpiId: "only" }, null, {}, { kpiId: "unknown" }], kpis);
  assert.deepEqual(refs, { only: { kpiId: "only" } });
  assert.equal(Object.hasOwn(refs.only, "params"), false);
});
