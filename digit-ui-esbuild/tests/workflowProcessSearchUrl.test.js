// Which endpoint the complaint timeline is read from, per caller (#2846).
// Run from digit-ui-esbuild/:  node --test tests/workflowProcessSearchUrl.test.js
//
// workflowProcessSearchUrl.js is ESM, so the test bundles it to CJS with the
// repo's own esbuild (same idiom as products/dashboard/src/services/dashboardMetrics.test.js)
// and drives it through a stubbed `Digit.UserService`.
//
// The assertions that matter are the citizen ones: a citizen token must never be
// pointed at the raw workflow search, whatever else is in storage.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../packages/libraries/src/services/elements/workflowProcessSearchUrl.js");
const OUT = path.join(os.tmpdir(), `workflowProcessSearchUrl.cjs.${process.pid}.js`);

esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch (e) {
    /* already gone */
  }
});

const RAW = "/egov-workflow-v2/egov-wf/process/_search";
const CHRONOLOGY = "/pgr-services/v2/request/_chronology";

function load(user) {
  global.window = { globalConfigs: { getConfig: () => undefined } }; // urls.js reads it at import time
  global.Digit = { UserService: { getUser: () => user } };
  delete require.cache[OUT];
  return require(OUT).processSearchUrl;
}

test("a citizen token reads a complaint's history through the chronology endpoint", () => {
  const url = load({ access_token: "t", info: { type: "CITIZEN" } });
  assert.equal(url("PGR"), CHRONOLOGY);
});

test("an employee token keeps the raw workflow search for complaints", () => {
  const url = load({ access_token: "t", info: { type: "EMPLOYEE" } });
  assert.equal(url("PGR"), RAW);
});

test("no signed-in user is treated like a citizen, never like staff", () => {
  assert.equal(load(null)("PGR"), CHRONOLOGY);
  assert.equal(load({})("PGR"), CHRONOLOGY);
  assert.equal(load({ info: {} })("PGR"), CHRONOLOGY);
});

test("other modules' workflows stay on the raw search for every caller", () => {
  assert.equal(load({ info: { type: "CITIZEN" } })("FSM"), RAW);
  assert.equal(load({ info: { type: "EMPLOYEE" } })("BS.AMENDMENT"), RAW);
  assert.equal(load(null)(undefined), RAW);
});
