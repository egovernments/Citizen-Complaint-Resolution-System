// Regression tests for the Add-KPI drag lifecycle (#1287 bomet repro).
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/utils/pickerDragLifecycle.test.js
//
// react-grid-layout 1.3.4 only cleans its external-drop state (droppingDOMNode,
// __dropping-elem__ layout entry, dragEnterCounter, activeDrag) on a grid drop
// or a balanced dragleave. A drag that engaged the grid and ended anywhere else
// leaves activeDrag stuck, after which every layout prop change is ignored —
// adds persist but never render. The lifecycle tracker decides, at dragend,
// whether AdminDashboard must dispatch a synthetic drop at the grid to run
// RGL's own cleanup. These tests pin that decision table.

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

const { createPickerDragLifecycle } = bundle("pickerDragLifecycle.js");

test("REGRESSION #1287: drag engages the grid, released elsewhere -> cleanup required", () => {
  const lc = createPickerDragLifecycle();
  lc.start();
  lc.gridDragOver(); // placeholder conjured, RGL dropping state exists
  lc.gridDragOver();
  // released over the header/picker, or ESC — no grid drop, only dragend
  assert.deepEqual(lc.end(), { needsSyntheticCleanup: true });
});

test("successful drop on the grid needs no cleanup (RGL cleaned itself)", () => {
  const lc = createPickerDragLifecycle();
  lc.start();
  lc.gridDragOver();
  lc.gridDrop(); // RGL onDrop ran: counter reset + placeholder removed
  assert.deepEqual(lc.end(), { needsSyntheticCleanup: false });
});

test("drag that never reaches the grid needs no cleanup", () => {
  const lc = createPickerDragLifecycle();
  lc.start();
  assert.deepEqual(lc.end(), { needsSyntheticCleanup: false });
});

test("foreign drag (no picker dragstart) never triggers cleanup", () => {
  const lc = createPickerDragLifecycle();
  lc.gridDragOver(); // stray dragover without an active picker drag
  assert.deepEqual(lc.end(), { needsSyntheticCleanup: false });
});

test("state resets between drags — a cancelled drag does not taint the next one", () => {
  const lc = createPickerDragLifecycle();
  lc.start();
  lc.gridDragOver();
  assert.deepEqual(lc.end(), { needsSyntheticCleanup: true });
  // next drag: clean slate, drop succeeds
  lc.start();
  assert.deepEqual(lc.peek(), { active: true, engaged: false, dropped: false });
  lc.gridDragOver();
  lc.gridDrop();
  assert.deepEqual(lc.end(), { needsSyntheticCleanup: false });
});

test("the synthetic cleanup drop itself cannot re-arm the tracker", () => {
  const lc = createPickerDragLifecycle();
  lc.start();
  lc.gridDragOver();
  lc.end();
  // AdminDashboard's synthetic drop re-enters handleGridDrop -> gridDrop()
  lc.gridDrop();
  assert.deepEqual(lc.end(), { needsSyntheticCleanup: false });
});
