// Pins how the voice input flag in RAINMAKER-PGR.UIConstants is read.
// Run from digit-ui-esbuild/:  node --test tests/uiConstants.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/utils/uiConstants.js");
const OUT = path.join(os.tmpdir(), `uiConstants.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});
const { voiceInputEnabled } = require(OUT);

test("voice input stays on where the tenant hasn't set the flag", () => {
  assert.equal(voiceInputEnabled(undefined), true);
  assert.equal(voiceInputEnabled([]), true);
  assert.equal(voiceInputEnabled([{ code: "DEFAULT", REOPENSLA: 259200000 }]), true);
});

test("only an explicit false turns it off", () => {
  assert.equal(voiceInputEnabled([{ code: "DEFAULT", VOICE_INPUT: false }]), false);
  assert.equal(voiceInputEnabled([{ code: "DEFAULT", VOICE_INPUT: true }]), true);
});
