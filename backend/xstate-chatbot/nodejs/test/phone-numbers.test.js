const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

// COUNTRY_CODE and MOBILE_NUMBER_LENGTH drive both directions; .env already sets
// 258/9, pinned here so the test states what it depends on and passes on a clean
// checkout. Without the length the defaults (91/10) apply and every case below
// is measured against the wrong country.
process.env.COUNTRY_CODE = "258";
process.env.MOBILE_NUMBER_LENGTH = "9";

const { toNationalNumber, toInternationalNumber } = require(p("src/phone-numbers.js"));

test("an inbound number loses exactly the configured country code", () => {
  assert.equal(toNationalNumber("whatsapp:+258840000000"), "840000000");
  assert.equal(toNationalNumber("258840000000"), "840000000");
  assert.equal(toNationalNumber("+258 84 000 0000"), "840000000", "separators are ignored");
});

test("a number without the country code is left intact, not truncated", () => {
  // The old slice(2) removed the first two digits regardless, so a national
  // number arrived as 0000000 and matched no citizen.
  assert.equal(toNationalNumber("840000000"), "840000000");
});

test("an outbound number carries exactly one country code", () => {
  assert.equal(toInternationalNumber("840000000"), "258840000000");
  assert.equal(toInternationalNumber("258840000000"), "258840000000", "not double-prefixed");
  assert.equal(toInternationalNumber("whatsapp:+258840000000"), "258840000000");
});

test("an empty number does not become a bare country code", () => {
  for (const value of ["", null, undefined, "whatsapp:+"]) {
    assert.equal(toInternationalNumber(value), "", String(value));
  }
});

test("a national number that starts with its own country code survives", () => {
  // Under 258 no MZ number can collide — they all start with 8. Under 91 they
  // can: the national number 9123456789 begins with the country code, and
  // stripping on the prefix alone turned it into 23456789, which matched no
  // citizen and no whitelist entry. Only the length says the prefix is real.
  for (const f of ["src/phone-numbers.js", "src/env-variables.js"]) {
    delete require.cache[require.resolve(p(f))];
  }
  process.env.COUNTRY_CODE = "91";
  process.env.MOBILE_NUMBER_LENGTH = "10";
  const india = require(p("src/phone-numbers.js"));

  assert.equal(india.toNationalNumber("9123456789"), "9123456789", "10 digits: no prefix to strip");
  assert.equal(india.toNationalNumber("919123456789"), "9123456789", "12 digits: the prefix is real");
  assert.equal(india.toInternationalNumber("9123456789"), "919123456789");
  assert.equal(india.toInternationalNumber("919123456789"), "919123456789", "not double-prefixed");

  // Put the module registry back the way the other tests expect to find it.
  for (const f of ["src/phone-numbers.js", "src/env-variables.js"]) {
    delete require.cache[require.resolve(p(f))];
  }
  process.env.COUNTRY_CODE = "258";
  process.env.MOBILE_NUMBER_LENGTH = "9";
});

test("the Twilio adapter routes both directions through the shared helpers", () => {
  const twilio = require(p("src/channel/twilio.js"));

  assert.equal(twilio.extractPhoneNumber("whatsapp:+258840000000"), "840000000");
  assert.equal(twilio.toWhatsAppNumber("840000000"), "whatsapp:+258840000000");
  assert.equal(twilio.toWhatsAppNumber("258840000000"), "whatsapp:+258840000000");
});
