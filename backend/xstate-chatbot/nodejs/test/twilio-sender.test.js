const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, "src/env-variables.js");
const twilioPath = path.join(projectRoot, "src/channel/twilio.js");
const mobilePath = path.join(projectRoot, "src/machine/service/mobile-validation-service.js");

function loadProvider(whatsappNumber) {
  delete require.cache[twilioPath];
  delete require.cache[mobilePath];
  require.cache[envPath] = {
    id: envPath,
    filename: envPath,
    loaded: true,
    exports: {
      rootTenantId: "pg",
      twilio: { accountSid: "AC", authToken: "tok", whatsappNumber, baseUrl: "" },
      mobileValidation: { defaultCountryCode: "+91", defaultRegex: "^[0-9]{10}$", cacheTtlMs: 1000 },
      egovServices: { egovServicesHost: "http://localhost/", mdmsV2SearchPath: "mdms-v2/v2/_search" },
    },
  };
  return require(twilioPath);
}

test("REGRESSION #7: the repo-wide whatsapp:-prefixed sender is not double-prefixed", () => {
  // twilio_whatsapp_from is documented as "whatsapp:+14155238886" in every host_vars
  // example and in the Novu bootstrap default. Re-prefixing produced
  // From=whatsapp:+whatsapp:+14155238886, which Twilio rejects -- the webhook validated,
  // the dialog ran, and the citizen never got a reply.
  assert.equal(loadProvider("whatsapp:+14155238886").senderAddress(), "whatsapp:+14155238886");
});

test("REGRESSION #7: an unprefixed sender still works", () => {
  assert.equal(loadProvider("+14155238886").senderAddress(), "whatsapp:+14155238886");
  assert.equal(loadProvider("14155238886").senderAddress(), "whatsapp:+14155238886");
});

test("REGRESSION #7: mixed case and stray formatting are normalised", () => {
  assert.equal(loadProvider("WhatsApp:+1 (415) 523-8886").senderAddress(), "whatsapp:+14155238886");
});

test("REGRESSION #6/#7: an unset sender fails loudly instead of using the eGov demo number", () => {
  // Previously this silently became +919880900990, so a misconfigured deployment sent
  // as someone else's number rather than failing.
  for (const blank of ["", "   ", undefined]) {
    assert.throws(() => loadProvider(blank).senderAddress(), /TWILIO_WHATSAPP_NUMBER is not set/);
  }
});
