// Pins where the employee working-context panel opens (#2445): under the
// header pill however long its translation, centred only for the mobile row.
// Run from digit-ui-esbuild/:  node --test tests/workingContextPosition.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../packages/modules/core/src/components/TopBarSideBar/workingContextPosition.js");
const OUT = path.join(os.tmpdir(), `workingContextPosition.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT, logLevel: "error" });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});

const { workingContextPanelLeft } = require(OUT);
const PANEL = 272;

test("right-aligns under a short English pill", () => {
  assert.equal(workingContextPanelLeft({ right: 1810, width: 220 }, 2048, PANEL), 1810 - PANEL);
});

test("still right-aligns under a pill wider than the panel, as in Portuguese", () => {
  // "Condado de Bomet · 1 departamento · 1 função" is ~330px: wider than the
  // panel, which used to centre it in the middle of the page.
  assert.equal(workingContextPanelLeft({ right: 1810, width: 330 }, 2048, PANEL), 1810 - PANEL);
});

test("centres under the full-width mobile row", () => {
  assert.equal(workingContextPanelLeft({ right: 374, width: 358 }, 390, PANEL), (390 - PANEL) / 2);
});

test("never leaves the viewport", () => {
  assert.equal(workingContextPanelLeft({ right: 100, width: 90 }, 1280, PANEL), 8);
  assert.equal(workingContextPanelLeft({ right: 380, width: 120 }, 300, 284), 8);
});
