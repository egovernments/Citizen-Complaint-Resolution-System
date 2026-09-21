const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Pinned before env-variables loads: the defaults are India's (91/10), so on a
// clean checkout createUser rejects a 9-digit MZ number before reaching the
// assertion. .env supplies these locally, which is why this only failed there.
process.env.CITIZEN_PLACEHOLDER_NAME = "Cidadão";
process.env.COUNTRY_CODE = "258";
process.env.MOBILE_NUMBER_LENGTH = "9";

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

// node-fetch is stubbed so createUser can be inspected without egov-user.
let lastRequest = null;
require.cache[require.resolve("node-fetch")] = {
  id: require.resolve("node-fetch"),
  filename: require.resolve("node-fetch"),
  loaded: true,
  exports: async (url, options) => {
    // The login call posts URLSearchParams; only the _createnovalidate call is JSON.
    let body = options.body;
    if (typeof body === "string" && body.trim().startsWith("{")) body = JSON.parse(body);
    lastRequest = { url, body };
    return {
      status: 200,
      ok: true,
      text: async () => "",
      json: async () => ({ user: [{ uuid: "new-uuid", name: "Cidadão" }] }),
    };
  },
};
require.cache[p("src/machine/util/localisation-service.js")] = {
  id: p("src/machine/util/localisation-service.js"),
  filename: p("src/machine/util/localisation-service.js"),
  loaded: true,
  exports: { getMessageBundleForCode: () => undefined },
};

const config = require(p("src/env-variables.js"));
const userService = require(p("src/session/user-service.js"));
const { isOnboarded, hasProfileName } = require(p("src/machine/shell-machine.js"));

test("createUser does not set a locale — locale presence is the onboarded marker", async () => {
  userService._serviceAccount = { authToken: "t", userInfo: { uuid: "svc" } };
  userService._serviceAccountExpiry = Date.now() + 60_000;


  await userService.createUser("840000000", "mz");

  assert.ok(lastRequest, "a create request was made");
  assert.equal("locale" in lastRequest.body.user, false, "a created citizen must have no locale yet");
  assert.equal(lastRequest.body.user.name, config.citizenPlaceholderName);
});

test("a freshly created citizen is not onboarded and has no usable name", () => {
  const context = { user: { userId: "new-uuid", name: config.citizenPlaceholderName } };

  assert.ok(!isOnboarded(context), "no locale yet, so onboarding must run");
  assert.equal(hasProfileName(context), false, "the placeholder must not pass as a real name");
});

test("a citizen who completed onboarding skips it", () => {
  const context = { user: { userId: "u-1", locale: "pt_PT", name: "Feliciano Mazoio" } };

  assert.ok(isOnboarded(context));
  assert.equal(hasProfileName(context), true);
});
