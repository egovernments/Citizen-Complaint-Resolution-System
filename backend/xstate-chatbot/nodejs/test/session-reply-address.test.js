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
  delete require.cache[modulePath];
  return { module: require(modulePath), sent };
}

test("REGRESSION (review): sandbox-mode replies go to the address the citizen wrote from", async (t) => {
  // session-manager starts a cleanup interval at load; keep it off the real clock.
  t.mock.timers.enable({ apis: ["setInterval"] });
  const config = require(src("env-variables.js"));
  const previous = config.enableSandboxMode;
  config.enableSandboxMode = true;
  t.after(() => { config.enableSandboxMode = previous; });
  const { module: sessionManager, sent } = loadWithStubs(sessionPath);

  // "hi" -> the email prompt; then an unknown email -> the registration hint.
  await sessionManager.fromUser({ user: { ...CITIZEN }, message: { type: "text", input: "hi" }, extraInfo: {} });
  await sessionManager.fromUser({ user: { ...CITIZEN }, message: { type: "text", input: "nobody@example.org" }, extraInfo: {} });

  assert.equal(sent.length, 2);
  for (const { user } of sent) assert.equal(user.whatsAppAddress, CITIZEN.whatsAppAddress);
});

test("REGRESSION (review): the saved session keeps the reply address", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { module: sessionManager } = loadWithStubs(sessionPath);
  const saved = sessionManager.removeUserDataFromState({
    context: { user: { ...CITIZEN, userId: "u-1", locale: "en_IN", authToken: "secret" } },
  });
  assert.deepEqual(saved.context.user, { ...CITIZEN, userId: "u-1", locale: "en_IN" });
});

test("REGRESSION (review): a message without a usable From keeps the saved reply address", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { module: sessionManager } = loadWithStubs(sessionPath);
  // A real saved state, as removeUserDataFromState leaves it.
  const saved = JSON.parse(JSON.stringify(require(src("machine/seva.js")).initialState));
  saved.context = { ...(saved.context || {}), user: { ...CITIZEN, userId: "u-1", locale: "en_IN" } };
  const service = sessionManager.getChatServiceFor(saved, {
    user: { userId: "u-1", mobileNumber: undefined, whatsAppAddress: undefined },
    extraInfo: {},
  });
  assert.equal(service.state.context.user.whatsAppAddress, CITIZEN.whatsAppAddress);
  assert.equal(service.state.context.user.mobileNumber, CITIZEN.mobileNumber);
  service.stop();
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
