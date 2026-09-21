const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sessionDir = path.join(projectRoot, "src/session");
const machineDir = path.join(projectRoot, "src/machine");

function stub(request, from, exports) {
  const filename = require.resolve(request, { paths: [from] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return exports;
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

const AVG_SESSION_MINUTES = 30;

stub("../env-variables", sessionDir, {
  pgrUseCase: {},
  supportedLocales: "pt_PT",
  defaultLocale: "pt_PT",
  allowedMobileNumbers: "",
  rootTenantId: "mz",
  timeZone: "Africa/Maputo",
  dateFormat: "DD/MM/YYYY",
  egovServices: {},
  kafka: {},
  instituteNameMaxLength: 300,
  descriptionMinLength: 20,
  avgSessionTime: AVG_SESSION_MINUTES,
  dispatchSettleTimeoutMs: 30000,
});
stub("./service/service-loader", machineDir, { pgrService: {} });
stub("./service/egov-user-profile", machineDir, { updateUser: async () => ({}) });
stub("./service/email-tenant-service", machineDir, {});
stub("./util/localisation-service", machineDir, {
  getMessageBundleForCode: () => undefined,
  getLocales: () => [{ value: "pt_PT", label: "PORTUGUÊS" }],
  init: () => {},
});

const sent = [];
stub("../channel", sessionDir, {
  processMessageFromUser: async () => null,
  sendMessageToUser: async (user, messages) => { sent.push(...messages); },
});
stub("./telemetry", sessionDir, { log: () => {} });
stub("./system", sessionDir, { error: () => {} });
stub("./user-service", sessionDir, {});

// A repo that records what the resume flow writes, standing in for the row.
const repo = stub("./repo", sessionDir, {
  row: { state: null, resumePendingAt: null, lastActivity: Date.now() },
  calls: [],
  async insertNewState() { this.calls.push("insertNewState"); },
  async updateState(userId, active, state) { this.calls.push("updateState"); this.row.state = state; },
  async updateSessionId() { this.calls.push("updateSessionId"); },
  async getSessionId() { return "session-1"; },
  async getActiveStateForUserId() { return this.row.chatState || null; },
  async getLastActivityTimestamp() { return this.row.lastActivity; },
  async setResumePending(userId, timeStamp) { this.calls.push("setResumePending"); this.row.resumePendingAt = timeStamp; },
  async clearResumePending() { this.calls.push("clearResumePending"); this.row.resumePendingAt = null; },
  async getResumePendingAt() { return this.row.resumePendingAt; },
});

const sessionManager = require(path.join(sessionDir, "session-manager.js"));
const ChatService = require(path.join(sessionDir, "chat-service.js"));
const chatService = new ChatService(sessionManager);

const user = { userId: "u1", mobileNumber: "258840000000", locale: "pt_PT" };

function model({ input = "1", cancel = false, reset = false } = {}) {
  return {
    user,
    extraInfo: { tenantId: "mz", whatsAppBusinessNumber: "258840000001" },
    getMessage: () => ({
      getInputMessage: () => input,
      isCancel: () => cancel,
      isReset: () => reset,
    }),
  };
}

test("an expired session marks the prompt on the row, not in memory", async () => {
  repo.calls = [];
  repo.row = { chatState: { toPersistableState: () => ({ state: "{}" }), context: {} }, resumePendingAt: null, lastActivity: Date.now() - AVG_SESSION_MINUTES * 60 * 1000 * 2 };

  const result = await chatService.getOrCreateChatState("u1", user, model());

  assert.equal(result, null, "the turn stops until the citizen answers");
  assert.ok(repo.calls.includes("setResumePending"), "the marker is persisted");
  assert.ok(repo.row.resumePendingAt > 0);
});

test("the prompt survives a restart: a pending row still intercepts", async () => {
  repo.row.resumePendingAt = Date.now();
  assert.equal(await chatService.resumePromptVerdict("u1", model({ input: "1" })), "answer");
});

test("cancel and reset are treated as the word, not as an answer", async () => {
  repo.row.resumePendingAt = Date.now();
  assert.equal(await chatService.resumePromptVerdict("u1", model({ input: "cancelar", cancel: true })), "override");

  repo.row.resumePendingAt = Date.now();
  assert.equal(await chatService.resumePromptVerdict("u1", model({ input: "reiniciar", reset: true })), "override");
});

test("a reset word restarts the session instead of re-prompting", async () => {
  // Regression: the verdict used to clear the marker and report "not pending", so
  // dispatch fell through, found the session still expired, set the marker again
  // and re-sent the same prompt. Only "2" could escape it. Asserting the boolean
  // is what let that through, so this asserts the repo calls instead.
  repo.calls = [];
  repo.row.resumePendingAt = Date.now();
  repo.row.chatState = { toPersistableState: () => ({ state: "{}" }), context: {} };
  sent.length = 0;

  await chatService.dispatch({ userId: "u1", user }, model({ input: "reiniciar", reset: true }));
  await flush();

  assert.ok(repo.calls.includes("clearResumePending"), "the marker is dropped");
  assert.ok(!repo.calls.includes("setResumePending"), "and NOT set again - that was the bug");
});

test("a prompt nobody ever answered stops intercepting", async () => {
  repo.row.resumePendingAt = Date.now() - (AVG_SESSION_MINUTES + 1) * 60 * 1000;
  assert.equal(await chatService.resumePromptVerdict("u1", model({ input: "ola" })), "abandoned");
});

test("answering 1 reads the expired state back from the row and clears the marker", async () => {
  repo.calls = [];
  repo.row.resumePendingAt = Date.now();
  repo.row.chatState = { toPersistableState: () => ({ state: '{"resumed":true}' }), context: { lastPrompt: "Onde?" } };
  sent.length = 0;

  await chatService.resolveResumeChoice({ userId: "u1", user }, model({ input: "1" }));
  await flush();

  assert.ok(repo.calls.includes("clearResumePending"));
  assert.ok(repo.calls.includes("updateState"));
  assert.equal(repo.row.state, '{"resumed":true}');
  assert.deepEqual(sent, ["Onde?"], "the citizen gets the prompt they were on");
});
