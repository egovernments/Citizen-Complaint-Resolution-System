const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const twilio = require(path.join(projectRoot, "src/channel/twilio.js"));

// MediaUrl0 arrives in the webhook body and the download attaches the account
// credentials as basic auth, so an attacker-controlled host would receive them.
const ACCOUNT = "AC" + "0".repeat(32);
const MESSAGE = "MM" + "1".repeat(32);
const MEDIA = "ME" + "2".repeat(32);
const VALID = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages/${MESSAGE}/Media/${MEDIA}`;

test("a genuine Twilio media url is accepted and rebuilt verbatim", () => {
  assert.equal(twilio.twilioMediaUrl(VALID), VALID);
});

test("the url is rebuilt from the validated SIDs, dropping anything else", () => {
  // Query string, port and userinfo are not part of the rebuilt url.
  const noisy = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages/${MESSAGE}/Media/${MEDIA}?X=1`;
  assert.equal(twilio.twilioMediaUrl(noisy), VALID, "the query string is dropped");
});

test("a foreign host is refused — this is the credential-leak case", () => {
  for (const url of [
    `https://evil.example/2010-04-01/Accounts/${ACCOUNT}/Messages/${MESSAGE}/Media/${MEDIA}`,
    `https://api.twilio.com.evil.example/2010-04-01/Accounts/${ACCOUNT}/Messages/${MESSAGE}/Media/${MEDIA}`,
    `https://user:pass@evil.example/2010-04-01/Accounts/${ACCOUNT}/Messages/${MESSAGE}/Media/${MEDIA}`,
  ]) {
    assert.throws(() => twilio.twilioMediaUrl(url), /non-Twilio host/, url);
  }
});

test("plain http is refused even on the right host", () => {
  assert.throws(
    () => twilio.twilioMediaUrl(VALID.replace("https:", "http:")),
    /non-Twilio host/
  );
});

test("an unexpected path on the right host is refused", () => {
  for (const url of [
    "https://api.twilio.com/2010-04-01/Accounts/AC0/Messages/MM1/Media/ME2",
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages/${MESSAGE}`,
    `https://api.twilio.com/../${ACCOUNT}`,
    "https://api.twilio.com/",
  ]) {
    assert.throws(() => twilio.twilioMediaUrl(url), /unexpected twilio path/, url);
  }
});

test("a malformed or missing url is refused rather than fetched", () => {
  for (const url of ["not-a-url", "", null, undefined]) {
    assert.throws(() => twilio.twilioMediaUrl(url), /malformed url/, String(url));
  }
});
