// Pins the citizen's My Complaints inbox: status tones, what a search keeps,
// the order, and paging.
// Run from digit-ui-esbuild/:  node --test tests/citizenComplaints.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/utils/citizenComplaints.js");
const OUT = path.join(os.tmpdir(), `citizenComplaints.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});
const { matchesComplaintQuery, pageOf, searchComplaints, statusTone } = require(OUT);

const rows = [
  { id: "PG-PGR-2026-09-28-004377", concern: "Broken water pipe / Leakage", category: "Water and Sewage", description: "Main pipe burst outside Makongeni market", createdTime: 2 },
  { id: "PG-PGR-2026-09-30-004512", concern: "Garbage needs to be cleared", category: "Garbage", description: "Not collected on Kenyatta Avenue for two weeks", createdTime: 3 },
  { id: "PG-PGR-2026-09-24-004101", concern: "Streetlight not working", category: "Street Lights", description: "Three lights on Jogoo Road are off", createdTime: 1 },
];

test("status tones: open until closed, rejected kept apart", () => {
  assert.equal(statusTone("PENDINGFORASSIGNMENT"), "open");
  assert.equal(statusTone("PENDINGATLME"), "open");
  assert.equal(statusTone("RESOLVED"), "closed");
  assert.equal(statusTone("CLOSEDAFTERRESOLUTION"), "closed");
  assert.equal(statusTone("REJECTED"), "rejected");
  assert.equal(statusTone("CLOSEDAFTERREJECTION"), "rejected");
});

test("a search matches the complaint number, the description, the concern or the category", () => {
  assert.equal(matchesComplaintQuery(rows[1], "004512"), true);
  assert.equal(matchesComplaintQuery(rows[1], "pg-pgr-2026-09-30"), true);
  assert.equal(matchesComplaintQuery(rows[1], "kenyatta"), true);
  assert.equal(matchesComplaintQuery(rows[0], "LEAKAGE"), true);
  assert.equal(matchesComplaintQuery(rows[2], "street lights"), true);
  // Every word, anywhere, in any order.
  assert.equal(matchesComplaintQuery(rows[0], "makongeni pipe"), true);
  assert.equal(matchesComplaintQuery(rows[0], "makongeni garbage"), false);
  // Nothing typed keeps everything.
  assert.equal(matchesComplaintQuery(rows[0], "   "), true);
});

test("results come newest first", () => {
  assert.deepEqual(searchComplaints(rows, "").map((r) => r.createdTime), [3, 2, 1]);
  assert.deepEqual(searchComplaints(rows, "road").map((r) => r.id), ["PG-PGR-2026-09-24-004101"]);
  assert.deepEqual(searchComplaints(undefined, "x"), []);
});

test("paging clamps into range and reports the span shown", () => {
  const many = Array.from({ length: 23 }, (_, i) => ({ id: String(i) }));
  assert.deepEqual(pageOf(many, 1, 10).rows.map((r) => r.id), ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  const last = pageOf(many, 3, 10);
  assert.deepEqual([last.page, last.pages, last.from, last.to, last.total, last.rows.length], [3, 3, 21, 23, 23, 3]);
  // A search that leaves one page pulls a later page number back into range.
  assert.equal(pageOf(many.slice(0, 4), 3, 10).page, 1);
  const none = pageOf([], 1, 10);
  assert.deepEqual([none.page, none.pages, none.from, none.to, none.total], [1, 1, 0, 0, 0]);
});
