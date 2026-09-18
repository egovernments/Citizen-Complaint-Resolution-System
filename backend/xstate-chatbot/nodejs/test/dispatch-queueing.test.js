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

const MAX_QUEUED = 3;

stub("../env-variables", sessionDir, {
  pgrUseCase: {}, supportedLocales: "pt_PT", defaultLocale: "pt_PT",
  allowedMobileNumbers: "", rootTenantId: "mz", timeZone: "Africa/Maputo",
  dateFormat: "DD/MM/YYYY", egovServices: {}, kafka: {},
  instituteNameMaxLength: 300, descriptionMinLength: 20,
  avgSessionTime: 30, dispatchSettleTimeoutMs: 30000,
  replyCooldownMs: 0,                // no cooldown, so the test is fast
  maxQueuedMessagesPerUser: MAX_QUEUED,
});
stub("./service/service-loader", machineDir, { pgrService: {} });
stub("./service/egov-user-profile", machineDir, { updateUser: async () => ({}) });
stub("./service/email-tenant-service", machineDir, {});
stub("./util/localisation-service", machineDir, {
  getMessageBundleForCode: () => undefined, getLocales: () => [], init: () => {},
});
stub("../channel", sessionDir, { processMessageFromUser: async () => null, sendMessageToUser: async () => {} });
stub("./telemetry", sessionDir, { log: () => {} });
stub("./system", sessionDir, { error: () => {} });
stub("./user-service", sessionDir, {});
stub("./repo", sessionDir, {});

const sessionManager = require(path.join(sessionDir, "session-manager.js"));

/** Replace the real dispatch with a recorder that takes a controllable amount of time. */
function instrument({ durationMs = 5 } = {}) {
  const started = [];
  const finished = [];
  sessionManager._authenticateAndDispatch = async (model) => {
    const tag = model.message.input;
    started.push(tag);
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    finished.push(tag);
    return "u-1";
  };
  return { started, finished };
}

const model = (input) => ({ user: { mobileNumber: "840000000" }, message: { type: "text", input } });

test("a message arriving mid-turn is queued, not discarded", async () => {
  const { started, finished } = instrument();

  const first = sessionManager.authenticateAndDispatch(model("one"));
  const second = sessionManager.authenticateAndDispatch(model("two"));
  await Promise.all([first, second]);

  assert.deepEqual(started, ["one", "two"], "both were processed");
  assert.deepEqual(finished, ["one", "two"], "in arrival order");
});

test("the second turn starts only after the first finishes", async () => {
  const order = [];
  sessionManager._authenticateAndDispatch = async (model) => {
    order.push(`start:${model.message.input}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push(`end:${model.message.input}`);
    return "u-1";
  };

  await Promise.all([
    sessionManager.authenticateAndDispatch(model("a")),
    sessionManager.authenticateAndDispatch(model("b")),
  ]);

  assert.deepEqual(order, ["start:a", "end:a", "start:b", "end:b"], "no overlap for one citizen");
});

test("different citizens are not serialized against each other", async () => {
  const active = { count: 0, peak: 0 };
  sessionManager._authenticateAndDispatch = async () => {
    active.count += 1;
    active.peak = Math.max(active.peak, active.count);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active.count -= 1;
    return "u-1";
  };

  await Promise.all([
    sessionManager.authenticateAndDispatch({ user: { mobileNumber: "840000000" }, message: { type: "text", input: "x" } }),
    sessionManager.authenticateAndDispatch({ user: { mobileNumber: "840000002" }, message: { type: "text", input: "y" } }),
  ]);

  assert.equal(active.peak, 2, "two citizens are handled concurrently");
});

test("beyond the cap a message is dropped rather than queued forever", async () => {
  const { started } = instrument({ durationMs: 10 });

  const pending = [];
  for (const tag of ["1", "2", "3", "4", "5"]) {
    pending.push(sessionManager.authenticateAndDispatch(model(tag)));
  }
  await Promise.all(pending);

  assert.equal(started.length, MAX_QUEUED, `only ${MAX_QUEUED} were accepted`);
  assert.deepEqual(started, ["1", "2", "3"], "the earliest messages win, not the latest");
});

test("a failing turn does not block the message behind it", async () => {
  const seen = [];
  sessionManager._authenticateAndDispatch = async (model) => {
    seen.push(model.message.input);
    if (model.message.input === "boom") throw new Error("dispatch failed");
    return "u-1";
  };

  const first = sessionManager.authenticateAndDispatch(model("boom"));
  const second = sessionManager.authenticateAndDispatch(model("after"));
  await Promise.allSettled([first, second]);

  assert.deepEqual(seen, ["boom", "after"], "the next message is still processed");
});
