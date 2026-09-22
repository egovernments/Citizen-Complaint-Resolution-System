// Pins the derived layouts used below the desktop breakpoint: one column on a
// phone, two on a tablet with cards paired and wide widgets full width.
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/constants/layoutConfig.stacked.test.js
//
// layoutConfig.js is ESM (like the rest of products/), so the test bundles it
// to CJS with the repo's own esbuild — same idiom as globalFilterGroups.test.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "layoutConfig.js");
const OUT = path.join(os.tmpdir(), `layoutConfig.cjs.${process.pid}.js`);

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
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});

const { reflowLayout } = require(OUT);

const DESKTOP = [
  { i: "chart-b", x: 6, y: 2, w: 6, h: 6, minW: 4, maxW: 12 },
  { i: "kpi-a", x: 0, y: 0, w: 2, h: 2 },
  { i: "chart-a", x: 0, y: 2, w: 6, h: 6 },
  { i: "kpi-b", x: 2, y: 0, w: 2, h: 2 },
];

test("reflowLayout(1) orders by reading order, not array order", () => {
  assert.deepEqual(
    reflowLayout(DESKTOP, 1).map((i) => i.i),
    ["kpi-a", "kpi-b", "chart-a", "chart-b"],
  );
});

test("reflowLayout(1) puts every widget in one full-width column", () => {
  for (const item of reflowLayout(DESKTOP, 1)) {
    assert.equal(item.x, 0, `${item.i} x`);
    assert.equal(item.w, 1, `${item.i} w`);
    assert.equal(item.minW, 1, `${item.i} minW`);
    assert.equal(item.maxW, 1, `${item.i} maxW`);
  }
});

test("reflowLayout(1) stacks without gaps or overlap", () => {
  const stacked = reflowLayout(DESKTOP, 1);
  let expected = 0;
  for (const item of stacked) {
    assert.equal(item.y, expected, `${item.i} y`);
    expected += item.h;
  }
});

test("reflowLayout(1) preserves the operator's heights", () => {
  const byId = Object.fromEntries(reflowLayout(DESKTOP, 1).map((i) => [i.i, i.h]));
  for (const item of DESKTOP) assert.equal(byId[item.i], item.h, `${item.i} h`);
});

test("reflowLayout(1) does not mutate the saved layout", () => {
  const snapshot = JSON.parse(JSON.stringify(DESKTOP));
  reflowLayout(DESKTOP, 1);
  assert.deepEqual(DESKTOP, snapshot);
});

test("reflowLayout(1) handles an empty layout", () => {
  assert.deepEqual(reflowLayout([], 1), []);
});

// --- tablet: two columns, cards pair up, wide widgets span ---

const isCard = (item) => item.i.startsWith("kpi-");
const wide = (item) => !isCard(item);

test("reflowLayout(2) pairs cards and gives wide widgets the full width", () => {
  const out = reflowLayout(DESKTOP, 2, wide);
  const byId = Object.fromEntries(out.map((i) => [i.i, i]));
  assert.equal(byId["kpi-a"].w, 1);
  assert.equal(byId["kpi-b"].w, 1);
  assert.equal(byId["chart-a"].w, 2);
  assert.equal(byId["chart-b"].w, 2);
});

test("reflowLayout(2) seats the two cards side by side on one row", () => {
  const out = reflowLayout(DESKTOP, 2, wide);
  const byId = Object.fromEntries(out.map((i) => [i.i, i]));
  assert.equal(byId["kpi-a"].y, byId["kpi-b"].y, "same row");
  assert.notEqual(byId["kpi-a"].x, byId["kpi-b"].x, "different columns");
});

test("reflowLayout never overlaps or overflows its column count", () => {
  for (const cols of [1, 2]) {
    const out = reflowLayout(DESKTOP, cols, wide);
    for (const item of out) {
      assert.ok(item.x >= 0 && item.x + item.w <= cols, `${item.i} fits in ${cols} cols`);
    }
    for (let a = 0; a < out.length; a += 1) {
      for (let b = a + 1; b < out.length; b += 1) {
        const p = out[a];
        const q = out[b];
        const overlap = p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y;
        assert.ok(!overlap, `${p.i} overlaps ${q.i} at cols=${cols}`);
      }
    }
  }
});

test("an odd number of cards still leaves no widget overlapping", () => {
  const odd = [
    { i: "kpi-a", x: 0, y: 0, w: 2, h: 2 },
    { i: "kpi-b", x: 2, y: 0, w: 2, h: 2 },
    { i: "kpi-c", x: 4, y: 0, w: 2, h: 2 },
    { i: "chart-a", x: 0, y: 2, w: 12, h: 6 },
  ];
  const out = reflowLayout(odd, 2, wide);
  const chart = out.find((i) => i.i === "chart-a");
  const lastCard = out.find((i) => i.i === "kpi-c");
  assert.equal(chart.x, 0, "full-width widget starts a fresh row");
  assert.ok(chart.y >= lastCard.y + lastCard.h, "and sits below the trailing card");
});
