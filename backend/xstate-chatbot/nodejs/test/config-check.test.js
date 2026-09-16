const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, "src/env-variables.js");
const checkPath = path.join(projectRoot, "src/config-check.js");

function load(overrides = {}) {
  delete require.cache[checkPath];
  require.cache[envPath] = {
    id: envPath,
    filename: envPath,
    loaded: true,
    exports: Object.assign(
      {
        whatsAppProvider: "Twilio",
        repoProvider: "Postgres",
        twilio: {
          accountSid: "AC123",
          authToken: "tok",
          whatsappNumber: "whatsapp:+14155238886",
          validateSignature: true,
        },
      },
      overrides
    ),
  };
  return require(checkPath);
}

test("a fully configured Twilio deployment reports no problems", () => {
  assert.deepEqual(load().problems(), []);
});

test("REGRESSION NEW5: a missing sender is reported, not swallowed", () => {
  // senderAddress() throws inside sendMessageToUser's per-message try/catch, which logs and
  // continues -- so the container looked healthy while filing complaints and dropping every
  // reply. This surfaces it where an operator can see it.
  const p = load({
    twilio: { accountSid: "AC", authToken: "t", whatsappNumber: "", validateSignature: true },
  }).problems();
  assert.equal(p.length, 1);
  assert.match(p[0], /TWILIO_WHATSAPP_NUMBER is not set/);
});

test("REGRESSION NEW5: missing credentials are reported", () => {
  const p = load({
    twilio: { accountSid: "", authToken: "", whatsappNumber: "whatsapp:+1", validateSignature: true },
  }).problems();
  assert.equal(p.length, 1);
  assert.match(p[0], /TWILIO_ACCOUNT_SID/);
});

test("disabled signature validation is reported on a Twilio deployment", () => {
  const p = load({
    twilio: { accountSid: "AC", authToken: "t", whatsappNumber: "whatsapp:+1", validateSignature: false },
  }).problems();
  assert.equal(p.length, 1);
  assert.match(p[0], /forgeable/);
});

test("InMemory session storage is reported", () => {
  const p = load({ repoProvider: "InMemory" }).problems();
  assert.equal(p.length, 1);
  assert.match(p[0], /conversations are lost on restart/);
});

test("non-Twilio providers are not held to the Twilio checks", () => {
  const p = load({
    whatsAppProvider: "Console",
    twilio: { accountSid: "", authToken: "", whatsappNumber: "", validateSignature: false },
  }).problems();
  assert.deepEqual(p, []);
});

test("logAtStartup returns the same problems it logs", () => {
  const mod = load({ repoProvider: "InMemory" });
  const originalError = console.error;
  const lines = [];
  console.error = (m) => lines.push(String(m));
  try {
    const found = mod.logAtStartup();
    assert.equal(found.length, 1);
    assert.ok(lines.some((l) => /Configuration check FAILED/.test(l)));
  } finally {
    console.error = originalError;
  }
});
