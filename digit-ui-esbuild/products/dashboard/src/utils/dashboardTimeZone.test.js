// Unit tests for the deterministic, zone-safe calendar-date math backing the
// dashboard's default date-range filters (#29 timezone addendum).
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/utils/dashboardTimeZone.test.js
//
// dashboardTimeZone.js is ESM (like the rest of products/), so the test
// bundles it to CJS with the repo's own esbuild — same idiom as
// hierLevelGrouping.test.js / numberFormat.test.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "dashboardTimeZone.js");
const OUT = path.join(os.tmpdir(), `dashboardTimeZone.cjs.${process.pid}.js`);

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

const {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  resolveConfiguredTimeZone,
  zonedYMD,
  oneMonthEarlierYMD,
} = require(OUT);

/* ------------------------------------------------------------------ */
/* Validation / fallback                                               */
/* ------------------------------------------------------------------ */

test("DEFAULT_TIME_ZONE matches the backend's migration-compatibility default", () => {
  assert.equal(DEFAULT_TIME_ZONE, "Africa/Nairobi");
});

test("isValidTimeZone: valid IANA ids accepted, garbage rejected", () => {
  assert.equal(isValidTimeZone("Africa/Nairobi"), true);
  assert.equal(isValidTimeZone("Africa/Maputo"), true);
  assert.equal(isValidTimeZone("Asia/Kolkata"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone("   "), false);
  assert.equal(isValidTimeZone(null), false);
  assert.equal(isValidTimeZone(undefined), false);
  assert.equal(isValidTimeZone(42), false);
});

test("resolveConfiguredTimeZone: falls back to Africa/Nairobi when missing/invalid", () => {
  assert.equal(resolveConfiguredTimeZone({ timeZone: "Asia/Kolkata" }), "Asia/Kolkata");
  assert.equal(resolveConfiguredTimeZone({ timeZone: "  Africa/Maputo  " }), "Africa/Maputo");
  assert.equal(resolveConfiguredTimeZone({ timeZone: "bogus" }), DEFAULT_TIME_ZONE);
  assert.equal(resolveConfiguredTimeZone({ timeZone: "" }), DEFAULT_TIME_ZONE);
  assert.equal(resolveConfiguredTimeZone({}), DEFAULT_TIME_ZONE);
  assert.equal(resolveConfiguredTimeZone(null), DEFAULT_TIME_ZONE);
  assert.equal(resolveConfiguredTimeZone(undefined), DEFAULT_TIME_ZONE);
});

/* ------------------------------------------------------------------ */
/* zonedYMD                                                             */
/* ------------------------------------------------------------------ */

test("zonedYMD: Africa/Nairobi (UTC+3) vs Africa/Maputo (UTC+2) disagree around midnight", () => {
  const instant = Date.UTC(2026, 2, 1, 21, 30, 0); // 2026-03-01T21:30:00Z
  assert.equal(zonedYMD(instant, "Africa/Nairobi"), "2026-03-02");
  assert.equal(zonedYMD(instant, "Africa/Maputo"), "2026-03-01");
});

test("zonedYMD: Asia/Kolkata half-hour offset", () => {
  const instant = Date.UTC(2026, 0, 15, 18, 35, 0); // 2026-01-15T18:35:00Z
  assert.equal(zonedYMD(instant, "Asia/Kolkata"), "2026-01-16");
  assert.equal(zonedYMD(instant, "UTC"), "2026-01-15");
});

test("zonedYMD: invalid zone falls back to Africa/Nairobi rather than throwing", () => {
  const instant = Date.UTC(2026, 2, 1, 21, 30, 0);
  assert.equal(zonedYMD(instant, "Not/AZone"), zonedYMD(instant, "Africa/Nairobi"));
});

test("zonedYMD: accepts a Date instance too", () => {
  const d = new Date(Date.UTC(2026, 5, 10, 12, 0, 0));
  assert.equal(zonedYMD(d, "UTC"), "2026-06-10");
});

/* ------------------------------------------------------------------ */
/* oneMonthEarlierYMD — month-end clamp / leap year / zone-derived day */
/* ------------------------------------------------------------------ */

test("oneMonthEarlierYMD: clamps end-of-month into a non-leap February", () => {
  const instant = Date.UTC(2026, 2, 31, 12, 0, 0); // 2026-03-31 UTC noon
  assert.equal(oneMonthEarlierYMD(instant, "UTC"), "2026-02-28");
});

test("oneMonthEarlierYMD: clamps to Feb 29 in a leap year", () => {
  const instant = Date.UTC(2024, 2, 31, 12, 0, 0); // 2024-03-31 UTC noon
  assert.equal(oneMonthEarlierYMD(instant, "UTC"), "2024-02-29");
});

test("oneMonthEarlierYMD: crosses a year boundary (Jan -> prior Dec)", () => {
  const instant = Date.UTC(2026, 0, 31, 12, 0, 0); // 2026-01-31
  assert.equal(oneMonthEarlierYMD(instant, "UTC"), "2025-12-31");
});

test("oneMonthEarlierYMD: no clamp needed on a mid-month date", () => {
  const instant = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15
  assert.equal(oneMonthEarlierYMD(instant, "UTC"), "2026-05-15");
});

test("oneMonthEarlierYMD: computed from the ZONED calendar day, not UTC's", () => {
  // 2026-03-01T21:30:00Z is already 2026-03-02 local in Nairobi (UTC+3) — one
  // month earlier in Nairobi's calendar is 2026-02-02, not a UTC-day-derived value.
  const instant = Date.UTC(2026, 2, 1, 21, 30, 0);
  assert.equal(oneMonthEarlierYMD(instant, "Africa/Nairobi"), "2026-02-02");
});

test("oneMonthEarlierYMD: invalid zone falls back to Africa/Nairobi rather than throwing", () => {
  const instant = Date.UTC(2026, 2, 31, 12, 0, 0);
  assert.equal(
    oneMonthEarlierYMD(instant, "Not/AZone"),
    oneMonthEarlierYMD(instant, "Africa/Nairobi")
  );
});
