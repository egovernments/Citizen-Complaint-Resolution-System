const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const OUT = path.join(os.tmpdir(), `citizen-otp.cjs.${process.pid}.js`);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "../packages/libraries/src/services/auth/citizenOtp.js")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: OUT,
  logLevel: "error",
});
process.on("exit", () => {
  try { fs.unlinkSync(OUT); } catch (_) { /* already removed */ }
});
const { fetchCitizenSigninMethods, sendCitizenOtp, verifyCitizenOtp } = require(OUT);

const TENANT = { urlSlug: "kd", tenantId: "kd" };

// One canned response per call; records what was sent.
const fakeFetch = (status, body, headers = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name) => headers[name] ?? null },
      json: async () => body,
    };
  };
  return { fetchImpl, calls };
};

test("auth-methods: phone_otp is shown in digit-ui, anything else is a redirect", async () => {
  const both = fakeFetch(200, { methods: [{ id: "phone_otp", type: "phone_otp" }, { id: "google", type: "oidc" }] });
  assert.deepEqual(await fetchCitizenSigninMethods({ fetchImpl: both.fetchImpl }),
    { ok: true, phoneOtp: true, redirect: true });
  assert.equal(both.calls[0].url, "/identity/v1/auth-methods?intent=signin&surface=citizen");
  assert.equal(both.calls[0].init.credentials, "include");

  const unconfigured = fakeFetch(503, { error: "not configured" });
  assert.deepEqual(await fetchCitizenSigninMethods({ fetchImpl: unconfigured.fetchImpl }),
    { ok: false, phoneOtp: false, redirect: false });
});

test("_send posts the route slug and the national number, and returns the challenge", async () => {
  const { fetchImpl, calls } = fakeFetch(202, { challengeId: "c1", expiresIn: 300, resendAfter: 30 });
  const sent = await sendCitizenOtp({ tenant: TENANT, mobileNumber: "712345678", locale: "en_IN", fetchImpl });
  assert.deepEqual(sent, { ok: true, challengeId: "c1", expiresIn: 300, resendAfter: 30 });
  assert.equal(calls[0].url, "/identity/v1/citizen/otp/_send");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "include");
  assert.deepEqual(calls[0].body, { tenantSlug: "kd", mobileNumber: "712345678", locale: "en_IN" });
});

