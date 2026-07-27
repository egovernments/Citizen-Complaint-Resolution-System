// Unit tests for catalog drag geometry (#1311 review).
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/utils/catalogDragGeometry.test.js

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

const { createCatalogDragGeometry, isCatalogCard } = bundle("catalogDragGeometry.js");

const KPIS = {
  card_a: { viz: { kind: "number-tile-delta" } },
  card_b: { viz: { kind: "number-tile-sparkline" } },
  chart_a: { viz: { kind: "bar" } },
  chart_b: { viz: { kind: "horizontal-bar" } },
};

const geom = createCatalogDragGeometry(KPIS);

const item = (i, x, y, w, h) => ({ i, x, y, w, h });

test("isCatalogCard: number tiles only", () => {
  assert.equal(isCatalogCard("card_a", KPIS), true);
  assert.equal(isCatalogCard("chart_a", KPIS), false);
  assert.equal(isCatalogCard("missing", KPIS), false);
});

test("resolveSwapTarget: returns hovered peer of the same band kind", () => {
  const layout = [
    item("card_a", 0, 0, 3, 2),
    item("card_b", 3, 0, 3, 2),
    item("chart_a", 0, 3, 6, 4),
  ];
  const drop = item("card_a", 4, 0, 3, 2);
  const target = geom.resolveSwapTarget(layout, drop, "card_a", "card_b");
  assert.equal(target?.i, "card_b");
});

test("resolveSwapTarget: refuses card↔chart swaps", () => {
  const layout = [
    item("card_a", 0, 0, 3, 2),
    item("chart_a", 0, 3, 6, 4),
  ];
  const drop = item("card_a", 1, 3, 3, 2);
  const target = geom.resolveSwapTarget(layout, drop, "card_a", "chart_a");
  assert.equal(target, null);
});

test("compactGapsUpward: packs a hole after a tile is removed", () => {
  const withHole = [
    item("chart_a", 0, 0, 6, 4),
    item("chart_b", 0, 6, 6, 4),
  ].filter((entry) => entry.i !== "chart_a");
  const packed = geom.compactGapsUpward(withHole, [], {
    packKpis: false,
    colStart: 0,
    colEnd: 6,
  });
  const b = packed.find((entry) => entry.i === "chart_b");
  assert.ok(b);
  assert.equal(b.y, 0);
});

test("compactAfterRemove: fills the vacated band", () => {
  const layout = [
    item("chart_a", 0, 0, 6, 4),
    item("chart_b", 0, 4, 6, 4),
  ];
  const without = layout.filter((entry) => entry.i !== "chart_a");
  const packed = geom.compactAfterRemove(without, [item("chart_a", 0, 0, 6, 4)]);
  const b = packed.find((entry) => entry.i === "chart_b");
  assert.ok(b);
  assert.equal(b.y, 0);
});
test("resolveRemainingOverlaps: separates stacked items sharing a cell", () => {
  const layout = [
    item("chart_a", 0, 0, 6, 4),
    item("chart_b", 0, 0, 6, 4),
  ];
  const fixed = geom.resolveRemainingOverlaps(layout, ["chart_a"]);
  assert.equal(geom.hasOverlaps(fixed), false);
  const a = fixed.find((entry) => entry.i === "chart_a");
  const b = fixed.find((entry) => entry.i === "chart_b");
  assert.equal(a.x, 0);
  assert.equal(a.y, 0);
  assert.ok(b.y >= a.h || b.x >= a.w);
});

test("hasOverlaps: detects and clears after repair", () => {
  const overlapping = [
    item("chart_a", 0, 0, 6, 4),
    item("chart_b", 2, 1, 6, 4),
  ];
  assert.equal(geom.hasOverlaps(overlapping), true);
  const fixed = geom.resolveRemainingOverlaps(overlapping, []);
  assert.equal(geom.hasOverlaps(fixed), false);
});

/* ------------------------------------------------------------------ */
/* Origin-row swap fallback (findKpiColumnSwapTarget guard)            */
/* ------------------------------------------------------------------ */

test("findDragHoverTarget: far-below drop does not swap with an origin-row KPI", () => {
  const origin = item("card_a", 0, 0, 2, 2);
  const layout = [origin, item("card_b", 2, 0, 2, 2)];
  // Dropped 4 KPI rows below the band, horizontally overlapping card_b.
  const drop = item("card_a", 1, 8, 2, 2);
  const target = geom.findDragHoverTarget(layout, drop, "card_a", origin);
  assert.equal(target, null);
});

test("findDragHoverTarget: adjacent-row drop still swaps via origin-row fallback", () => {
  const origin = item("card_a", 0, 0, 2, 2);
  const layout = [origin, item("card_b", 2, 0, 2, 2)];
  // One KPI row below the origin, horizontally overlapping card_b.
  const drop = item("card_a", 1, 2, 2, 2);
  const target = geom.findDragHoverTarget(layout, drop, "card_a", origin);
  assert.equal(target?.i, "card_b");
});

/* ------------------------------------------------------------------ */
/* KPI row packing must wrap before exceeding GRID_COLS (12)           */
/* ------------------------------------------------------------------ */

const SEVEN_CARD_KPIS = Object.fromEntries(
  Array.from({ length: 7 }, (_, n) => [
    `card_${n + 1}`,
    { viz: { kind: "number-tile" } },
  ])
);
const sevenGeom = createCatalogDragGeometry(SEVEN_CARD_KPIS);

function assertInsideGrid(layout) {
  for (const entry of layout) {
    assert.ok(
      entry.x >= 0 && entry.x + entry.w <= 12,
      `${entry.i} exceeds the grid: x=${entry.x} w=${entry.w}`
    );
  }
}

test("reflowKpiBand: seven 2-wide cards wrap to a second row without overlaps", () => {
  const layout = Array.from({ length: 7 }, (_, n) =>
    item(`card_${n + 1}`, n, 0, 2, 2)
  );
  const packed = sevenGeom.reflowKpiBand(layout);
  assertInsideGrid(packed);
  assert.equal(sevenGeom.hasOverlaps(packed), false);
  const wrapped = packed.filter((entry) => entry.y === 2);
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].x, 0);
  assert.equal(packed.filter((entry) => entry.y === 0).length, 6);
});

test("applyExplicitDrop: inserting a seventh card into a full row wraps, no overlaps", () => {
  const prev = Array.from({ length: 6 }, (_, n) =>
    item(`card_${n + 1}`, n * 2, 0, 2, 2)
  );
  const result = sevenGeom.applyExplicitDrop(prev, item("card_7", 4, 0, 2, 2));
  assert.equal(result.length, 7);
  assertInsideGrid(result);
  assert.equal(sevenGeom.hasOverlaps(result), false);
  const wrapped = result.filter((entry) => entry.y >= 2);
  assert.equal(wrapped.length, 1);
});

test("resolveRemainingOverlaps: repairs a card/card collision deterministically", () => {
  const layout = [
    item("card_a", 0, 0, 2, 2),
    item("card_b", 0, 0, 2, 2),
  ];
  const fixed = geom.resolveRemainingOverlaps(layout, []);
  assert.equal(geom.hasOverlaps(fixed), false);
  const a = fixed.find((entry) => entry.i === "card_a");
  const b = fixed.find((entry) => entry.i === "card_b");
  assert.deepEqual({ x: a.x, y: a.y }, { x: 0, y: 0 });
  assert.ok(b.x + b.w <= 12);
});
