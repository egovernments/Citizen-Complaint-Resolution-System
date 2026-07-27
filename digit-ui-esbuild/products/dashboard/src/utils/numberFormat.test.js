// Unit tests for the per-locale number-format mask (#1213, per-locale per #1272).
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/utils/numberFormat.test.js
//
// numberFormat.js is ESM (like the rest of products/), so the test bundles it
// to CJS with the repo's own esbuild and reloads it per test for fresh module
// state — the same idiom as src/services/dashboardMetrics.test.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "numberFormat.js");
const OUT = path.join(os.tmpdir(), `numberFormat.cjs.${process.pid}.js`);

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
  } catch (e) {
    /* already gone */
  }
});

function load() {
  delete require.cache[require.resolve(OUT)];
  return require(OUT);
}

/* ------------------------------------------------------------------ */
/* parseMask — R1: placeholders stripped BEFORE separator detection    */
/* ------------------------------------------------------------------ */

test("parseMask #,##0.00 (en) -> comma group, dot decimal, 2 decimals", () => {
  const { parseMask } = load();
  assert.deepEqual(parseMask("#,##0.00"), { group: ",", decimal: ".", decimals: 2 });
});

test("parseMask #.##0,00 (pt) -> dot group, comma decimal, 2 decimals", () => {
  const { parseMask } = load();
  assert.deepEqual(parseMask("#.##0,00"), { group: ".", decimal: ",", decimals: 2 });
});

test("parseMask '# ##0,00' (fr) -> space group, comma decimal, 2 decimals", () => {
  const { parseMask } = load();
  assert.deepEqual(parseMask("# ##0,00"), { group: " ", decimal: ",", decimals: 2 });
});

test("parseMask #,##0 -> group-only, 0 decimals", () => {
  const { parseMask } = load();
  const parsed = parseMask("#,##0");
  assert.equal(parsed.group, ",");
  assert.equal(parsed.decimals, 0);
});

test("parseMask 0,00 -> no grouping, comma decimal, 2 decimals", () => {
  const { parseMask } = load();
  assert.deepEqual(parseMask("0,00"), { group: "", decimal: ",", decimals: 2 });
});

test("parseMask repeated identical separator #,###,##0 -> grouping only", () => {
  const { parseMask } = load();
  const parsed = parseMask("#,###,##0");
  assert.equal(parsed.group, ",");
  assert.equal(parsed.decimals, 0);
});

test("parseMask rejects garbage / empty / non-string masks", () => {
  const { parseMask } = load();
  assert.equal(parseMask(""), null);
  assert.equal(parseMask("   "), null);
  assert.equal(parseMask(null), null);
  assert.equal(parseMask(undefined), null);
  assert.equal(parseMask(42), null);
  assert.equal(parseMask("abc"), null);
  assert.equal(parseMask("#,##0.00%"), null); // unit chars are NOT mask material
  assert.equal(parseMask(".,"), null); // separators only — not a mask
});

/* ------------------------------------------------------------------ */
/* formatNumber — null when unmasked; separators-only when masked      */
/* ------------------------------------------------------------------ */

test("formatNumber returns null when no mask is configured", () => {
  const { formatNumber } = load();
  assert.equal(formatNumber(52560, "integer"), null);
  assert.equal(formatNumber(56.5, { decimals: 1 }), null);
});

test("formatNumber returns null after an invalid mask is set", () => {
  const { setNumberFormatMask, formatNumber } = load();
  setNumberFormatMask("total garbage");
  assert.equal(formatNumber(52560, "integer"), null);
});

test("formatNumber under #.##0,00 — the reference smoke pair", () => {
  const { setNumberFormatMask, formatNumber } = load();
  setNumberFormatMask("#.##0,00");
  assert.equal(formatNumber(52560, "integer"), "52.560");
  assert.equal(formatNumber(56.5, "percentOneDecimal"), "56,5"); // % suffix stays at call site
});

test("formatNumber under #.##0,00 — decimals, grouping, sign, trim", () => {
  const { setNumberFormatMask, formatNumber } = load();
  setNumberFormatMask("#.##0,00");
  assert.equal(formatNumber(1234567.891, { decimals: 2 }), "1.234.567,89");
  assert.equal(formatNumber(-1234.5, { decimals: 1 }), "-1.234,5");
  assert.equal(formatNumber(2, { decimals: 1, trim: true }), "2");
  assert.equal(formatNumber(2.5, { decimals: 1, trim: true }), "2,5");
  assert.equal(formatNumber(56, { decimals: 1 }), "56,0"); // no trim -> toFixed parity
  assert.equal(formatNumber(0, { decimals: 0 }), "0");
});

test("formatNumber under #,##0.00 (en) and '# ##0,00' (fr)", () => {
  const { setNumberFormatMask, formatNumber } = load();
  setNumberFormatMask("#,##0.00");
  assert.equal(formatNumber(52560, "integer"), "52,560");
  assert.equal(formatNumber(1234.56, { decimals: 2 }), "1,234.56");
  setNumberFormatMask("# ##0,00");
  assert.equal(formatNumber(52560, "integer"), "52 560");
  assert.equal(formatNumber(1234.5, { decimals: 1 }), "1 234,5");
});

test("formatNumber under group-only mask #,##0 still honors caller decimals", () => {
  const { setNumberFormatMask, formatNumber } = load();
  setNumberFormatMask("#,##0");
  assert.equal(formatNumber(52560, { decimals: 0 }), "52,560");
  assert.equal(formatNumber(2.5, { decimals: 1 }), "2.5"); // fallback decimal sep never collides with group
});

