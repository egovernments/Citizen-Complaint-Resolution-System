// Pins where a v2 Select's open list starts when it is wider than its field:
// under the field, slid left only as far as the viewport needs.
// Run from digit-ui-esbuild/:  node --test tests/selectPopover.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../packages/digit-ui-components-v2/src/components/ui/selectPopover.ts");
const OUT = path.join(os.tmpdir(), `selectPopover.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT, logLevel: "error" });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});

const { popoverLeft } = require(OUT);
const MARGIN = 12;

test("starts under the field when the wider list fits", () => {
  // The inbox filter column: a 250px field at 24px, a 480px list.
  assert.equal(popoverLeft(24, 480, 1440, MARGIN), 24);
});

test("slides left just enough near the right edge", () => {
  // A field ending at 1400 on a 1440 page: 1200 + 480 overruns 1428 by 252.
  assert.equal(popoverLeft(1200, 480, 1440, MARGIN), 1200 - 252);
});

test("never goes past the left margin", () => {
  // A phone: the list is capped at the viewport less both margins.
  assert.equal(popoverLeft(16, 366, 390, MARGIN), MARGIN);
  assert.equal(popoverLeft(200, 366, 390, MARGIN), MARGIN);
});
