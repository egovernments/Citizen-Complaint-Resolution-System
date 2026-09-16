const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const out = path.join(os.tmpdir(), `format-updated-ago.${process.pid}.cjs`);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "formatUpdatedAgo.js")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: out,
  logLevel: "silent",
});
const { updatedAgoParts, formatUpdatedAgoLabel } = require(out);

const t = (key, seed) => seed;
const now = Date.UTC(2026, 8, 13, 12, 0, 0);

test("updatedAgoParts buckets just now / min / hrs / days", () => {
  assert.deepEqual(updatedAgoParts(now - 30_000, now), { unit: "justNow", n: 0 });
  assert.deepEqual(updatedAgoParts(now - 5 * 60_000, now), { unit: "min", n: 5 });
  assert.deepEqual(updatedAgoParts(now - 90 * 60_000, now), { unit: "hrs", n: 1 });
  assert.deepEqual(updatedAgoParts(now - 5 * 3600_000, now), { unit: "hrs", n: 5 });
  assert.deepEqual(updatedAgoParts(now - 24 * 3600_000, now), { unit: "days", n: 1 });
  assert.deepEqual(updatedAgoParts(now - 100 * 3600_000, now), { unit: "days", n: 4 });
});

test("formatUpdatedAgoLabel builds issue-shaped copy with singular forms", () => {
  assert.equal(formatUpdatedAgoLabel(now - 30_000, t, now), "just now");
  assert.equal(formatUpdatedAgoLabel(now - 12 * 60_000, t, now), "12 min ago");
  assert.equal(formatUpdatedAgoLabel(now - 1 * 3600_000, t, now), "1 hr ago");
  assert.equal(formatUpdatedAgoLabel(now - 3 * 3600_000, t, now), "3 hrs ago");
  assert.equal(formatUpdatedAgoLabel(now - 24 * 3600_000, t, now), "1 day ago");
  assert.equal(formatUpdatedAgoLabel(now - 100 * 3600_000, t, now), "4 days ago");
});

test("formatUpdatedAgoLabel returns null for missing asOf", () => {
  assert.equal(formatUpdatedAgoLabel(null, t, now), null);
});
