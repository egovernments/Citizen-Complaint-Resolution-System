// Pins how the employee working-context pill names a jurisdiction (#2643):
// boundary names are seeded under the bare code (CITY_001), not ADMIN_CITY_001.
// Run from digit-ui-esbuild/:  node --test tests/workingContextJurisdiction.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../packages/modules/core/src/components/TopBarSideBar/EmployeeWorkingContext.js");
const OUT = path.join(os.tmpdir(), `workingContextJurisdiction.cjs.${process.pid}.js`);
const REACT_STUB = path.join(os.tmpdir(), `workingContextReactStub.${process.pid}.js`);
fs.writeFileSync(REACT_STUB, "module.exports = {};");
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  format: "cjs",
  platform: "node",
  loader: { ".js": "jsx" },
  alias: { react: REACT_STUB },
  outfile: OUT,
  logLevel: "error",
});
process.on("exit", () => {
  for (const f of [OUT, REACT_STUB]) {
    try {
      fs.unlinkSync(f);
    } catch {
      // Best effort; the temp files are process-scoped.
    }
  }
});

const { jurisdictionLabel, boundaryHierarchies, loadBoundaryPacks } = require(OUT);
const dict = (entries) => (key) => entries[key] || key;
const J = { hierarchy: "admin", boundary: "CITY_001", boundaryType: "City" };

test("uses the bare boundary code, as the seeded rows and Create Complaint do", () => {
  assert.equal(jurisdictionLabel(dict({ CITY_001: "Bomet Town" }), J, null, "testj"), "Bomet Town");
});

test("does not read a hierarchy-prefixed key; nothing writes it", () => {
  assert.equal(jurisdictionLabel(dict({ ADMIN_CITY_001: "Bomet Town" }), J, null, "testj"), "CITY_001");
});

test("falls back to the raw code when nothing is seeded", () => {
  assert.equal(jurisdictionLabel(dict({}), J, null, "testj"), "CITY_001");
});

test("a city-wide jurisdiction stored as the tenant code shows the city name", () => {
  const j = { hierarchy: "admin", boundary: "testj" };
  assert.equal(jurisdictionLabel(dict({ TENANT_TESTJ: "Bomet" }), j, { code: "testj", i18nKey: "TENANT_TESTJ" }, "testj"), "Bomet");
});

test("city-wide jurisdictions do not request a boundary pack", () => {
  const js = [{ hierarchy: "workspace", boundary: "testj" }, { hierarchy: "ADMIN", boundary: "CITY_001" }, { hierarchy: "ADMIN", boundary: "W1" }];
  assert.deepEqual(boundaryHierarchies(js, "testj"), ["ADMIN"]);
});

test("loadBoundaryPacks loads the pack once, merges parallel calls, warns on failure and retries", async () => {
  const calls = [];
  let fail = false;
  globalThis.Digit = {
    LocalizationService: {
      getLocale: async (a) => {
        calls.push(a);
        if (fail) throw new Error("401");
      },
    },
  };
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a);
  try {
    const args = { hierarchies: ["ADMIN"], locale: "en_IN", tenantId: "pg" };
    const [a, b] = await Promise.all([loadBoundaryPacks(args), loadBoundaryPacks(args)]);
    await loadBoundaryPacks(args);
    assert.deepEqual([a, b], [true, true]);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { modules: ["rainmaker-boundary-admin"], locale: "en_IN", tenantId: "pg" });

    fail = true;
    const other = { hierarchies: ["REVENUE"], locale: "en_IN", tenantId: "pg" };
    assert.equal(await loadBoundaryPacks(other), false);
    assert.match(String(warns[0][0]), /rainmaker-boundary-revenue.*pg/);
    fail = false;
    assert.equal(await loadBoundaryPacks(other), true);
    assert.equal(calls.length, 3);
  } finally {
    console.warn = origWarn;
    delete globalThis.Digit;
  }
});
