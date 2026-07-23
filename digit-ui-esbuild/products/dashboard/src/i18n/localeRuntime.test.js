// Regression: i18next.exists/t with fallbackLng:false STILL returns English
// when the active locale is missing the key. localeRuntime must use
// getResource (and/or the side-cache), never exists/t (#1108).
//
// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/i18n/localeRuntime.test.js

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

function bundle() {
  const out = path.join(os.tmpdir(), `localeRuntime.cjs.${process.pid}.js`);
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, "localeRuntime.js")],
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
  delete require.cache[out];
  return require(out);
}

beforeEach(() => {
  delete global.window;
});

afterEach(() => {
  delete global.window;
});

test("translate ignores i18next en_IN bleed when pt_PT lacks the key", () => {
  const bags = {
    en_IN: { DASHBOARD_FILTERS_ALL_WARDS: "All wards" },
    pt_PT: {},
  };
  global.window = {
    localStorage: {
      getItem: (k) => (k === "Employee.locale" ? "pt_PT" : null),
    },
    i18next: {
      language: "pt_PT",
      options: { defaultNS: "translations" },
      // Deliberately broken the way real i18next is: exists/t return English.
      exists: () => true,
      t: () => "All wards",
      getResource: (lng, _ns, key) => bags[lng]?.[key],
      on() {},
      off() {},
      store: { on() {}, off() {} },
    },
    globalConfigs: { getConfig: () => "ADMIN" },
  };
  const { translate, exists } = bundle();
  assert.equal(exists("DASHBOARD_FILTERS_ALL_WARDS"), false);
  assert.equal(
    translate("DASHBOARD_FILTERS_ALL_WARDS", "All wards"),
    "DASHBOARD_FILTERS_ALL_WARDS",
    "must echo the key, not English"
  );
});

test("translate returns Portuguese when getResource has the pt_PT message", () => {
  const bags = {
    en_IN: { DASHBOARD_FILTERS_ALL_WARDS: "All wards" },
    pt_PT: { DASHBOARD_FILTERS_ALL_WARDS: "Todos os bairros" },
  };
  global.window = {
    localStorage: {
      getItem: (k) => (k === "Employee.locale" ? "pt_PT" : null),
    },
    i18next: {
      language: "pt_PT",
      options: { defaultNS: "translations" },
      exists: () => true,
      t: () => "All wards", // would bleed if we called it
      getResource: (lng, _ns, key) => bags[lng]?.[key],
      on() {},
      off() {},
      store: { on() {}, off() {} },
    },
    globalConfigs: { getConfig: () => "ADMIN" },
  };
  const { translate } = bundle();
  assert.equal(translate("DASHBOARD_FILTERS_ALL_WARDS"), "Todos os bairros");
});
