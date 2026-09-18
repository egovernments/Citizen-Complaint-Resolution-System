const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

// COUNTRY_CODE drives both directions; .env already sets 258, pinned here so the
// test states what it depends on.
process.env.COUNTRY_CODE = "258";

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

test("the Twilio adapter routes both directions through the shared helpers", () => {
  const twilio = require(p("src/channel/twilio.js"));

  assert.equal(twilio.extractPhoneNumber("whatsapp:+258840000000"), "840000000");
  assert.equal(twilio.toWhatsAppNumber("840000000"), "whatsapp:+258840000000");
  assert.equal(twilio.toWhatsAppNumber("258840000000"), "whatsapp:+258840000000");
});