test("formatNumber under decimal-only mask 0,00 never groups", () => {
  const { setNumberFormatMask, formatNumber } = load();
  setNumberFormatMask("0,00");
  assert.equal(formatNumber(52560, { decimals: 2 }), "52560,00");
});

test("formatNumber returns null for non-finite values even when masked", () => {
  const { setNumberFormatMask, formatNumber } = load();
  setNumberFormatMask("#.##0,00");
  assert.equal(formatNumber(NaN, "integer"), null);
  assert.equal(formatNumber(Infinity, "integer"), null);
  assert.equal(formatNumber("not a number", "integer"), null);
  assert.equal(formatNumber(null, "integer"), null);
});

test("setNumberFormatMask(null) clears back to unconfigured", () => {
  const { setNumberFormatMask, formatNumber } = load();
  setNumberFormatMask("#.##0,00");
  assert.equal(formatNumber(1, "integer"), "1");
  setNumberFormatMask(null);
  assert.equal(formatNumber(1, "integer"), null);
});

/* ------------------------------------------------------------------ */
/* resolveNumberFormatMask — per-locale resolution (#1272)             */
/* ------------------------------------------------------------------ */

const LOCALE_MASKS = {
  en_IN: "#,##0.00",
  pt_PT: "#.##0,00",
  fr_FR: "# ##0,00",
  default: "#,##0.00",
};

test("resolveNumberFormatMask object form: exact locale match wins", () => {
  const { resolveNumberFormatMask } = load();
  assert.equal(resolveNumberFormatMask(LOCALE_MASKS, "en_IN"), "#,##0.00");
  assert.equal(resolveNumberFormatMask(LOCALE_MASKS, "pt_PT"), "#.##0,00");
  assert.equal(resolveNumberFormatMask(LOCALE_MASKS, "fr_FR"), "# ##0,00");
});

test("resolveNumberFormatMask object form: unknown locale falls back to default", () => {
  const { resolveNumberFormatMask } = load();
  assert.equal(resolveNumberFormatMask(LOCALE_MASKS, "sw_KE"), "#,##0.00");
  assert.equal(resolveNumberFormatMask(LOCALE_MASKS, undefined), "#,##0.00");
  assert.equal(resolveNumberFormatMask(LOCALE_MASKS, null), "#,##0.00");
});

test("resolveNumberFormatMask object form without default: unknown locale -> null", () => {
  const { resolveNumberFormatMask } = load();
  const noDefault = { pt_PT: "#.##0,00" };
  assert.equal(resolveNumberFormatMask(noDefault, "pt_PT"), "#.##0,00");
  assert.equal(resolveNumberFormatMask(noDefault, "en_IN"), null);
});

test("resolveNumberFormatMask string legacy form: same mask for every locale", () => {
  const { resolveNumberFormatMask } = load();
  assert.equal(resolveNumberFormatMask("#.##0,00", "en_IN"), "#.##0,00");
  assert.equal(resolveNumberFormatMask("#.##0,00", "fr_FR"), "#.##0,00");
  assert.equal(resolveNumberFormatMask("#.##0,00", undefined), "#.##0,00");
});

test("resolveNumberFormatMask malformed values -> null (unconfigured)", () => {
  const { resolveNumberFormatMask } = load();
  assert.equal(resolveNumberFormatMask(undefined, "en_IN"), null);
  assert.equal(resolveNumberFormatMask(null, "en_IN"), null);
  assert.equal(resolveNumberFormatMask(42, "en_IN"), null);
  assert.equal(resolveNumberFormatMask(["#,##0.00"], "en_IN"), null);
  assert.equal(resolveNumberFormatMask({}, "en_IN"), null);
  // non-string entries never resolve, for the locale or the default
  assert.equal(resolveNumberFormatMask({ en_IN: 7 }, "en_IN"), null);
  assert.equal(resolveNumberFormatMask({ default: { nested: true } }, "en_IN"), null);
});

test("language switch flips separators end-to-end (bomet en/pt/fr conventions)", () => {
  const { resolveNumberFormatMask, setNumberFormatMask, formatNumber } = load();
  const prime = (language) =>
    setNumberFormatMask(resolveNumberFormatMask(LOCALE_MASKS, language));

  prime("en_IN");
  assert.equal(formatNumber(12348248, { decimals: 2 }), "12,348,248.00");
  prime("pt_PT"); // simulated TopBar language switch -> AdminDashboard re-prime
  assert.equal(formatNumber(12348248, { decimals: 2 }), "12.348.248,00");
  prime("fr_FR");
  assert.equal(formatNumber(12348248, { decimals: 2 }), "12 348 248,00");
  prime("en_IN"); // and back
  assert.equal(formatNumber(12348248, { decimals: 2 }), "12,348,248.00");
});

test("getNumberFormatStamp tracks the resolved mask string across switches", () => {
  const { resolveNumberFormatMask, setNumberFormatMask, getNumberFormatStamp } = load();
  assert.equal(getNumberFormatStamp(), null);
  setNumberFormatMask(resolveNumberFormatMask(LOCALE_MASKS, "en_IN"));
  assert.equal(getNumberFormatStamp(), "#,##0.00");
  setNumberFormatMask(resolveNumberFormatMask(LOCALE_MASKS, "fr_FR"));
  assert.equal(getNumberFormatStamp(), "# ##0,00");
  setNumberFormatMask(null);
  assert.equal(getNumberFormatStamp(), null);
});
