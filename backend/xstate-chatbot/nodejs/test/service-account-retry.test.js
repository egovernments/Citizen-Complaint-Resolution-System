const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

// Each call records the token it was made with, so we can prove the retry used a
// freshly minted one rather than replaying the rejected token.
const calls = [];
let loginCount = 0;
let mintRefusedToken = false;   // when set, a fresh login still yields a refused token

require.cache[require.resolve("node-fetch")] = {
  id: require.resolve("node-fetch"),
  filename: require.resolve("node-fetch"),
  loaded: true,
  exports: async (url, options) => {
    if (String(url).includes("oauth/token")) {
      loginCount += 1;
      const access_token = mintRefusedToken ? "stale-token" : `token-${loginCount}`;
      return {
        status: 200,
        ok: true,
        text: async () => "",
        json: async () => ({ access_token, UserRequest: { uuid: "svc" }, expires_in: 3600 }),
      };
    }

    const body = JSON.parse(options.body);
    const token = (body.RequestInfo || body.requestInfo).authToken;
    calls.push({ url: String(url), token });

    // "boom-token" always 500s; "stale-token" is always refused (so the retry
    // path can be observed end to end); anything else succeeds.
    if (token === "boom-token") {
      return { status: 500, ok: false, text: async () => "", json: async () => ({}) };
    }
    if (token === "stale-token") {
      return { status: 401, ok: false, text: async () => "", json: async () => ({}) };
    }
    return {
      status: 200,
      ok: true,
      text: async () => "",
      json: async () => ({ user: [{ uuid: "citizen-uuid", name: "Feliciano", active: true }] }),
    };
  },
};

const userService = require(p("src/session/user-service.js"));

// sanitizeMobileNumber resolves the tenant's rule from MDMS now; pin it so this
// test exercises onboarding, not a network lookup.
require(p("src/machine/service/mobile-validation-service.js")).getConfig =
  async () => ({ countryCode: "+258", mobileNumberRegex: "^[0-9]{9}$" });

test("a 401 re-authenticates and retries once, returning the fresh token", async () => {
  calls.length = 0;
  loginCount = 0;

  // Simulate a token that egov-user no longer honours (restart / store flush)
  // but whose expires_in has not elapsed, so the cache still trusts it.
  userService._serviceAccount = { authToken: "stale-token", userInfo: { uuid: "svc" } };
  userService._serviceAccountExpiry = Date.now() + 60_000;

  const found = await userService.findCitizen("840000000", "mz");

  assert.equal(calls.length, 2, "one refused attempt, then one retry");
  assert.equal(calls[0].token, "stale-token");
  assert.equal(calls[1].token, "token-1", "the retry uses a newly minted token");
  assert.equal(loginCount, 1, "exactly one re-authentication");

  assert.ok(found, "the citizen is found — a 401 must not read as 'no such citizen'");
  assert.equal(found.userInfo.uuid, "citizen-uuid");
  assert.equal(found.authToken, "token-1", "callers receive the fresh token, not the rejected one");
});

test("a healthy token makes exactly one call and no re-login", async () => {
  calls.length = 0;
  loginCount = 0;
  userService._serviceAccount = { authToken: "good-token", userInfo: { uuid: "svc" } };
  userService._serviceAccountExpiry = Date.now() + 60_000;

  await userService.findCitizen("840000000", "mz");

  assert.equal(calls.length, 1);
  assert.equal(loginCount, 0);
});

test("a 5xx on the search is an error, not a missing citizen", async () => {
  // Regression: any non-OK response returned undefined, so loginOrCreateUser read
  // a failed search as "no such citizen" and tried to create one that existed.
  calls.length = 0;
  loginCount = 0;
  userService._serviceAccount = { authToken: "boom-token", userInfo: { uuid: "svc" } };
  userService._serviceAccountExpiry = Date.now() + 60_000;

  await assert.rejects(
    () => userService.findCitizen("840000000", "mz"),
    /user\/_search failed with status 500/
  );
  assert.equal(loginCount, 0, "a 5xx is not a credential problem, so no re-login");
});

test("a persistent 401 surfaces as an error after the single retry", async () => {
  calls.length = 0;
  loginCount = 0;
  userService._serviceAccount = { authToken: "stale-token", userInfo: { uuid: "svc" } };
  userService._serviceAccountExpiry = Date.now() + 60_000;
  mintRefusedToken = true;   // re-authentication does not help

  try {
    await assert.rejects(
      () => userService.findCitizen("840000001", "mz"),
      /user\/_search failed with status 401/,
      "the citizen must not look absent just because the token was refused"
    );
  } finally {
    mintRefusedToken = false;
  }
  assert.equal(loginCount, 1, "exactly one re-authentication was attempted");
});
