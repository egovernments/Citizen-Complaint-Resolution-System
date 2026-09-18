const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { isValidTwilioSignature, expectedSignature } = require(
  path.join(path.resolve(__dirname, ".."), "src/channel/twilio-signature.js")
);

const TOKEN = "test_auth_token";
const URL = "https://chatbot.example.gov/xstate-chatbot/message";
const BODY = { From: "whatsapp:+258840000000", To: "whatsapp:+258840000001", Body: "Ola" };

/** Independent implementation of Twilio's scheme, to pin the canonical string. */
function sign(url, params) {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return crypto.createHmac("sha1", TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
}

test("accepts a correctly signed request", () => {
  const signature = sign(URL, BODY);
  assert.equal(isValidTwilioSignature({ authToken: TOKEN, url: URL, params: BODY, signature }), true);
});

test("param order does not change the signature", () => {
  const reordered = { Body: BODY.Body, To: BODY.To, From: BODY.From };
  assert.equal(expectedSignature(TOKEN, URL, reordered), expectedSignature(TOKEN, URL, BODY));
});

test("rejects a tampered From — the impersonation case", () => {
  const signature = sign(URL, BODY);
  const tampered = { ...BODY, From: "whatsapp:+258840000002" };
  assert.equal(isValidTwilioSignature({ authToken: TOKEN, url: URL, params: tampered, signature }), false);
});

test("rejects a signature computed over a different URL", () => {
  const signature = sign("https://evil.example/xstate-chatbot/message", BODY);
  assert.equal(isValidTwilioSignature({ authToken: TOKEN, url: URL, params: BODY, signature }), false);
});

test("rejects when the signature header, token or url is missing", () => {
  const signature = sign(URL, BODY);
  assert.equal(isValidTwilioSignature({ authToken: TOKEN, url: URL, params: BODY, signature: undefined }), false);
  assert.equal(isValidTwilioSignature({ authToken: "", url: URL, params: BODY, signature }), false);
  assert.equal(isValidTwilioSignature({ authToken: TOKEN, url: "", params: BODY, signature }), false);
});

test("a wrong-length signature does not throw (timingSafeEqual guard)", () => {
  assert.equal(isValidTwilioSignature({ authToken: TOKEN, url: URL, params: BODY, signature: "short" }), false);
});
