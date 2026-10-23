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

const { jurisdictionLabel } = require(OUT);
const dict = (entries) => (key) => entries[key] || key;
const J = { hierarchy: "admin", boundary: "CITY_001", boundaryType: "City" };

test("uses the bare boundary code, as the seeded rows and Create Complaint do", () => {
  assert.equal(jurisdictionLabel(dict({ CITY_001: "Bomet Town" }), J, null, "testj"), "Bomet Town");
});

test("prefers the bare code over a hierarchy-prefixed key", () => {
  const t = dict({ CITY_001: "Bomet Town", ADMIN_CITY_001: "Other" });
  assert.equal(jurisdictionLabel(t, J, null, "testj"), "Bomet Town");
});

test("falls back to the hierarchy-prefixed key when the bare code is unseeded", () => {
  assert.equal(jurisdictionLabel(dict({ ADMIN_CITY_001: "Bomet Town" }), J, null, "testj"), "Bomet Town");
});

test("falls back to the raw code when nothing is seeded", () => {
  assert.equal(jurisdictionLabel(dict({}), J, null, "testj"), "CITY_001");
});

test("a city-wide jurisdiction stored as the tenant code shows the city name", () => {
  const j = { hierarchy: "admin", boundary: "testj" };
  assert.equal(jurisdictionLabel(dict({ TENANT_TESTJ: "Bomet" }), j, { code: "testj", i18nKey: "TENANT_TESTJ" }, "testj"), "Bomet");
});
