const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sessionDir = path.join(projectRoot, "src/session");
const machineDir = path.join(projectRoot, "src/machine");

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function stub(request, from, exports) {
  const filename = require.resolve(request, { paths: [from] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return filename;
}

// Machine-side collaborators first, so requiring state-machine.js does no I/O.
stub("../env-variables", sessionDir, {
  pgrUseCase: {},
  supportedLocales: "en_IN",
  allowedMobileNumbers: "",
  rootTenantId: "pg",
  timeZone: "Africa/Maputo",
  dateFormat: "DD/MM/YYYY",
  egovServices: {},
  kafka: {},
  instituteNameMaxLength: 300,
  descriptionMinLength: 20,
});
stub("./service/service-loader", machineDir, { pgrService: {} });
stub("./service/egov-user-profile", machineDir, { updateUser: async () => ({}) });
stub("./service/email-tenant-service", machineDir, {});
stub("./util/localisation-service", machineDir, {
  getMessageBundleForCode: () => undefined,
  getLocales: () => [{ value: "en_IN", label: "ENGLISH" }],
  init: () => {},
});

// Session-side collaborators: no channel, no database, no telemetry.
const sent = [];
stub("../channel", sessionDir, {
  processMessageFromUser: async () => null,
  sendMessageToUser: async (user, messages) => {
    sent.push(...messages);
  },
});
stub("./repo", sessionDir, {
  updateState: async () => {},
  getSessionId: async () => "session-1",
  insertNewState: async () => {},
  getActiveStateForUserId: async () => null,
});
stub("./telemetry", sessionDir, { log: () => {} });
stub("./system", sessionDir, { error: () => {} });
stub("./user-service", sessionDir, {});

const sessionManager = require(path.join(sessionDir, "session-manager.js"));
const ChatService = require(path.join(sessionDir, "chat-service.js"));
const ChatState = require(path.join(sessionDir, "chat-state.js"));
const stateMachine = require(path.join(machineDir, "state-machine.js"));
const { interpret, State } = require("xstate");

const chatService = new ChatService(sessionManager);

function reformattedMessage() {
  return {
    user: { userId: "u1", mobileNumber: "258840000000", locale: "en_IN" },
    extraInfo: { tenantId: "mz.ige", whatsAppBusinessNumber: "258840000001" },
    message: { type: "text", input: "1" },
  };
}

function persistedState(mutate) {
  const service = interpret(
    stateMachine.withContext({
      chatInterface: sessionManager,
      user: { userId: "u1", mobileNumber: "258840000000", locale: "en_IN" },
      extraInfo: { tenantId: "mz.ige" },
      slots: { pgr: {} },
    })
  );
  service.start();
  const json = JSON.parse(JSON.stringify(service.state));
  service.stop();
  if (mutate) mutate(json);
  return ChatState.create(json);
}

test("a valid persisted state is resumed in place", () => {
  const chatState = persistedState();
  const service = chatService.getStateMachineServiceFor(chatState, reformattedMessage());
  assert.equal(JSON.stringify(service.state.value), JSON.stringify(chatState.value));
  service.stop();
});

test("a persisted state naming a state the machine no longer has falls back to start", () => {
  const chatState = persistedState((json) => {
    json.value = { pgr: { fileComplaint: { type: { complaintType2Step: "GONE" } } } };
  });

  // Precondition: without the fallback this value really does throw, so the
  // assertion below is not vacuous.
  assert.throws(
    () =>
      stateMachine
        .withContext(chatState.context)
        .resolveState(State.create(chatState.raw)),
    /does not exist/
  );

  let service;
  assert.doesNotThrow(() => {
    service = chatService.getStateMachineServiceFor(chatState, reformattedMessage());
  });
  assert.equal(service.state.value, "start");
  service.stop();
});

test("the fallback discards stale scratch context but keeps the user and tenant", () => {
  const chatState = persistedState((json) => {
    json.value = { pgr: { fileComplaint: { location: { boundary: "NOPE" } } } };
    json.context.slots.pgr = { complaint: "STALE", boundaryPath: ["OLD"] };
    json.context.grammer = [{ intention: "STALE", recognize: ["1"] }];
    json.context.boundaryStep = { options: ["STALE"] };
  });

  const service = chatService.getStateMachineServiceFor(chatState, reformattedMessage());
  const context = service.state.context;
  assert.deepEqual(context.slots.pgr, {});
  assert.equal(context.grammer, undefined);
  assert.equal(context.boundaryStep, undefined);
  assert.equal(context.user.userId, "u1");
  assert.equal(context.extraInfo.tenantId, "mz.ige");
  service.stop();
});

test("a discarded session recovers on the next message instead of staying stuck", async () => {
  const chatState = persistedState((json) => {
    json.value = { pgr: { fileComplaint: { type: { complaintType2Step: "GONE" } } } };
  });
  const service = chatService.getStateMachineServiceFor(chatState, reformattedMessage());
  assert.equal(service.state.value, "start");
  sent.length = 0;
  service.send({ type: "USER_MESSAGE", message: { type: "text", input: "hi" } });
  assert.notEqual(service.state.value, "start", "start must route the message onward");
  // toUser queues the send behind a promise chain now (session-manager.js),
  // so it lands a microtask after service.send() returns, not synchronously.
  await flush();
  assert.ok(sent.length > 0, "the citizen must receive something, not silence");
  service.stop();
});
