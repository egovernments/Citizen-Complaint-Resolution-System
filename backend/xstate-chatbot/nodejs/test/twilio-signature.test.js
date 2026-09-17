const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, "src/env-variables.js");
const modulePath = path.join(projectRoot, "src/channel/twilio-signature.js");

const AUTH_TOKEN = "test-auth-token-0123456789";

function load({ authToken = AUTH_TOKEN, validateSignature = true, webhookBaseUrl = "" } = {}) {
  delete require.cache[modulePath];
  require.cache[envPath] = {
    id: envPath,
    filename: envPath,
    loaded: true,
    exports: { twilio: { authToken, validateSignature, webhookBaseUrl } },
  };
  return require(modulePath);
}

/** Twilio's documented algorithm, computed independently of the implementation. */
function sign(url, params, token = AUTH_TOKEN) {
  let payload = url;
  for (const key of Object.keys(params).sort()) payload += key + params[key];
  return crypto.createHmac("sha1", token).update(Buffer.from(payload, "utf-8")).digest("base64");
}

function formRequest(signature, params, { originalUrl = "/xstate-chatbot/message" } = {}) {
  return {
    headers: {
      "x-twilio-signature": signature,
      "content-type": "application/x-www-form-urlencoded",
      host: "bomet.example.org",
    },
    protocol: "https",
    originalUrl,
    body: params,
  };
}

const BODY = {
  From: "whatsapp:+919876543210",
  To: "whatsapp:+14155238886",
  Body: "Hi",
  NumMedia: "0",
};
const URL_BASE = "https://bomet.example.org";
const FULL_URL = URL_BASE + "/xstate-chatbot/message";

test("a correctly signed Twilio request is accepted", () => {
  const mod = load({ webhookBaseUrl: URL_BASE });
  const result = mod.validateRequest(formRequest(sign(FULL_URL, BODY), BODY));
  assert.equal(result.valid, true);
});

test("a tampered body is rejected", () => {
  const mod = load({ webhookBaseUrl: URL_BASE });
  const signature = sign(FULL_URL, BODY);
  // Attacker keeps the captured signature but swaps the sender.
  const forged = { ...BODY, From: "whatsapp:+919999999999" };
  assert.equal(mod.validateRequest(formRequest(signature, forged)).valid, false);
});

test("a missing signature header is rejected", () => {
  const mod = load({ webhookBaseUrl: URL_BASE });
  const req = formRequest(undefined, BODY);
  delete req.headers["x-twilio-signature"];
  const result = mod.validateRequest(req);
  assert.equal(result.valid, false);
  assert.match(result.reason, /missing X-Twilio-Signature/);
});

test("a signature from the wrong auth token is rejected", () => {
  const mod = load({ webhookBaseUrl: URL_BASE });
  const signature = sign(FULL_URL, BODY, "somebody-elses-token");
  assert.equal(mod.validateRequest(formRequest(signature, BODY)).valid, false);
});

test("an unset auth token fails closed", () => {
  // HMAC over an empty key still verifies, so a blank token must not mean "allow".
  const mod = load({ authToken: "", webhookBaseUrl: URL_BASE });
  const signature = sign(FULL_URL, BODY, "");
  const result = mod.validateRequest(formRequest(signature, BODY));
  assert.equal(result.valid, false);
  assert.match(result.reason, /TWILIO_AUTH_TOKEN is not set/);
});

test("validation can be disabled for local console testing", () => {
  const mod = load({ validateSignature: false, webhookBaseUrl: URL_BASE });
  const req = formRequest(undefined, BODY);
  delete req.headers["x-twilio-signature"];
  assert.equal(mod.validateRequest(req).valid, true);
});

test("the configured base URL wins over spoofable proxy headers", () => {
  const mod = load({ webhookBaseUrl: URL_BASE });
  const req = formRequest(sign(FULL_URL, BODY), BODY);
  // An attacker controls Host/X-Forwarded-*; the pinned base URL must be used anyway.
  req.headers.host = "attacker.example.net";
  req.headers["x-forwarded-host"] = "attacker.example.net";
  req.headers["x-forwarded-proto"] = "http";
  assert.equal(mod.validateRequest(req).valid, true);
  assert.equal(mod.buildUrl(req), FULL_URL);
});

test("without a configured base URL the request headers are used", () => {
  const mod = load({ webhookBaseUrl: "" });
  const req = formRequest("x", BODY);
  assert.equal(mod.buildUrl(req), FULL_URL);
});

test("a trailing slash on the configured base URL does not double up", () => {
  const mod = load({ webhookBaseUrl: URL_BASE + "/" });
  assert.equal(mod.buildUrl(formRequest("x", BODY)), FULL_URL);
});

test("the query string is part of the signed URL", () => {
  const mod = load({ webhookBaseUrl: URL_BASE });
  const urlWithQuery = FULL_URL + "?tenantId=pg.citya";
  const signature = sign(urlWithQuery, BODY);
  const req = formRequest(signature, BODY, {
    originalUrl: "/xstate-chatbot/message?tenantId=pg.citya",
  });
  assert.equal(mod.validateRequest(req).valid, true);
  // The same signature must not validate against the path without the query.
  assert.equal(mod.validateRequest(formRequest(signature, BODY)).valid, false);
});
