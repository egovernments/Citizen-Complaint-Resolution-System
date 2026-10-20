// Pins who the complaint timelines show as the filer of a WhatsApp complaint
// (#2503): the complainant, never the chatbot's service account.
// Run from digit-ui-esbuild/:  node --test tests/filedBy.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/utils/filedBy.js");
const OUT = path.join(os.tmpdir(), `filedBy.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});
const { channelFiler, isFiledThroughChannel } = require(OUT);

const citizen = { uuid: "c-1", name: "Asha", mobileNumber: "712345679" };

test("a web complaint keeps the workflow's own actor", () => {
  assert.equal(channelFiler({ source: "web", citizen }), null);
  assert.equal(channelFiler({ citizen }), null);
  assert.equal(channelFiler(undefined), null);
});

test("a WhatsApp complaint shows the complainant's name and mobile", () => {
  assert.deepEqual(channelFiler({ source: "whatsapp", citizen }), { name: "Asha", mobileNumber: "712345679" });
  assert.equal(isFiledThroughChannel({ source: "WhatsApp" }), true);
});

test("a confidential WhatsApp complaint shows the name only", () => {
  const service = { source: "whatsapp", citizen, extendedAttributes: { isConfidential: true } };
  assert.deepEqual(channelFiler(service), { name: "Asha", mobileNumber: null });
});

test("a non-confidential WhatsApp complaint still shows the mobile", () => {
  const service = { source: "whatsapp", citizen, extendedAttributes: { isConfidential: false } };
  assert.deepEqual(channelFiler(service), { name: "Asha", mobileNumber: "712345679" });
});

test("details pgr-services redacted stay hidden, with no fallback to the bot account", () => {
  const service = { source: "whatsapp", citizen: { uuid: "c-1", name: null, mobileNumber: null } };
  assert.deepEqual(channelFiler(service), { name: null, mobileNumber: null });
  assert.deepEqual(channelFiler({ source: "whatsapp" }), { name: null, mobileNumber: null });
});
