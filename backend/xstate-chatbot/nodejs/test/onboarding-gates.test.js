const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Pinned before env-variables loads: the defaults are India's (91/10), so on a
// clean checkout createUser rejects a 9-digit MZ number before reaching the
// assertion. .env supplies these locally, which is why this only failed there.
process.env.CITIZEN_PLACEHOLDER_NAME = "Cidadão";
process.env.COUNTRY_CODE = "258";
process.env.ALLOWED_MOBILE_NUMBERS = "";   // empty = open, so the whitelist gate is not what is under test
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
// sanitizeMobileNumber resolves the tenant's rule from MDMS now; pin it so this
// test exercises onboarding, not a network lookup.
require(p("src/machine/service/mobile-validation-service.js")).getConfig =
  async () => ({ countryCode: "+258", mobileNumberRegex: "^[0-9]{9}$" });
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

const shell = require(p("src/machine/shell-machine.js"));

/** The first branch on `start` whose guard passes — i.e. where this citizen lands. */
function routeFromStart(user) {
  const context = { user };
  for (const branch of shell.config.states.start.on.USER_MESSAGE) {
    if (!branch.cond || branch.cond(context)) return branch.target;
  }
  return undefined;
}

test("a citizen provisioned by the earlier build is sent to the profile check", () => {
  // They have a locale, so isOnboarded passed and the gate sent them straight
  // to PGR — keeping the placeholder name forever. They are not made to pick a
  // locale again, only to supply the name nobody ever asked them for.
  const legacy = { userId: "u-1", mobileNumber: "840000001", locale: "pt_PT", name: config.citizenPlaceholderName };

  assert.ok(isOnboarded({ user: legacy }), "the locale that let them slip through is still there");
  assert.equal(routeFromStart(legacy), "#checkProfile");
});

test("the fully onboarded and the brand new still route as before", () => {
  assert.equal(
    routeFromStart({ userId: "u-1", mobileNumber: "840000001", locale: "pt_PT", name: "Feliciano" }),
    "#welcome",
    "a real name skips onboarding"
  );
  assert.equal(
    routeFromStart({ userId: "u-2", mobileNumber: "840000002", name: config.citizenPlaceholderName }),
    "#onboarding",
    "no locale means the full journey, locale question included"
  );
});

test("finishing the name does not clear the locale that skipped the locale question", () => {
  // Entering at checkProfile never runs askLocale, so onboarding.locale is
  // unset. Assigning it blindly logged the citizen back out of onboarding.
  const commit = shell.states.onboardingUpdateUserProfile.branches[0].set;
  const context = {
    user: { userId: "u-1", locale: "pt_PT", name: config.citizenPlaceholderName },
    onboarding: { name: "Feliciano" },
  };

  commit(context);

  assert.equal(context.user.name, "Feliciano");
  assert.equal(context.user.locale, "pt_PT", "their existing locale survives");
});

test("a citizen who did pick a locale during onboarding gets that one", () => {
  const commit = shell.states.onboardingUpdateUserProfile.branches[0].set;
  const context = {
    user: { userId: "u-2", locale: undefined, name: config.citizenPlaceholderName },
    onboarding: { name: "Ana", locale: "en_IN" },
  };

  commit(context);

  assert.equal(context.user.locale, "en_IN");
});