test("_send: OTP_CHANNEL_UNAVAILABLE gets its own message", async () => {
  const { fetchImpl } = fakeFetch(503, { code: "OTP_CHANNEL_UNAVAILABLE" });
  const sent = await sendCitizenOtp({ tenant: TENANT, mobileNumber: "712345678", fetchImpl });
  assert.equal(sent.ok, false);
  assert.equal(sent.code, "OTP_CHANNEL_UNAVAILABLE");
  assert.equal(sent.messageKey, "CORE_IDENTITY_OTP_CHANNEL_UNAVAILABLE");
  assert.match(sent.message, /can't send a code/);
});

test("_send: 429 codes carry retryAfter, from the body or the Retry-After header", async () => {
  for (const code of ["OTP_RESEND_TOO_SOON", "OTP_RATE_LIMITED", "OTP_LOCKED"]) {
    const { fetchImpl } = fakeFetch(429, { code, retryAfter: 25 });
    const sent = await sendCitizenOtp({ tenant: TENANT, mobileNumber: "712345678", fetchImpl });
    assert.equal(sent.code, code);
    assert.equal(sent.retryAfter, 25);
    assert.match(sent.message, /25 seconds/);
  }
  const header = fakeFetch(429, { code: "OTP_RATE_LIMITED" }, { "Retry-After": "3600" });
  assert.equal((await sendCitizenOtp({ tenant: TENANT, mobileNumber: "7", fetchImpl: header.fetchImpl })).retryAfter, 3600);
});

test("_send: unknown tenant route and uncoded errors fall back to generic messages", async () => {
  const notFound = fakeFetch(404, { error: "Tenant route is not available" });
  assert.equal((await sendCitizenOtp({ tenant: TENANT, mobileNumber: "7", fetchImpl: notFound.fetchImpl })).messageKey,
    "CORE_IDENTITY_TENANT_UNAVAILABLE");
  const malformed = fakeFetch(400, { error: "bad" });
  assert.equal((await sendCitizenOtp({ tenant: TENANT, mobileNumber: "7", fetchImpl: malformed.fetchImpl })).messageKey,
    "CORE_IDENTITY_SIGNIN_UNAVAILABLE");
});

test("_verify posts the challenge and code; 200 authenticated is success", async () => {
  const { fetchImpl, calls } = fakeFetch(200, { authenticated: true, tenant: { urlSlug: "kd", tenantId: "kd" } });
  assert.deepEqual(await verifyCitizenOtp({ tenant: TENANT, challengeId: "c1", code: "123456", fetchImpl }), { ok: true });
  assert.equal(calls[0].url, "/identity/v1/citizen/otp/_verify");
  assert.deepEqual(calls[0].body, { tenantSlug: "kd", challengeId: "c1", code: "123456" });
});

test("_verify: OTP_INVALID reports the attempts left", async () => {
  const { fetchImpl } = fakeFetch(400, { code: "OTP_INVALID", attemptsRemaining: 3 });
  const verified = await verifyCitizenOtp({ tenant: TENANT, challengeId: "c1", code: "000000", fetchImpl });
  assert.equal(verified.code, "OTP_INVALID");
  assert.equal(verified.attemptsRemaining, 3);
  assert.equal(verified.params.attempts, 3);
  assert.match(verified.message, /3 attempts left/);
});

test("_verify: expired, locked and identity failures map to their own keys", async () => {
  const cases = [
    [400, "OTP_EXPIRED", "CORE_IDENTITY_OTP_EXPIRED"],
    [403, "IDENTITY_DISABLED", "CORE_IDENTITY_ACCOUNT_DISABLED"],
    [409, "IDENTITY_CONFLICT", "CORE_IDENTITY_SIGNIN_FAILED"],
    [503, "IDENTITY_UNAVAILABLE", "CORE_IDENTITY_SIGNIN_FAILED"],
  ];
  for (const [status, code, messageKey] of cases) {
    const { fetchImpl } = fakeFetch(status, { code });
    const verified = await verifyCitizenOtp({ tenant: TENANT, challengeId: "c1", code: "123456", fetchImpl });
    assert.equal(verified.ok, false);
    assert.equal(verified.messageKey, messageKey, code);
  }
});

test("a missing retryAfter or attemptsRemaining gives a sentence without the number", async () => {
  const limited = fakeFetch(429, { code: "OTP_RATE_LIMITED" }, { "Retry-After": "Wed, 30 Sep 2026 10:00:00 GMT" });
  const sent = await sendCitizenOtp({ tenant: TENANT, mobileNumber: "7", fetchImpl: limited.fetchImpl });
  assert.equal(sent.messageKey, "CORE_IDENTITY_OTP_TRY_LATER");
  assert.doesNotMatch(sent.message, /\{\{|  /);

  const invalid = fakeFetch(400, { code: "OTP_INVALID" });
  const verified = await verifyCitizenOtp({ tenant: TENANT, challengeId: "c1", code: "000000", fetchImpl: invalid.fetchImpl });
  assert.equal(verified.messageKey, "CORE_IDENTITY_OTP_INVALID_CODE");
  assert.equal(verified.message, "That code is not correct.");
});

test("_send accepts any 2xx that carries a challenge", async () => {
  const { fetchImpl } = fakeFetch(200, { challengeId: "c2", expiresIn: 300, resendAfter: 30 });
  assert.equal((await sendCitizenOtp({ tenant: TENANT, mobileNumber: "7", fetchImpl })).challengeId, "c2");
});
