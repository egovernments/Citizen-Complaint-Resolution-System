// Pins the translated "Select <field>" placeholder and its English fallback.
// Run from digit-ui-esbuild/:  node --test tests/selectPlaceholder.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/utils/selectPlaceholder.js");
const OUT = path.join(os.tmpdir(), `selectPlaceholder.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});
const { selectPlaceholder, translateOr } = require(OUT);

// i18next hands a missing key back unchanged.
const tFrom = (table) => (key) => (key in table ? table[key] : key);

test("the verb is translated along with the field", () => {
  const t = tFrom({ ES_CREATECOMPLAINT_SELECT_PLACEHOLDER: "Selecionar" });
  assert.equal(selectPlaceholder(t, "Condado"), "Selecionar Condado");
});

test("a locale without the key keeps today's English", () => {
  assert.equal(selectPlaceholder(tFrom({}), "County"), "Select County");
});

test("translateOr falls back on a missing or empty value", () => {
  assert.equal(translateOr(tFrom({}), "CS_COMMON_FILTER", "Filter"), "Filter");
  assert.equal(translateOr(tFrom({ CS_COMMON_FILTER: "" }), "CS_COMMON_FILTER", "Filter"), "Filter");
  assert.equal(translateOr(tFrom({ CS_COMMON_FILTER: "Chuja" }), "CS_COMMON_FILTER", "Filter"), "Chuja");
});
