const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const src = (p) => path.join(projectRoot, "src", p);
const channelPath = src("channel/index.js");
const repoPath = src("session/repo/index.js");
const sessionPath = src("session/session-manager.js");
const remindersPath = src("machine/service/reminders-service.js");
const emailTenantPath = src("machine/service/email-tenant-service.js");
const userServicePath = src("session/user-service.js");
const phoneNumbersPath = src("phone-numbers.js");

// A +91 citizen on a ke deployment: the national number alone would be re-prefixed +254.
const CITIZEN = { mobileNumber: "6307817430", whatsAppAddress: "whatsapp:+916307817430" };

function stub(modulePath, exports) {
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
}

/** Load a module with the channel and session repo replaced; returns what was sent. */
function loadWithStubs(modulePath, repo = {}) {
  const sent = [];
  stub(channelPath, { sendMessageToUser: (user, messages) => sent.push({ user, messages }) });
  stub(repoPath, repo);
  stub(emailTenantPath, { findTenantByEmail: async () => null });
  // Number conversion reads MDMS over the network; not what these tests are about.
  stub(phoneNumbersPath, { toNationalNumber: async (v) => String(v ?? ""), toInternationalNumber: async (v) => String(v ?? "") });
  delete require.cache[modulePath];
  return { module: require(modulePath), sent };
}

function loadLoginFlow(allowed) {
  const sent = [];
  stub(channelPath, { sendMessageToUser: async (user, messages) => sent.push({ user, messages }) });
  stub(userServicePath, {
    // egov-user's record: a national number, and no channel address.
    getUserForMobileNumber: async () => ({ userId: "u-1", mobileNumber: CITIZEN.mobileNumber, locale: "en_IN", userInfo: {} }),
  });
  const config = require(src("env-variables.js"));
  config.allowedMobileNumbers = allowed;
  for (const p of ["session/standard-login-flow.js", "whitelist.js"]) delete require.cache[src(p)];
  const StandardLoginFlow = require(src("session/standard-login-flow.js"));
  const InboundRequestModel = require(src("machine/util/inbound-request-model.js"));
  const model = new InboundRequestModel({ user: { ...CITIZEN }, message: { type: "text", input: "ola" }, extraInfo: {} });
  return { flow: new StandardLoginFlow(model), model, sent };
}

test("the session user keeps the address the citizen wrote from", async (t) => {
  const config = require(src("env-variables.js"));
  const previous = config.allowedMobileNumbers;
  t.after(() => { config.allowedMobileNumbers = previous; });

  const { flow, model } = loadLoginFlow("");
  await flow.resolveSession();
  assert.equal(model.user.whatsAppAddress, CITIZEN.whatsAppAddress, "not lost when egov-user's record replaces the user");
});

test("the not-authorised reply goes to the address the citizen wrote from", async (t) => {
  const config = require(src("env-variables.js"));
  const previous = config.allowedMobileNumbers;
  t.after(() => { config.allowedMobileNumbers = previous; });

  const { flow, sent } = loadLoginFlow("840000000");
  assert.equal(await flow.resolveSession(), null);
  assert.equal(sent[0].user.whatsAppAddress, CITIZEN.whatsAppAddress);
});

test("REGRESSION (review): the saved session keeps the reply address", () => {
  const ChatState = require(src("session/chat-state.js"));
  const saved = ChatState.create({
    context: { user: { ...CITIZEN, userId: "u-1", locale: "en_IN", authToken: "secret" } },
  }).withoutUserData();
  assert.deepEqual(saved.raw.context.user, { ...CITIZEN, userId: "u-1", locale: "en_IN" });
});

test("REGRESSION (review): a message without a usable From keeps the saved reply address", () => {
  const ChatService = require(src("session/chat-service.js"));
  const context = { user: { ...CITIZEN, userId: "u-1", locale: "en_IN" } };
  const refreshed = ChatService.prototype.refreshContext.call({ sessionManager: {} }, context, {
    user: { userId: "u-1", mobileNumber: undefined, whatsAppAddress: undefined },
    extraInfo: {},
  });
  assert.equal(refreshed.user.whatsAppAddress, CITIZEN.whatsAppAddress);
  assert.equal(refreshed.user.mobileNumber, CITIZEN.mobileNumber);
});

function loadReminders(contact, savedAddress) {
  const chatState = { value: { pgr: "question" }, context: { user: { whatsAppAddress: savedAddress, locale: "en_IN" } } };
  const { module: reminders, sent } = loadWithStubs(remindersPath, {
    getActiveStateForUserId: async () => chatState,
  });
  reminders.getContactFromUserId = async () => contact;
  return { reminders, sent };
}

test("REGRESSION (review): reminders use egov-user's own country code first", async () => {
  const { reminders, sent } = loadReminders({ mobileNumber: "6307817430", countryCode: "+91" }, undefined);
  await reminders.sendMessages(["u-1"]);
  assert.equal(sent[0].user.whatsAppAddress, "whatsapp:+916307817430");
});

test("REGRESSION (review): reminders use the saved address only while it is the same number", async () => {
  // No countryCode on the record: the saved address is used while it matches...
  let { reminders, sent } = loadReminders({ mobileNumber: "6307817430" }, CITIZEN.whatsAppAddress);
  await reminders.sendMessages(["u-1"]);
  assert.equal(sent[0].user.whatsAppAddress, CITIZEN.whatsAppAddress);

  // ...and dropped once the registered number has changed.
  ({ reminders, sent } = loadReminders({ mobileNumber: "7012345678" }, CITIZEN.whatsAppAddress));
  await reminders.sendMessages(["u-1"]);
  assert.equal(sent[0].user.whatsAppAddress, undefined);
  assert.equal(sent[0].user.mobileNumber, "7012345678");
});

test("a changed number with a stored country code goes to the new number", async () => {
  const { reminders, sent } = loadReminders({ mobileNumber: "0712345678", countryCode: "+254" }, CITIZEN.whatsAppAddress);
  await reminders.sendMessages(["u-1"]);
  // Trunk 0 dropped; the stale saved +91 address is ignored.
  assert.equal(sent[0].user.whatsAppAddress, "whatsapp:+254712345678");
});

test("REGRESSION (review): the saved address beats a default-filled countryCode while it is the same number", async () => {
  // egov-user may fill countryCode with the deployment default (+254) for a +91 citizen.
  const { reminders, sent } = loadReminders({ mobileNumber: "6307817430", countryCode: "+254" }, CITIZEN.whatsAppAddress);
  await reminders.sendMessages(["u-1"]);
  assert.equal(sent[0].user.whatsAppAddress, CITIZEN.whatsAppAddress);
});
