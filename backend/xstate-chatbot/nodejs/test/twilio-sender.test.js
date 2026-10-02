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

test("REGRESSION: replies go to the address the citizen wrote from, not a re-prefixed national number", async (t) => {
  const provider = loadProvider("whatsapp:+14155238886");
  // ke's first row: +254, whose regex also admits 10-digit Indian numbers.
  // t.mock.method restores the shared singleton when the test ends.
  const mobile = require(mobilePath);
  t.mock.method(mobile, "getConfig", async () => ({ countryCode: "+254", mobileNumberRegex: "^(0?[17][0-9]{8}|[6-9][0-9]{9})$" }));
  const sent = [];
  provider.sendTwilioRequest = async (params) => sent.push(params.get("To"));

  const citizen = { mobileNumber: "6307817430", whatsAppAddress: "whatsapp:+916307817430" };
  await provider.sendMessageToUser(citizen, ["hello"], { tenantId: "ke" });
  // Previously the national number was re-prefixed with the tenant default: +2546307817430.
  assert.deepEqual(sent, ["whatsapp:+916307817430"]);

  // Without a captured address the old national-number path is unchanged.
  sent.length = 0;
  await provider.sendMessageToUser({ mobileNumber: "712345678" }, ["hello"], { tenantId: "ke" });
  assert.deepEqual(sent, ["whatsapp:+254712345678"]);
});
