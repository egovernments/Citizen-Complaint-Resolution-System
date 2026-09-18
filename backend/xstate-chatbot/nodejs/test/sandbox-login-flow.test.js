const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sessionDir = path.join(projectRoot, "src/session");

function stub(request, from, exports) {
  const filename = require.resolve(request, { paths: [from] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return exports;
}

stub("../env-variables", sessionDir, { rootTenantId: "mz", countryCode: "258", defaultLocale: "pt_PT", supportedLocales: "pt_PT" });
stub("./repo", sessionDir, {});
stub("./user-service", sessionDir, {});
stub("../machine/service/email-tenant-service", sessionDir, {
  getSandboxRegistrationUrl: (email) => `https://sandbox.example/register?email=${email}`,
});

const SandboxLoginFlow = require(path.join(sessionDir, "sandbox-login-flow.js"));
const { NotRegisteredError, ExternalServiceError } = require(path.join(sessionDir, "errors.js"));

function harness({ authenticateUser } = {}) {
  const sent = [];
  const deleted = [];
  const tracker = {
    expireIfStale: () => {},
    isWaitingForEmail: () => false,
    isWaitingForOrgSelection: () => false,
    delete: (n) => deleted.push(n),
    set: () => {},
  };
  const model = {
    user: { mobileNumber: "840000000" },
    extraInfo: { tenantId: "mz" },
    getMessage: () => ({ isGreeting: () => false, getInputMessage: () => "x" }),
  };

  const flow = new SandboxLoginFlow(model, tracker, authenticateUser, async (user, messages) => {
    sent.push({ mobileNumber: user.mobileNumber, messages });
  });
  return { flow, sent, deleted };
}

test("a login prompt goes through the injected queued sender", async () => {
  // It used to call channelProvider.sendMessageToUser directly and unawaited,
  // bypassing the per-user ordering in SessionManager.toUser.
  const { flow, sent } = harness();

  const result = await flow.notifyAndStop(["Enter your registered email address"]);

  assert.equal(result, null, "the turn still stops");
  assert.equal(sent.length, 1, "exactly one queued send");
  assert.equal(sent[0].mobileNumber, "840000000");
  assert.deepEqual(sent[0].messages, ["Enter your registered email address"]);
});

test("notifyAndStop resolves only after the send completes", async () => {
  let delivered = false;
  const model = {
    user: { mobileNumber: "840000000" },
    extraInfo: {},
    getMessage: () => ({ isGreeting: () => false }),
  };
  const flow = new SandboxLoginFlow(model, {}, null, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    delivered = true;
  });

  await flow.notifyAndStop(["hello"]);

  assert.equal(delivered, true, "a later reply cannot overtake this prompt");
});

test("an infrastructure failure keeps the citizen's progress", async () => {
  // Previously ANY error deleted the tracker and told the citizen to re-register.
  const { flow, sent, deleted } = harness({
    authenticateUser: async () => { throw new ExternalServiceError("user/_search failed with status 503"); },
  });

  await assert.rejects(
    () => flow.authenticateForOrg({ code: "mz.ige", name: "IGE" }, "citizen@example.mz"),
    /503/,
    "the real error surfaces"
  );
  assert.deepEqual(deleted, [], "the tracker is preserved");
  assert.deepEqual(sent, [], "no misleading registration prompt");
});

test("a genuine not-registered result does send them to register", async () => {
  const { flow, sent, deleted } = harness({
    authenticateUser: async () => { throw new NotRegisteredError("no membership for mz.ige"); },
  });

  const result = await flow.authenticateForOrg({ code: "mz.ige", name: "IGE" }, "citizen@example.mz");

  assert.equal(result, null);
  assert.deepEqual(deleted, ["840000000"], "the stale tracker entry is cleared");
  assert.equal(sent.length, 1);
  assert.match(sent[0].messages[0], /not registered with IGE/);
  assert.match(sent[0].messages[0], /84\*\*\*\*\*00/, "the number is masked");
});
