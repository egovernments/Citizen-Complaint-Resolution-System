const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.ALLOWED_MOBILE_NUMBERS = "840000000,840000002";

const projectRoot = path.resolve(__dirname, "..");
const p = (rel) => path.join(projectRoot, rel);

const sent = [];
let getUserCalls = 0;

// Stub the outbound channel and the user service: the property under test is that
// NOTHING is created for a non-whitelisted number.
require.cache[p("src/channel/index.js")] = {
  id: p("src/channel/index.js"),
  filename: p("src/channel/index.js"),
  loaded: true,
  exports: { sendMessageToUser: (user, messages) => sent.push({ user, messages }) },
};
require.cache[p("src/session/user-service.js")] = {
  id: p("src/session/user-service.js"),
  filename: p("src/session/user-service.js"),
  loaded: true,
  exports: {
    getUserForMobileNumber: async (mobileNumber) => {
      getUserCalls += 1;
      return { userId: "u-1", mobileNumber, locale: "pt_PT", authToken: "t" };
    },
  },
};
require.cache[p("src/machine/util/localisation-service.js")] = {
  id: p("src/machine/util/localisation-service.js"),
  filename: p("src/machine/util/localisation-service.js"),
  loaded: true,
  exports: { getMessageBundleForCode: () => undefined },
};

const StandardLoginFlow = require(p("src/session/standard-login-flow.js"));

const modelFor = (mobileNumber) => ({ user: { mobileNumber }, extraInfo: {} });

test("a non-whitelisted number creates nothing and is told so", async () => {
  sent.length = 0;
  getUserCalls = 0;
  const session = await new StandardLoginFlow(modelFor("849999999")).resolveSession();

  assert.equal(session, null, "no session for a non-whitelisted number");
  assert.equal(getUserCalls, 0, "getUserForMobileNumber must not run — it creates a DIGIT citizen");
  assert.equal(sent.length, 1, "the citizen is still told why");
  assert.equal(sent[0].user.mobileNumber, "849999999");
  assert.match(String(sent[0].messages[0]), /autorizado|authorized/i);
});

test("a whitelisted number resolves a session", async () => {
  sent.length = 0;
  getUserCalls = 0;
  const session = await new StandardLoginFlow(modelFor("840000000")).resolveSession();

  assert.equal(getUserCalls, 1);
  assert.equal(session.userId, "u-1");
  assert.equal(sent.length, 0);
});
