// #2675: the complaint success page must not promise SMS/WhatsApp.
// Run from digit-ui-esbuild/:  node --test tests/trackComplaintText.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/utils/trackComplaintText.js");
const OUT = path.join(os.tmpdir(), `trackComplaintText.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort.
  }
});
const { trackComplaintText, TRACK_COMPLAINT_TEXT_KEY } = require(OUT);

test("falls back to channel-neutral English when the tenant has no row", () => {
  const text = trackComplaintText((k) => k);
  assert.match(text, /track the complaint/);
  assert.doesNotMatch(text, /mobile number|SMS|WhatsApp|sent to/i);
});

test("uses the localized row when present", () => {
  assert.equal(trackComplaintText((k) => (k === TRACK_COMPLAINT_TEXT_KEY ? "Localized" : k)), "Localized");
});

test("neither success page uses the old SMS-promising key or text", () => {
  for (const f of ["pages/citizen/Response.js", "pages/employee/CreateComplaint/createComplaintForm.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "../products/pgr/src", f), "utf8");
    assert.doesNotMatch(src, /CS_COMMON_TRACK_COMPLAINT_TEXT|registered mobile number/);
  }
});
