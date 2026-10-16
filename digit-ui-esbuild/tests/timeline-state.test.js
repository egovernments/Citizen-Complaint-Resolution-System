// ours#770: a cancelled or failed timeline query is "failed" (retry / Retry button), never an endless spinner.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const out = path.join(os.tmpdir(), `timeline-state.${process.pid}.cjs.js`);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "../products/pgr/src/utils/timelineState.js")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: out,
  logLevel: "error",
});
process.on("exit", () => {
  try { fs.unlinkSync(out); } catch (_) { /* already removed */ }
});
const { timelineState } = require(out);

test("first fetch in flight: loading", () => {
  assert.equal(timelineState({ isLoading: true, isFetching: true }), "loading");
});

test("a cancelled first fetch (react-query reverts it to idle, no data): failed", () => {
  assert.equal(timelineState({ isLoading: false, isFetching: false, isIdle: true, data: undefined }), "failed");
});

test("an errored fetch without data: failed; while its retry runs: loading", () => {
  assert.equal(timelineState({ isError: true, isFetching: false }), "failed");
  assert.equal(timelineState({ isError: true, isFetching: true }), "loading");
});

test("data wins, also during a background refetch or after a later error", () => {
  const data = { timeline: [] };
  assert.equal(timelineState({ data }), "ready");
  assert.equal(timelineState({ data, isFetching: true }), "ready");
  assert.equal(timelineState({ data, isError: true }), "ready");
});
