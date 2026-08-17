// Unit tests for buildDefaultFilters / hasActiveFilters (#29 timezone addendum,
// review fix): date defaults must resolve from the RESOLVED dashboard timeZone at
// call time, never a module-load browser-clock snapshot. Pins non-Nairobi
// active/clear/default behavior right at a UTC midnight crossing, where a
// zone-blind implementation and a zone-correct one disagree.
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/config/globalFilterGroups.test.js
//
// globalFilterGroups.js is ESM (like the rest of products/), so the test bundles it to
// CJS with the repo's own esbuild — same idiom as dashboardTimeZone.test.js.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "globalFilterGroups.js");
const OUT = path.join(os.tmpdir(), `globalFilterGroups.cjs.${process.pid}.js`);

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

const { buildDefaultFilters, hasActiveFilters } = require(OUT);

// clearDashboardFilters (config/dashboardFilters.js) is a thin buildDefaultFilters(timeZone)
// wrapper — bundled separately here since it also pulls in dashboardConfig.js's
// localStorage-key helpers (unused by clearDashboardFilters itself, but present at
// import time), keeping this file's own bundle free of that dependency.
const CLEAR_ENTRY = path.join(__dirname, "..", "config", "dashboardFilters.js");
const CLEAR_OUT = path.join(os.tmpdir(), `dashboardFilters.cjs.${process.pid}.js`);
esbuild.buildSync({
  entryPoints: [CLEAR_ENTRY],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: CLEAR_OUT,
});
process.on("exit", () => {
  try {
    fs.unlinkSync(CLEAR_OUT);
  } catch (e) {
    /* already gone */
  }
});
const { clearDashboardFilters } = require(CLEAR_OUT);

// 2026-03-01T21:30:00Z: already 2026-03-02 local in Africa/Nairobi (UTC+3) but
// still 2026-03-01 local in Africa/Maputo (UTC+2) — see dashboardTimeZone.test.js's
// zonedYMD coverage of the same instant. Pinning "now" here (rather than trusting
// module-load state) is what proves the fix: no code under test may read a
// pre-computed default that was frozen at a different instant/zone.
const NEAR_MIDNIGHT_UTC_MS = Date.UTC(2026, 2, 1, 21, 30, 0);

let RealDate;

before(() => {
  RealDate = global.Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(NEAR_MIDNIGHT_UTC_MS);
      else super(...args);
    }
    static now() {
      return NEAR_MIDNIGHT_UTC_MS;
    }
  }
  global.Date = FakeDate;
});

after(() => {
  global.Date = RealDate;
});

test("buildDefaultFilters: Maputo and Nairobi disagree on 'today' at the same instant", () => {
  const maputo = buildDefaultFilters("Africa/Maputo");
  const nairobi = buildDefaultFilters("Africa/Nairobi");
  assert.equal(maputo.dateTo, "2026-03-01");
  assert.equal(maputo.dateFrom, "2026-02-01");
  assert.equal(nairobi.dateTo, "2026-03-02");
  assert.equal(nairobi.dateFrom, "2026-02-02");
});

test("buildDefaultFilters: unresolved/invalid timeZone falls back to Nairobi, not browser local", () => {
  const noZone = buildDefaultFilters(undefined);
  const bogusZone = buildDefaultFilters("Not/AZone");
  const nairobi = buildDefaultFilters("Africa/Nairobi");
  assert.deepEqual(noZone, nairobi);
  assert.deepEqual(bogusZone, nairobi);
});

test("hasActiveFilters: filters equal to the SAME zone's defaults are inactive", () => {
  const maputoDefaults = buildDefaultFilters("Africa/Maputo");
  assert.equal(hasActiveFilters(maputoDefaults, "Africa/Maputo"), false);
});

test("hasActiveFilters: another zone's default date range reads as an active filter", () => {
  // A Nairobi-shaped filter set evaluated against Maputo's resolved zone must NOT be
  // silently treated as "no filter applied" — this is the exact confusion a
  // module-load (single fixed zone) default would produce.
  const nairobiDefaults = buildDefaultFilters("Africa/Nairobi");
  assert.equal(hasActiveFilters(nairobiDefaults, "Africa/Maputo"), true);
});

test("hasActiveFilters: null/undefined filters (not yet loaded) are inactive", () => {
  assert.equal(hasActiveFilters(null, "Africa/Maputo"), false);
  assert.equal(hasActiveFilters(undefined, "Africa/Maputo"), false);
});

test("hasActiveFilters: a manually widened date range against the resolved zone is active", () => {
  const defaults = buildDefaultFilters("Africa/Maputo");
  const widened = { ...defaults, dateFrom: "2020-01-01" };
  assert.equal(hasActiveFilters(widened, "Africa/Maputo"), true);
});

test("clearDashboardFilters: resets to the RESOLVED zone's default, not a stale/browser one", () => {
  assert.deepEqual(clearDashboardFilters("Africa/Maputo"), buildDefaultFilters("Africa/Maputo"));
  const cleared = clearDashboardFilters("Africa/Maputo");
  assert.equal(cleared.dateTo, "2026-03-01");
  assert.equal(hasActiveFilters(cleared, "Africa/Maputo"), false);
});
