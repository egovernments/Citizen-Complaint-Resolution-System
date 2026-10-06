const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, "src/env-variables.js");
const twilioPath = path.join(projectRoot, "src/channel/twilio.js");
const mobilePath = path.join(projectRoot, "src/machine/service/mobile-validation-service.js");

// COUNTRY_CODE left at its '91' default, as on a deployment that never set it.
function loadProvider(mdmsCountryCode) {
  delete require.cache[twilioPath];
  delete require.cache[mobilePath];
  require.cache[envPath] = {
    id: envPath,
    filename: envPath,
    loaded: true,
    exports: {
      rootTenantId: "mz",
      countryCode: "91",
      twilio: { accountSid: "AC", authToken: "tok", whatsappNumber: "+14155238886", baseUrl: "" },
      mobileValidation: { defaultCountryCode: "+91", defaultRegex: "^[0-9]{10}$", cacheTtlMs: 1000 },
      egovServices: { egovServicesHost: "http://localhost/", mdmsV2SearchPath: "mdms-v2/v2/_search" },
    },
  };
  const provider = require(twilioPath);
  const mobileValidation = require(mobilePath);
  mobileValidation.getConfig = async () => ({ countryCode: mdmsCountryCode, mobileNumberRegex: "^[0-9]{9}$" });
  return provider;
}

test("the served country comes from MDMS, not COUNTRY_CODE", async () => {
  const provider = loadProvider("+258");
  assert.equal(await provider.isServedCountry("whatsapp:+258841234567"), true);
  assert.equal(await provider.isServedCountry("whatsapp:+919812345678"), false);
});

test("isValid discards an out-of-country sender and admits an in-country one", async () => {
  const provider = loadProvider("+258");
  const message = (From) => ({ From, To: "whatsapp:+14155238886", Body: "hi" });
  assert.equal(await provider.isValid(message("whatsapp:+919812345678")), false);
  assert.equal(await provider.isValid(message("whatsapp:+258841234567")), true);
});

test("a tenant rule without a country code admits every sender", async () => {
  const provider = loadProvider("");
  assert.equal(await provider.isServedCountry("whatsapp:+919812345678"), true);
});

test("a sender from an alternate country rule is served, not dropped", async () => {
  // ke carries +254 and +91. Checking only the primary dropped every +91 citizen
  // before the tenant-aware resolution could apply the alternate.
  const provider = loadProvider("+254");
  require(mobilePath).getConfig = async () => ({
    countryCode: "+254", mobileNumberRegex: "^0?[17][0-9]{8}$",
    alternates: [{ countryCode: "+91", mobileNumberRegex: "^[6-9][0-9]{9}$" }],
  });
  assert.equal(await provider.isServedCountry("whatsapp:+916307817430"), true);
  assert.equal(await provider.isServedCountry("whatsapp:+254712345678"), true);
  assert.equal(await provider.isServedCountry("whatsapp:+447700900123"), false);
});
