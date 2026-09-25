// CCRS #2129 — ESCALATE must only be offered to the employee holding the complaint.
//
// Run from digit-ui-esbuild/:   node --test tests/pgr.escalate-visibility.test.js
//
// escalationVisibility.js is ESM like the rest of products/, so this bundles it to CJS
// with the repo's own esbuild — the same idiom as
// products/dashboard/src/services/dashboardMetrics.test.js.
//
// Background: the PGR workflow gates ESCALATE by ROLE. getNextActionOptions matched the
// caller's roles against the state's actions and checked only that *an* assignee existed,
// so every PGR_LME holder in the tenant was offered Escalate on every PENDINGATLME
// complaint — including AD_LME_SUP, which the reported complaint had already escalated
// past. Clicking it advanced the CURRENT assignee's ladder, not the clicker's.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/pages/employee/escalationVisibility.js");
const OUT = path.join(os.tmpdir(), `escalationVisibility.cjs.${process.pid}.js`);

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
    /* best effort */
  }
});

const { isCurrentAssignee } = require(OUT);

// The chain from the reported complaint PG-PGR-2026-09-23-284820.
const AD_LME = "53d85ed2-445c-42cb-8b2b-c84861a1143c";
const AD_LME_SUP = "a37e6345-a9dd-469e-bcf6-4ca9601c04e1";
const AD_LME_DIR = "6f0b5052-bcc2-441c-8acb-9eac3e7e4921";

test("the holder of the complaint may escalate it", () => {
  assert.equal(isCurrentAssignee([{ uuid: AD_LME_DIR }], AD_LME_DIR), true);
});

test("a level the complaint has already moved past may not", () => {
  // The exact case in the ticket: AD_LME_SUP escalated it onward to AD_LME_DIR and was
  // still being offered ESCALATE afterwards.
  assert.equal(isCurrentAssignee([{ uuid: AD_LME_DIR }], AD_LME_SUP), false);
});

test("a level below the current holder may not escalate somebody else's ladder", () => {
  assert.equal(isCurrentAssignee([{ uuid: AD_LME_DIR }], AD_LME), false);
});

test("an unassigned complaint offers no escalation to anyone", () => {
  assert.equal(isCurrentAssignee([], AD_LME), false);
  assert.equal(isCurrentAssignee(undefined, AD_LME), false);
  assert.equal(isCurrentAssignee(null, AD_LME), false);
});

test("a caller with no uuid is never a match", () => {
  assert.equal(isCurrentAssignee([{ uuid: AD_LME }], undefined), false);
  assert.equal(isCurrentAssignee([{ uuid: AD_LME }], ""), false);
});

test("bare-uuid assignee lists are accepted too", () => {
  // getCurrentAssignees maps to uuids server-side; the UI sees objects. Tolerate both
  // rather than depending on which shape reaches this call.
  assert.equal(isCurrentAssignee([AD_LME_DIR], AD_LME_DIR), true);
  assert.equal(isCurrentAssignee([AD_LME_DIR], AD_LME), false);
});

test("a malformed assignee entry never matches", () => {
  assert.equal(isCurrentAssignee([null, {}, { uuid: null }], AD_LME), false);
});

test("one match among several co-assignees is enough", () => {
  assert.equal(isCurrentAssignee([{ uuid: AD_LME_SUP }, { uuid: AD_LME_DIR }], AD_LME_DIR), true);
});
