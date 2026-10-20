// Pins who the complaint timelines show as a complaint's filer (#2503): the
// complainant whenever the APPLY actor is another account (the WhatsApp bot's
// service account, an employee filing for a citizen), never that account.
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
const { complainantFiler } = require(OUT);

const citizen = { uuid: "c-1", name: "Asha", mobileNumber: "712345679" };
const service = { accountId: "c-1", source: "whatsapp", citizen };
const bot = { uuid: "bot-1", name: "Admin", mobileNumber: "0111111111" };

test("a complaint the citizen filed keeps the workflow's own actor", () => {
  assert.equal(complainantFiler({ ...service, source: "web" }, { uuid: "c-1", name: "Asha" }, "Citizen"), null);
});

test("another account's filing shows the complainant's name and mobile", () => {
  assert.deepEqual(complainantFiler(service, bot, "Citizen"), { name: "Asha", mobileNumber: "712345679" });
});

test("the check is the actor, not the channel", () => {
  const csrFiled = { ...service, source: "web" };
  assert.deepEqual(complainantFiler(csrFiled, { uuid: "csr-1" }, "Citizen"), { name: "Asha", mobileNumber: "712345679" });
  assert.deepEqual(complainantFiler({ ...service, source: "telegram" }, bot, "Citizen"), { name: "Asha", mobileNumber: "712345679" });
});

test("confidentiality is left to pgr-services' redaction, not a second rule here", () => {
  const confidential = { ...service, extendedAttributes: { isConfidential: true } };
  assert.deepEqual(complainantFiler(confidential, bot, "Citizen"), { name: "Asha", mobileNumber: "712345679" });
});

test("details pgr-services redacted stay hidden, with no fallback to the filing account", () => {
  const redacted = { ...service, citizen: { uuid: "c-1", name: null, mobileNumber: null } };
  assert.deepEqual(complainantFiler(redacted, bot, "Citizen"), { name: "Citizen", mobileNumber: null });
  assert.deepEqual(complainantFiler({ accountId: "c-1" }, bot, "Citizen"), { name: "Citizen", mobileNumber: null });
});

test("an unknown actor or complainant keeps the workflow's own actor", () => {
  assert.equal(complainantFiler(service, undefined, "Citizen"), null);
  assert.equal(complainantFiler(service, { name: "Admin" }, "Citizen"), null);
  assert.equal(complainantFiler({ citizen }, bot, "Citizen"), null);
  assert.equal(complainantFiler(undefined, bot, "Citizen"), null);
});
