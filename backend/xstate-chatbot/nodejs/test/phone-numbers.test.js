const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

// Both directions follow the tenant's MDMS MobileNumberValidation row. COUNTRY_CODE
// is pinned to India's 91 to prove it is no longer read.
process.env.COUNTRY_CODE = "91";
process.env.MOBILE_NUMBER_LENGTH = "10";

const mv = require(p("src/machine/service/mobile-validation-service.js"));
const { toNationalNumber, toInternationalNumber } = require(p("src/phone-numbers.js"));

const MZ = { countryCode: "+258", mobileNumberRegex: "^[0-9]{9}$" };
const IN = { countryCode: "+91", mobileNumberRegex: "^[0-9]{10}$" };
const useRule = (rule) => { mv.getConfig = async () => rule; };

test("an inbound number loses exactly the tenant's country code", async () => {
  useRule(MZ);
  assert.equal(await toNationalNumber("whatsapp:+258840000000"), "840000000");
  assert.equal(await toNationalNumber("258840000000"), "840000000");
  assert.equal(await toNationalNumber("+258 84 000 0000"), "840000000", "separators are ignored");
});

test("a number without the country code is left intact, not truncated", async () => {
  useRule(MZ);
  assert.equal(await toNationalNumber("840000000"), "840000000");
});

test("an outbound number carries exactly one country code", async () => {
  useRule(MZ);
  assert.equal(await toInternationalNumber("840000000"), "258840000000");
  assert.equal(await toInternationalNumber("258840000000"), "258840000000", "not double-prefixed");
  assert.equal(await toInternationalNumber("whatsapp:+258840000000"), "258840000000");
});

test("an empty number does not become a bare country code", async () => {
  useRule(MZ);
  for (const value of ["", null, undefined, "whatsapp:+"]) {
    assert.equal(await toInternationalNumber(value), "", String(value));
  }
});

test("a national number that starts with its own country code survives", async () => {
  // Under +91 the national number 9123456789 begins with the country code;
  // stripping on the prefix alone turned it into 23456789.
  useRule(IN);
  assert.equal(await toNationalNumber("9123456789"), "9123456789", "10 digits: no prefix to strip");
  assert.equal(await toNationalNumber("919123456789"), "9123456789", "12 digits: the prefix is real");
  assert.equal(await toInternationalNumber("9123456789"), "919123456789");
  assert.equal(await toInternationalNumber("919123456789"), "919123456789", "not double-prefixed");
});

test("COUNTRY_CODE=91 is ignored when the tenant rule says +258", async () => {
  useRule(MZ);
  assert.equal(await toInternationalNumber("840000000"), "258840000000");
});

test("a foreign number the tenant rule cannot reconcile is not given the tenant's prefix", async () => {
  useRule(MZ);
  assert.equal(await toNationalNumber("+447700900123"), "447700900123");
  assert.equal(await toInternationalNumber("+447700900123"), "447700900123");
});

test("the Twilio adapter resolves numbers through the tenant's mobile rule", async () => {
  useRule(MZ);
  const twilio = require(p("src/channel/twilio.js"));

  assert.equal(await twilio.extractPhoneNumber("whatsapp:+258840000000"), "840000000");
  assert.equal(await twilio.toWhatsAppAddress("840000000"), "whatsapp:+258840000000");
  assert.equal(await twilio.toWhatsAppAddress("258840000000"), "whatsapp:+258840000000");
});
