// Pins complaint dates to the user's language (#2445): English keeps
// d-MMM-yyyy, other languages get their own month names.
// Run from digit-ui-esbuild/:  node --test tests/localeDate.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/utils/localeDate.js");
const OUT = path.join(os.tmpdir(), `localeDate.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "node", outfile: OUT, logLevel: "error" });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});

const { formatLocaleDate, formatLocaleParts, intlLocale } = require(OUT);
const OCT_13 = new Date(2026, 9, 13, 10, 42).getTime();

test("English keeps the d-MMM-yyyy the PGR screens already show", () => {
  assert.equal(formatLocaleDate(OCT_13, "en_IN"), "13-Oct-2026");
  assert.equal(formatLocaleDate(OCT_13), "13-Oct-2026");
});

test("French and Portuguese use their own date format", () => {
  assert.match(formatLocaleDate(OCT_13, "fr_FR"), /^13 oct\.? 2026$/);
  // ICU's pt-PT short date is numeric (13/10/2026): Portuguese order, no English month.
  assert.match(formatLocaleDate(OCT_13, "pt_PT"), /^13.*2026$/);
  for (const locale of ["fr_FR", "pt_PT"]) assert.doesNotMatch(formatLocaleDate(OCT_13, locale), /Oct/);
});

test("no timestamp gives an empty string and a bad locale falls back to English", () => {
  assert.equal(formatLocaleDate(undefined, "fr_FR"), "");
  assert.equal(formatLocaleDate(OCT_13, "not a locale"), "13-Oct-2026");
});

test("parts use the DIGIT locale code as an Intl tag", () => {
  assert.equal(intlLocale("pt_PT"), "pt-PT");
  assert.match(formatLocaleParts(OCT_13, { month: "long" }, "date", "fr_FR"), /octobre/);
  assert.equal(formatLocaleParts(OCT_13, { hour: "2-digit", minute: "2-digit" }, "time", "fr_FR"), "10:42");
});
