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
  avgSessionTime: 30,
  timeouts: { request: 20000, mediaProcessing: 13000, dispatchSettle: 30000 },
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

// The settle timeout itself is exercised in invoke-state.test.js. Here we only
// need to control its VERDICT, so the two dispatch outcomes can be driven
// without waiting on a real hung invocation.
const invoke = { settled: true };
stub("./invoke-state", sessionDir, {
  hasActiveInvoke: () => false,
  waitUntilSettled: async () => invoke.settled,
});

const repo = stub("./repo", sessionDir, {
  writes: [],
  calls: [],
  async insertNewState() { this.calls.push("insertNewState"); },
  async updateState(userId, active, state) { this.calls.push("updateState"); this.writes.push({ active, state }); },
  async updateSessionId() { this.calls.push("updateSessionId"); },
  async getSessionId() { return "session-1"; },
  async getActiveStateForUserId() { return null; },     // virgin dialog every time
  async getLastActivityTimestamp() { return null; },
  async getResumePendingAt() { return null; },
  async clearResumePending() { this.calls.push("clearResumePending"); },
  async setResumePending() { this.calls.push("setResumePending"); },
});

const sessionManager = require(path.join(sessionDir, "session-manager.js"));
const ChatService = require(path.join(sessionDir, "chat-service.js"));
const chatService = new ChatService(sessionManager);

// A returning citizen: locale AND a real name, so the onboarding gate lets
// them straight through to the flow under test.
const user = { userId: "u1", mobileNumber: "258840000000", locale: "pt_PT", name: "Feliciano" };
const session = { userId: "u1", user };

function model(input = "ola") {
  return {
    user,
    extraInfo: { tenantId: "mz", whatsAppBusinessNumber: "258840000001" },
    message: { type: "text", input },   // the transition telemetry reads this directly
    getMessage: () => ({
      getInputMessage: () => input,
      isCancel: () => false,
      isReset: () => false,
    }),
  };
}

function reset({ settled }) {
  repo.calls = [];
  repo.writes = [];
  sent.length = 0;
  invoke.settled = settled;
}

test("an ordinary message runs the whole dispatch path", async () => {
  // Regression: a refactor of the resume-prompt gate dropped dispatch's
  // getOrCreateChatState call, leaving `chatState` undefined a few lines later.
  // Every non-cancel, non-resume message threw ReferenceError. Nothing caught
  // it because the only dispatch test at the time returned early on the
  // cancel/reset branch, so no test ever reached the state machine.
  reset({ settled: true });

  await chatService.dispatch(session, model());
  await flush();

  assert.ok(repo.calls.includes("insertNewState"), "a virgin dialog was created and persisted");
  assert.ok(sent.length > 0, "the citizen got a reply");
});

test("a clean settle leaves the session open", async () => {
  reset({ settled: true });

  await chatService.dispatch(session, model());
  await flush();

  assert.ok(
    !repo.writes.some((w) => w.active === false),
    "nothing closed the session"
  );
});

test("a stalled invocation closes the session instead of leaving it mid-submission", async () => {
  // The machine is stopped with its state unpersisted, so the row still holds
  // the step BEFORE the submission. Resuming there would put the citizen back
  // on the confirm prompt, where their next "1" files a second complaint.
  reset({ settled: false });

  await chatService.dispatch(session, model());
  await flush();

  assert.ok(
    repo.writes.some((w) => w.active === false),
    "the session is marked inactive, so the next message starts clean"
  );
  assert.ok(
    sent.some((m) => typeof m === "string" && m.includes("não foi possível concluir o seu pedido")),
    "and the citizen is told, rather than left waiting for a reply that never comes"
  );
});
