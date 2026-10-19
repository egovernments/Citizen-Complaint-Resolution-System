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
  pgrUseCase: {}, supportedLocales: "pt_PT", defaultLocale: "pt_PT",
  allowedMobileNumbers: "", rootTenantId: "mz", timeZone: "Africa/Maputo",
  dateFormat: "DD/MM/YYYY", egovServices: {}, kafka: {},
  instituteNameMaxLength: 300, descriptionMinLength: 20,
  avgSessionTime: 30, replyCooldownMs: 0, maxQueuedMessagesPerUser: 3,
  timeouts: { request: 20000, mediaProcessing: 13000, dispatchSettle: 30000 },
});
stub("./service/service-loader", machineDir, { pgrService: {} });
stub("./service/egov-user-profile", machineDir, { updateUser: async () => ({}) });
stub("./service/email-tenant-service", machineDir, {});
stub("./util/localisation-service", machineDir, {
  getMessageBundleForCode: () => undefined, getLocales: () => [], init: () => {},
});
stub("./system", sessionDir, { error: () => {} });
stub("./user-service", sessionDir, {});
stub("./repo", sessionDir, {});

const logged = [];
stub("./telemetry", sessionDir, { log: (id) => { logged.push(id); } });

// Every send parks until released, so "did B wait for A?" is observable.
const inFlight = [];
stub("../channel", sessionDir, {
  processMessageFromUser: async () => null,
  sendMessageToUser: (user) =>
    new Promise((resolve) => { inFlight.push({ to: user.mobileNumber, resolve }); }),
});

const sessionManager = require(path.join(sessionDir, "session-manager.js"));

function reset() {
  inFlight.length = 0;
  logged.length = 0;
}

test("two pre-auth citizens do not queue behind each other", async () => {
  // Both have no userId yet — sandbox login asks for an email before any user
  // exists. Keyed on undefined they shared one chain, so the second citizen's
  // prompt waited on the first one's Twilio call.
  reset();

  sessionManager.toUser({ mobileNumber: "840000001" }, ["email?"], {});
  sessionManager.toUser({ mobileNumber: "840000002" }, ["email?"], {});
  await flush();

  assert.equal(inFlight.length, 2, "both sends started; neither is blocked on the other");
  assert.deepEqual(inFlight.map((s) => s.to).sort(), ["840000001", "840000002"]);

  inFlight.forEach((s) => s.resolve());
});

test("one citizen's sends still go out in order", async () => {
  reset();

  sessionManager.toUser({ mobileNumber: "840000001" }, ["welcome"], {});
  sessionManager.toUser({ mobileNumber: "840000001" }, ["menu"], {});
  await flush();

  assert.equal(inFlight.length, 1, "the menu waits for the welcome to land");

  inFlight[0].resolve();
  await flush();
  await flush();
  assert.equal(inFlight.length, 2, "and follows it, rather than racing it");

  inFlight.forEach((s) => s.resolve());
});

test("a pre-auth send is logged under a masked number, never undefined", async () => {
  reset();

  sessionManager.toUser({ mobileNumber: "840000001" }, ["email?"], {});
  await flush();

  assert.equal(logged.length, 1);
  assert.notEqual(logged[0], undefined, "the telemetry topic had every pre-auth send under `undefined`");
  assert.doesNotMatch(logged[0], /840000001/, "and the raw number must not reach Kafka");

  inFlight.forEach((s) => s.resolve());
});
