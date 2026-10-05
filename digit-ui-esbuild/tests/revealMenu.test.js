// Pins how far the inbox filter scrolls to show a dropdown menu opened near
// the bottom of its scroll box.
// Run from digit-ui-esbuild/:  node --test tests/revealMenu.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/utils/revealMenu.js");
const OUT = path.join(os.tmpdir(), `revealMenu.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});
const { revealOffset } = require(OUT);

const box = { top: 100, bottom: 500 };

test("a menu that already fits needs no scroll", () => {
  assert.equal(revealOffset(box, { top: 200, bottom: 450 }), 0);
  assert.equal(revealOffset(box, { top: 200, bottom: 500 }), 0);
});

test("a menu running past the bottom scrolls just enough to show it", () => {
  assert.equal(revealOffset(box, { top: 400, bottom: 620 }), 120);
});

test("a menu taller than the box keeps its top edge in view", () => {
  assert.equal(revealOffset(box, { top: 300, bottom: 900 }), 200);
});

test("a menu whose top is already above the box is left alone", () => {
  assert.equal(revealOffset(box, { top: 80, bottom: 700 }), 0);
});
